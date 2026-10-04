import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, buildForkSeed } from '@deepseek-ai/dsh-session';
import { createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { InMemoryCredentialStore, createProvider, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai';
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn';
import { moonshotaiProvider } from '@earendil-works/pi-ai/providers/moonshotai';
import { moonshotaiCnProvider } from '@earendil-works/pi-ai/providers/moonshotai-cn';
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { qwenTokenPlanCnProvider } from '@earendil-works/pi-ai/providers/qwen-token-plan-cn';
import { minimaxProvider } from '@earendil-works/pi-ai/providers/minimax';
import { minimaxCnProvider } from '@earendil-works/pi-ai/providers/minimax-cn';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { mistralProvider } from '@earendil-works/pi-ai/providers/mistral';
import { groqProvider } from '@earendil-works/pi-ai/providers/groq';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { boardOverview } from './board-data.js';
import { boardPath } from './board-runtime.js';
import { responsesRequest } from './chatgpt-provider.js';

// This is an encoder regression, not a service-side cache-hit or billing test.
// Real adapters build their requests; a sentinel stops every SDK before transport.
const STOP = 'notara-offline-payload-captured';
const SYSTEM = 'You are the teaching agent. Read current classroom state from user runtime-context snapshots.';
const TOOL_RESULT = '合成工具结果，保留原课堂引用。';
const TOOLS = [{ name: 'read_board', description: 'Read the classroom board.', parameters: {
  type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false,
} }];
const json = value => JSON.parse(JSON.stringify(value));
const text = value => [{ type: 'text', text: value }];
const user = value => createUserMessage({ source: { kind: 'user' }, content: text(value) });
const denyNetwork = async () => { throw new Error('offline provider test attempted network transport'); };

function runtimeContext(sessionId, phase) {
  const board = {
    sections: [{ id: 's-topic', title: '动量' }],
    blocks: [{ id: 'b-progress', title: '板书进度 ' + phase, section: 's-topic', kind: 'note', size: 'wide', body: '合成板书。', answers: [] }],
  };
  return createUserMessage({ source: { kind: 'runtime-context', form: 'snapshot' }, content: text(
    'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n当前白板：'
    + boardPath(sessionId) + '\n' + boardOverview(board),
  ) });
}

function beginTurn(session, turn, phase) {
  session.append('turn/start', { turn });
  session.append('step/start', { turn, step: 1 });
  session.append('user/message', user('继续合成课堂 ' + turn), { surfaceOp: 'append' });
  session.append('user/message', runtimeContext(session.id, phase), { surfaceOp: 'append' });
}

function assistant(session, turn, provider, model, content) {
  session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({
    source: { provider, model }, content,
  }) }, { surfaceOp: 'append' });
}

function finishTurn(session, turn, provider, model) {
  assistant(session, turn, provider, model, text('合成回复 ' + turn));
  session.append('step/end', { turn, step: 1 });
  session.append('turn/end', { turn, reason: { kind: 'completed' } });
}

function historyFixture(provider, model) {
  const parent = Session.create('session-offline-parent');
  parent.append('system/message', { turn: 1, step: 1, message: createSystemMessage(SYSTEM) }, { surfaceOp: 'append' });
  parent.append('request/header', { header: { config: { provider, model }, tools: TOOLS }, reason: 'initial' });
  beginTurn(parent, 1, '初始');
  assistant(parent, 1, provider, model, [{ type: 'tool-call', id: 'call_board_1', name: 'read_board', arguments: '{"path":"synthetic-board.md"}' }]);
  parent.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({
    callId: 'call_board_1', content: text(TOOL_RESULT), isError: false,
  }) }, { surfaceOp: 'append' });
  finishTurn(parent, 1, provider, model);
  beginTurn(parent, 2, '第一轮');
  const initial = parent.deriveMessages();
  finishTurn(parent, 2, provider, model);
  beginTurn(parent, 3, '更新');
  const updated = parent.deriveMessages();
  finishTurn(parent, 3, provider, model);
  const events = parent.snapshotEvents(), boundary = events.length - 1;
  const child = Session.create('session-offline-child', buildForkSeed(events, boundary), {
    version: parent.header.version, id: 'session-offline-child', createdAt: parent.header.createdAt,
    isSeeded: true, parentSession: parent.id,
  }, boundary + 1);
  assert.deepEqual(child.deriveMessages(), parent.deriveMessages(), 'the real fork seed must retain historical message identities/content');
  beginTurn(child, 4, '分支');
  const fork = child.deriveMessages();
  assert.deepEqual(parent.snapshotEvents(), events, 'child continuation must not mutate source events');
  return [
    { sessionId: parent.id, messages: initial },
    { sessionId: parent.id, messages: updated },
    { sessionId: child.id, messages: fork },
  ].map(value => ({ provider, model, tools: TOOLS, ...value }));
}

