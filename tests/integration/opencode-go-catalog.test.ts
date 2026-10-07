import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';

type Route = Record<string, unknown>;
type RawConfig = { providers: Record<string, Route> };
type Listener = (this: object, previous?: unknown, next?: () => RawConfig) => unknown;
type ModelInfo = { id: string; context: { contextWindow: number }; defaultMaxTokens?: number };
type Discover = (request: { provider: string; apiKey?: string; headers?: Record<string, string>; baseURL?: string }, signal?: AbortSignal) => Promise<{ id: string }[]>;
type Adapter = {
  listModels(provider: string): Promise<{ id: string }[]>;
  resolveModel(provider: string, model: string): Promise<ModelInfo>;
  stream(input: GenerateOptions): AsyncIterable<StreamChunk>;
};
type PluginContext = {
  fiber: { entry: { options: { id: string } } };
  inject(services: string[], callback: unknown): void;
  on(event: string, listener: Listener): void;
  get(service: string): unknown;
  effect(callback: () => () => void): void;
  logger: { warn(): void; error(): void };
  llm: {
    registerConfigurableProviders(entries: unknown): { replace(entries: unknown): void };
    registerModelDiscovery(namespace: string, discover: Discover): void;
    registerAdapter(routes: string[], adapter: Adapter): { replace(routes: string[]): void };
  };
};
const sdk = await import(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai')) as {
  apply(ctx: PluginContext, config: { providers: { get(): Record<string, Route> } }): Promise<void>;
};

const homes: string[] = [];
const disposers: (() => void)[] = [];
const endpoints = [
  ['deepseek-v4.1-flash', 'chat/completions'],
  ['mimo-v2.6-flash', 'chat/completions'],
  ['mimo-v2.6-pro', 'chat/completions'],
  ['longcat-2.5-preview-free', 'chat/completions'],
  ['space-bunny', 'chat/completions'],
  ['gpt-6-luna', 'responses'],
  ['grok-4.7', 'responses'],
  ['deepseek-v4-flash', 'chat/completions'],
  ['gpt-5.6-luna', 'responses'],
  ['minimax-m3', 'messages'],
  // A new, arbitrary ID verifies that production code needs no per-ID update.
  ['future-go-fixture-model', 'chat/completions'],
] as const;

function publicSources(rows: readonly (readonly [string, string])[] = endpoints) {
  const models = Object.fromEntries(rows.map(([id, endpoint]) => [id, {
    id, name: id, limit: { context: 262144, output: 32768 }, modalities: { input: ['text', 'image'] },
    ...(endpoint === 'chat/completions' ? {} : { provider: { npm: endpoint === 'responses' ? '@ai-sdk/openai' : '@ai-sdk/anthropic' } }),
  }]));
  if (models['deepseek-v4.1-flash']) Object.assign(models['deepseek-v4.1-flash'], {
    reasoning: true, family: 'deepseek-flash', interleaved: { field: 'reasoning_content' },
    reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
  });
  return {
    listing: { data: rows.map(([id]) => ({ id, object: 'model' })) },
    metadata: { 'opencode-go': { api: 'https://opencode.ai/zen/go/v1', npm: '@ai-sdk/openai-compatible', models } },
  };
}

function mockCatalog(rows: readonly (readonly [string, string])[] = endpoints) {
  const sources = publicSources(rows);
  const calls: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    if (request.url === 'https://opencode.ai/zen/go/v1/models') return Response.json(sources.listing);
    if (request.url === 'https://models.dev/api.json') return Response.json(sources.metadata);
    throw new Error('Unexpected real network access');
  });
  return calls;
}

