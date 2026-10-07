import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
type Model = { id: string; api: string; baseUrl: string; contextWindow?: number; maxTokens?: number; [key: string]: unknown };
// The upstream generated declaration graph imports JSON without NodeNext attributes.
// Keep this fixture seam structural instead of pulling those declarations into the tests.
const { getBuiltinModels } = await import(import.meta.resolve('@earendil-works/pi-ai/providers/all')) as {
  getBuiltinModels(provider: string): Model[];
};
type Snapshot = { models: Model[]; activeIds: string[] };
type Auth = { apiKey: string; catalogIdentity?: string; baseUrl?: string; headers?: Record<string, string> };
type Catalogs = {
  revision: number; load(home: string, accounts?: Record<string, Auth>): Promise<void>;
  refresh(id: string, options?: { auth?: Auth; installed?: unknown[] }): Promise<boolean>;
  invalidate(id: string): void;
  credentialChanged(id: string, credential?: { type: 'oauth'; access: string; refresh: string }): Promise<void>;
  selectAccount(id: string, auth: Auth): Promise<{ cacheId: string; generation: number }>;
  models(id: string, installed: unknown[], base?: string): Model[];
};
const { parseSubscriptionCatalog, parseCodexCatalog, SubscriptionCatalogs } = await import(new URL('../../scripts/subscription-model-catalog.mjs', import.meta.url).href) as {
  parseSubscriptionCatalog(id: string, metadata: unknown, listing?: unknown, installed?: unknown[], fetchedAt?: number, allowPolicyFallback?: boolean): Snapshot;
  parseCodexCatalog(body: unknown): Snapshot;
  SubscriptionCatalogs: new (options?: { fetcher?: (url: string, init: RequestInit) => Promise<Response> }) => Catalogs;
};
const homes: string[] = [];
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });
const rawModel = (id = 'future-model') => ({ id, name: id, limit: { context: 1000000, output: 32768 }, modalities: { input: ['text', 'image'] }, secret: 'ignored' });
const codexRows = ['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'].map(slug => ({ slug, display_name: slug, visibility: 'list', supported_in_api: false, context_window: 1000000, input_modalities: ['text', 'image'], supported_reasoning_levels: [{ effort: 'high' }, { effort: 'max' }] }));

test('Codex account catalog accepts new visible subscription models without API-key eligibility filtering', () => {
  const result = parseCodexCatalog({ models: [...codexRows, { slug: 'hidden', visibility: 'hide' }] });
  expect(result.models.map(model => model.id)).toEqual(['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol']);
  for (const model of result.models) {
    expect(model.api).toBe('openai-codex-responses');
    expect(model).not.toHaveProperty('maxTokens');
    expect(model.contextWindow).toBe(1000000);
  }
});

