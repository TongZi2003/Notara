import { createHash } from 'node:crypto';
import { NATIVE_HISTORY_SEARCH_POLICY, HISTORY_RETRIEVAL_TOOL_NAMES, HISTORY_SEARCH_IDENTITY_LIMITS, isNativeHistorySearchPosition, compactHistorySearchChunk } from './context-history-search-policy.js';
import { maskHistoryStringEscapes } from './context-history-evidence.js';

export const NATIVE_EVENT_ENCODING = 'native-event-v1';
export const HISTORY_RECORD_CHUNK_CHARS = 8192;
export const HISTORY_RECORD_BATCH_CHUNKS = 8;
export const HISTORY_RECORD_BATCH_BYTES = 256 * 1024;
const STRING_PIECE_CHARS = 1024;
const SEARCH_BATCH_ENVELOPE_BYTES = 8192;
const retrievalTools = new Set(HISTORY_RETRIEVAL_TOOL_NAMES);
const omittedTypes = new Set(['reasoning', 'image', 'file', 'tool-call', 'tool-addition', 'tool-removal']);
const validSeq = value => Number.isSafeInteger(value) && value >= 0;
const fail = reason => { throw new Error(`context history record: ${reason}`); };
const abort = signal => signal?.throwIfAborted();
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));

function safeEnd(text, end) {
  if (end < text.length && end > 0) {
    const last = text.charCodeAt(end - 1), next = text.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return end - 1;
  }
  return end;
}

// Escape only small source slices. A giant body is never passed to stringify.
function* quoted(value, evidence = false) {
  if (typeof value !== 'string') fail('expected canonical string');
  yield '"';
  for (let start = 0; start < value.length;) {
    const end = safeEnd(value, Math.min(value.length, start + STRING_PIECE_CHARS));
    const body = JSON.stringify(value.slice(start, end)).slice(1, -1);
    yield evidence ? { body, search: maskHistoryStringEscapes(body) } : body;
    start = end;
  }
  yield '"';
}

function* number(value) {
  if (!validSeq(value)) fail('invalid native sequence');
  yield String(value);
}

function* sequences(values) {
  if (!Array.isArray(values)) fail('expected direct native sequences');
  yield '[';
  for (let index = 0; index < values.length; index++) {
    if (index) yield ',';
    yield* number(values[index]);
  }
  yield ']';
}

function* blocks(content) {
  if (!Array.isArray(content)) fail('expected canonical content');
  yield '[';
  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (!block || typeof block !== 'object') fail('invalid canonical block');
    if (index) yield ',';
    yield `{"blockIndex":${index},"type":`;
    if (block.type === 'text') {
      yield* quoted('text');
      yield ',"text":';
      yield* quoted(block.text, true);
    } else if (block.type === 'tool-call') {
      // The assistant record can precede execution or survive a interrupted step.
      yield* quoted('tool-call');
      const evidence = !retrievalTools.has(block.name);
      yield ',"id":'; yield* quoted(block.id, evidence);
      yield ',"name":'; yield* quoted(block.name, evidence);
      yield ',"arguments":'; yield* quoted(block.arguments, evidence);
    } else {
      // Never read the omitted block's text, arguments, attachment or replay.
      if (!omittedTypes.has(block.type)) fail('unsupported canonical content type');
      yield* quoted(block.type);
      yield ',"omitted":true';
    }
    yield '}';
  }
  yield ']';
}

/**
 * Project only canonical native fields. Unindexed event data is never inspected.
 * The generators can be replayed for hashing and transport without holding JSON.
 * Output chunks/page fragments are encoded JSON, not plain text or individually
 * valid JSON records. Offsets and metadata.chars count the encoded UTF16 stream.
 * Concatenate the complete stream before JSON.parse restores original strings.
 * Input is the immutable canonical event owned by the native session.
 */