async function settingsFixture(options: { home?: string; discover?: boolean; initial?: Record<string, Route> } = {}) {
  const home = options.home ?? await mkdtemp(join(tmpdir(), 'notara-go-catalog-'));
  if (!options.home) homes.push(home);
  let raw: RawConfig = { providers: options.initial ?? {} };
  let adapter: Adapter | undefined;
  let discover: Discover | undefined;
  const listeners = new Map<string, Listener>();
  const ctx: PluginContext = {
    fiber: { entry: { options: { id: 'fixture-pi-ai' } } },
    inject() {},
    on(event, listener) { listeners.set(event, listener); },
    effect(callback) { disposers.push(callback()); },
    get(service) {
      if (service === 'credentials') return { resolve: async () => ({ value: 'synthetic-go-key' }) };
      if (service === 'launchEnvironment') return { get: (name: string) => name === 'DSH_HOME' ? { value: home } : undefined };
      return undefined;
    },
    logger: { warn() {}, error() {} },
    llm: {
      registerConfigurableProviders() { return { replace() {} }; },
      registerModelDiscovery(_namespace, next) { discover = next; },
      registerAdapter(_routes, next) { adapter = next; return { replace() {} }; },
    },
  };
  await sdk.apply(ctx, { providers: { get: () => raw.providers } });
  if (options.discover !== false) await discover!({ provider: 'opencode-go' });
  return {
    home,
    discover: (request: Parameters<Discover>[0], signal?: AbortSignal) => discover!(request, signal),
    save(providers: Record<string, Route>) {
      const next = { providers };
      // Invoke the actual plugin's strict internal/config guard before publishing,
      // then its volatile-update hook, as a settings save does.
      listeners.get('internal/config')!.call(ctx.fiber, raw, () => next);
      raw = next;
      listeners.get('loader/volatile-update')!.call(ctx.fiber);
      if (!adapter) throw new Error('Saved route was not registered');
      return adapter;
    },
  };
}

afterEach(async () => {
  disposers.splice(0).forEach(dispose => dispose());
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

test('saves discovered DeepSeek V4.1 Flash alongside existing mixed-protocol Go models', async () => {
  mockCatalog();
  const adapter = (await settingsFixture()).save({
    'opencode-go': {
      apiKeyEnv: 'TEST_OPENCODE_KEY',
      models: [
        { id: 'deepseek-v4.1-flash', contextWindow: 131072, maxTokens: 4096 },
        { id: 'deepseek-v4-flash' },
        { id: 'gpt-5.6-luna' },
        { id: 'minimax-m3' },
      ],
    },
  });
  expect((await adapter.listModels('opencode-go')).map(model => model.id)).toEqual([
    'deepseek-v4.1-flash', 'deepseek-v4-flash', 'gpt-5.6-luna', 'minimax-m3',
  ]);
  expect(await adapter.resolveModel('opencode-go', 'deepseek-v4.1-flash')).toMatchObject({
    id: 'deepseek-v4.1-flash', context: { contextWindow: 131072 }, defaultMaxTokens: 4096,
  });
  const captured: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    captured.push({ url: request.url, headers: request.headers, body: await request.json() as Record<string, unknown> });
    const chunks = [
      { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'deepseek-v4.1-flash', choices: [{ index: 0, delta: { content: 'fixture answer' }, finish_reason: null }] },
      { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'deepseek-v4.1-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: 'opencode-go', model: 'deepseek-v4.1-flash',
    sessionId: 'fixture-go-session' as NonNullable<GenerateOptions['sessionId']>,
    reasoningEffort: 'high' as NonNullable<GenerateOptions['reasoningEffort']>,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic request.' }] }],
  })) chunks.push(chunk);
  expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'fixture answer')).toBe(true);
  expect(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop')).toBe(true);
  expect(captured).toHaveLength(1);
  expect(captured[0]!.url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
  expect(captured[0]!.headers.get('x-opencode-session')).toBe('fixture-go-session');
  expect(captured[0]!.headers.get('authorization')).toBe('Bearer synthetic-go-key');
  expect(captured[0]!.body.model).toBe('deepseek-v4.1-flash');
  expect(captured[0]!.body.thinking).toEqual({ type: 'enabled' });
  expect(captured[0]!.body.reasoning_effort).toBe('high');
  expect(captured[0]!.body.max_tokens).toBe(4096);
});

test.each(endpoints)('dispatches dynamically discovered %s to the metadata-defined %s endpoint', async (modelId, endpoint) => {
  mockCatalog();
  const adapter = (await settingsFixture()).save({
    'opencode-go': {
      apiKeyEnv: 'TEST_OPENCODE_KEY',
      models: endpoints.map(([id]) => ({ id })),
    },
  });
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init));
    // Routing check only: stop at the SDK transport with a non-retryable error.
    return Response.json({ error: { message: 'synthetic transport boundary', type: 'invalid_request_error' } }, { status: 400 });
  });
  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: 'opencode-go', model: modelId,
    sessionId: 'mixed-go-session' as NonNullable<GenerateOptions['sessionId']>,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic routing check.' }] }],
  })) chunks.push(chunk);
  expect(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'error')).toBe(true);
  expect(requests).toHaveLength(1);
  const url = new URL(requests[0]!.url);
  expect(url.origin + url.pathname).toBe(`https://opencode.ai/zen/go/v1/${endpoint}`);
  expect(requests[0]!.headers.get('x-opencode-session')).toBe('mixed-go-session');
  expect(await requests[0]!.json()).toMatchObject({ model: modelId });
});

