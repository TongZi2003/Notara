import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
type Route = Record<string, unknown>;
type Raw = { providers: Record<string, Route> };
type Discover = (request: { provider: string; baseURL?: string; apiKey?: string }) => Promise<{ id: string }[]>;
type Adapter = { listModels(provider: string): Promise<{ id: string }[]>; resolveModel(provider: string, model: string): Promise<{ context: { contextWindow: number } }>; stream(options: GenerateOptions): AsyncIterable<StreamChunk> };
const sdk = await import(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai')) as { apply(ctx: Record<string, unknown>, config: Record<string, unknown>): Promise<void> };
const homes: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });
const token = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64url')}.signature`;
async function fixture(home?: string, switchDuringAuth = false, initialProviders: Record<string, Route> = {}) {
  if (!home) { home = await mkdtemp(join(tmpdir(), 'notara-subscription-integration-')); homes.push(home); }
  let raw: Raw = { providers: initialProviders }, discover!: Discover, adapter!: Adapter;
  const listeners = new Map<string, (this: unknown, previous?: unknown, next?: () => Raw) => unknown>();
  const fiber = { entry: { options: { id: 'catalog-fixture' } } };
  type Flow = { key: unknown; run(session: { method: string; signal: AbortSignal; prompt(prompt: unknown): Promise<string>; notify(event: unknown): void }): Promise<void> };
  const injections: ((context: Record<string, unknown>) => void)[] = [], flows: Flow[] = [], warnings: string[] = [];
  const records = new Map<string, unknown>();
  const storedRecord = { kind: 'grant', payload: { type: 'oauth', access: token, refresh: 'synthetic-refresh', expires: Date.now() + 3600_000 } };
  let codexReads = 0;
  const ctx = {
    fiber, inject(services: string[], operation: (context: Record<string, unknown>) => void) { if (services.includes('authorization')) injections.push(operation); }, effect() {}, logger: { warn(message: string) { warnings.push(message); }, error() {} },
    on(event: string, listener: (this: unknown, previous?: unknown, next?: () => Raw) => unknown) { listeners.set(event, listener); },
    get(service: string) {
      if (service === 'launchEnvironment') return { get: (name: string) => name === 'DSH_HOME' ? { value: home } : undefined };
      if (service === 'credentials') return {
        resolve: async () => ({ value: 'synthetic-key' }),
        readRecord: async (key: unknown) => {
          const address = JSON.stringify(key);
          if (switchDuringAuth && address.includes('openai-codex') && ++codexReads >= 3) return {
            ...storedRecord, payload: { ...storedRecord.payload, access: 'different-account-token', refresh: 'different-account-grant' },
          };
          return records.get(address) ?? storedRecord;
        },
        modifyRecord: async (key: unknown, operation: (current: unknown) => Promise<unknown>) => {
          const address = JSON.stringify(key), next = await operation(records.get(address) ?? storedRecord);
          records.set(address, next); return next;
        },
      };
      return undefined;
    },
    llm: {
      registerConfigurableProviders() { return { replace() {} }; },
      registerModelDiscovery(_ns: string, operation: Discover) { discover = operation; },
      registerAdapter(_routes: string[], next: Adapter) { adapter = next; return { replace() {} }; },
    },
  };
  await sdk.apply(ctx, { providers: { get: () => raw.providers } });
  return { home, discover, warnings,
    async login(provider: string) {
      for (const operation of injections) operation({ logger: ctx.logger, authorization: { registerFlow(flow: Flow) { flows.push(flow); } } });
      const flow = flows.find(flow => JSON.stringify(flow.key).includes(provider));
      if (!flow) throw new Error('Missing authorization flow');
      await flow.run({ method: 'api_key', signal: new AbortController().signal, prompt: async () => 'synthetic-new-key', notify() {} });
    },
    save(providers: Record<string, Route>) {
      const next = { providers };
      listeners.get('internal/config')!.call(fiber, raw, () => next);
      raw = next;
      listeners.get('loader/volatile-update')!.call(fiber);
      return adapter;
    },
  };
}
const codexModels = ['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'].map(slug => ({ slug, display_name: slug, visibility: 'list', supported_in_api: false, context_window: 1000000, input_modalities: ['text'], supported_reasoning_levels: [{ effort: 'high' }] }));
const vendorMetadata = (key: string, context = 1000000) => ({ [key]: { models: { 'future-subscription-model': {
  id: 'future-subscription-model', name: 'Future subscription model', limit: { context, output: 8192 }, modalities: { input: ['text'] },
} } } });