export function projectNativeEventRecord(event) {
  const seq = event?.seq, type = event?.type;
  if (!validSeq(seq) || typeof type !== 'string' || !type.length || type.length > 64) fail('invalid native event identity');
  const skip = reason => ({ kind: 'skip', seq, type, reason });
  if (!['user/message', 'assistant/message', 'tool/call', 'tool/result', 'compaction/summary'].includes(type)) return skip('unindexed-event-type');
  const data = event.data;
  if (!data || typeof data !== 'object') fail('missing canonical event data');
  if (type === 'user/message') {
    const sourceKind = data.source?.kind;
    if (sourceKind === 'compact-checkpoint') return skip('checkpoint-carrier');
    if (sourceKind !== 'user') return skip('unindexed-user-source');
  }

  const role = type === 'user/message' ? 'user' : type.startsWith('tool/') ? 'tool' : 'assistant';
  function* rawPieces() {
    yield '{"encoding":'; yield* quoted(NATIVE_EVENT_ENCODING);
    yield ',"seq":'; yield* number(seq);
    yield ',"type":'; yield* quoted(type);
    yield ',"role":'; yield* quoted(role);
    if (type === 'tool/call') {
      const evidence = !retrievalTools.has(data.name);
      yield ',"callId":'; yield* quoted(data.callId, evidence);
      yield ',"name":'; yield* quoted(data.name, evidence);
      yield ',"arguments":'; yield* quoted(data.arguments, evidence);
    } else {
      const message = type === 'user/message' ? data : type === 'compaction/summary' ? null : data.message;
      if (type === 'tool/result') {
        yield ',"callId":'; yield* quoted(message?.toolCallId);
        if (message.isError !== undefined && typeof message.isError !== 'boolean') fail('invalid tool result error flag');
        yield `,"isError":${message.isError === true}`;
      }
      if (type === 'compaction/summary') {
        yield ',"compactionId":'; yield* quoted(data.compactionId);
        yield ',"directSourceSeqs":'; yield* sequences(data.shadowedSeqs);
        if (!data.shadowedRange || !validSeq(data.shadowedRange.start) || !validSeq(data.shadowedRange.end)) fail('invalid positional summary range');
        yield `,"shadowedRange":{"start":${data.shadowedRange.start},"end":${data.shadowedRange.end}}`;
        if (event.sourceEventSeqs !== undefined) {
          yield ',"sourceEventSeqs":'; yield* sequences(event.sourceEventSeqs);
        }
      }
      yield ',"blocks":'; yield* blocks(type === 'compaction/summary' ? data.summary : message?.content);
    }
    yield '}';
  }
  function* pieces({ signal } = {}) {
    for (const piece of rawPieces()) { abort(signal); yield typeof piece === 'string' ? piece : piece.body; }
  }
  function* searchChunks(options = {}) {
    let pending = '', pendingSearch = '';
    for (const piece of rawPieces()) {
      abort(options.signal);
      const body = typeof piece === 'string' ? piece : piece.body;
      pending += body;
      pendingSearch += typeof piece === 'string' ? ' '.repeat(body.length) : piece.search;
      while (pending.length >= HISTORY_RECORD_CHUNK_CHARS) {
        const end = safeEnd(pending, HISTORY_RECORD_CHUNK_CHARS);
        yield { body: pending.slice(0, end), search: pendingSearch.slice(0, end) };
        pending = pending.slice(end);
        pendingSearch = pendingSearch.slice(end);
      }
    }
    if (pending) yield { body: pending, search: pendingSearch };
  }
  function* chunks(options = {}) { for (const chunk of searchChunks(options)) yield chunk.body; }
  return { kind: 'record', seq, type, role, encoding: NATIVE_EVENT_ENCODING, pieces, chunks, searchChunks };
}

