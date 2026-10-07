import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Model = { id: string; name: string; api: string; baseUrl: string; contextWindow: number; maxTokens: number; input: string[]; [key: string]: unknown };
type Snapshot = { format: number; fetchedAt: number; activeIds: string[]; models: Model[] };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Catalog = {
  snapshot?: Snapshot; revision: number; fetcher: Fetcher; cachePath?: string;
  load(home: string): Promise<void>;
  refresh(options?: { force?: boolean; signal?: AbortSignal }): Promise<boolean>;
  models(installed: Model[], base?: string): Model[];
};
const { OpenCodeGoCatalog, parseGoCatalog, GO_MODELS_URL, GO_METADATA_URL } = await import(
  new URL('../../scripts/opencode-go-catalog.mjs', import.meta.url).href
) as {
  OpenCodeGoCatalog: new (options?: { fetcher?: Fetcher; now?: () => number }) => Catalog;
  parseGoCatalog(listing: unknown, metadata: unknown): Snapshot;
  GO_MODELS_URL: string; GO_METADATA_URL: string;
};

const homes: string[] = [];
async function home() { const path = await mkdtemp(join(tmpdir(), 'notara-go-unit-')); homes.push(path); return path; }
afterEach(async () => { for (const path of homes.splice(0)) await rm(path, { recursive: true, force: true }); });

function sources(ids = ['future-completions', 'future-responses', 'future-messages']) {
  const models = Object.fromEntries(ids.map((id, index) => [id, {
    id, name: id, limit: { context: 1000000, output: 32768 }, modalities: { input: ['text', 'image', 'pdf'] },
    ...(index === 0 ? {} : { provider: { npm: index === 1 ? '@ai-sdk/openai' : '@ai-sdk/anthropic' } }),
    irrelevantSecret: 'must-not-enter-cache',
  }]));
  return { listing: { data: ids.map(id => ({ id })) }, metadata: { 'opencode-go': { npm: '@ai-sdk/openai-compatible', api: 'https://opencode.ai/zen/go/v1', models } } };
}
function fetcher(data = sources(), calls: { url: string; init: RequestInit }[] = []): Fetcher {
  return async (url, init) => {
    calls.push({ url, init });
    if (url === GO_MODELS_URL) return Response.json(data.listing);
    if (url === GO_METADATA_URL) return Response.json(data.metadata);
    throw new Error('Unexpected real network');
  };
}

test('joins exact Go IDs with model-level SDK overrides, stripping unsupported fields', () => {
  const data = sources();
  data.listing.data.push({ id: 'missing-metadata' }, { id: 'future-completions' });
  const result = parseGoCatalog(data.listing, data.metadata);
  expect(result.models.map(model => [model.id, model.api, model.baseUrl])).toEqual([
    ['future-completions', 'openai-completions', 'https://opencode.ai/zen/go/v1'],
    ['future-responses', 'openai-responses', 'https://opencode.ai/zen/go/v1'],
    ['future-messages', 'anthropic-messages', 'https://opencode.ai/zen/go'],
  ]);
  expect(result.models[0]!.input).toEqual(['text', 'image']);
  expect(JSON.stringify(result)).not.toContain('must-not-enter-cache');
  expect(result.activeIds).toHaveLength(4);
});

test('rejects unknown protocols and untrusted endpoints without model-name inference', () => {
  const data = sources(['deepseek-future', 'gpt-future', 'minimax-future']);
  const models = data.metadata['opencode-go'].models;
  Object.assign(models['deepseek-future']!, { provider: { npm: 'untrusted-executable-package' } });
  Object.assign(models['gpt-future']!, { provider: { npm: '@ai-sdk/openai', api: 'https://foreign.example/v1' } });
  expect(parseGoCatalog(data.listing, data.metadata).models.map(model => model.id)).toEqual(['minimax-future']);
  expect(() => parseGoCatalog(data.listing, { 'opencode-go': { ...data.metadata['opencode-go'], api: undefined } })).toThrow(/Invalid/);
  expect(() => parseGoCatalog({ data: [] }, data.metadata)).toThrow(/empty/);
});

test('fetches anonymously, persists normalized metadata, and reopens offline', async () => {
  const path = await home();
  const calls: { url: string; init: RequestInit }[] = [];
  const catalog = new OpenCodeGoCatalog({ fetcher: fetcher(sources(), calls) });
  await catalog.load(path);
  expect(await catalog.refresh()).toBe(true);
  expect(calls.map(call => call.url).sort()).toEqual([GO_MODELS_URL, GO_METADATA_URL].sort());
  for (const { init } of calls) {
    expect(init.headers).toEqual({ accept: 'application/json' });
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  }
  const saved = await readFile(catalog.cachePath!, 'utf8');
  expect(saved).not.toContain('must-not-enter-cache');
  const offline = new OpenCodeGoCatalog({ fetcher: async () => { throw new Error('offline'); } });
  await offline.load(path);
  expect(offline.models([])).toEqual(catalog.models([]));
  await expect(offline.refresh({ force: true })).rejects.toThrow('offline');
  expect(await readFile(catalog.cachePath!, 'utf8')).toBe(saved);
});

