import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { LlmRuntime, LlmAdapter, LlmError, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { TokenMeter } from '@deepseek-ai/dsh-token-meter';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import BudgetEngine from './compaction.js';
import { planBudget, admissionPolicy, createRequestPricer, measuredRequestPrice } from './context-budget-plan.js';

async function scenario(name, options = {}) {
  const ctx = new Context();
  const fibers = [];
  let handle;
  let summaries = 0, requests = 0, checkpoints = 0, attempts = 0, overflow = 0;
  let maxPrice = 0, maxMessages = 0, userCount = 0;
  let toolCount = 0, cancellations = 0;
  let persona = '';
  let maxSurface = 0;
  let failure = null;
  const declared = options.declared === undefined ? 32768 : options.declared;
  const actual = options.actual ?? 32768;
  const policy = { workingInputCap: options.cap ?? 10000, unknownInputCap: 10000,
    ...(options.maxOverflowRetries === undefined ? {} : { maxOverflowRetries: options.maxOverflowRetries }),
    ...(options.auto === false ? { auto: false } : {}),
    ...(options.defaultSummaryBudget ? {} : { maxTokens: 512 }) };
  const output = 256;
  const price = createRequestPricer({ imageRequestPricing: () => null, fileRequestText: () => '' });
  const start = performance.now();
  try {
    for (const [plugin, config] of [
      [SessionProjectionRegistry], [SessionStore], [AgentRegistry], [LlmRuntime],
      [SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }],
      [ToolRuntime, { mode: 'native' }], [TokenMeter],
      [AgentDefaultModel, { provider: 'synthetic-only', model: name }],
      [AgentLoop, {}], [LlmRetry], [BudgetEngine, policy],
    ]) fibers.push(await ctx.plugin(plugin, config));
    if (options.personaChanges) ctx.systemPrompt.section({ name: 'persona-budget-regression', order: 1, text: () => persona });
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message' && event.data.source.kind === 'user') userCount++;
      if (event.type === 'compaction/summary') checkpoints++;
      if (event.type === 'assistant/attempt') attempts++;
      if (event.type === 'turn/end' && event.data.reason.kind === 'error') failure = event.data.reason.error;
      if (event.type === 'turn/end' && event.data.reason.kind === 'aborted') cancellations++;
    });
    if (options.toolSteps) ctx.tools.register({
      name: 'synthetic_tool', description: 'Synthetic test operation',
      parameters: { type: 'object', properties: { step: { type: 'integer' } }, required: ['step'], additionalProperties: false },
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: value.body }] },
      execute: async ({ step }) => {
        assert.equal(step, toolCount, 'tool side effects must execute exactly once in order');
        toolCount++;
        return { body: `COMPLETED_STEP_${step}: ${'x'.repeat(options.toolBytes ?? 4000)}` };
      },
    });
    class Adapter extends LlmAdapter {
      async resolveModel(provider, model) {
        return { provider, id: model, name: model, ...(declared ? { context: { contextWindow: declared } } : {}),
          defaultMaxTokens: output, inputModalities: ['text'], systemPromptUpdate: 'in-history' };
      }
      async *stream(request) {
        assert.equal(request.provider, 'synthetic-only');
        const estimated = price(request);
        if (request.purpose === 'compaction') {
          summaries++;
          if (estimated + request.maxTokens > actual) throw new LlmError('synthetic summary overflow', 'CONTEXT_WINDOW_EXCEEDED');
          if (options.summaryAuth) throw new LlmError('synthetic summary credential failure', 'AUTH');
          if (options.summaryCancel && summaries === 1) {
            handle.agent.cancel({ kind: 'user' });
            request.signal.throwIfAborted();
          }
        } else {
          requests++;
          if (options.personaChanges) assert.equal(request.messages.filter(m => m.role === 'system')
            .flatMap(m => m.content).filter(b => b.type === 'text').at(-1)?.text, persona);
          assert.ok(Object.isFrozen(request) && Object.isFrozen(request.messages));
          const latest = request.messages.findLast(m => m.role === 'user' && m.source.kind === 'user');
          assert.ok(latest, 'latest student input must remain verbatim');
          assert.match(latest.content[0].text, /^student-input-/);
          maxPrice = Math.max(maxPrice, estimated);
          maxMessages = Math.max(maxMessages, request.messages.length);
          if (estimated + output > actual) { overflow++; throw new LlmError('synthetic context overflow', 'CONTEXT_WINDOW_EXCEEDED'); }
          if (toolCount < (options.toolSteps ?? 0)) {
            const id = `synthetic-call-${toolCount}`;
            yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'synthetic_tool', arguments: JSON.stringify({ step: toolCount }) } };
            yield { type: 'usage', usage: { inputTokens: estimated, outputTokens: 12 } };
            yield { type: 'finish', reason: { kind: 'tool-calls' } };
            return;
          }
        }
        // No oracle facts are placed in this intentionally lossy checkpoint.
        const text = request.purpose ? 'Synthetic continuity checkpoint; retrieve original history for exact earlier details.' : 'Synthetic reply.';
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'usage', usage: { inputTokens: estimated, outputTokens: 4 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['synthetic-only'], new Adapter());
    handle = await ctx.agents.create({ sessionId: SessionId(`probe-${name}`),
      agentOptions: { provider: 'synthetic-only', model: name, maxTokens: output } });
    const count = options.count ?? 120;
    let sent = 0;
    for (; sent < count; sent++) {
      if (options.personaChanges) persona = `PERSONA_${sent}:` + 'p'.repeat(4000);
      const text = `student-input-${sent}: ${options.huge ? '超'.repeat(100000) : '上下文预算测试原话不能改变'.repeat(80)}`;
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
      await handle.agent.whenIdle();
      maxSurface = Math.max(maxSurface, handle.agent.session.surface.nodes.length);
      if (failure) { sent++; break; }
    }
    assert.equal(userCount, sent, 'retry may not duplicate student input');
    if (options.huge || options.summaryAuth || options.maxOverflowRetries === 0) assert.ok(failure, 'irreducible input or disabled recovery must fail');
    else {
      assert.equal(failure, null);
      if (options.auto === false) assert.equal(checkpoints, 0);
      else assert.ok(checkpoints > 0);
      assert.equal(requests - overflow, count + (options.toolSteps ?? 0) - cancellations);
      assert.equal(attempts, overflow, 'budget preflight must not create a fake provider attempt');
    }
    if (options.huge) { assert.equal(requests, 0); assert.equal(summaries, 0); }
    if (options.summaryAuth) assert.equal(summaries, 1);
    if (options.maxOverflowRetries === 0) { assert.equal(summaries, 0); assert.equal(overflow, 1); }
    if (options.toolSteps) assert.equal(toolCount, options.toolSteps);
    if (options.summaryCancel) assert.equal(cancellations, 1);
    if (options.personaChanges) assert.ok(maxSurface < 150, `normalized empty system nodes must not fragment old ranges (${maxSurface})`);
    const result = { name, sent, requests, summaries, checkpoints, attempts, overflow, maxPrice, maxMessages,
      events: handle.agent.session.seq, surface: handle.agent.session.surface.nodes.length,
      failure, toolCount, cancellations, ms: Math.round(performance.now() - start), rss: process.memoryUsage().rss };
    return result;
  } finally {
    if (handle) await handle.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
  }
}