function nativeToolSearchIdentity(event) {
  if (!['tool/call', 'tool/result'].includes(event.type)) return {};
  const { turn, step } = event.data;
  if (!isNativeHistorySearchPosition(turn) || !isNativeHistorySearchPosition(step)) return {};
  const callId = event.type === 'tool/call' ? event.data.callId : event.data.message?.toolCallId;
  if (typeof callId !== 'string' || !callId.length || callId.length > HISTORY_SEARCH_IDENTITY_LIMITS.callId || !callId.isWellFormed()) return {};
  if (event.type === 'tool/result') return { result: { callId, turn, step } };
  const name = event.data.name;
  if (typeof name !== 'string' || !name.length || name.length > HISTORY_SEARCH_IDENTITY_LIMITS.name || !name.isWellFormed()) return {};
  return { call: { callId, name, turn, step } };
}

/** Compute exact serialized UTF-8 bytes, UTF-16 chars and SHA256 incrementally. */
export async function prepareNativeEventRecord(event, { signal, yieldEveryChars = 65536 } = {}) {
  abort(signal);
  if (!Number.isSafeInteger(yieldEveryChars) || yieldEveryChars < 1 || yieldEveryChars > 65536) fail('invalid yield interval');
  const record = projectNativeEventRecord(event);
  if (record.kind === 'skip') return record;
  const hash = createHash('sha256'), searchHash = createHash('sha256');
  let bytes = 0, chars = 0, sinceYield = 0;
  for (const chunk of record.searchChunks({ signal })) {
    bytes += Buffer.byteLength(chunk.body, 'utf8');
    chars += chunk.body.length;
    sinceYield += chunk.body.length;
    if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(chars)) fail('record size overflow');
    hash.update(chunk.body, 'utf8'); searchHash.update(chunk.search, 'utf8');
    if (sinceYield >= yieldEveryChars) {
      sinceYield = 0;
      await yieldTurn();
      abort(signal);
    }
  }
  abort(signal);
  const metadata = { seq: record.seq, type: record.type, role: record.role, encoding: record.encoding,
    hash: hash.digest('hex'), bytes, chars,
    search: { policy: NATIVE_HISTORY_SEARCH_POLICY, hash: searchHash.digest('hex'), ...nativeToolSearchIdentity(event) } };
  async function* batches({ signal: transportSignal = signal } = {}) {
    let batch = [], batchBytes = 0;
    for (const chunk of record.chunks({ signal: transportSignal })) {
      abort(transportSignal);
      const chunkBytes = Buffer.byteLength(chunk, 'utf8');
      if (batch.length === HISTORY_RECORD_BATCH_CHUNKS || batchBytes + chunkBytes > HISTORY_RECORD_BATCH_BYTES) {
        yield batch;
        batch = []; batchBytes = 0;
        await yieldTurn();
        abort(transportSignal);
      }
      batch.push(chunk); batchBytes += chunkBytes;
    }
    if (batch.length) { abort(transportSignal); yield batch; }
  }
  async function* searchBatches({ signal: transportSignal = signal } = {}) {
    let batch = [], batchBytes = 0;
    for (const fullChunk of record.searchChunks({ signal: transportSignal })) {
      abort(transportSignal);
      const chunk = compactHistorySearchChunk(fullChunk);
      // Include object fields, comma and JSON escapes; leave room for the
      // maximum scope/generation/sequence/cursor RPC envelope.
      const chunkBytes = Buffer.byteLength(JSON.stringify(chunk), 'utf8') + 1;
      if (batch.length === HISTORY_RECORD_BATCH_CHUNKS || batchBytes + chunkBytes > HISTORY_RECORD_BATCH_BYTES - SEARCH_BATCH_ENVELOPE_BYTES) {
        yield batch; batch = []; batchBytes = 0;
        await yieldTurn(); abort(transportSignal);
      }
      batch.push(chunk); batchBytes += chunkBytes;
    }
    if (batch.length) { abort(transportSignal); yield batch; }
  }
  return { ...record, metadata, batches, searchBatches };
}
