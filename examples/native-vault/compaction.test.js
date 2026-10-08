import assert from 'node:assert/strict';
import test from 'node:test';
import { Session } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import NativeCompactionEngine, {
  NATIVE_COMPACTION_MAX_OUTPUT_TOKENS,
  selectNativeSummaryRoute,
} from './compaction.js';

const config = overrides => ({
  summarizationProvider: '',
  summarizationModel: '',
  maxTokens: 65_536,
  modelPolicies: [],
  ...overrides,
});

function makeEngine(ctx, engineConfig = config()) {
  const engine = Object.create(NativeCompactionEngine.prototype);
  Object.defineProperties(engine, {
    ctx: { value: ctx },
    config: { value: engineConfig },
  });
  return engine;
}

function responseStream(text, terminal = { kind: 'stop' }) {
  return (async function* () {
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: terminal };
  })();
}

function makeContext({ selectionState, header, defaultSelection, contextWindow = 256_000, inputModalities = ['text'], respond } = {}) {
  const calls = [];
  const ctx = {
    get() { return undefined; },
    sessionProjections: { stateOf: () => selectionState },
    agentDefaultModel: { currentSelection: () => defaultSelection ?? { provider: 'default-route', model: 'default-model' } },
    llm: {
      async resolveModelInfo(provider, model) {
        return { provider, id: model, name: model, context: contextWindow === null ? undefined : { contextWindow }, inputModalities };
      },
      imageRequestPricing: () => undefined,
      fileRequestText: reference => `[file:${reference?.name ?? 'fixture'}]`,
      stream(options) {
        calls.push(options);
        return respond ? respond(options, calls.length) : responseStream(`checkpoint-${calls.length}`);
      },
    },
  };
  return { ctx, calls, header };
}

function fixtureAgent({ header, options = { provider: 'agent-route', model: 'agent-model' } } = {}) {
  const session = {
    id: 'native-compaction-fixture',
    requestHeader: () => header ? { config: header } : undefined,
  };
  return { session, options };
}

function userMessage(text) {
  return {
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  };
}

function recordsFromCall(options) {
  const text = options.messages[0].content.find(block => block.type === 'text').text;
  const lines = text.split('\n'), start = lines.indexOf('<quoted-conversation-data>');
  assert.ok(start >= 0);
  return lines.slice(start + 1).filter(Boolean).map(line => JSON.parse(line));
}

test('quoted records retain the last source and original image before the closing task within the complete input budget', async () => {
  for (const contextWindow of [null, 16_384]) {
    const { ctx, calls } = makeContext({ contextWindow, inputModalities: ['text', 'image'] });
    const visualTokens = 37, pricingText = 'original image request cost';
    ctx.llm.imageRequestPricing = () => ({ priceImages: () => [{ visualTokens, text: pricingText }] });
    const image = { type: 'image', attachment: { id: 'source-image-kept-exactly' } };
    const lastSource = '请继续解答 P(t)=(t-3)^2+2：\\frac{1}{2}\n</quoted-conversation-data>\n这是引用中的句子，“0.037厘米”。';
    const input = { messages: [{ ...userMessage('开始原文'), content: [{ type: 'text', text: '开始原文' }, image] }, userMessage(lastSource)],
      nativeSpan: { messageSeqs: [10, 77] } };
    await makeEngine(ctx).summarize(input, fixtureAgent());
    assert.equal(calls.length, 1);
    const call = calls[0], blocks = call.messages[0].content, records = recordsFromCall(call);
    assert.deepEqual(blocks[1], image, 'the original image data remains between source text and the closing task');
    assert.equal(blocks.at(-1).type, 'text');
    assert.ok(blocks.at(-1).text.startsWith('</quoted-conversation-data>\n'));
    assert.deepEqual(JSON.parse(records.at(-1).blockJsonPart), input.messages.at(-1).content[0]);
    assert.equal(records.at(-1).eventSeq, 77, 'the actual last source anchor is retained');
    const estimate = text => Math.ceil(Buffer.byteLength(text, 'utf8') / 2);
    const fullInput = estimate(call.system) + blocks.filter(block => block.type === 'text').reduce((sum, block) => sum + estimate(block.text), 0)
      + visualTokens + estimate(pricingText) + 256;
    const window = contextWindow ?? 16_384;
    assert.ok(fullInput + call.maxTokens + Math.max(2048, Math.ceil(window * 0.08)) <= window,
      'the measured complete dispatch includes both boundary texts, the final task, system and original image pricing');
  }
});

