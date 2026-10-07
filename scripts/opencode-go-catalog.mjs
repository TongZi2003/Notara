import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

export const GO_MODELS_URL = 'https://opencode.ai/zen/go/v1/models';
export const GO_METADATA_URL = 'https://models.dev/api.json';
const TTL = 30 * 60_000;
const CACHE_BYTES = 1024 * 1024;
const MAX_MODELS = 2000;
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const PROTOCOLS = new Map([
  ['@ai-sdk/openai-compatible', 'openai-completions'],
  ['@ai-sdk/openai', 'openai-responses'],
  ['@ai-sdk/anthropic', 'anthropic-messages'],
]);
const BASES = new Map([
  ['openai-completions', 'https://opencode.ai/zen/go/v1'],
  ['openai-responses', 'https://opencode.ai/zen/go/v1'],
  ['anthropic-messages', 'https://opencode.ai/zen/go'],
]);
const validId = value => typeof value === 'string' && /^[\x21-\x7e]{1,256}$/.test(value);
const capacity = value => Number.isSafeInteger(value) && value > 0 && value <= 100_000_000;

export function isOfficialGoBase(base) {
  if (base === undefined) return true;
  try {
    const url = new URL(base);
    return url.protocol === 'https:' && url.hostname === 'opencode.ai' && !url.port && !url.username && !url.password && !url.search && !url.hash &&
      ['/zen/go', '/zen/go/', '/zen/go/v1', '/zen/go/v1/'].includes(url.pathname);
  } catch { return false; }
}

function cachedModel(raw) {
  if (!raw || !validId(raw.id) || !BASES.has(raw.api) || raw.baseUrl !== BASES.get(raw.api) ||
      typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 512 ||
      !capacity(raw.contextWindow) || !capacity(raw.maxTokens) || !Array.isArray(raw.input) ||
      !raw.input.includes('text') || raw.input.some(value => !['text', 'image'].includes(value)) ||
      (raw.reasoning !== undefined && typeof raw.reasoning !== 'boolean') ||
      (raw.reasoningContent !== undefined && typeof raw.reasoningContent !== 'boolean') ||
      (raw.reasoningEfforts !== undefined && (!raw.reasoningEfforts || typeof raw.reasoningEfforts !== 'object' || Array.isArray(raw.reasoningEfforts) ||
        Object.entries(raw.reasoningEfforts).some(([key, value]) => !LEVELS.includes(key) || ![...LEVELS, 'none'].includes(value)))) ||
      (raw.thinkingFormat !== undefined && raw.thinkingFormat !== 'deepseek')) return;
  return { id: raw.id, name: raw.name, api: raw.api, baseUrl: raw.baseUrl,
    contextWindow: raw.contextWindow, maxTokens: raw.maxTokens, input: [...new Set(raw.input)],
    ...(raw.reasoning === undefined ? {} : { reasoning: raw.reasoning }),
    ...(raw.reasoningContent === undefined ? {} : { reasoningContent: raw.reasoningContent }),
    ...(raw.reasoningEfforts === undefined ? {} : { reasoningEfforts: { ...raw.reasoningEfforts } }),
    ...(raw.thinkingFormat === undefined ? {} : { thinkingFormat: raw.thinkingFormat }) };
}