test.each([
  ['kimi-coding', 'kimi-code-plan-cn', 'anthropic-messages', 'https://api.kimi.com/coding'],
  ['minimax', 'minimax-coding-plan', 'anthropic-messages', 'https://api.minimax.io/anthropic'],
  ['minimax-cn', 'minimax-cn-coding-plan', 'anthropic-messages', 'https://api.minimaxi.com/anthropic'],
  ['zai', 'zai-coding-plan', 'openai-completions', 'https://api.z.ai/api/coding/paas/v4'],
  ['zai-coding-cn', 'zhipuai-coding-plan', 'openai-completions', 'https://open.bigmodel.cn/api/coding/paas/v4'],
  ['qwen-token-plan', 'alibaba-token-plan', 'openai-completions', 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'],
  ['qwen-token-plan-individual', 'alibaba-token-plan', 'openai-completions', 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'],
  ['qwen-token-plan-cn', 'alibaba-token-plan-cn', 'openai-completions', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'],
  ['xiaomi-token-plan-cn', 'xiaomi-token-plan-cn', 'openai-completions', 'https://token-plan-cn.xiaomimimo.com/v1'],
  ['xiaomi-token-plan-ams', 'xiaomi-token-plan-ams', 'openai-completions', 'https://token-plan-ams.xiaomimimo.com/v1'],
  ['xiaomi-token-plan-sgp', 'xiaomi-token-plan-sgp', 'openai-completions', 'https://token-plan-sgp.xiaomimimo.com/v1'],
])('%s uses dynamic IDs while preserving its native API and credential endpoint', (id, metadataId, api, baseUrl) => {
  const result = parseSubscriptionCatalog(id!, { [metadataId!]: { npm: '@ai-sdk/openai-compatible', api: 'https://foreign.example/v1', models: { 'future-model': rawModel() } } });
  expect(result.models).toHaveLength(1);
  expect(result.models[0]).toMatchObject({ id: 'future-model', api, baseUrl });
  expect(JSON.stringify(result)).not.toContain('ignored');
});

test('Zen joins advertised IDs with per-model wire metadata, and Copilot retains known mixed APIs', () => {
  const result = parseSubscriptionCatalog('opencode', { opencode: { npm: '@ai-sdk/openai-compatible', models: {
    'future-model': rawModel(), 'future-responses': { ...rawModel('future-responses'), provider: { npm: '@ai-sdk/openai' } },
    absent: rawModel('absent'),
  } } }, { data: [{ id: 'future-model' }, { id: 'future-responses' }] });
  expect(result.models.map(model => model.api)).toEqual(['openai-completions', 'openai-responses']);
  const installed = getBuiltinModels('github-copilot'), anthropic = installed.find(model => model.api === 'anthropic-messages')!;
  const copilot = parseSubscriptionCatalog('github-copilot', { 'github-copilot': { npm: '@ai-sdk/openai-compatible', models: {
    [anthropic.id]: rawModel(anthropic.id), 'future-model': rawModel(),
  } } }, { data: [anthropic.id, 'future-model'].map(id => ({ id, model_picker_enabled: true, capabilities: { supports: { tool_calls: true } }, policy: { state: 'enabled' } })) }, installed);
  expect(copilot.models.map(model => model.api)).toEqual(['anthropic-messages']);
  expect(copilot.activeIds).toContain('future-model');
});

test('new discovery persists a public catalog once, reopens offline and reports refresh failure without erasing it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'notara-subscription-unit-')); homes.push(home);
  const calls: Request[] = [];
  const catalogs = new SubscriptionCatalogs({ fetcher: async (url, init) => { calls.push(new Request(url, init)); return Response.json({ 'zai-coding-plan': { models: { 'future-model': rawModel() } } }); } });
  await catalogs.load(home);
  expect(calls).toHaveLength(0);
  await catalogs.refresh('zai');
  expect(calls).toHaveLength(1);
  expect(calls[0]!.headers.has('authorization')).toBe(false);
  expect(catalogs.models('zai', [])[0]).toMatchObject({ id: 'future-model', compat: { thinkingFormat: 'zai' } });
  const source = await readFile(join(home, '.notara/model-catalog/zai.json'), 'utf8');
  expect(source).not.toMatch(/ignored|apiKey|authorization/);
  const reopened = new SubscriptionCatalogs({ fetcher: async () => { throw new Error('offline'); } });
  await reopened.load(home);
  await expect(reopened.refresh('zai')).rejects.toThrow('offline');
  expect(reopened.models('zai', [])[0]?.id).toBe('future-model');
  const untouched = [{ id: 'custom', api: 'openai-completions', baseUrl: 'http://localhost:9999' }];
  expect(reopened.models('zai', untouched, 'http://localhost:9999')).toBe(untouched);
});

test('Codex catalog sends account auth only to the fixed endpoint and never persists credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'notara-codex-unit-')); homes.push(home);
  const calls: Request[] = [], token = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64url')}.signature`;
  const catalogs = new SubscriptionCatalogs({ fetcher: async (url, init) => { calls.push(new Request(url, init)); return Response.json({ models: codexRows }); } });
  await catalogs.load(home);
  await catalogs.refresh('openai-codex', { auth: { apiKey: token, headers: { Authorization: 'stale-token', 'ChatGPT-Account-ID': 'stale-account' } } });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('https://chatgpt.com/backend-api/codex/models?client_version=0.85.1');
  expect(calls[0]!.headers.get('chatgpt-account-id')).toBe('synthetic-account');
  expect(calls[0]!.headers.get('authorization')).toBe(`Bearer ${token}`);
  const cache = (await readdir(join(home, '.notara/model-catalog'))).find(name => /^openai-codex\.[a-f0-9]{64}\.json$/.test(name));
  expect(cache).toBeDefined();
  expect(await readFile(join(home, '.notara/model-catalog', cache!), 'utf8')).not.toMatch(/synthetic-account|signature|authorization/);
  await expect(catalogs.refresh('openai-codex', { auth: { apiKey: 'invalid' } })).rejects.toThrow(/identity/);
  expect(catalogs.models('openai-codex', []).map(model => model.id)).toEqual(codexRows.map(model => model.slug));
});

test('Copilot discovers an explicitly described new protocol and limits policy fallback to individual accounts', () => {
  const metadata = { 'github-copilot': { npm: '@ai-sdk/openai-compatible', models: {
    picker: { ...rawModel('picker'), provider: { npm: '@ai-sdk/anthropic' } },
    enabled: { ...rawModel('enabled'), provider: { npm: '@ai-sdk/openai' } },
    unconfigured: { ...rawModel('unconfigured'), provider: { npm: '@ai-sdk/anthropic' } },
  } } };
  const listing = { data: [
    { id: 'picker', model_picker_enabled: true, policy: { state: 'enabled' } },
    { id: 'enabled', policy: { state: 'enabled' } },
    { id: 'unconfigured', model_picker_enabled: true, policy: { state: 'unconfigured' } },
  ] };
  expect(parseSubscriptionCatalog('github-copilot', metadata, listing).models.map(model => [model.id, model.api])).toEqual([['picker', 'anthropic-messages']]);
  const fallback = { data: listing.data.slice(1) };
  expect(parseSubscriptionCatalog('github-copilot', metadata, fallback).models).toEqual([]);
  expect(parseSubscriptionCatalog('github-copilot', metadata, fallback, [], Date.now(), true).models.map(model => model.id)).toEqual(['enabled']);
});

test('Copilot restores the same OAuth account cache offline without requiring its refreshed endpoint', async () => {
  const home = await mkdtemp(join(tmpdir(), 'notara-copilot-unit-')); homes.push(home);
  const requests: Request[] = [];
  const catalogs = new SubscriptionCatalogs({ fetcher: async (url, init) => {
    const request = new Request(url, init); requests.push(request);
    if (url === 'https://copilot-api.synthetic.ghe.com/models') return Response.json({ data: [{ id: 'future-model', model_picker_enabled: true }] });
    if (url === 'https://models.dev/api.json') return Response.json({ 'github-copilot': { models: { 'future-model': { ...rawModel(), provider: { npm: '@ai-sdk/anthropic' } } } } });
    throw new Error('Unexpected network');
  } });
  await catalogs.load(home);
  const auth = { apiKey: 'synthetic-short-lived', catalogIdentity: 'synthetic-github-grant', baseUrl: 'https://copilot-api.synthetic.ghe.com' };
  await catalogs.refresh('github-copilot', { auth });
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer synthetic-short-lived');
  expect(requests[0]!.headers.get('x-github-api-version')).toBe('2026-06-01');
  expect(requests[0]!.headers.get('editor-version')).toBe('Notara/0.24.3');
  expect(requests[1]!.headers.has('authorization')).toBe(false);
  const reopened = new SubscriptionCatalogs({ fetcher: async () => { throw new Error('offline'); } });
  await reopened.load(home, { 'github-copilot': { apiKey: auth.apiKey, catalogIdentity: auth.catalogIdentity } });
  expect(reopened.models('github-copilot', [])[0]?.id).toBe('future-model');
  await expect(reopened.refresh('github-copilot', { auth: { ...auth, baseUrl: 'https://foreign.example' } })).rejects.toThrow(/endpoint/);
  expect(reopened.models('github-copilot', [])[0]?.id).toBe('future-model');
});

test('Codex account switches isolate cached lists and reject a late request even after switching back', async () => {
  const home = await mkdtemp(join(tmpdir(), 'notara-codex-switch-')); homes.push(home);
  const authFor = (account: string) => ({ apiKey: `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.signature` });
  let release: (() => void) | undefined, pendingStarted: (() => void) | undefined;
  let defer = false;
  const started = new Promise<void>(resolve => { pendingStarted = resolve; });
  const catalogs = new SubscriptionCatalogs({ fetcher: async (_url, init) => {
    const id = new Headers(init.headers).get('chatgpt-account-id');
    if (defer && id === 'account-a') { defer = false; pendingStarted!(); await new Promise<void>(resolve => { release = resolve; }); }
    return Response.json({ models: [{ ...codexRows[0], slug: id }] });
  } });
  await catalogs.load(home);
  const a = authFor('account-a'), b = authFor('account-b');
  await catalogs.refresh('openai-codex', { auth: a });
  defer = true;
  const late = catalogs.refresh('openai-codex', { auth: a });
  const rejected = expect(late).rejects.toThrow(/changed/);
  await started;
  await catalogs.refresh('openai-codex', { auth: b });
  expect(catalogs.models('openai-codex', [])[0]?.id).toBe('account-b');
  await catalogs.credentialChanged('openai-codex', { type: 'oauth', access: a.apiKey, refresh: 'synthetic-refresh' });
  expect(catalogs.models('openai-codex', [])[0]?.id).toBe('account-a');
  release!(); await rejected;
  expect(catalogs.models('openai-codex', [])[0]?.id).toBe('account-a');
  catalogs.invalidate('openai-codex');
  expect(catalogs.models('openai-codex', [])).toEqual([]);
});

test('a valid empty account list suppresses bundled choices and survives an offline restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'notara-codex-empty-')); homes.push(home);
  const auth = { apiKey: `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'empty-account' } })).toString('base64url')}.signature` };
  const catalogs = new SubscriptionCatalogs({ fetcher: async () => Response.json({ models: [] }) });
  await catalogs.load(home); await catalogs.refresh('openai-codex', { auth });
  expect(catalogs.models('openai-codex', getBuiltinModels('openai-codex'))).toEqual([]);
  const reopened = new SubscriptionCatalogs({ fetcher: async () => { throw new Error('offline'); } });
  await reopened.load(home, { 'openai-codex': auth });
  expect(reopened.models('openai-codex', getBuiltinModels('openai-codex'))).toEqual([]);
});

