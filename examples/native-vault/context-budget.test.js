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
