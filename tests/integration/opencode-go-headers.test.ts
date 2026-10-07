import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';

type SupportedApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
type FixtureModel = {
  id: string;
  api: SupportedApi;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: ('text' | 'image')[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  [key: string]: unknown;
};
type FixtureApi = { stream: unknown; streamSimple: unknown };
type FixtureProvider = {
  id: string;
  name: string;
  auth: FixtureProviderAuth;
  getModels(): FixtureModel[];
  stream(model: FixtureModel, context: unknown, options?: unknown): unknown;
  streamSimple(model: FixtureModel, context: unknown, options?: unknown): unknown;
};
type FixtureProviderAuth = {
  apiKey: {
    name: string;
    resolve(input: { credential?: { key?: string } }): Promise<{ auth: { apiKey: string }; source: string }>;
  };
};
type FixtureProfile = {
  provider: string;
  displayName: string;
  headers: Record<string, string>;
  cacheRetention: 'none';
  streamIdleTimeoutMs: number;
  maxRequestImageBytes: number;
  requestImagePixelBudget: number;
  requestImageMaxBytes: number;
  retryPolicy: undefined;
  configuredMaxTokens: Map<string, number>;
  modelErrors: Map<string, string>;
  piProvider: FixtureProvider;
};
type FixtureCredentialStore = {
  read(): Promise<undefined>;
  list(): Promise<never[]>;
  modify(): Promise<undefined>;
  delete(): Promise<void>;
};
type FixtureAuthContext = {
  env(name: string): Promise<undefined>;
  fileExists(path: string): Promise<boolean>;
};
type FixtureAdapterOptions = {
  profiles(): ReadonlyMap<string, FixtureProfile>;
  resolveApiKey(provider: string, profile: FixtureProfile): Promise<string>;
  auth: { credentials: FixtureCredentialStore; authContext: FixtureAuthContext };
};
type FixtureAdapter = { stream(options: GenerateOptions): AsyncIterable<StreamChunk> };
type FixtureAdapterModule = { PiAiAdapter: new (options: FixtureAdapterOptions) => FixtureAdapter };
type FixtureApiProviderOptions = {
  id: string;
  name: string;
  auth: FixtureProviderAuth;
  models: FixtureModel[];
  api: Partial<Record<SupportedApi, FixtureApi>>;
};
type FixturePiAiModule = { createProvider(options: FixtureApiProviderOptions): FixtureProvider };
type FixtureModelsProviderModule = { opencodeGoProvider(): FixtureProvider };
type FixtureAnthropicModule = { anthropicMessagesApi(): FixtureApi };
type FixtureCompletionsModule = { openAICompletionsApi(): FixtureApi };
type FixtureResponsesModule = { openAIResponsesApi(): FixtureApi };

// Runtime-resolve SDK modules so TypeScript only checks this narrow test contract,
// not optional SDK declaration trees that this test does not use.
const { PiAiAdapter } = await import(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai')) as FixtureAdapterModule;
const { createProvider } = await import(import.meta.resolve('@earendil-works/pi-ai')) as FixturePiAiModule;
const { opencodeGoProvider } = await import(import.meta.resolve('@earendil-works/pi-ai/providers/opencode-go')) as FixtureModelsProviderModule;
const { anthropicMessagesApi } = await import(import.meta.resolve('@earendil-works/pi-ai/api/anthropic-messages.lazy')) as FixtureAnthropicModule;
const { openAICompletionsApi } = await import(import.meta.resolve('@earendil-works/pi-ai/api/openai-completions.lazy')) as FixtureCompletionsModule;
const { openAIResponsesApi } = await import(import.meta.resolve('@earendil-works/pi-ai/api/openai-responses.lazy')) as FixtureResponsesModule;

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
}

const FIXTURE_API_KEY = 'integration-only-not-a-real-key';
const GO_SESSION_HEADER = 'x-opencode-session';
const NOTARA_USER_AGENT_PREFIX = 'Notara (+https://github.com/TongZi2003/Notara) ';
const GO_HEADER_COLLISION = 'X-oPeNcOdE-SeSsIoN';
const GO_PROFILE_HEADERS = {
  [GO_HEADER_COLLISION]: 'stale-profile-session',
  'x-test-route': 'profile-header-survives',
};

const EMPTY_CREDENTIALS: FixtureCredentialStore = {
  read: async () => undefined,
  list: async () => [],
  modify: async () => undefined,
  delete: async () => undefined,
};

const EMPTY_AUTH_CONTEXT: FixtureAuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

const FIXTURE_AUTH: FixtureProviderAuth = {
  apiKey: {
    name: 'Integration fixture key',
    resolve: async ({ credential }) => ({
      auth: { apiKey: credential?.key ?? FIXTURE_API_KEY },
      source: 'integration fixture',
    }),
  },
};

function profileFor(
  route: string,
  piProvider: FixtureProvider,
  displayName: string,
  headers: Record<string, string>,
): FixtureProfile {
  return {
    provider: route,
    displayName,
    headers,
    cacheRetention: 'none',
    streamIdleTimeoutMs: 10_000,
    maxRequestImageBytes: 20 * 1024 * 1024,
    requestImagePixelBudget: 4_194_304,
    requestImageMaxBytes: 1_048_576,
    retryPolicy: undefined,
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    piProvider,
  };
}

function adapterWithProfiles(profiles: ReadonlyMap<string, FixtureProfile>): FixtureAdapter {
  return new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => FIXTURE_API_KEY,
    auth: {
      credentials: EMPTY_CREDENTIALS,
      authContext: EMPTY_AUTH_CONTEXT,
    },
  });
}