test('an account switch between cache selection and request start cannot write into the new account cache', async () => {
  const home = await mkdtemp(join(tmpdir(), 'notara-codex-presend-')); homes.push(home);
  const authFor = (account: string) => ({ apiKey: `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.signature` });
  const requested: string[] = [];
  const catalogs = new SubscriptionCatalogs({ fetcher: async (_url, init) => {
    const id = new Headers(init.headers).get('chatgpt-account-id')!; requested.push(id);
    return Response.json({ models: [{ ...codexRows[0], slug: id }] });
  } });
  await catalogs.load(home);
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }), selected = new Promise<void>(resolve => { entered = resolve; });
  const original = catalogs.selectAccount.bind(catalogs), a = authFor('account-a'), b = authFor('account-b');
  // Hold the real selection result at its async call boundary, simulating a
  // concurrent successful login before this caller is allowed to start GET.
  catalogs.selectAccount = async (id, auth) => {
    const result = await original(id, auth);
    if (auth.apiKey === a.apiKey) { entered(); await barrier; }
    return result;
  };
  const late = catalogs.refresh('openai-codex', { auth: a }), rejected = expect(late).rejects.toThrow(/changed/);
  await selected;
  await catalogs.refresh('openai-codex', { auth: b });
  release(); await rejected;
  expect(requested).toEqual(['account-b']);
  expect(catalogs.models('openai-codex', [])[0]?.id).toBe('account-b');
  const caches = await readdir(join(home, '.notara/model-catalog'));
  expect(caches).toHaveLength(1);
  expect(JSON.parse(await readFile(join(home, '.notara/model-catalog', caches[0]!), 'utf8')).models[0].id).toBe('account-b');
});