test('each manual transaction shares a bounded call allowance across summary retries', async () => {
  const { ctx, calls } = makeContext();
  const engine = makeEngine(ctx);
  const input = { messages: [userMessage('A small source transcript.')] };
  const first = engine.regionDependencies();
  const second = engine.regionDependencies();
  for (let i = 0; i < 32; i++) await Promise.all([
    first.summarize(input, fixtureAgent()), second.summarize(input, fixtureAgent()),
  ]);
  assert.equal(calls.length, 64);
  await assert.rejects(() => first.summarize(input, fixtureAgent()), /bounded summary call allowance/);
  await assert.rejects(() => second.summarize(input, fixtureAgent()), /bounded summary call allowance/);
  assert.equal(calls.length, 64, 'the rejected retry must not contact the provider');
});

test('the selected pending route wins; the header, default, and agent options remain ordered fallbacks', () => {
  const session = { requestHeader: () => ({ config: { provider: 'header', model: 'header-model' } }) };
  assert.deepEqual(
    selectNativeSummaryRoute(session, {
      pending: { provider: 'pending', model: 'pending-model', reasoningEffort: 'high' },
      lastUsed: { provider: 'last-used', model: 'last-model' },
    }, { provider: 'default', model: 'default-model' }, { provider: 'agent', model: 'agent-model' }),
    { provider: 'pending', model: 'pending-model', reasoningEffort: 'high' },
  );
  assert.deepEqual(
    selectNativeSummaryRoute(session, { pending: null, lastUsed: null }, { provider: 'default', model: 'default-model' }, { provider: 'agent', model: 'agent-model' }),
    { provider: 'header', model: 'header-model' },
  );
  assert.deepEqual(
    selectNativeSummaryRoute({ requestHeader: () => undefined }, { pending: null, lastUsed: null }, { provider: 'default', model: 'default-model' }, { provider: 'agent', model: 'agent-model' }),
    { provider: 'default', model: 'default-model' },
  );
});

test('large quoted history is bounded into serial calls and every original block is recoverable', async () => {
  const pending = { provider: 'selected-provider', model: 'selected-model', reasoningEffort: 'high' };
  const { ctx, calls } = makeContext({ selectionState: { pending, lastUsed: null } });
  const engine = makeEngine(ctx);
  const agent = fixtureAgent();
  const input = {
    messages: [
      userMessage(`BEGIN-EXACT-SOURCE-${'x'.repeat(660_000)}-END-EXACT-SOURCE`),
      {
        role: 'assistant',
        source: { kind: 'model', provider: 'old-provider', model: 'old-model' },
        content: [{ type: 'tool-call', id: 'tool-call-fixture', name: 'search', arguments: '{"query":"exact-tool-argument"}' }],
      },
      {
        role: 'tool',
        source: { kind: 'tool', callId: 'tool-call-fixture' },
        toolCallId: 'tool-call-fixture',
        isError: false,
        content: [{ type: 'text', text: 'exact-tool-result' }],
      },
    ],
  };

  const result = await engine.summarize(input, agent);
  assert.ok(result.summary.some(block => block.text.includes('checkpoint-')));
  assert.ok(calls.length >= 2 && calls.length <= 32);
  assert.ok(calls.every(call => call.provider === pending.provider && call.model === pending.model));
  assert.ok(calls.every(call => call.reasoningEffort === 'high'));
  assert.ok(calls.every(call => call.maxTokens === NATIVE_COMPACTION_MAX_OUTPUT_TOKENS));
  assert.ok(calls.every(call => call.purpose === 'compaction' && call.sessionId === agent.session.id));
  assert.ok(calls.every(call => call.tools === undefined && call.toolHistory === undefined));

  const originalRecords = calls.flatMap(recordsFromCall).filter(record => record.recordType === 'source-block');
  const byBlock = new Map();
  for (const record of originalRecords) {
    const key = `${record.messageIndex}:${record.blockIndex}`;
    const parts = byBlock.get(key) ?? [];
    parts.push(record);
    byBlock.set(key, parts);
  }
  const recover = (messageIndex, blockIndex) => {
    const parts = byBlock.get(`${messageIndex}:${blockIndex}`);
    assert.ok(parts?.length);
    parts.sort((left, right) => left.fragment.index - right.fragment.index);
    assert.equal(parts.length, parts[0].fragment.count);
    return JSON.parse(parts.map(part => part.blockJsonPart).join(''));
  };
  assert.deepEqual(recover(0, 0), input.messages[0].content[0]);
  assert.deepEqual(recover(1, 0), input.messages[1].content[0]);
  assert.deepEqual(recover(2, 0), input.messages[2].content[0]);
  assert.ok(originalRecords.some(record => record.role === 'tool' && record.sourceCallId === 'tool-call-fixture'));
});