function providerFixture(factory, preferred, apiOverride) {
  const original = factory(), models = original.getModels();
  const base = preferred === undefined ? models[0] : models.find(model => model.id === preferred);
  assert.ok(base, 'the locked provider must have a catalog model');
  const model = apiOverride ? { ...base, api: 'openai-completions' } : base;
  let captured, callbacks = 0, localTransports = 0;
  // Mistral remaps its SDK object's camelCase properties after onPayload.
  // Capture that final JSON in a local function, without any HTTP transport.
  const captureMistralWire = async (_url, init) => {
    localTransports++; captured = JSON.parse(init.body); throw new Error(STOP);
  };
  const provider = { ...original, getModels: () => [model],
    streamSimple: (actualModel, context, options) => {
      const stream = apiOverride ? apiOverride.streamSimple.bind(apiOverride) : original.streamSimple.bind(original);
      return stream(actualModel, context, { ...options,
        fetch: model.api === 'mistral-conversations' ? captureMistralWire : globalThis.fetch, env: {},
        onPayload: params => {
          callbacks++;
          if (model.api === 'mistral-conversations') return;
          captured = json(params); throw new Error(STOP);
        },
      });
    },
  };
  const supportedReasoning = getSupportedThinkingLevels(model);
  const profile = { piProvider: provider, modelErrors: new Map(), configuredMaxTokens: new Map(),
    cacheRetention: 'short', reasoning: supportedReasoning.includes('off') ? 'off' : supportedReasoning[0],
    streamIdleTimeoutMs: 5000 };
  const adapter = new PiAiAdapter({
    profiles: () => new Map([[provider.id, profile]]),
    resolveApiKey: async () => 'synthetic-offline-key',
    auth: { credentials: new InMemoryCredentialStore(), authContext: {
      env: async () => { throw new Error('offline test attempted ambient credential lookup'); },
    } },
  });
  return { provider: provider.id, model: model.id, api: model.api,
    async capture(options, retention = 'short') {
      captured = undefined; callbacks = 0; localTransports = 0; profile.cacheRetention = retention;
      let failure;
      const chunks = [];
      try { for await (const chunk of adapter.stream(options)) chunks.push(chunk); }
      catch (error) { failure = error; }
      assert.equal(callbacks, 1, 'the actual SDK serializer must reach onPayload exactly once; '
        + failure?.code + ': ' + failure?.message);
      assert.ok(captured, 'failure before serialization is not a passing encoder test');
      assert.equal(failure, undefined, 'serialized SDK errors use the adapter finish protocol');
      assert.deepEqual(chunks.map(chunk => chunk.type), ['usage', 'finish'], 'the sentinel must emit no model content');
      assert.equal(chunks.at(-1).reason.kind, 'error');
      assert.match(JSON.stringify(chunks.at(-1).reason), new RegExp(STOP), 'the deliberate sentinel must cause the final error');
      assert.equal(localTransports, model.api === 'mistral-conversations' ? 1 : 0);
      return captured;
    },
  };
}

function nativeDeepSeekFixture(model) {
  const connection = resolveAdapterOptions({ baseURL: 'http://127.0.0.1:9/anthropic', thinking: 'disabled' });
  let captured;
  const adapter = new DeepSeekAdapter({
    options: () => connection, resolveFiles: () => ({}),
    resolveAuth: async () => ({ headers: { authorization: 'Bearer synthetic-offline-key' } }),
    resolveUserId: () => 'synthetic-offline-user',
    prepareExtensions: async ({ body }) => { captured = json(body); throw new Error(STOP); },
  });
  return { provider: 'deepseek-native', model, api: 'deepseek-messages',
    async capture(options) {
      captured = undefined;
      await assert.rejects(async () => { for await (const _ of adapter.stream(options)) assert.fail('no native reply may be emitted'); }, { code: 'REQUEST_EXTENSION' });
      assert.ok(captured, 'the real DeepSeek serializer must run before the sentinel');
      return captured;
    },
  };
}