/** Join exact advertised IDs with protocol metadata; never infer a vendor from an ID. */
export function parseGoCatalog(listing, metadata, fetchedAt = Date.now()) {
  const provider = metadata?.['opencode-go'];
  if (!Array.isArray(listing?.data) || listing.data.length > MAX_MODELS || !provider ||
      typeof provider.api !== 'string' || !isOfficialGoBase(provider.api) ||
      typeof provider.models !== 'object' || provider.models === null || Array.isArray(provider.models)) throw new Error('Invalid public Go catalog');
  const activeIds = [...new Set(listing.data.map(value => value?.id).filter(validId))];
  if (!activeIds.length) throw new Error('Public Go catalog is empty');
  const models = [];
  for (const id of activeIds) {
    if (!Object.hasOwn(provider.models, id)) continue;
    const raw = provider.models[id];
    if (!raw || raw.id !== id) continue;
    const npm = raw.provider?.npm ?? provider.npm;
    const api = PROTOCOLS.get(npm);
    // Only fixed official endpoints may be used, including model-level overrides.
    if (!api || (raw.provider?.api !== undefined && !isOfficialGoBase(raw.provider.api))) continue;
    const input = raw.modalities?.input;
    const effortOption = Array.isArray(raw.reasoning_options) ? raw.reasoning_options.find(option => option?.type === 'effort' && Array.isArray(option.values)) : undefined;
    const efforts = effortOption?.values.filter(value => [...LEVELS, 'none'].includes(value));
    const model = cachedModel({ id, name: raw.name, api, baseUrl: BASES.get(api),
      contextWindow: raw.limit?.context, maxTokens: raw.limit?.output,
      reasoning: raw.reasoning,
      ...(efforts?.length ? { reasoningEfforts: Object.fromEntries(efforts.map(value => [value === 'none' ? 'off' : value, value])) } : {}),
      ...(raw.interleaved?.field === 'reasoning_content' ? { reasoningContent: true } : {}),
      // Explicit metadata family selects an existing SDK wire dialect; no ID matching.
      ...(api === 'openai-completions' && ['deepseek-flash', 'deepseek-pro'].includes(raw.family) ? { thinkingFormat: 'deepseek' } : {}),
      input: Array.isArray(input) ? input.filter(value => ['text', 'image'].includes(value)) : undefined });
    if (model) models.push(model);
  }
  if (!models.length) throw new Error('Public Go catalog contains no supported protocol metadata');
  return { format: 1, fetchedAt, activeIds, models };
}

function readSnapshot(raw) {
  if (raw?.format !== 1 || !Number.isSafeInteger(raw.fetchedAt) || raw.fetchedAt < 0 || raw.fetchedAt > Date.now() + 60_000 ||
      !Array.isArray(raw.activeIds) || !raw.activeIds.length || raw.activeIds.length > MAX_MODELS || raw.activeIds.some(id => !validId(id)) ||
      !Array.isArray(raw.models) || !raw.models.length || raw.models.length > MAX_MODELS) throw new Error('Invalid cached Go catalog');
  const active = new Set(raw.activeIds);
  const models = raw.models.map(cachedModel);
  if (models.some(model => !model || !active.has(model.id)) || new Set(models.map(model => model.id)).size !== models.length) throw new Error('Invalid cached Go model');
  return { format: 1, fetchedAt: raw.fetchedAt, activeIds: [...active], models };
}