test('respects TTL, coalesces refreshes, and cancels one waiter without cancelling others', async () => {
  let now = Date.now();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: { url: string; init: RequestInit }[] = [];
  const plain = fetcher(sources(), calls);
  const catalog = new OpenCodeGoCatalog({ now: () => now, fetcher: async (url, init) => { await gate; return plain(url, init); } });
  await catalog.load(await home());
  const signal = new AbortController();
  const first = catalog.refresh({ signal: signal.signal });
  const second = catalog.refresh();
  signal.abort(new Error('caller cancelled'));
  await expect(first).rejects.toThrow('caller cancelled');
  release();
  expect(await second).toBe(true);
  expect(calls).toHaveLength(2);
  expect(await catalog.refresh()).toBe(false);
  expect(calls).toHaveLength(2);
  now += 30 * 60_000;
  expect(await catalog.refresh()).toBe(true);
  expect(calls).toHaveLength(4);
  expect(await catalog.refresh({ force: true })).toBe(true);
  expect(calls).toHaveLength(6);
});

test('failed, oversized, or empty sources preserve the last valid snapshot and disk cache', async () => {
  const catalog = new OpenCodeGoCatalog({ fetcher: fetcher() });
  await catalog.load(await home());
  await catalog.refresh();
  const revision = catalog.revision;
  const previous = await readFile(catalog.cachePath!, 'utf8');
  for (const broken of [
    async () => Response.json({}, { status: 503 }),
    async () => new Response('{}', { headers: { 'content-length': String(20 * 1024 * 1024) } }),
    fetcher({ ...sources(), listing: { data: [] } }),
  ]) {
    catalog.fetcher = broken;
    await expect(catalog.refresh({ force: true })).rejects.toThrow();
    expect(catalog.revision).toBe(revision);
    expect(await readFile(catalog.cachePath!, 'utf8')).toBe(previous);
  }
});

test('temporarily missing metadata retains last-known-good entries only while advertised', async () => {
  const catalog = new OpenCodeGoCatalog({ fetcher: fetcher() });
  await catalog.load(await home());
  await catalog.refresh();
  const data = sources();
  delete data.metadata['opencode-go'].models['future-responses'];
  data.listing.data = data.listing.data.filter(row => row.id !== 'future-messages');
  catalog.fetcher = fetcher(data);
  await catalog.refresh({ force: true });
  expect(catalog.models([]).map(model => model.id).sort()).toEqual(['future-completions', 'future-responses']);
  expect(catalog.models([]).find(model => model.id === 'future-responses')!.api).toBe('openai-responses');
});

test('does not let a late old-home refresh replace a newer home snapshot', async () => {
  const firstHome = await home();
  const secondHome = await home();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalFetch = fetcher(sources(['old-home-model']));
  const catalog = new OpenCodeGoCatalog({ fetcher: async (url, init) => { await gate; return originalFetch(url, init); } });
  await catalog.load(firstHome);
  const old = catalog.refresh();
  await catalog.load(secondHome);
  catalog.fetcher = fetcher(sources(['new-home-model']));
  await catalog.refresh();
  release();
  expect(await old).toBe(false);
  expect(catalog.models([]).map(model => model.id)).toEqual(['new-home-model']);
  expect(JSON.parse(await readFile(catalog.cachePath!, 'utf8')).models[0].id).toBe('new-home-model');
});

test('ignores corrupt, oversized, or nonofficial caches and preserves custom routes', async () => {
  const path = await home();
  const cacheDir = join(path, '.notara/model-catalog');
  await mkdir(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, 'opencode-go.json');
  const valid = parseGoCatalog(sources().listing, sources().metadata);
  for (const content of ['{broken', 'x'.repeat(1024 * 1024 + 1), JSON.stringify({ ...valid, models: [{ ...valid.models[0], baseUrl: 'https://foreign.example' }] })]) {
    await writeFile(cachePath, content);
    const catalog = new OpenCodeGoCatalog();
    await catalog.load(path);
    expect(catalog.snapshot).toBeUndefined();
  }
  await writeFile(cachePath, JSON.stringify(valid));
  const catalog = new OpenCodeGoCatalog();
  await catalog.load(path);
  const installed: Model[] = [{ ...valid.models[0]!, reasoning: true, compat: { fixture: true } }];
  expect(catalog.models(installed, 'https://foreign.example/v1')).toBe(installed);
  expect(catalog.models(installed)[0]).toMatchObject({ reasoning: true, compat: { fixture: true } });
  const changed = [{ ...installed[0]!, api: 'anthropic-messages', thinkingLevelMap: { high: 'fixture' } }];
  expect(catalog.models(changed)[0]!.compat).not.toHaveProperty('fixture');
  expect(catalog.models(changed)[0]).not.toHaveProperty('thinkingLevelMap');
});

test('does not publish a new in-memory generation when cache persistence fails', async () => {
  const path = await home();
  await writeFile(join(path, '.notara'), 'directory occupied');
  const catalog = new OpenCodeGoCatalog({ fetcher: fetcher() });
  await catalog.load(path);
  await expect(catalog.refresh()).rejects.toThrow();
  expect(catalog.snapshot).toBeUndefined();
});

test('preserves explicitly declared reasoning capabilities and DeepSeek metadata wire dialect', () => {
  const data = sources(['brand-new-model']);
  Object.assign(data.metadata['opencode-go'].models['brand-new-model']!, {
    reasoning: true, family: 'deepseek-flash', interleaved: { field: 'reasoning_content' },
    reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max', 'unrecognized-effort'] }],
  });
  const catalog = new OpenCodeGoCatalog();
  catalog.snapshot = parseGoCatalog(data.listing, data.metadata);
  const model = catalog.models([])[0]!;
  expect(model.reasoning).toBe(true);
  expect(model.compat).toMatchObject({ thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true, maxTokensField: 'max_tokens' });
  expect(model.thinkingLevelMap).toEqual({ minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' });
});
