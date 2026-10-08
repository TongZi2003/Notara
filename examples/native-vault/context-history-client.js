import { Worker } from 'node:worker_threads';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { NATIVE_HISTORY_SEARCH_POLICY, HISTORY_SEARCH_IDENTITY_LIMITS, isNativeHistorySearchPosition, expandHistorySearchProjection } from './context-history-search-policy.js';
import { HISTORY_LITERAL_MAX_QUERY_CHARS, HISTORY_LITERAL_MAX_ENCODED_QUERY_CHARS } from './context-history-evidence.js';
const fail=code=>{throw Object.assign(new Error(code),{code})};
export const STREAM_BUDGET = Object.freeze({ rpcBytes: 256 * 1024, chunks: 8, chunkChars: 8192,
  pageChunks: 4, pendingRpc: 4, defaultTimeoutMs: 30000 });
export const BATCH_BUDGET = Object.freeze({ events: 128, shortRecordChars: STREAM_BUDGET.chunkChars });
export function rpcBytes(method, args) { return Buffer.byteLength(JSON.stringify({ id: Number.MAX_SAFE_INTEGER, method, args, deadline: Number.MAX_SAFE_INTEGER })); }
export function scopeInput(scope) { if (typeof scope !== 'string' || !scope.length || scope.length > 512 || !scope.isWellFormed()) fail('INVALID_SCOPE'); }
export function sessionInput(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.length || sessionId.length > 512 || !sessionId.isWellFormed()) fail('INVALID_SESSION_ID');
}
export function validateSearchMetadata(search, metadata) {
  if (search === undefined) return;
  if (!search || typeof search !== 'object' || Object.keys(search).some(key => !['policy','hash','call','result'].includes(key))
    || search.policy !== NATIVE_HISTORY_SEARCH_POLICY || typeof search.hash !== 'string' || !/^[0-9a-f]{64}$/.test(search.hash)
    || metadata.encoding !== 'native-event-v1' || (search.call !== undefined && search.result !== undefined)) fail('INVALID_SEARCH_METADATA');
  for (const kind of ['call', 'result']) if (search[kind] !== undefined) {
    const identity = search[kind], keys = kind === 'call' ? ['callId','name','turn','step'] : ['callId','turn','step'];
    if (!identity || typeof identity !== 'object' || Object.keys(identity).some(key => !keys.includes(key))
      || !isNativeHistorySearchPosition(identity.turn) || !isNativeHistorySearchPosition(identity.step)
      || typeof identity.callId !== 'string' || !identity.callId.length || identity.callId.length > HISTORY_SEARCH_IDENTITY_LIMITS.callId || !identity.callId.isWellFormed()
      || (kind === 'call' && (typeof identity.name !== 'string' || !identity.name.length || identity.name.length > HISTORY_SEARCH_IDENTITY_LIMITS.name || !identity.name.isWellFormed()))
      || metadata.type !== (kind === 'call' ? 'tool/call' : 'tool/result') || metadata.role !== 'tool') fail('INVALID_SEARCH_IDENTITY');
  }
}
export function searchMetadataFrame(search) {
  if (search === undefined || search === null) return null;
  if (typeof search === 'string') search = JSON.parse(search);
  return [search.policy, search.hash, search.call ? ['call',search.call.callId,search.call.name,search.call.turn,search.call.step]
    : search.result ? ['result',search.result.callId,search.result.turn,search.result.step] : null];
}
export function serializeSearchMetadata(search) {
  if (search === undefined) return null;
  const descriptor = { policy: search.policy, hash: search.hash };
  if (search.call) descriptor.call = { callId: search.call.callId, name: search.call.name, turn: search.call.turn, step: search.call.step };
  if (search.result) descriptor.result = { callId: search.result.callId, turn: search.result.turn, step: search.result.step };
  return JSON.stringify(descriptor);
}
export function validateSearchProjection(body, search) {
  // Bound expansion before interpreting the compact all-space sentinel.
  if (typeof body !== 'string' || body.length > STREAM_BUDGET.chunkChars || !body.isWellFormed()
    || (search !== null && typeof search !== 'string')) fail('INVALID_SEARCH_PROJECTION');
  const projection = expandHistorySearchProjection(body, search);
  if (body.length !== projection.length || !projection.isWellFormed()) fail('INVALID_SEARCH_PROJECTION');
  for (let index = 0; index < body.length; index++) if (projection[index] !== ' ' && projection[index] !== body[index]) fail('INVALID_SEARCH_PROJECTION');
  return projection;
}
export function validateRpc(method, args) {
  const arity = { openScope: 1, beginEvent: 3, appendChunks: 5, finishEvent: 4, cancelEvent: 3,
    search: 3, page: 4, inspect: 1, inspectEvent: 3, inspectPrefix: 3, skipEvents: 4, appendEventBatch: 4, deleteScope: 2,
    bindSession: 2, deleteSessionIds: 1, close: 0 };
  if (!Object.hasOwn(arity, method) || !Array.isArray(args) || args.length !== arity[method]) fail('INVALID_RPC_SHAPE');
  if (method === 'close') return;
  if (method === 'bindSession') {
    sessionInput(args[0]);
    if (typeof args[1] !== 'string' || !/^[0-9a-f]{64}$/.test(args[1])) fail('INVALID_SESSION_BINDING');
    return;
  }
  if (method === 'deleteSessionIds') {
    if (!Array.isArray(args[0]) || !args[0].length || args[0].length > 256) fail('INVALID_SESSION_BATCH');
    args[0].forEach(sessionInput); return;
  }
  scopeInput(args[0]);
  if (method === 'openScope' || method === 'inspect') return;
  if (!Number.isSafeInteger(args[1]) || args[1] < 1) fail('INVALID_SCOPE_GENERATION');
  if (method === 'deleteScope') return;
  if (method === 'inspectPrefix') { if (args[2] !== null && (!Number.isSafeInteger(args[2]) || args[2] < 0)) fail('INVALID_SEQUENCE'); return; }
  if (method === 'search') { if (typeof args[2] !== 'string' || args[2].length > HISTORY_LITERAL_MAX_QUERY_CHARS) fail('INVALID_QUERY'); return; }
  if (method === 'beginEvent') {
    const meta = args[2];
    if (!meta || typeof meta !== 'object' || Object.keys(meta).some(key => !['seq','chars','bytes','hash','type','role','encoding','search'].includes(key))
        || !Number.isSafeInteger(meta.seq) || meta.seq < 0 || !Number.isSafeInteger(meta.chars) || meta.chars < 0 || !Number.isSafeInteger(meta.bytes) || meta.bytes < 0
        || typeof meta.hash !== 'string' || !/^[0-9a-f]{64}$/.test(meta.hash) || typeof (meta.type ?? 'message') !== 'string'
        || !(meta.type ?? 'message').length || (meta.type ?? 'message').length > 64 || !(meta.type ?? 'message').isWellFormed()
        || !['plain-text','native-event-v1'].includes(meta.encoding ?? 'plain-text')
        || !['user','assistant','tool','developer','system'].includes(meta.role ?? 'user')) fail('INVALID_EVENT_METADATA');
    validateSearchMetadata(meta.search, meta);
    return;
  }
  if (!Number.isSafeInteger(args[2]) || args[2] < 0) fail('INVALID_SEQUENCE');
  if (method === 'appendEventBatch') {
    const items = args[3];
    if (!Array.isArray(items) || !items.length || items.length > BATCH_BUDGET.events
      || !Number.isSafeInteger(args[2] + items.length)) fail('INVALID_EVENT_BATCH');
    for (let index = 0; index < items.length; index++) {
      const item = items[index], seq = args[2] + index;
      if (!item || typeof item !== 'object') fail('INVALID_EVENT_BATCH');
      if (item.kind === 'skip') {
        if (Object.keys(item).some(key => !['kind', 'seq', 'type', 'reason'].includes(key)) || item.seq !== seq) fail('INVALID_EVENT_BATCH');
        validateRpc('skipEvents', [args[0], args[1], seq, [{ seq: item.seq, type: item.type, reason: item.reason }]]);
      } else if (item.kind === 'record') {
        if (Object.keys(item).some(key => !['kind', 'metadata', 'body','search'].includes(key)) || item.metadata?.seq !== seq) fail('INVALID_EVENT_BATCH');
        validateRpc('beginEvent', [args[0], args[1], item.metadata]);
        if (item.metadata.encoding !== 'native-event-v1' || typeof item.body !== 'string' || !item.body.length
          || item.body.length > BATCH_BUDGET.shortRecordChars || !item.body.isWellFormed()
          || item.metadata.chars !== item.body.length || item.metadata.bytes !== Buffer.byteLength(item.body)) fail('INVALID_BATCH_RECORD');
        if ((item.search !== undefined) !== (item.metadata.search !== undefined)) fail('SEARCH_PROJECTION_REQUIRED');
        if (item.metadata.search !== undefined) validateSearchProjection(item.body, item.search);
      } else fail('INVALID_EVENT_BATCH');
    }
    return;
  }
  if (method === 'skipEvents') {
    const events = args[3];
    if (!Array.isArray(events) || !events.length || events.length > 256 || !Number.isSafeInteger(args[2] + events.length) || events.some((event, i) =>
      !event || typeof event !== 'object' || Object.keys(event).some(key => !['seq','type','reason'].includes(key))
      || event.seq !== args[2] + i || typeof event.type !== 'string' || !event.type.length || event.type.length > 64 || !event.type.isWellFormed()
      || typeof event.reason !== 'string' || !event.reason.length || event.reason.length > 64 || !/^[a-z][a-z0-9-]*$/.test(event.reason))) fail('INVALID_SKIP_BATCH');
    return;
  }
  if (method === 'appendChunks') {
    if (!Number.isSafeInteger(args[3]) || args[3] < 0 || !Array.isArray(args[4]) || !args[4].length || args[4].length > STREAM_BUDGET.chunks
        || args[4].some(chunk => {
          const body = typeof chunk === 'string' ? chunk : chunk?.body;
          return typeof body !== 'string' || !body.length || body.length > STREAM_BUDGET.chunkChars || !body.isWellFormed()
            || (typeof chunk !== 'string' && (!chunk || typeof chunk !== 'object' || Object.keys(chunk).some(key => !['body','search'].includes(key))));
        })) fail('INVALID_CHUNK_BATCH');
    for (const chunk of args[4]) if (typeof chunk !== 'string') validateSearchProjection(chunk.body, chunk.search);
  } else if (method === 'page' || method === 'finishEvent') {
    if (!Number.isSafeInteger(args[3]) || args[3] < (method === 'page' ? -1 : 0)) fail('INVALID_CURSOR');
  }
}