export async function publicJson(url, limit, fetcher, signal, headers = {}) {
  const response = await fetcher(url, { headers: { accept: 'application/json', ...headers }, redirect: 'error', signal });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Public Go catalog request failed'); }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) { await response.body?.cancel(); throw new Error('Public Go catalog is too large'); }
  if (!response.body) throw new Error('Public Go catalog has no body');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('Public Go catalog is too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolveWait, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Go discovery cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolveWait, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class OpenCodeGoCatalog {
  constructor({ fetcher = (...args) => fetch(...args), now = () => Date.now(), catalog } = {}) {
    this.fetcher = fetcher;
    this.now = now;
    this.catalog = catalog;
    this.revision = 0;
    this.snapshot = undefined;
    this.pending = undefined;
    this.cachePath = undefined;
    this.generation = 0;
    this.loading = undefined;
  }

  async load(home) {
    const path = resolve(home, '.notara', 'model-catalog', `${this.catalog?.id ?? 'opencode-go'}.json`);
    if (this.cachePath === path) return this.loading;
    this.cachePath = path;
    const generation = ++this.generation;
    this.pending = undefined;
    this.snapshot = undefined;
    this.revision++;
    this.loading = (async () => {
      try {
        if ((await stat(path)).size > CACHE_BYTES) return;
        const snapshot = (this.catalog?.readSnapshot ?? readSnapshot)(JSON.parse(await readFile(path, 'utf8')));
        if (this.generation === generation) this.snapshot = snapshot;
      } catch { /* A missing/invalid cache cannot prevent local startup. */ }
    })();
    await this.loading;
  }

  matches(base) { return (this.catalog?.matches ?? isOfficialGoBase)(base); }
  baseFor(api) { return this.catalog ? this.catalog.baseFor(api) : BASES.get(api); }

  models(installed, base) {
    if (!this.snapshot || !this.matches(base)) return installed;
    if (this.catalog) return this.catalog.models(this.snapshot, installed);
    const original = new Map(installed.map(model => [model.id, model]));
    const resolved = this.snapshot.models.map(model => {
      const prior = original.get(model.id);
      const { reasoningContent, thinkingFormat, reasoningEfforts, ...fields } = model;
      const result = { ...(prior ?? { provider: 'opencode-go', reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }), ...fields };
      if (prior && prior.api !== model.api) { delete result.compat; delete result.thinkingLevelMap; }
      if (model.api === 'openai-completions') {
        result.compat = { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens', ...result.compat,
          ...(reasoningContent ? { requiresReasoningContentOnAssistantMessages: true } : {}),
          ...(thinkingFormat ? { thinkingFormat } : {}) };
      }
      if (reasoningEfforts) {
        result.thinkingLevelMap = Object.fromEntries(LEVELS.map(level => [level, reasoningEfforts[level] ?? null]));
        // This SDK dialect explicitly disables thinking without an effort spelling.
        if (thinkingFormat === 'deepseek') delete result.thinkingLevelMap.off;
      }
      // An unfamiliar compatible model's toggle/budget controls need their own wire adapter.
      if (!prior && model.api === 'openai-completions' && !reasoningEfforts && !thinkingFormat) result.reasoning = false;
      return result;
    });
    // Temporary metadata lag must not remove an already supported advertised model.
    const ids = new Set(resolved.map(model => model.id));
    const active = new Set(this.snapshot.activeIds);
    return [...resolved, ...installed.filter(model => active.has(model.id) && !ids.has(model.id))];
  }

  async refresh({ force = false, signal, auth, installed } = {}) {
    signal?.throwIfAborted();
    if (!force && this.snapshot && this.now() - this.snapshot.fetchedAt < TTL) return false;
    if (!this.cachePath) throw new Error('Go catalog cache is not initialized');
    if (!this.pending) {
      const cachePath = this.cachePath;
      const generation = this.generation;
      const pending = (async () => {
        const timeout = AbortSignal.timeout(10_000);
        const next = this.catalog ? await this.catalog.fetch(this.fetcher, timeout, this.now(), auth, installed) : parseGoCatalog(...await Promise.all([
          publicJson(GO_MODELS_URL, 4 * 1024 * 1024, this.fetcher, timeout),
          publicJson(GO_METADATA_URL, 16 * 1024 * 1024, this.fetcher, timeout),
        ]), this.now());
        const active = new Set(next.activeIds);
        const freshIds = new Set(next.models.map(model => model.id));
        next.models.push(...(this.snapshot?.models ?? []).filter(model => active.has(model.id) && !freshIds.has(model.id)));
        const encoded = JSON.stringify(next);
        if (Buffer.byteLength(encoded) > CACHE_BYTES) throw new Error('Go catalog cache is too large');
        if (this.generation !== generation) return false;
        const directory = dirname(cachePath);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const pendingPath = `${cachePath}.${randomUUID()}.next`;
        try {
          const file = await open(pendingPath, 'wx', 0o600);
          try { await file.writeFile(encoded); await file.sync(); }
          finally { await file.close(); }
          for (let attempt = 0; ; attempt++) {
            try { await rename(pendingPath, cachePath); break; }
            catch (error) {
              if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
              await new Promise(resolveDelay => setTimeout(resolveDelay, 50 * (attempt + 1)));
            }
          }
        } finally { await rm(pendingPath, { force: true }); }
        if (this.generation !== generation) return false;
        this.snapshot = next;
        this.revision++;
        return true;
      })().finally(() => { if (this.pending === pending) this.pending = undefined; });
      this.pending = pending;
    }
    return waitFor(this.pending, signal);
  }
}

export const notaraGoCatalog = new OpenCodeGoCatalog();