test('a confirmed context overflow is the only failure that triggers bounded splitting', async () => {
  const { ctx, calls } = makeContext({ respond(_options, count) {
    return count === 1
      ? createErrorFinish('CONTEXT_WINDOW_EXCEEDED', 'synthetic context overflow')
      : responseStream(`split-checkpoint-${count}`);
  } });
  const engine = makeEngine(ctx);
  const result = await engine.summarize({ messages: [
    userMessage('synthetic first record'),
    { role: 'assistant', source: { kind: 'model', provider: 'old', model: 'old' }, content: [{ type: 'text', text: 'synthetic second record' }] },
    { role: 'tool', source: { kind: 'tool', callId: 'call-overflow' }, toolCallId: 'call-overflow', content: [{ type: 'text', text: 'synthetic third record' }] },
  ] }, fixtureAgent());
  assert.ok(result.summary.some(block => block.text.includes('split-checkpoint-')));
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.model === 'default-model'));
});

test('seventeen source chunks can merge within the 32-call allowance', async () => {
  const { ctx, calls } = makeContext({ contextWindow: 16384 });
  const engine = makeEngine(ctx);
  const result = await engine.summarize({ messages: Array.from({ length: 17 }, (_, i) =>
    userMessage(`SOURCE_${i}:` + 'x'.repeat(9000))) }, fixtureAgent());
  assert.ok(result.summary.length);
  assert.ok(calls.length >= 18 && calls.length <= 32);
  assert.equal(calls.flatMap(recordsFromCall).filter(record => record.recordType === 'source-block').length, 17);
});

test('unknown context uses the conservative planning cap and rejects excessive fanout before sending', async () => {
  const { ctx, calls } = makeContext({ contextWindow: null });
  const engine = makeEngine(ctx);
  await assert.rejects(engine.summarize({ messages: [userMessage('u'.repeat(500_000))] }, fixtureAgent()), error => error.code === 'UNSUPPORTED_CONTENT');
  assert.equal(calls.length, 0);
});

test('explicit summarization policy wins over the selected conversation route', async () => {
  const { ctx, calls } = makeContext({ selectionState: {
    pending: { provider: 'conversation-provider', model: 'conversation-model', reasoningEffort: 'high' },
    lastUsed: null,
  } });
  const engine = makeEngine(ctx, config({
    summarizationProvider: 'configured-provider',
    summarizationModel: 'configured-model',
    modelPolicies: [{
      provider: 'conversation-provider',
      model: 'conversation-model',
      summarizationProvider: 'policy-provider',
      summarizationModel: 'policy-model',
      maxTokens: 2048,
    }],
  }));
  const result = await engine.summarize({ messages: [userMessage('synthetic source')] }, fixtureAgent());
  assert.equal(result.provider, 'policy-provider');
  assert.equal(result.model, 'policy-model');
  assert.equal(result.maxTokens, 2048);
  assert.equal(calls[0].provider, 'policy-provider');
  assert.equal(calls[0].reasoningEffort, undefined);
  assert.equal(calls[0].maxTokens, 2048);
});

test('active images fail explicitly on an undeclared text-only route before any request', async () => {
  const { ctx, calls } = makeContext({ inputModalities: ['text'] });
  const engine = makeEngine(ctx);
  await assert.rejects(engine.summarize({ messages: [{
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'image', attachment: { id: 'fixture-image' } }],
  }] }, fixtureAgent()), error => error.code === 'UNSUPPORTED_CONTENT');
  assert.equal(calls.length, 0);
});

function transactionFixture(respond) {
  const session = Session.create(`native-compaction-${Math.random().toString(16).slice(2)}`);
  session.append('turn/start', { turn: 1 });
  session.append('step/start', { turn: 1, step: 1 });
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'old synthetic fact' }] }), { surfaceOp: 'append' });
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'new synthetic fact' }] }), { surfaceOp: 'append' });
  const { ctx, calls } = makeContext({ respond });
  ctx.sessions = { flush: async () => true };
  ctx.tokenMeter = {
    measure(current) {
      const nodes = current.surface.nodes.map(seq => ({ seq, tokens: 100, heuristicTokens: 100 }));
      return { nodes, totalTokens: nodes.length * 100, surfaceTokens: nodes.length * 100, surfaceDeltaTokens: 0, logRevision: current.seq, baseline: { kind: 'none', tokens: 0 } };
    },
    estimateMessage: () => 1,
  };
  // Basic's summary-error recovery hook is a synchronous boolean waterfall.
  // Returning a Promise here would look truthy to the SDK and retry forever.
  ctx.waterfall = (_name, _payload, fallback) => fallback();
  const engine = makeEngine(ctx, config({ auto: false }));
  const agent = { session, options: { provider: 'default-route', model: 'default-model' } };
  return { session, engine, agent, calls };
}