test.each([
  ['opencode-go', { models: [{ id: 'unknown-future-go-model' }] }],
  ['private-go', { models: [{ id: 'deepseek-v4.1-flash' }], baseURL: 'https://opencode.ai/zen/go/v1' }],
  ['opencode-go', { models: [{ id: 'deepseek-v4.1-flash' }], baseURL: 'https://other.example/v1' }],
  ['opencode-go', { models: [{ id: 'deepseek-v4.1-flash' }], baseURL: 'https://opencode.ai/zen/v1' }],
  ['opencode-go', { models: [{ id: 'deepseek-v4.1-flash' }], baseURL: 'https://opencode.ai.evil.example/zen/go/v1' }],
  ['opencode-go', { models: [{ id: 'deepseek-v4.1-flash' }], baseURL: 'http://opencode.ai/zen/go/v1' }],
] as const)('keeps explicit-protocol validation for %s with %j', async (route, profile) => {
  mockCatalog();
  const fixture = await settingsFixture();
  expect(() => fixture.save({ [route]: profile })).toThrow(/needs an api/);
});

test('preserves an explicit protocol and custom endpoint override', async () => {
  const calls = mockCatalog();
  const adapter = (await settingsFixture({ discover: false })).save({
    'opencode-go': {
      apiKeyEnv: 'TEST_OPENCODE_KEY', api: 'openai-completions',
      baseURL: 'https://configured.example/v1', models: [{ id: 'deepseek-v4.1-flash' }],
    },
  });
  expect(calls).toHaveLength(0);
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Response.json({ error: { message: 'synthetic transport boundary' } }, { status: 400 });
  });
  for await (const _chunk of adapter.stream({
    provider: 'opencode-go', model: 'deepseek-v4.1-flash',
    sessionId: 'custom-go-session' as NonNullable<GenerateOptions['sessionId']>,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic routing check.' }] }],
  })) { /* The boundary deliberately returns an error. */ }
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://configured.example/v1/chat/completions');
  expect(requests[0]!.headers.get('x-opencode-session')).toBeNull();
});

test('discovers arbitrary future models without forwarding configured credentials to metadata sources', async () => {
  const calls = mockCatalog();
  const fixture = await settingsFixture({ discover: false });
  const found = await fixture.discover({ provider: 'opencode-go', apiKey: 'private-synthetic-key', headers: { 'x-private': 'private-synthetic-value' } });
  expect(found.some(model => model.id === 'future-go-fixture-model')).toBe(true);
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.headers.get('authorization')).toBeNull();
    expect(call.headers.get('x-private')).toBeNull();
    expect(call.headers.get('x-opencode-session')).toBeNull();
  }
  const adapter = fixture.save({ 'opencode-go': { apiKeyEnv: 'TEST_OPENCODE_KEY', models: [{ id: 'future-go-fixture-model' }] } });
  expect(await adapter.listModels('opencode-go')).toMatchObject([{ id: 'future-go-fixture-model' }]);
});