// Anthropic moves the ephemeral breakpoint to the newest user content.
// Exclude only that marker, and normalize the two equivalent plain-text content
// forms the SDK uses when adding/removing it. Any second block or metadata stops
// normalization: roles, tool IDs, arguments, images and signatures stay intact.
function withoutCacheControl(value) {
  if (Array.isArray(value)) return value.map(withoutCacheControl);
  if (value && typeof value === 'object') {
    const result = Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'cache_control').map(([key, item]) => [key, withoutCacheControl(item)]));
    const content = result.content;
    if (Array.isArray(content) && content.length === 1 && content[0]?.type === 'text'
      && typeof content[0].text === 'string' && Object.keys(content[0]).length === 2) result.content = content[0].text;
    return result;
  }
  return value;
}
function controls(value, result = []) {
  if (Array.isArray(value)) for (const item of value) controls(item, result);
  else if (value && typeof value === 'object') {
    if (value.cache_control) result.push(value.cache_control);
    for (const [key, item] of Object.entries(value)) if (key !== 'cache_control') controls(item, result);
  }
  return result;
}
const promptParts = body => ({
  system: body.system ?? body.config?.systemInstruction ?? body.instructions ?? null,
  tools: body.tools ?? body.config?.tools ?? null,
  history: body.input ?? body.messages ?? body.contents,
});

function assertPrefix(before, after) {
  const a = promptParts(before), b = promptParts(after);
  assert.deepEqual(withoutCacheControl(b.system), withoutCacheControl(a.system), 'system must remain unchanged');
  assert.deepEqual(withoutCacheControl(b.tools), withoutCacheControl(a.tools), 'tool schemas/order must remain unchanged');
  assert.ok(b.history.length > a.history.length, 'the update must add a real new conversation tail');
  assert.deepEqual(withoutCacheControl(b.history.slice(0, a.history.length)), withoutCacheControl(a.history), 'all old prompt content, roles and tool history must remain a prefix');
}

function assertToolHistory(body, api) {
  const history = promptParts(body).history;
  assert.ok(JSON.stringify(history).includes(TOOL_RESULT), 'the complete tool result must survive');
  if (api === 'google-generative-ai') {
    const callMessage = history.find(message => message.parts?.some(part => part.functionCall));
    const resultMessage = history.find(message => message.parts?.some(part => part.functionResponse));
    assert.equal(callMessage.role, 'model');
    assert.equal(resultMessage.role, 'user');
    assert.deepEqual(callMessage.parts.find(part => part.functionCall).functionCall,
      { name: 'read_board', args: { path: 'synthetic-board.md' } });
    assert.deepEqual(resultMessage.parts.find(part => part.functionResponse).functionResponse,
      { name: 'read_board', response: { output: TOOL_RESULT } });
  } else if (api === 'mistral-conversations') {
    const call = history.flatMap(message => message.tool_calls ?? []).find(call => call.function.name === 'read_board');
    const result = history.find(message => message.role === 'tool');
    assert.match(call.id, /^[a-zA-Z0-9]{9}$/);
    assert.deepEqual(call.function, { name: 'read_board', arguments: '{"path":"synthetic-board.md"}' });
    assert.equal(result.tool_call_id, call.id, 'Mistral must retain the normalized call/result relationship');
    assert.equal(result.name, 'read_board');
  } else assert.match(JSON.stringify(history), /call_board_1/);
}