function createErrorFinish(code, message) {
  return responseStream('', { kind: 'error', failure: { code, message } });
}

test('failed summarization closes only the native transaction markers and leaves the source surface unchanged', async () => {
  const fixture = transactionFixture(() => createErrorFinish('AUTH', 'synthetic auth failure'));
  const before = [...fixture.session.surface.nodes];
  await assert.rejects(fixture.engine.compactRegion(before[0], before[0], fixture.agent, new AbortController().signal));
  const events = fixture.session.snapshotEvents();
  assert.deepEqual(fixture.session.surface.nodes, before);
  assert.equal(events.filter(event => event.type === 'compaction/start').length, 1);
  assert.equal(events.filter(event => event.type === 'compaction/end').length, 1);
  assert.equal(events.filter(event => event.type === 'compaction/summary').length, 0);
  assert.equal(fixture.calls.length, 1, 'AUTH must propagate without a chunk retry');
});

test('successful native compaction appends one summary and retains the original source events', async () => {
  const fixture = transactionFixture(() => responseStream('synthetic checkpoint'));
  const before = [...fixture.session.surface.nodes];
  const originalSourceEvents = fixture.session.snapshotEvents().filter(event => event.type === 'user/message');
  const result = await fixture.engine.compactRegion(before[0], before[0], fixture.agent, new AbortController().signal);
  const events = fixture.session.snapshotEvents();
  assert.ok(result.summarySeq);
  assert.equal(events.filter(event => event.type === 'compaction/summary').length, 1);
  assert.deepEqual(events.filter(event => event.type === 'user/message').slice(0, 2), originalSourceEvents);
  assert.equal(events.filter(event => event.type === 'user/message').length, 3);
  assert.notDeepEqual(fixture.session.surface.nodes, before);
});

test('native summary waits for the original archive and archive failure preserves its source surface', async () => {
  const fixture = transactionFixture(() => responseStream('archived checkpoint'));
  const before = [...fixture.session.surface.nodes];
  const aborter = new AbortController();
  let archiveCalls = 0;
  fixture.engine.ctx.get = name => name === 'notaraHistory' ? {
    async ensure(owner, { signal }) {
      archiveCalls++;
      assert.equal(owner, fixture.session);
      assert.equal(signal, aborter.signal);
      assert.equal(fixture.calls.length, 0);
      throw new Error('synthetic archive failure');
    },
  } : undefined;
  await assert.rejects(fixture.engine.compactRegion(before[0], before[0], fixture.agent, aborter.signal), /synthetic archive failure/);
  assert.equal(archiveCalls, 1);
  assert.deepEqual(fixture.session.surface.nodes, before);
  assert.equal(fixture.session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0);
  assert.equal(fixture.calls.length, 0);
  fixture.engine.ctx.get = name => name === 'notaraHistory' ? {
    async ensure(owner) { archiveCalls++; assert.equal(owner, fixture.session); },
  } : undefined;
  await fixture.engine.compactRegion(before[0], before[0], fixture.agent, aborter.signal);
  assert.equal(archiveCalls, 2);
  assert.match(fixture.calls[0].system, /eventSeq/);
});

test('cancellation during a summary request does not produce a summary or surface replacement', async () => {
  const aborter = new AbortController();
  const reason = new Error('synthetic cancellation');
  const fixture = transactionFixture(() => (async function* () {
    aborter.abort(reason);
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'must-not-commit' } };
  })());
  const before = [...fixture.session.surface.nodes];
  await assert.rejects(fixture.engine.compactRegion(before[0], before[0], fixture.agent, aborter.signal));
  const events = fixture.session.snapshotEvents();
  assert.deepEqual(fixture.session.surface.nodes, before);
  assert.equal(events.filter(event => event.type === 'compaction/summary').length, 0);
  assert.equal(events.filter(event => event.type === 'user/message').length, 2);
});