function responseFor(api: SupportedApi, modelId: string): string {
  if (api === 'openai-completions') {
    const chunks = [
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: modelId,
        choices: [{ index: 0, delta: { content: 'fixture answer' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ];
    return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
  }

  if (api === 'openai-responses') {
    const message = {
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: 'fixture answer', annotations: [] }],
    };
    const response = {
      id: 'resp_fixture',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: modelId,
      output: [message],
      usage: {
        input_tokens: 1,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 2,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 3,
      },
    };
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'fixture answer' },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response },
    ];
    return `${events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')}`;
  }

  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_fixture',
        type: 'message',
        role: 'assistant',
        model: modelId,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fixture answer' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ];
  return `${events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')}`;
}

function interceptSdkFetch(api: SupportedApi, modelId: string): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input));
    const headers = new Headers(request?.headers);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const bodyText = typeof init?.body === 'string'
      ? init.body
      : request
        ? await request.clone().text()
        : '';
    requests.push({
      url,
      method: init?.method ?? request?.method ?? 'GET',
      headers,
      body: JSON.parse(bodyText) as Record<string, unknown>,
    });
    return new Response(responseFor(api, modelId), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  return requests;
}

function apiFor(api: SupportedApi): FixtureApi {
  if (api === 'openai-completions') return openAICompletionsApi();
  if (api === 'openai-responses') return openAIResponsesApi();
  return anthropicMessagesApi();
}

function expectedEndpointPath(api: SupportedApi, model: FixtureModel): string {
  const basePath = new URL(model.baseUrl).pathname.replace(/\/+$/, '');
  const suffix = api === 'openai-completions'
    ? '/chat/completions'
    : api === 'openai-responses'
      ? '/responses'
      : '/v1/messages';
  return `${basePath}${suffix}`;
}

function customProvider(route: string, source: FixtureModel[]): FixtureProvider {
  const models = source.map((model) => ({ ...model, provider: route }));
  const handlers: Partial<Record<SupportedApi, FixtureApi>> = {};
  for (const model of models) handlers[model.api] = apiFor(model.api);
  return createProvider({
    id: route,
    name: route,
    auth: FIXTURE_AUTH,
    models,
    api: handlers,
  });
}

async function streamOnce(
  adapter: FixtureAdapter,
  route: string,
  modelId: string,
  sessionId: string,
  purpose?: GenerateOptions['purpose'],
) {
  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: route,
    model: modelId,
    sessionId: sessionId as NonNullable<GenerateOptions['sessionId']>,
    ...(purpose ? { purpose } : {}),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Say fixture answer.' }] }],
  })) {
    chunks.push(chunk);
  }
  expect(chunks.some((chunk) => chunk.type === 'text-delta' && chunk.text.includes('fixture answer'))).toBe(true);
  expect(chunks.some((chunk) => chunk.type === 'finish' && chunk.reason.kind === 'stop')).toBe(true);
}

