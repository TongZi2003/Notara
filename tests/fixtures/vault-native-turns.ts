import type { SessionPage, SessionProjectionsValue, SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller';
import type { VaultHarness } from './vault-http.ts';

export type NativeTurnHost = Pick<VaultHarness, 'rpc' | 'value' | 'sessions'>;
export interface NativeCut { readonly sessionId: string; readonly asOfSeq: number }
export interface NativeReadOptions {
  readonly signal?: AbortSignal;
  readonly pageMessages?: number;
  readonly maxPages?: number;
  readonly maxEvents?: number;
}
export interface NativeTurnWaitOptions extends NativeReadOptions {
  /** session/prompt persists this exact identity in user/message.data.source.rpcId. */
  readonly requestId: string;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}
export interface NativeToolOutcome {
  readonly turn: number; readonly step: number; readonly callId: string;
  readonly name: string; readonly arguments: string;
  readonly callSeq: number; readonly resultSeq: number;
  readonly failed: boolean; readonly text: string;
}
export interface NativeUnpairedToolResult {
  readonly turn: number; readonly step: number; readonly callId: string;
  readonly resultSeq: number; readonly failed: boolean; readonly text: string;
}
export interface NativeObservedTurn {
  readonly requestId: string; readonly turn: number;
  readonly userSeq: number; readonly startSeq: number; readonly endSeq: number;
  readonly reason: Readonly<Record<string, unknown>> & { readonly kind: string };
  /** Only native completed terminals without an interrupted assistant are completed. */
  readonly status: 'completed' | 'failed';
  readonly assistantText: string;
  readonly toolOutcomes: readonly NativeToolOutcome[];
  readonly unpairedToolResults: readonly NativeUnpairedToolResult[];
  readonly events: readonly SessionWireEvent[];
}

export class NativeTurnObservationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'NativeTurnObservationError'; this.code = code; }
}
function fail(code: string, message: string): never { throw new NativeTurnObservationError(code, message); }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const position = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0);
const cursor = (value: unknown): value is number => value === -1 || position(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
function limits(options: NativeReadOptions) {
  const result = { pageMessages: options.pageMessages ?? 32, maxPages: options.maxPages ?? 256, maxEvents: options.maxEvents ?? 65_536 };
  for (const [key, value] of Object.entries(result)) if (!position(value) || value < 1) fail('NATIVE_INVALID_OPTIONS', `${key} must be a positive safe integer`);
  return result;
}
function checkSession(sessionId: string) { if (!identity(sessionId)) fail('NATIVE_INVALID_SESSION', 'A native session identity is required'); }

/** The RPC interface has no signal argument; abandon waiting without mistaking late RPC completion for a turn. */
async function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) { void promise.catch(() => {}); signal.throwIfAborted(); }
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
async function pause(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function captureNativeCut(host: NativeTurnHost, sessionId: string, options: NativeReadOptions = {}): Promise<NativeCut> {
  checkSession(sessionId); options.signal?.throwIfAborted();
  const value = host.value(await withSignal(host.rpc<SessionProjectionsValue>('session/projections', { request: { sessionId } }), options.signal));
  if (value === null) fail('NATIVE_SESSION_NOT_FOUND', `Native session ${sessionId} does not exist`);
  if (!cursor(value.asOfSeq)) fail('NATIVE_INVALID_CUT', 'Native projection returned an invalid event watermark');
  return { sessionId, asOfSeq: value.asOfSeq };
}

/** Native pages run backwards using beforeSeq; every page shares the same inclusive cut. */
async function* backwardPages(host: NativeTurnHost, sessionId: string, throughSeq: number, options: NativeReadOptions) {
  const budget = limits(options);
  if (throughSeq === -1) return;
  let beforeSeq: number | undefined, expectedLast = throughSeq, count = 0;
  for (let pageNumber = 0; ; pageNumber++) {
    if (pageNumber >= budget.maxPages) fail('NATIVE_PAGE_BUDGET', 'Native history exceeded the configured page budget');
    options.signal?.throwIfAborted();
    const request = { address: { kind: 'session', sessionId }, throughSeq, maxMessages: budget.pageMessages,
      ...(beforeSeq === undefined ? {} : { beforeSeq }) };
    const page = host.value(await withSignal(host.rpc<SessionPage>('session/page', { request }), options.signal));
    if (!Array.isArray(page.records) || typeof page.hasMore !== 'boolean' || page.records.length === 0) {
      fail('NATIVE_INVALID_PAGE', 'Native history returned an empty or malformed page for a nonempty range');
    }
    count += page.records.length;
    if (count > budget.maxEvents) fail('NATIVE_EVENT_BUDGET', 'Native history exceeded the configured event budget');
    const rows = page.records.map(record => {
      if (record.type !== 'event' || !position(record.event?.seq) || typeof record.event.type !== 'string') {
        fail('NATIVE_INVALID_PAGE', 'Native page contains an invalid event envelope');
      }
      return record.event;
    });
    const first = rows[0]!, last = rows.at(-1)!;
    if (last.seq !== expectedLast || rows.some((event, index) => event.seq !== first.seq + index)
      || page.hasMore !== (first.seq > 0)) fail('NATIVE_PAGE_GAP', 'Native pages must form a dense, advancing prefix at the captured cut');
    yield rows;
    if (!page.hasMore) return;
    beforeSeq = first.seq; expectedLast = first.seq - 1;
  }
}

export async function readNativeEvents(host: NativeTurnHost, sessionId: string, throughSeq?: number, afterSeq = -1,
  options: NativeReadOptions = {}): Promise<SessionWireEvent[]> {
  checkSession(sessionId); limits(options);
  const cut = throughSeq ?? (await captureNativeCut(host, sessionId, options)).asOfSeq;
  if (!cursor(cut) || !cursor(afterSeq) || afterSeq > cut) fail('NATIVE_INVALID_RANGE', 'Native event range must satisfy -1 <= afterSeq <= throughSeq');
  options.signal?.throwIfAborted();
  if (cut === afterSeq) return [];
  const pages: SessionWireEvent[][] = [];
  for await (const page of backwardPages(host, sessionId, cut, options)) {
    pages.push(page.filter(event => event.seq > afterSeq));
    if (page[0]!.seq <= afterSeq + 1) break;
  }
  const rows = pages.reverse().flat();
  if (rows.length !== cut - afterSeq || rows[0]?.seq !== afterSeq + 1 || rows.at(-1)?.seq !== cut) {
    fail('NATIVE_PAGE_GAP', 'Native event range was not fully observed');
  }
  return rows;
}

/** Preserve an already open turn so a steered prompt can still be associated with its actual start. */
async function openTurnAtCut(host: NativeTurnHost, cut: NativeCut, options: NativeReadOptions): Promise<SessionWireEvent[]> {
  const tail: SessionWireEvent[][] = [];
  for await (const page of backwardPages(host, cut.sessionId, cut.asOfSeq, options)) {
    for (let index = page.length - 1; index >= 0; index--) {
      const event = page[index]!;
      if (event.type === 'turn/end') return [];
      if (event.type === 'turn/start') return [page.slice(index), ...tail.reverse()].flat();
    }
    tail.push(page);
  }
  return [];
}
const contentText = (message: unknown) => {
  const content = object(message).content;
  return Array.isArray(content) ? content.flatMap(block => object(block).type === 'text' && typeof object(block).text === 'string'
    ? [object(block).text as string] : []).join('\n') : '';
};

function summarizeTurn(events: SessionWireEvent[], user: SessionWireEvent, requestId: string): NativeObservedTurn {
  const start = events[0]!, end = events.at(-1)!, turn = object(start.data).turn;
  if (!position(turn)) fail('NATIVE_TURN_PROTOCOL', 'Native turn start has no valid identity');
  const reason = object(object(end.data).reason);
  if (!identity(reason.kind)) fail('NATIVE_TURN_PROTOCOL', 'Native turn end has no terminal reason');
  const calls = new Map<string, { event: SessionWireEvent; data: Record<string, unknown> }>();
  const toolOutcomes: NativeToolOutcome[] = [], unpairedToolResults: NativeUnpairedToolResult[] = [], assistants: string[] = [];
  let interrupted = false;
  for (const event of events) {
    if (event.seq <= user.seq) continue;
    const data = object(event.data);
    if (!['assistant/message', 'tool/call', 'tool/result'].includes(event.type)) continue;
    if (data.turn !== turn || !position(data.step)) fail('NATIVE_TURN_PROTOCOL', 'Turn content carries a different turn or invalid step');
    if (event.type === 'assistant/message') {
      interrupted ||= data.interrupted === true; assistants.push(contentText(data.message)); continue;
    }
    const message = object(data.message), callId = event.type === 'tool/call' ? data.callId : message.toolCallId;
    if (!identity(callId)) fail('NATIVE_TURN_PROTOCOL', 'Native tool event has no call identity');
    const key = JSON.stringify([turn, data.step, callId]);
    if (event.type === 'tool/call') {
      if (!identity(data.name) || typeof data.arguments !== 'string' || calls.has(key)) {
        fail('NATIVE_TURN_PROTOCOL', 'Native tool call is malformed or duplicated within a turn and step');
      }
      calls.set(key, { event, data }); continue;
    }
    const common = { turn, step: data.step, callId, resultSeq: event.seq, failed: message.isError === true, text: contentText(message) };
    const call = calls.get(key);
    if (call && call.event.seq < event.seq) {
      toolOutcomes.push({ ...common, name: call.data.name as string, arguments: call.data.arguments as string, callSeq: call.event.seq });
      calls.delete(key);
    } else unpairedToolResults.push(common);
  }
  return { requestId, turn, userSeq: user.seq, startSeq: start.seq, endSeq: end.seq,
    reason: reason as NativeObservedTurn['reason'], status: reason.kind === 'completed' && !interrupted ? 'completed' : 'failed',
    assistantText: assistants.filter(Boolean).join('\n'), toolOutcomes, unpairedToolResults, events };
}

/** Observes the submitted request's terminal turn; another queued turn may still keep the Session running. */
export async function waitForNativeTurn(host: NativeTurnHost, sessionId: string, baseline: NativeCut,
  options: NativeTurnWaitOptions): Promise<NativeObservedTurn> {
  checkSession(sessionId); limits(options);
  if (baseline.sessionId !== sessionId || !cursor(baseline.asOfSeq) || !identity(options.requestId)) {
    fail('NATIVE_INVALID_BASELINE', 'The baseline must belong to this session and the submitted prompt must have a requestId');
  }
  const timeoutMs = options.timeoutMs ?? 120_000, pollMs = options.pollMs ?? 100;
  if (!position(timeoutMs) || timeoutMs < 1 || !position(pollMs) || pollMs < 1) fail('NATIVE_INVALID_OPTIONS', 'Timeout and polling intervals must be positive safe integers');
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new NativeTurnObservationError('NATIVE_TURN_TIMEOUT', `No terminal turn for request ${options.requestId} within ${timeoutMs}ms`)), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  const readOptions = { ...options, signal };
  try {
    signal.throwIfAborted();
    const initialCut = await captureNativeCut(host, sessionId, readOptions);
    if (initialCut.asOfSeq < baseline.asOfSeq) fail('NATIVE_LOG_REWOUND', 'Native session watermark moved behind the baseline cut');
    let segment = await openTurnAtCut(host, baseline, readOptions), user: SessionWireEvent | undefined, seen = baseline.asOfSeq;
    for (;;) {
      signal.throwIfAborted();
      const sessions = await withSignal(host.sessions(), signal);
      if (!sessions.some(row => row.sessionId === sessionId)) fail('NATIVE_SESSION_NOT_FOUND', `Native session ${sessionId} is no longer listed`);
      const cut = await captureNativeCut(host, sessionId, readOptions);
      if (cut.asOfSeq < seen) fail('NATIVE_LOG_REWOUND', 'Native session watermark moved behind the observed cut');
      for (const event of await readNativeEvents(host, sessionId, cut.asOfSeq, seen, readOptions)) {
        const data = object(event.data);
        if (event.type === 'turn/start') {
          if (segment.length) fail('NATIVE_TURN_PROTOCOL', 'A new native turn started before the preceding turn ended');
          if (!position(data.turn)) fail('NATIVE_TURN_PROTOCOL', 'Native turn has no valid identity');
          segment = [event];
        } else if (segment.length) segment.push(event);
        if (segment.length > (options.maxEvents ?? 65_536)) fail('NATIVE_EVENT_BUDGET', 'Observed turn exceeded the configured event budget');
        const source = object(data.source);
        if (event.type === 'user/message' && event.seq > baseline.asOfSeq && event.surfaceOp === 'append'
          && source.kind === 'user' && source.rpcId === options.requestId) {
          if (!segment.length || user) fail('NATIVE_TURN_PROTOCOL', 'Prompt identity is duplicated or has no native turn start');
          user = event;
        }
        if (event.type === 'turn/end') {
          if (!segment.length || data.turn !== object(segment[0]!.data).turn) fail('NATIVE_TURN_PROTOCOL', 'Native terminal does not close its actual turn');
          if (user) return summarizeTurn(segment, user, options.requestId);
          segment = [];
        }
      }
      seen = cut.asOfSeq;
      await pause(pollMs, signal);
    }
  } finally { clearTimeout(timer); }
}