async function softRetentionScenario(name, explicitRetention) {
  const ctx = new Context();
  const fibers = [];
  let handle;
  let engine;
  let toolCalls = 0;
  let pressurePhase = false;
  const pressureInputs = [];
  const mainPrices = [];
  let failure;
  const inputCap = 9000;
  const pressureMarker = 'LATEST_PRESSURE_USER_ONLY';
  const giantMarker = 'GIANT_TOOL_RESULT_MARKER';
  const policy = { workingInputCap: inputCap, unknownInputCap: inputCap, maxTokens: 512,
    ...(explicitRetention ? { retainTokens: 3500 } : {}) };
  const price = createRequestPricer({ imageRequestPricing: () => null, fileRequestText: () => '' });
  try {
    for (const [plugin, config] of [
      [SessionProjectionRegistry], [SessionStore], [AgentRegistry], [LlmRuntime],
      [SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }],
      [ToolRuntime, { mode: 'native' }], [TokenMeter],
      [AgentDefaultModel, { provider: 'synthetic-only', model: name }],
      [AgentLoop, {}], [LlmRetry], [BudgetEngine, policy],
    ]) fibers.push(await ctx.plugin(plugin, config));
    engine = ctx.get('compaction');
    assert.ok(engine && typeof engine.compactRegion === 'function', 'the scenario must use the native compaction engine');
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end' && event.data.reason.kind === 'error') failure = event.data.reason.error;
    });
    ctx.tools.register({
      name: 'synthetic_tool', description: 'Synthetic paired operation',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: value.body }] },
      execute: async () => {
        toolCalls++;
        return { body: `${giantMarker}\n${'g'.repeat(16500)}` };
      },
    });
    let toolCallIssued = false;
    class Adapter extends LlmAdapter {
      async resolveModel(provider, model) {
        return { provider, id: model, name: model, context: { contextWindow: 32768 },
          defaultMaxTokens: 256, inputModalities: ['text'], systemPromptUpdate: 'in-history' };
      }
      async *stream(request) {
        const estimated = price(request);
        if (request.purpose === 'compaction') {
          if (pressurePhase) pressureInputs.push(JSON.stringify(request.messages));
          const text = pressurePhase && explicitRetention
            ? `NONSHRINKING_EXPLICIT_RETENTION_${'n'.repeat(3000)}`
            : 'SHORT_SYNTHETIC_CONTINUITY_CHECKPOINT';
          yield { type: 'block-end', index: 0, block: { type: 'text', text } };
          yield { type: 'usage', usage: { inputTokens: estimated, outputTokens: 16 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
          return;
        }
        const latest = request.messages.findLast(message => message.role === 'user' && message.source.kind === 'user');
        assert.ok(latest, 'native request retains a real latest user message');
        const latestText = latest.content.map(block => block.text ?? '').join('');
        mainPrices.push(estimated);
        if (pressurePhase && latestText.includes(pressureMarker)) {
          assert.ok(estimated <= inputCap, 'a recovered request fits the unchanged admission cap');
        }
        if (!pressurePhase && latestText.includes('RUN_GIANT_TOOL_TURN') && !toolCallIssued) {
          assert.ok(estimated < inputCap, 'the complete tool call begins below the admission cap');
          toolCallIssued = true;
          yield { type: 'block-end', index: 0, block: {
            type: 'tool-call', id: 'synthetic-giant-call', name: 'synthetic_tool', arguments: '{}',
          } };
          yield { type: 'usage', usage: { inputTokens: estimated, outputTokens: 12 } };
          yield { type: 'finish', reason: { kind: 'tool-calls' } };
          return;
        }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic reply.' } };
        yield { type: 'usage', usage: { inputTokens: estimated, outputTokens: 4 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['synthetic-only'], new Adapter());
    handle = await ctx.agents.create({ sessionId: SessionId(`probe-${name}`),
      agentOptions: { provider: 'synthetic-only', model: name, maxTokens: 256 } });

    const oldSource = `OLD_SOURCE_FOR_SHORT_CHECKPOINT\n${'old '.repeat(1600)}`;
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: oldSource }] }));
    await handle.agent.whenIdle();
    assert.equal(failure, undefined);
    assert.ok(handle.agent.session.deriveMessages().some(message => message.role === 'assistant'), 'seed turn has a completed assistant reply');
    await engine.compactNow(handle.agent, new AbortController().signal);
    const checkpoint = handle.agent.session.deriveMessages().find(message => message.source?.kind === 'compact-checkpoint');
    assert.ok(checkpoint, 'a real native compaction transaction creates the short old checkpoint');
    assert.match(checkpoint.content.map(block => block.text ?? '').join(''), /SHORT_SYNTHETIC_CONTINUITY_CHECKPOINT/);

    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'RUN_GIANT_TOOL_TURN' }] }));
    await handle.agent.whenIdle();
    assert.equal(failure, undefined);
    assert.equal(toolCalls, 1, 'the native tool call/result pair executes once');
    const afterToolMessages = handle.agent.session.deriveMessages();
    assert.ok(afterToolMessages.some(message => message.content.some(block => block.text?.includes(giantMarker))), 'the large tool result is present before pressure');
    const afterToolLatest = afterToolMessages.findLast(message => message.role === 'user' && message.source.kind === 'user');
    assert.equal(afterToolLatest?.content[0]?.text, 'RUN_GIANT_TOOL_TURN');
    pressurePhase = true;
    pressureInputs.length = 0;
    const requestsBeforePressure = mainPrices.length;

    const pressureText = `${pressureMarker}\n${'current '.repeat(300)}`;
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: pressureText }] }));
    await handle.agent.whenIdle();

    assert.equal(pressureInputs.length, 1, 'one bounded pressure summary is attempted');
    const pressureInput = pressureInputs[0];
    assert.ok(pressureInput.includes(pressureMarker) === false, 'the latest real user input is never included in an old summary range');
    if (explicitRetention) {
      assert.equal(mainPrices.length, requestsBeforePressure, 'request admission rejects before starting a provider attempt');
      assert.equal(toolCalls, 1);
      assert.ok(pressureInput.includes('SHORT_SYNTHETIC_CONTINUITY_CHECKPOINT'), 'explicit retention keeps the selected range at the short checkpoint');
      assert.ok(!pressureInput.includes(giantMarker), 'explicit retention does not expand the selected range over the large tool pair');
      assert.match(failure?.message ?? '', /summary is not smaller than the shadowed content/);
      const surviving = handle.agent.session.deriveMessages();
      assert.ok(surviving.some(message => message.content.some(block => block.text?.includes(giantMarker))), 'failed compaction leaves the original tool result on the surface');
      assert.equal(surviving.findLast(message => message.role === 'user' && message.source.kind === 'user')?.content[0]?.text, pressureText);
    } else {
      assert.equal(mainPrices.length, requestsBeforePressure + 1, 'successful recovery starts exactly one bounded retry');
      assert.ok(pressureInput.includes('SHORT_SYNTHETIC_CONTINUITY_CHECKPOINT'), 'the larger fallback spans the short checkpoint as well as the oversized pair');
      assert.ok(pressureInput.includes(giantMarker), 'default soft retention falls back to the larger old range containing the complete tool result');
      assert.ok(pressureInput.includes('synthetic_tool'), 'the fallback range includes the matching tool-call side');
      assert.equal(failure, undefined);
      const recovered = handle.agent.session.deriveMessages();
      assert.equal(recovered.findLast(message => message.role === 'user' && message.source.kind === 'user')?.content[0]?.text, pressureText);
      assert.ok(!recovered.some(message => message.content.some(block => block.text?.includes(giantMarker))), 'the oversized pair was replaced by a compact checkpoint');
      assert.ok(mainPrices.at(-1) <= inputCap, 'the retried full request is within the cap');
    }
  } finally {
    if (handle) await handle.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
  }
}