function loopbackCompatibleProvider() {
  const base = openaiProvider().getModels().find(model => model.id === 'gpt-4o');
  return createProvider({
    id: 'notara-offline-compatible', name: 'Offline compatible protocol', baseUrl: 'http://127.0.0.1:9/v1',
    auth: { apiKey: { name: 'Synthetic credential', resolve: async () => ({
      auth: { apiKey: 'synthetic-offline-key' }, source: 'synthetic test',
    }) } },
    models: [{ ...base, id: 'synthetic-chat', provider: 'notara-offline-compatible',
      baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions', reasoning: false }],
    api: openAICompletionsApi(),
  });
}

const routes = [
  ['native DeepSeek Flash', () => nativeDeepSeekFixture('deepseek-flash')],
  ['native DeepSeek Pro', () => nativeDeepSeekFixture('deepseek-v4-pro')],
  ['GPT Responses', () => providerFixture(openaiProvider, 'gpt-4o')],
  ['GPT Chat Completions', () => providerFixture(openaiProvider, 'gpt-4o', openAICompletionsApi())],
  ['GLM Z.ai', () => providerFixture(zaiProvider, 'glm-4.7')],
  ['GLM 智谱', () => providerFixture(zaiCodingCnProvider, 'glm-4.7')],
  ['Kimi Moonshot', () => providerFixture(moonshotaiProvider)],
  ['Kimi Moonshot CN', () => providerFixture(moonshotaiCnProvider)],
  ['Kimi Coding', () => providerFixture(kimiCodingProvider)],
  ['Claude', () => providerFixture(anthropicProvider, 'claude-haiku-4-5')],
  ['Gemini', () => providerFixture(googleProvider, 'gemini-2.5-flash')],
  ['DeepSeek Chat Completions', () => providerFixture(deepseekProvider)],
  ['Qwen Token Plan CN', () => providerFixture(qwenTokenPlanCnProvider, 'qwen3.6-plus')],
  ['MiniMax', () => providerFixture(minimaxProvider)],
  ['MiniMax CN', () => providerFixture(minimaxCnProvider)],
  ['OpenRouter Chat Completions', () => providerFixture(openrouterProvider, 'openai/gpt-4o')],
  ['OpenRouter Anthropic', () => providerFixture(openrouterProvider, 'anthropic/claude-haiku-4.5')],
  ['Mistral', () => providerFixture(mistralProvider, 'mistral-small-latest')],
  ['Groq', () => providerFixture(groqProvider)],
  ['xAI Grok', () => providerFixture(xaiProvider)],
  ['synthetic custom compatible protocol', () => providerFixture(loopbackCompatibleProvider)],
  ['Notara ChatGPT', () => ({ provider: 'notara-chatgpt-synthetic', model: 'synthetic-model',
    api: 'notara-responses', capture: options => responsesRequest(options) })],
];

test('offline providers retain system/tools/history through board updates and native fork seeds', async t => {
  // No listener or external request is needed. Also guard the global transport,
  // including native DeepSeek and Google (which requires fetch === global fetch).
  const transport = t.mock.method(globalThis, 'fetch', denyNetwork);
  for (const [name, make] of routes) await t.test(name, async () => {
    const fixture = make(), history = historyFixture(fixture.provider, fixture.model), bodies = [];
    for (const options of history) bodies.push(await fixture.capture(options));
    assertPrefix(bodies[0], bodies[1]);
    assertPrefix(bodies[1], bodies[2]);
    const system = promptParts(bodies[2]).system ?? promptParts(bodies[2]).history[0];
    assert.ok(JSON.stringify(system).includes(SYSTEM), 'the actual wire prompt must contain the fixed system text');
    assert.equal(JSON.stringify(system).includes('板书进度'), false, 'board snapshots must remain outside system');
    assertToolHistory(bodies[2], fixture.api);
    if (fixture.api === 'anthropic-messages') {
      assert.ok(controls(bodies[0]).length >= 3, 'system, tool and latest user breakpoints must be present');
      const last = bodies[2].messages.at(-1);
      assert.equal(last.role, 'user');
      assert.deepEqual(last.content.at(-1).cache_control, { type: 'ephemeral' });
      assert.equal(controls(bodies[2].messages.slice(0, -1)).length, 0, 'the old user breakpoint must move without altering old content');
    }
    const none = await fixture.capture(history[2], 'none');
    assert.equal(Object.hasOwn(none, 'prompt_cache_key'), false);
    assert.equal(controls(none).length, 0, 'none disables explicit SDK cache markers');
    if (fixture.api === 'openai-responses' || fixture.api === 'mistral-conversations'
      || (fixture.api === 'openai-completions' && fixture.provider === 'openai')) {
      assert.equal(bodies[0].prompt_cache_key, history[0].sessionId);
      assert.equal(bodies[1].prompt_cache_key, history[1].sessionId);
      assert.equal(bodies[2].prompt_cache_key, history[2].sessionId, 'fork cache key follows its new session ID');
    } else {
      for (const body of bodies) assert.equal(Object.hasOwn(body, 'prompt_cache_key'), false, 'default compatible routes must not gain invented cache keys');
    }
    for (const body of bodies) {
      assert.equal(Object.hasOwn(body, 'enable_cache'), false);
      assert.equal(Object.hasOwn(body, 'previous_response_id'), false);
      assert.equal(Object.hasOwn(body.config ?? body, 'cachedContent'), false);
    }
  });
  assert.equal(transport.mock.callCount(), 0, 'the forbidden global network transport must never be called');
});

test('explicit long retention on compatible SDK routes has separate, documented key behavior', async t => {
  const transport = t.mock.method(globalThis, 'fetch', denyNetwork);
  for (const [name, factory] of [['GLM', zaiProvider], ['Moonshot', moonshotaiProvider]]) await t.test(name, async () => {
    const fixture = providerFixture(factory), options = historyFixture(fixture.provider, fixture.model)[0];
    const short = await fixture.capture(options), long = await fixture.capture(options, 'long');
    assert.equal(Object.hasOwn(short, 'prompt_cache_key'), false);
    assert.equal(long.prompt_cache_key, options.sessionId);
    assert.equal(long.prompt_cache_retention, '24h');
    assert.deepEqual(promptParts(long), promptParts(short), 'retention changes must not change prompt content');
  });
  assert.equal(transport.mock.callCount(), 0);
});