async function expectStableGoSessionHeader(api: SupportedApi, provider: FixtureProvider, route: string, model: FixtureModel) {
  const requests = interceptSdkFetch(api, model.id);
  const adapter = adapterWithProfiles(new Map([
    [route, profileFor(route, provider, 'Renamed OpenCode account', GO_PROFILE_HEADERS)],
  ]));
  await streamOnce(adapter, route, model.id, 'native-session-a');
  await streamOnce(adapter, route, model.id, 'native-session-a', 'compaction');
  await streamOnce(adapter, route, model.id, 'native-session-a', 'session-title');
  await streamOnce(adapter, route, model.id, 'native-session-b');

  expect(requests).toHaveLength(4);
  expect(requests.map((request) => request.headers.get(GO_SESSION_HEADER))).toEqual([
    'native-session-a',
    'native-session-a',
    'native-session-a',
    'native-session-b',
  ]);
  for (const request of requests) {
    expect(request.url.hostname).toBe('opencode.ai');
    expect(request.url.pathname).toBe(expectedEndpointPath(api, model));
    expect(request.headers.get('x-test-route')).toBe('profile-header-survives');
    expect(request.headers.get(GO_SESSION_HEADER)).not.toBe('stale-profile-session');
    expect(request.headers.get('user-agent')?.startsWith(NOTARA_USER_AGENT_PREFIX)).toBe(true);
    if (api === 'anthropic-messages') {
      expect(request.headers.get('x-api-key')).toBe(FIXTURE_API_KEY);
    } else {
      expect(request.headers.get('authorization')).toBe(`Bearer ${FIXTURE_API_KEY}`);
    }
    expect(request.body.model).toBe(model.id);
  }
  if (api === 'openai-responses') {
    // Disabling prompt-cache affinity must not suppress OpenCode Go's separate session header.
    expect(requests.every((request) => request.body.prompt_cache_key === undefined)).toBe(true);
  }
}

const goCatalog = opencodeGoProvider();
const goApis: readonly SupportedApi[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenCode Go session headers through DSH PiAiAdapter and pi-ai SDKs', () => {
  it.each(goApis)('sends stable native session IDs through the built-in OpenCode Go %s model', async (api) => {
    const model = goCatalog.getModels().find((entry) => entry.api === api);
    expect(model, `locked pi-ai catalog should include ${api}`).toBeDefined();
    await expectStableGoSessionHeader(api, goCatalog, 'opencode-go', model!);
  });

  it.each(goApis)('uses the official Go model URL with a custom route name for %s', async (api) => {
    const sourceModel = goCatalog.getModels().find((entry) => entry.api === api);
    expect(sourceModel, `locked pi-ai catalog should include ${api}`).toBeDefined();
    const route = 'go';
    const goBaseUrl = new URL(sourceModel!.baseUrl);
    const model = {
      ...sourceModel!,
      provider: route,
      // The canonical URL with an explicit default port and trailing slash is equivalent.
      baseUrl: `${goBaseUrl.protocol}//${goBaseUrl.hostname}:443${goBaseUrl.pathname.replace(/\/+$/, '')}/`,
    } as FixtureModel;
    const provider = customProvider(route, [model]);
    await expectStableGoSessionHeader(api, provider, route, model);
  });

  it.each([
    {
      route: 'opencode-go',
      api: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
      expectedSessionHeader: 'subscription-owned-session',
    },
    {
      route: 'openrouter',
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
      expectedSessionHeader: undefined,
    },
    {
      route: 'github-copilot',
      api: 'openai-completions',
      baseUrl: 'https://api.githubcopilot.com',
      expectedSessionHeader: 'copilot-owned-session',
    },
    {
      route: 'openai-codex',
      api: 'openai-responses',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      expectedSessionHeader: 'chatgpt-owned-session',
    },
  ] as const)('leaves a non-Go $route subscription header untouched', async ({ route, api, baseUrl, expectedSessionHeader }) => {
    const sourceModel = goCatalog.getModels().find((entry) => entry.api === api);
    expect(sourceModel).toBeDefined();
    const model = { ...sourceModel!, provider: route, baseUrl } as FixtureModel;
    const provider = customProvider(route, [model]);
    const requests = interceptSdkFetch(api, model.id);
    const adapter = adapterWithProfiles(new Map([
      [route, profileFor(route, provider, route, {
        ...(expectedSessionHeader === undefined ? {} : { [GO_HEADER_COLLISION]: expectedSessionHeader }),
        'x-test-route': 'profile-header-survives',
      })],
    ]));

    await streamOnce(adapter, route, model.id, 'must-not-replace-subscription-header');

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url.hostname).toBe(new URL(baseUrl).hostname);
    expect(request!.headers.get(GO_SESSION_HEADER)).toBe(expectedSessionHeader ?? null);
    expect(request!.headers.get('x-test-route')).toBe('profile-header-survives');
    expect(request!.headers.get('authorization')).toBe(`Bearer ${FIXTURE_API_KEY}`);
    expect(request!.headers.get('user-agent')).not.toContain(NOTARA_USER_AGENT_PREFIX);
    expect(request!.body.model).toBe(model.id);
  });
});