test('planning limits preserve unknown capacity and reject an envelope with no input space', () => {
  assert.equal(planBudget({ contextWindow: undefined }).known, null);
  assert.equal(planBudget({ contextWindow: 8192, maxTokens: 8192 }).inputCap, 0);
  assert.equal(measuredRequestPrice({ surfaceTokens: 1000, totalTokens: 12000, surfaceDeltaTokens: -1000,
    baseline: { kind: 'usage', tokens: 13000 } }, undefined, 1500), 1500,
  'old usage must not create phantom pressure after a replacement');
});

test('native config validates budget limits and preserves manual-only mode', () => {
  const parsed = BudgetEngine.Config({ auto: false, workingInputCap: 10000, unknownInputCap: 8000 });
  assert.equal(parsed.auto, false);
  assert.equal(parsed.workingInputCap, 10000);
  assert.equal(parsed.unknownInputCap, 8000);
  assert.throws(() => BudgetEngine.Config({ workingInputCap: 0 }));
  assert.throws(() => BudgetEngine.Config({ unknownInputCap: 1.5 }));
});

test('soft retention expands to a larger balanced range only when the default retained range cannot reach target', { timeout: 30000 }, async () => {
  await softRetentionScenario('soft-retention-expands', false);
  await softRetentionScenario('explicit-retention-stays', true);
});