test('reloads a persisted catalog and saves DeepSeek configuration while offline', async () => {
  mockCatalog();
  const first = await settingsFixture();
  // Switch the SDK singleton away, then reopen the original isolated runtime.
  await settingsFixture({ discover: false });
  vi.stubGlobal('fetch', async () => { throw new Error('synthetic offline'); });
  const reopened = await settingsFixture({ home: first.home, discover: false });
  await expect(reopened.discover({ provider: 'opencode-go' })).rejects.toThrow(/last valid catalog is retained/);
  const adapter = reopened.save({ 'opencode-go': { apiKeyEnv: 'TEST_OPENCODE_KEY', models: [{ id: 'deepseek-v4.1-flash' }] } });
  expect(await adapter.resolveModel('opencode-go', 'deepseek-v4.1-flash')).toMatchObject({ id: 'deepseek-v4.1-flash' });
});

test('refresh invalidates adapter profile memoization without modifying saved configuration', async () => {
  mockCatalog();
  const fixture = await settingsFixture();
  const adapter = fixture.save({ 'opencode-go': { apiKeyEnv: 'TEST_OPENCODE_KEY', models: [{ id: 'future-go-fixture-model' }] } });
  expect((await adapter.resolveModel('opencode-go', 'future-go-fixture-model')).context.contextWindow).toBe(262144);
  const sources = publicSources();
  sources.metadata['opencode-go'].models['future-go-fixture-model']!.limit.context = 1000000;
  vi.stubGlobal('fetch', async (input: string | URL | Request) => Response.json(
    String(input) === 'https://models.dev/api.json' ? sources.metadata : sources.listing,
  ));
  await fixture.discover({ provider: 'opencode-go' });
  expect((await adapter.resolveModel('opencode-go', 'future-go-fixture-model')).context.contextWindow).toBe(1000000);
});

test('initialization reads cache without network discovery; explicit discovery fetches once', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sources = publicSources();
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    calls.push(String(input));
    await gate;
    return Response.json(String(input) === 'https://models.dev/api.json' ? sources.metadata : sources.listing);
  });
  const fixture = await settingsFixture({ discover: false, initial: {
    'opencode-go': { apiKeyEnv: 'TEST_OPENCODE_KEY', models: [{ id: 'deepseek-v4-flash' }] },
  } });
  expect(calls).toHaveLength(0);
  release();
  const discovered = await fixture.discover({ provider: 'opencode-go' });
  expect(discovered.some(model => model.id === 'deepseek-v4.1-flash')).toBe(true);
  expect(calls).toHaveLength(2);
});

test('ordinary providers neither fetch Go metadata nor change their original discovery', async () => {
  const calls = mockCatalog();
  const fixture = await settingsFixture({ discover: false, initial: {
    openai: { apiKeyEnv: 'TEST_OPENAI_KEY', models: [{ id: 'gpt-4o' }] },
  } });
  const found = await fixture.discover({ provider: 'openai' });
  expect(found.some(model => model.id === 'gpt-4o')).toBe(true);
  expect(calls).toHaveLength(0);
});

test('a single-protocol dynamic catalog still requires metadata or explicit API for an unknown model', async () => {
  mockCatalog([['future-go-fixture-model', 'chat/completions']]);
  const fixture = await settingsFixture();
  expect(() => fixture.save({ 'opencode-go': { models: [{ id: 'unclassified-new-model' }] } })).toThrow(/needs an api/);
});

test.each(['https://opencode.ai/zen/go', 'https://opencode.ai/zen/go/v1'])(
  'normalizes official route base %s for every model in a mixed-protocol route', async baseURL => {
    mockCatalog();
    const adapter = (await settingsFixture()).save({ 'opencode-go': {
      apiKeyEnv: 'TEST_OPENCODE_KEY', baseURL,
      models: [{ id: 'deepseek-v4.1-flash' }, { id: 'gpt-6-luna' }, { id: 'minimax-m3' }],
    } });
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({ error: { message: 'synthetic transport boundary' } }, { status: 400 });
    });
    for (const model of ['deepseek-v4.1-flash', 'gpt-6-luna', 'minimax-m3']) {
      for await (const _chunk of adapter.stream({ provider: 'opencode-go', model,
        sessionId: 'official-go-alias' as NonNullable<GenerateOptions['sessionId']>,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic routing check.' }] }],
      })) { /* Deliberate transport boundary. */ }
    }
    expect(requests.map(request => new URL(request.url).pathname)).toEqual([
      '/zen/go/v1/chat/completions', '/zen/go/v1/responses', '/zen/go/v1/messages',
    ]);
  },
);