export const SEARCH_BUDGET = Object.freeze({ chunkChars: 8192, overlapChars: HISTORY_LITERAL_MAX_ENCODED_QUERY_CHARS, transactionChunks: 8,
  transactionBytes: 256 * 1024, queryChars: HISTORY_LITERAL_MAX_QUERY_CHARS, queryTerms: 512, anchors: 16,
  postingsPerAnchor: 64, candidates: 128, chunksPerEvent: 2, exactQuota: 32, lexicalQuota: 96,
  pageChunks: 4, pendingRpc: 4 });
// Shared with the native formatter: one unambiguous ordered fingerprint, without reading archive bodies.
export function historyPrefixFrame(row) {
  const omitted = row.state === 'omitted';
  const frame = [row.seq, omitted ? 'omitted' : 'complete', row.type ?? 'message', omitted ? null : row.role ?? 'user',
    omitted ? null : row.encoding ?? 'plain-text', omitted ? null : row.hash ?? null,
    omitted ? 0 : row.chars ?? 0, omitted ? 0 : row.bytes ?? 0, omitted ? row.omissionReason ?? row.reason ?? null : null];
  if (!omitted && row.search != null) frame.push(searchMetadataFrame(row.search));
  return frame;
}
export function createHistoryPrefixHasher() {
  const hash = createHash('sha256').update('notara-context-history-prefix-v1\0'); let nextSeq = 0;
  return { append(row) {
    if (!row || row.seq !== nextSeq || (row.state !== undefined && !['complete','omitted'].includes(row.state))) fail('BROKEN_PREFIX_CHAIN');
    hash.update(JSON.stringify(historyPrefixFrame(row)) + '\n'); nextSeq++; return this;
  }, get nextSeq() { return nextSeq; }, digest() { return { nextSeq, prefixHash: hash.digest('hex') }; } };
}
export class ContextHistoryClient {
  constructor({ path, startupTimeoutMs = STREAM_BUDGET.defaultTimeoutMs } = {}) {
    if (typeof path !== 'string' || !isAbsolute(path)) fail('INVALID_PRIVATE_DATABASE_PATH');
    if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120000) fail('INVALID_TIMEOUT');
    this.worker = new Worker(new URL('./context-history-worker.js', import.meta.url), {
      // Host snapshots/test runners can expose process-only flags that Worker rejects.
      workerData: { path, entry: 'notara-context-history' }, execArgv: [],
    });
    this.pending = new Map(); this.id = 0; this.maxRpcBytes = 0; this.dead = null; this.closing = false;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    this.exitPromise = new Promise(resolve => { this.resolveExit = resolve; });
    const rejectAll = error => {
      this.dead ??= error; clearTimeout(this.startupTimer); this.rejectReady(this.dead);
      for (const pending of this.pending.values()) { this.cleanup(pending); if (!pending.settled) pending.reject(this.dead); }
      this.pending.clear();
    };
    this.startupTimer = setTimeout(() => {
      rejectAll(Object.assign(new Error('STARTUP_TIMEOUT'), { code: 'STARTUP_TIMEOUT' })); void this.worker.terminate();
    }, startupTimeoutMs);
    this.worker.on('message', message => {
      if (message.ready) { clearTimeout(this.startupTimer); return this.resolveReady(); }
      if (message.fatal) { rejectAll(Object.assign(new Error(message.fatal), { code: message.fatal })); return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); this.cleanup(pending);
      if (pending.settled) return;
      if (message.error) pending.reject(Object.assign(new Error(message.error), { code: message.error, operation: pending.method }));
      else pending.resolve(message.value);
    });
    this.worker.on('error', () => rejectAll(Object.assign(new Error('WORKER_FAILED'), { code: 'WORKER_FAILED' })));
    this.worker.on('exit', code => { rejectAll(Object.assign(new Error('WORKER_EXIT'), { code: 'WORKER_EXIT', exitCode: code })); this.resolveExit(code); });
  }
  cleanup(pending) { clearTimeout(pending.timer); pending.signal?.removeEventListener('abort', pending.abort); }
  async waitReady(signal, timeoutMs) {
    if (this.dead) throw this.dead;
    if (signal?.aborted) fail('OP_CANCELLED');
    await new Promise((resolve, reject) => {
      const settle = (callback, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value); };
      const abort = () => settle(reject, Object.assign(new Error('OP_CANCELLED'), { code: 'OP_CANCELLED' }));
      const timer = setTimeout(() => settle(reject, Object.assign(new Error('OP_TIMEOUT'), { code: 'OP_TIMEOUT' })), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      this.ready.then(value => settle(resolve, value), error => settle(reject, error));
      if (signal?.aborted) abort();
    });
    if (this.dead) throw this.dead;
  }
  async call(method, args = [], options = {}) {
    validateRpc(method, args);
    const bytes = rpcBytes(method, args); if (bytes > STREAM_BUDGET.rpcBytes) fail('RPC_BYTE_BUDGET');
    const timeoutMs = options.timeoutMs ?? STREAM_BUDGET.defaultTimeoutMs, signal = options.signal;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) fail('INVALID_TIMEOUT');
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_ABORT_SIGNAL');
    if (this.closing && method !== 'close') fail('CLIENT_CLOSED');
    const deadline = Date.now() + timeoutMs;
    await this.waitReady(signal, timeoutMs);
    if (signal?.aborted) fail('OP_CANCELLED');
    if (Date.now() >= deadline) fail('OP_TIMEOUT');
    if (this.pending.size >= STREAM_BUDGET.pendingRpc) fail('RPC_QUEUE_BUDGET');
    this.maxRpcBytes = Math.max(this.maxRpcBytes, bytes);
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, settled: false, method, signal };
      const cancel = code => {
        if (pending.settled || !this.pending.has(id)) return;
        pending.settled = true; this.cleanup(pending);
        this.worker.postMessage({ cancel: id }); reject(Object.assign(new Error(code), { code, operation: method }));
      };
      pending.abort = () => cancel('OP_CANCELLED');
      pending.timer = setTimeout(() => cancel('OP_TIMEOUT'), Math.max(1, deadline - Date.now()));
      // Retain timed-out/aborted transport slots until acknowledgment to bound the worker backlog.
      this.pending.set(id, pending); signal?.addEventListener('abort', pending.abort, { once: true });
      this.worker.postMessage({ id, method, args, deadline });
      if (signal?.aborted) pending.abort();
    });
  }
  openScope(scope, options) { return this.call('openScope', [scope], options); }
  bindSession(sessionId, bindingHash, options) { return this.call('bindSession', [sessionId, bindingHash], options); }
  deleteSessionIds(sessionIds, options) { return this.call('deleteSessionIds', [sessionIds], options); }
  beginEvent(scope, generation, metadata, options) { return this.call('beginEvent', [scope, generation, metadata], options); }
  appendChunks(scope, generation, seq, offset, chunks, options) { return this.call('appendChunks', [scope, generation, seq, offset, chunks], options); }
  finishEvent(scope, generation, seq, parts, options) { return this.call('finishEvent', [scope, generation, seq, parts], options); }
  cancelEvent(scope, generation, seq, options) { return this.call('cancelEvent', [scope, generation, seq], options); }
  skipEvents(scope, generation, fromSeq, events, options) { return this.call('skipEvents', [scope, generation, fromSeq, events], options); }
  appendEventBatch(scope, generation, fromSeq, items, options) { return this.call('appendEventBatch', [scope, generation, fromSeq, items], options); }
  search(scope, generation, query, options) { return this.call('search', [scope, generation, query], options); }
  page(scope, generation, seq, afterPart = -1, options) { return this.call('page', [scope, generation, seq, afterPart], options); }
  inspect(scope, options) { return this.call('inspect', [scope], options); }
  inspectEvent(scope, generation, seq, options) { return this.call('inspectEvent', [scope, generation, seq], options); }
  inspectPrefix(scope, generation, nextSeq = null, options) { return this.call('inspectPrefix', [scope, generation, nextSeq], options); }
  deleteScope(scope, generation, options) { return this.call('deleteScope', [scope, generation], options); }
  async close() {
    if (this.dead) { await this.exitPromise; return; }
    if (!this.closing) {
      this.closing = true;
      // Shutdown must remain reliable when all four transport reservations are occupied.
      this.closePromise = this.call('close').then(() => this.exitPromise, async () => { await this.terminate(); });
    }
    return this.closePromise;
  }
  async terminate() { this.closing = true; await this.worker.terminate(); await this.exitPromise; }
}