test('fresh Codex account discovery saves all three newly visible GPT models, using the native Responses transport', async () => {
  const calls: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init); calls.push(request);
    if (request.url.startsWith('https://chatgpt.com/backend-api/codex/models?')) return Response.json({ models: codexModels });
    if (request.url === 'https://chatgpt.com/backend-api/codex/responses') {
      return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'synthetic', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }
    throw new Error('Unexpected real network');
  });
  const first = await fixture();
  expect(calls).toHaveLength(0);
  expect((await first.discover({ provider: 'openai-codex' })).map(model => model.id)).toEqual(codexModels.map(model => model.slug));
  const adapter = first.save({ 'openai-codex': { transport: 'sse', models: codexModels.map(model => ({ id: model.slug })) } });
  expect((await adapter.listModels('openai-codex')).map(model => model.id)).toEqual(codexModels.map(model => model.slug));
  expect((await adapter.resolveModel('openai-codex', 'gpt-6.1-sol')).context.contextWindow).toBe(1000000);
  const chunks: StreamChunk[] = [];
  for await (const chunk of adapter.stream({ provider: 'openai-codex', model: 'gpt-6.1-sol', system: 'Synthetic instruction.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic question.' }] }] })) chunks.push(chunk);
  expect(chunks.some(chunk => chunk.type === 'finish')).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[1]!.headers.get('authorization')).toBe(`Bearer ${token}`);
  expect(calls[1]!.headers.has('x-opencode-session')).toBe(false);
  const encoded = Buffer.from(await calls[1]!.arrayBuffer());
  const body = calls[1]!.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(encoded) : encoded;
  expect((JSON.parse(body.toString('utf8')) as { model: string }).model).toBe('gpt-6.1-sol');
  await fixture(); // Force singleton away before verifying disk restoration.
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  const reopened = await fixture(first.home);
  const persisted = reopened.save({ 'openai-codex': { models: [{ id: 'gpt-6.1-sol' }] } });
  expect((await persisted.listModels('openai-codex'))[0]?.id).toBe('gpt-6.1-sol');
  await expect(reopened.discover({ provider: 'openai-codex' })).rejects.toThrow(/last valid catalog is retained/);
  expect((await persisted.resolveModel('openai-codex', 'gpt-6.1-sol')).context.contextWindow).toBe(1000000);
});

test('a successful native API-key login refreshes its subscription catalog once before saving new models', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init); requests.push(request);
    if (request.url !== 'https://models.dev/api.json') throw new Error('Unexpected real network');
    return Response.json(vendorMetadata('kimi-code-plan-cn'));
  });
  const current = await fixture();
  await current.login('kimi-coding');
  expect(current.warnings).toEqual([]);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.headers.has('authorization')).toBe(false);
  const adapter = current.save({ 'kimi-coding': { models: [{ id: 'future-subscription-model' }] } });
  expect((await adapter.resolveModel('kimi-coding', 'future-subscription-model')).context.contextWindow).toBe(1000000);
  expect(requests).toHaveLength(1);
});

test.each([
  ['kimi-coding', 'kimi-code-plan-cn'], ['minimax', 'minimax-coding-plan'], ['minimax-cn', 'minimax-cn-coding-plan'],
  ['zai', 'zai-coding-plan'], ['zai-coding-cn', 'zhipuai-coding-plan'],
  ['qwen-token-plan', 'alibaba-token-plan'], ['qwen-token-plan-individual', 'alibaba-token-plan'], ['qwen-token-plan-cn', 'alibaba-token-plan-cn'],
  ['xiaomi-token-plan-cn', 'xiaomi-token-plan-cn'], ['xiaomi-token-plan-ams', 'xiaomi-token-plan-ams'], ['xiaomi-token-plan-sgp', 'xiaomi-token-plan-sgp'],
])('%s saves a dynamically announced future model and invalidates metadata without rewriting configuration', async (provider, metadata) => {
  let context = 1000000;
  const calls: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init); calls.push(request);
    if (request.url !== 'https://models.dev/api.json') throw new Error('Unexpected real network');
    return Response.json(vendorMetadata(metadata!, context));
  });
  const current = await fixture();
  expect(calls).toHaveLength(0);
  await current.discover({ provider: provider! });
  const adapter = current.save({ [provider!]: { apiKeyEnv: 'SYNTHETIC_SUBSCRIPTION_KEY', models: [{ id: 'future-subscription-model' }] } });
  expect((await adapter.resolveModel(provider!, 'future-subscription-model')).context.contextWindow).toBe(context);
  context = 131072;
  await current.discover({ provider: provider! });
  expect((await adapter.resolveModel(provider!, 'future-subscription-model')).context.contextWindow).toBe(context);
  expect(calls).toHaveLength(2);
  expect(calls.every(call => !call.headers.has('authorization'))).toBe(true);
  expect(() => current.save({ [provider!]: { models: [{ id: 'undiscovered-model' }] } })).toThrow(/needs an api/);
});

test('discovery refuses mismatched access and account identity snapshots before sending account credentials', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init)); throw new Error('Account switch should prevent network');
  });
  const current = await fixture(undefined, true);
  await expect(current.discover({ provider: 'openai-codex' })).rejects.toThrow(/could not be refreshed/);
  expect(requests).toEqual([]);
});

test('Copilot dynamically saves a new model with an explicit wire contract and restores an API-key route offline', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init); requests.push(request);
    if (request.url === 'https://api.individual.githubcopilot.com/models') return Response.json({ data: [
      { id: 'future-copilot', model_picker_enabled: true, policy: { state: 'enabled' }, capabilities: { supports: { tool_calls: true } } },
    ] });
    if (request.url === 'https://models.dev/api.json') return Response.json({ 'github-copilot': { models: {
      'future-copilot': { id: 'future-copilot', name: 'Future Copilot', provider: { npm: '@ai-sdk/anthropic' }, limit: { context: 1000000, output: 8192 }, modalities: { input: ['text'] } },
    } } });
    throw new Error('Unexpected real network');
  });
  const first = await fixture();
  expect((await first.discover({ provider: 'github-copilot', apiKey: 'synthetic-key' })).map(model => model.id)).toEqual(['future-copilot']);
  expect(requests).toHaveLength(2);
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer synthetic-key');
  expect(requests[1]!.headers.has('authorization')).toBe(false);
  const providers = { 'github-copilot': { apiKeyEnv: 'SYNTHETIC_COPILOT_KEY', models: [{ id: 'future-copilot' }] } };
  expect((await first.save(providers).resolveModel('github-copilot', 'future-copilot')).context.contextWindow).toBe(1000000);
  await fixture();
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  const restored = await fixture(first.home, false, providers);
  expect((await restored.save(providers).listModels('github-copilot')).map(model => model.id)).toEqual(['future-copilot']);
});