test('explicit native admission policy retains route overrides and recovery limits', () => {
  const raw = { thresholdRatio: .8, retainTokens: 1000, maxOverflowRetries: 0, compactionRetries: 0,
    modelPolicies: [{ provider: 'p', model: 'm', retainRatio: .1, thresholdRatio: .5 }] };
  const explicit = admissionPolicy(raw, 'p', 'm');
  assert.equal(explicit.retainTokens, undefined);
  const known = planBudget({ contextWindow: 10000, maxTokens: 1000, nativePolicy: explicit });
  assert.equal(known.inputCap, 5000);
  assert.equal(known.retain, 900);
  assert.equal(known.overflowLimit, 0);
  assert.equal(known.pressureLimit, 1);
  assert.equal(admissionPolicy(raw, 'else', 'm').retainTokens, 1000);
  assert.throws(() => planBudget({ contextWindow: 8000, nativePolicy: { retainTokens: 2000 } }), /retention/);
  const unknown = planBudget({ unknownInputCap: 12000, maxTokens: 1000, nativePolicy: { retainRatio: .1 } });
  assert.equal(unknown.known, null);
  assert.equal(unknown.retain, 1404);
});

// True Cordis/AgentLoop/TokenMeter/compaction transactions. Synthetic model values
// exercise routing and lifecycle; they are not evidence of real tokenizer accuracy.
for (const [name, options] of [
  ['known', {}], ['unknown', { declared: null }],
  ['small-window', { declared: 8192, actual: 8192, cap: 4500, defaultSummaryBudget: true }],
  ['provider-overflow', { cap: 24000, actual: 12500 }],
  ['huge-current-input', { huge: true }], ['summary-auth', { summaryAuth: true }],
  ['giant-tool-result', { count: 1, toolSteps: 1, toolBytes: 60000 }],
  ['long-tool-chain', { count: 1, toolSteps: 1000 }],
  ['cancel-summary', { count: 12, summaryCancel: true }],
  ['long', { count: 2000 }],
  ['manual-only', { count: 6, auto: false }],
  ['overflow-disabled', { cap: 24000, actual: 12500, maxOverflowRetries: 0 }],
  ['persona-changes', { count: 1000, cap: 8000, personaChanges: true }],
]) test(`native context budget: ${name}`, { timeout: 90000 }, () => scenario(name, options));
