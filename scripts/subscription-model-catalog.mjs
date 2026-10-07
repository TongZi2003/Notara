import { OpenCodeGoCatalog, publicJson, GO_METADATA_URL } from './opencode-go-catalog.mjs';
import { createHash } from 'node:crypto';

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const validId = value => typeof value === 'string' && /^[\x21-\x7e]{1,256}$/.test(value);
const capacity = value => Number.isSafeInteger(value) && value > 0 && value <= 100_000_000;
const PROTOCOLS = new Map([
  ['@ai-sdk/openai-compatible', 'openai-completions'], ['@ai-sdk/openai', 'openai-responses'],
  ['@ai-sdk/anthropic', 'anthropic-messages'], ['@ai-sdk/google', 'google-generative-ai'],
]);
const accountHeaders = (auth, values) => {
  const headers = new Headers(auth.headers);
  for (const [key, value] of Object.entries(values)) headers.set(key, value);
  return Object.fromEntries(headers);
};
// IDs identify the installed provider and the exact public catalog, never a model-name pattern.
// Preserve the native endpoint: public metadata cannot redirect credentials to another host.
const SPECS = {
  opencode: { metadata: 'opencode', base: 'https://opencode.ai/zen/v1', listing: 'https://opencode.ai/zen/v1/models',
    bases: { 'openai-completions': 'https://opencode.ai/zen/v1', 'openai-responses': 'https://opencode.ai/zen/v1', 'anthropic-messages': 'https://opencode.ai/zen', 'google-generative-ai': 'https://opencode.ai/zen/v1' } },
  'kimi-coding': { metadata: 'kimi-code-plan-cn', base: 'https://api.kimi.com/coding', api: 'anthropic-messages' },
  minimax: { metadata: 'minimax-coding-plan', base: 'https://api.minimax.io/anthropic', api: 'anthropic-messages' },
  'minimax-cn': { metadata: 'minimax-cn-coding-plan', base: 'https://api.minimaxi.com/anthropic', api: 'anthropic-messages' },
  zai: { metadata: 'zai-coding-plan', base: 'https://api.z.ai/api/coding/paas/v4', api: 'openai-completions' },
  'zai-coding-cn': { metadata: 'zhipuai-coding-plan', base: 'https://open.bigmodel.cn/api/coding/paas/v4', api: 'openai-completions' },
  'qwen-token-plan': { metadata: 'alibaba-token-plan', base: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', api: 'openai-completions' },
  'qwen-token-plan-individual': { metadata: 'alibaba-token-plan', base: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', api: 'openai-completions' },
  'qwen-token-plan-cn': { metadata: 'alibaba-token-plan-cn', base: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', api: 'openai-completions' },
  'xiaomi-token-plan-cn': { metadata: 'xiaomi-token-plan-cn', base: 'https://token-plan-cn.xiaomimimo.com/v1', api: 'openai-completions' },
  'xiaomi-token-plan-ams': { metadata: 'xiaomi-token-plan-ams', base: 'https://token-plan-ams.xiaomimimo.com/v1', api: 'openai-completions' },
  'xiaomi-token-plan-sgp': { metadata: 'xiaomi-token-plan-sgp', base: 'https://token-plan-sgp.xiaomimimo.com/v1', api: 'openai-completions' },
  'github-copilot': { metadata: 'github-copilot', base: 'https://api.individual.githubcopilot.com', account: true,
    apis: ['anthropic-messages', 'openai-completions', 'openai-responses'] },
  'openai-codex': { base: 'https://chatgpt.com/backend-api', api: 'openai-codex-responses', account: true },
};

function matches(spec, base) {
  if (base === undefined) return true;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return false;
    const allowed = new Set([spec.base, ...Object.values(spec.bases ?? {})]);
    return allowed.has(url.href.replace(/\/$/, ''));
  } catch { return false; }
}

function cleanModel(spec, raw) {
  if (!raw || !validId(raw.id) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 512 ||
      !(spec.api ? raw.api === spec.api : [...PROTOCOLS.values()].includes(raw.api)) ||
      (spec.apis && !spec.apis.includes(raw.api)) ||
      raw.baseUrl !== (spec.bases?.[raw.api] ?? spec.base) ||
      (raw.contextWindow !== undefined && !capacity(raw.contextWindow)) || (raw.maxTokens !== undefined && !capacity(raw.maxTokens)) ||
      !Array.isArray(raw.input) || !raw.input.includes('text') || raw.input.some(value => !['text', 'image'].includes(value)) ||
      (raw.reasoning !== undefined && typeof raw.reasoning !== 'boolean') ||
      (raw.efforts !== undefined && (!Array.isArray(raw.efforts) || raw.efforts.some(value => ![...LEVELS, 'none'].includes(value))))) return;
  return { id: raw.id, name: raw.name, api: raw.api, baseUrl: raw.baseUrl, input: [...new Set(raw.input)],
    ...(raw.contextWindow === undefined ? {} : { contextWindow: raw.contextWindow }),
    ...(raw.maxTokens === undefined ? {} : { maxTokens: raw.maxTokens }),
    ...(raw.reasoning === undefined ? {} : { reasoning: raw.reasoning }),
    ...(raw.efforts === undefined ? {} : { efforts: [...new Set(raw.efforts)] }) };
}

function readSnapshot(spec, raw) {
  if (raw?.format !== 1 || !Number.isSafeInteger(raw.fetchedAt) || raw.fetchedAt < 0 || raw.fetchedAt > Date.now() + 60_000 ||
      !Array.isArray(raw.models) || (!raw.models.length && !spec.account) || raw.models.length > 2000 ||
      !Array.isArray(raw.activeIds) || raw.activeIds.length > 2000 || raw.activeIds.some(id => !validId(id))) throw new Error('Invalid subscription catalog');
  const active = new Set(raw.activeIds), models = raw.models.map(model => cleanModel(spec, model));
  if (models.some(model => !model || !active.has(model.id)) || new Set(models.map(model => model.id)).size !== models.length) throw new Error('Invalid subscription model');
  return { format: 1, fetchedAt: raw.fetchedAt, activeIds: [...active], models };
}

export function parseSubscriptionCatalog(id, metadata, listing, installed = [], fetchedAt = Date.now(), allowPolicyFallback = false) {
  const spec = SPECS[id], provider = metadata?.[spec?.metadata];
  if (!spec || !provider?.models || typeof provider.models !== 'object' || Array.isArray(provider.models)) throw new Error('Missing subscription metadata');
  const known = new Map(installed.map(model => [model.id, model]));
  if (listing !== undefined && (!Array.isArray(listing?.data) || listing.data.length > 2000)) throw new Error('Invalid subscription listing');
  let rows = listing?.data;
  if (id === 'github-copilot' && rows) {
    const capable = rows.filter(model => model?.capabilities?.supports?.tool_calls !== false);
    const picked = capable.filter(model => model?.model_picker_enabled === true && !['disabled', 'unconfigured'].includes(model.policy?.state));
    rows = picked.length || !allowPolicyFallback ? picked : capable.filter(model => model?.policy?.state === 'enabled');
  }
  const activeIds = rows === undefined ? Object.keys(provider.models).filter(validId) : [...new Set(rows.map(model => model?.id).filter(validId))];
  if ((!activeIds.length && !spec.account) || activeIds.length > 2000) throw new Error('Empty subscription catalog');
  const models = [];
  for (const modelId of activeIds) {
    const raw = Object.hasOwn(provider.models, modelId) ? provider.models[modelId] : undefined;
    if (!raw || raw.id !== modelId) continue;
    // Existing mixed-protocol models retain their native API/compatibility. For newly
    // advertised Copilot IDs, metadata without a model-specific wire contract is insufficient.
    const api = spec.api ?? known.get(modelId)?.api ?? PROTOCOLS.get(raw.provider?.npm ?? (id === 'github-copilot' ? undefined : provider.npm));
    const input = raw.modalities?.input;
    const effort = raw.reasoning_options?.find(option => option?.type === 'effort' && Array.isArray(option.values));
    const model = cleanModel(spec, { id: modelId, name: raw.name, api, baseUrl: spec.bases?.[api] ?? spec.base,
      contextWindow: raw.limit?.context, maxTokens: raw.limit?.output, reasoning: raw.reasoning,
      input: Array.isArray(input) ? input.filter(value => ['text', 'image'].includes(value)) : undefined,
      ...(effort ? { efforts: effort.values.filter(value => [...LEVELS, 'none'].includes(value)) } : {}) });
    if (model) models.push(model);
  }
  return readSnapshot(spec, { format: 1, fetchedAt, activeIds, models });
}

export function parseCodexCatalog(listing, fetchedAt = Date.now()) {
  if (!Array.isArray(listing?.models) || listing.models.length > 2000) throw new Error('Invalid Codex account catalog');
  const models = listing.models.filter(model => model?.visibility === 'list').map(raw => cleanModel(SPECS['openai-codex'], {
    id: raw.slug, name: raw.display_name || raw.slug, api: 'openai-codex-responses', baseUrl: SPECS['openai-codex'].base,
    input: Array.isArray(raw.input_modalities) ? raw.input_modalities.filter(value => ['text', 'image'].includes(value)) : ['text'],
    ...(capacity(raw.context_window) ? { contextWindow: raw.context_window } : {}),
    ...(Array.isArray(raw.supported_reasoning_levels) ? { reasoning: raw.supported_reasoning_levels.length > 0,
      efforts: raw.supported_reasoning_levels.map(value => value.effort).filter(value => [...LEVELS, 'none'].includes(value)) } : {}),
  })).filter(Boolean);
  return readSnapshot(SPECS['openai-codex'], { format: 1, fetchedAt, activeIds: models.map(model => model.id), models });
}

function overlay(id, snapshot, installed) {
  const known = new Map(installed.map(model => [model.id, model]));
  const resolved = snapshot.models.map(model => {
    const prior = known.get(model.id), { efforts, ...fields } = model;
    const result = { ...(prior ?? { provider: id, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }), ...fields };
    if (model.api === 'openai-completions' && !prior) {
      result.compat = { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' };
      if (['zai', 'zai-coding-cn'].includes(id)) result.compat = { ...result.compat, supportsReasoningEffort: false, thinkingFormat: 'zai', zaiToolStream: true };
      else result.reasoning = false;
    }
    if (efforts?.length && !['zai', 'zai-coding-cn'].includes(id)) result.thinkingLevelMap = Object.fromEntries(LEVELS.map(level => [level, efforts.includes(level) ? level : level === 'off' && efforts.includes('none') ? 'none' : null]));
    return result;
  });
  const active = new Set(snapshot.activeIds), ids = new Set(resolved.map(model => model.id));
  return [...resolved, ...installed.filter(model => active.has(model.id) && !ids.has(model.id))];
}

export class SubscriptionCatalogs {
  constructor(options = {}) {
    this.catalogs = new Map(Object.entries(SPECS).map(([id, spec]) => [id, new OpenCodeGoCatalog({ ...options, catalog: {
      id, matches: base => matches(spec, base), baseFor: api => spec.bases?.[api] ?? spec.base,
      readSnapshot: raw => readSnapshot(spec, raw), models: (snapshot, installed) => overlay(id, snapshot, installed),
      fetch: async (fetcher, signal, fetchedAt, auth, installed) => {
        if (id === 'openai-codex') {
          if (!auth?.apiKey) throw new Error('Sign into OpenAI Codex before refreshing its account catalog');
          let accountId;
          try { accountId = JSON.parse(Buffer.from(auth.apiKey.split('.')[1], 'base64url').toString('utf8'))?.['https://api.openai.com/auth']?.chatgpt_account_id; } catch {}
          if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 256) throw new Error('Invalid Codex account identity');
          return parseCodexCatalog(await publicJson('https://chatgpt.com/backend-api/codex/models?client_version=0.85.1', 4 * 1024 * 1024, fetcher, signal,
            accountHeaders(auth, { authorization: `Bearer ${auth.apiKey}`, 'chatgpt-account-id': accountId, originator: 'pi', 'user-agent': 'Notara pi-ai/0.85.1' })), fetchedAt);
        }
        let listing, allowPolicyFallback = false;
        if (spec.account) {
          if (!auth?.apiKey) throw new Error('Sign into GitHub Copilot before refreshing its account catalog');
          const base = new URL(auth.baseUrl ?? spec.base);
          // Enterprise auth may change the endpoint; accept only SDK-owned Copilot API hosts.
          if (base.protocol !== 'https:' || base.port || base.username || base.password ||
              !(/(^|\.)githubcopilot\.com$/.test(base.hostname) || /^copilot-api\.[a-z0-9-]+\.ghe\.com$/.test(base.hostname) || auth.nativeOAuthEndpoint === base.origin) ||
              !['', '/'].includes(base.pathname) || base.search || base.hash) throw new Error('Unsupported Copilot catalog endpoint');
          allowPolicyFallback = base.origin === SPECS['github-copilot'].base;
          listing = await publicJson(new URL('/models', base).href, 4 * 1024 * 1024, fetcher, signal,
            accountHeaders(auth, { authorization: `Bearer ${auth.apiKey}`, 'editor-version': 'Notara/0.24.3',
              'editor-plugin-version': 'pi-ai/0.85.1', 'user-agent': 'Notara pi-ai/0.85.1',
              'copilot-integration-id': 'vscode-chat', 'x-github-api-version': '2026-06-01' }));
        } else if (spec.listing) listing = await publicJson(spec.listing, 4 * 1024 * 1024, fetcher, signal);
        const metadata = await publicJson(GO_METADATA_URL, 16 * 1024 * 1024, fetcher, signal);
        return parseSubscriptionCatalog(id, metadata, listing, installed, fetchedAt, allowPolicyFallback);
      },
    } })]));
  }
  get revision() { return [...this.catalogs.values()].reduce((total, catalog) => total + catalog.revision, 0); }
  async load(home, accounts = {}) {
    const changed = this.home !== home; this.home = home;
    await Promise.all([...this.catalogs].map(async ([id, catalog]) => {
      if (!SPECS[id].account) return catalog.load(home);
      if (changed) this.invalidate(id);
      if (accounts[id]) await this.selectAccount(id, accounts[id]).catch(() => this.invalidate(id));
    }));
  }
  invalidate(id) {
    const catalog = this.catalogs.get(id);
    if (!catalog || !SPECS[id].account) return;
    catalog.snapshot = undefined; catalog.pending = undefined; catalog.cachePath = undefined;
    catalog.generation++; catalog.revision++;
  }
  async credentialChanged(id, credential) {
    if (!SPECS[id]?.account) return;
    const auth = credential?.type === 'oauth'
      ? { apiKey: credential.access, catalogIdentity: credential.refresh }
      : credential?.type === 'api_key' ? { apiKey: credential.key, catalogIdentity: credential.key } : undefined;
    if (!auth) return this.invalidate(id);
    await this.selectAccount(id, auth).catch(() => this.invalidate(id));
  }
  async selectAccount(id, auth) {
    let identity = auth?.catalogIdentity;
    if (id === 'openai-codex') {
      identity = undefined;
      try { identity = JSON.parse(Buffer.from(auth.apiKey.split('.')[1], 'base64url').toString('utf8'))?.['https://api.openai.com/auth']?.chatgpt_account_id; } catch {}
    }
    if (typeof identity !== 'string' || !identity.trim()) throw new Error('Missing subscription account identity');
    // A refreshed OAuth credential may supply an endpoint absent from the stored
    // credential at startup. The stable account identity owns the offline cache.
    const scope = createHash('sha256').update(`${id}:${identity}`).digest('hex');
    const catalog = this.catalogs.get(id), cacheId = `${id}.${scope}`;
    catalog.catalog.id = cacheId;
    const loading = catalog.load(this.home), generation = catalog.generation;
    await loading;
    if (catalog.catalog.id !== cacheId || catalog.generation !== generation) throw new Error('Subscription account changed during catalog discovery');
    return { cacheId, generation };
  }
  matches(id, base) { return this.catalogs.get(id)?.matches(base) === true; }
  baseFor(id, api) { return this.catalogs.get(id)?.baseFor(api); }
  models(id, installed, base) { return this.catalogs.get(id)?.models(installed, base) ?? installed; }
  hasSnapshot(id, base) { return this.matches(id, base) && this.catalogs.get(id)?.snapshot !== undefined; }
  async refresh(id, options) {
    const catalog = this.catalogs.get(id);
    if (!catalog) return false;
    const selection = SPECS[id].account ? await this.selectAccount(id, { ...options?.auth, catalogIdentity: options?.auth?.catalogIdentity ?? options?.auth?.apiKey }) : undefined;
    if (selection && (catalog.catalog.id !== selection.cacheId || catalog.generation !== selection.generation)) throw new Error('Subscription account changed during catalog discovery');
    const generation = catalog.generation;
    const refreshed = await catalog.refresh({ ...options, force: true });
    if (selection && (catalog.catalog.id !== selection.cacheId || catalog.generation !== generation)) throw new Error('Subscription account changed during catalog discovery');
    return refreshed;
  }
}

export const notaraSubscriptionCatalogs = new SubscriptionCatalogs();
