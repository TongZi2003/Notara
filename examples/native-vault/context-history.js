import { Service } from '@deepseek-ai/cordis';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { ContextHistoryClient, createHistoryPrefixHasher, searchMetadataFrame, BATCH_BUDGET, STREAM_BUDGET, rpcBytes } from './context-history-client.js';
import { NATIVE_EVENT_ENCODING, prepareNativeEventRecord } from './context-history-record.js';
import { NATIVE_HISTORY_SEARCH_POLICY, compactHistorySearchChunk } from './context-history-search-policy.js';

const FEED_LIMIT = 4096;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
const skipRow = record => ({ seq: record.seq, type: record.type, reason: record.reason });
function waitForOperation(operation, signal) {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException('History request cancelled', 'AbortError'));
    const settle = (callback, value) => { signal.removeEventListener('abort', aborted); callback(value); };
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(value => settle(resolve, value), error => settle(reject, error));
    if (signal.aborted) { signal.removeEventListener('abort', aborted); aborted(); }
  });
}

/** Bind immutable native identity, never the mutable model/request header. */
export function nativeHistoryBinding(header, inheritedEventCount) {
  if (!header || typeof header.id !== 'string' || !Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) fail('HISTORY_INVALID_OWNER');
  return createHash('sha256').update(JSON.stringify([
    'notara-native-history-v1', NATIVE_EVENT_ENCODING, NATIVE_HISTORY_SEARCH_POLICY,
    header.version, header.id, header.createdAt, header.cwd ?? null,
    header.parentSession ?? null, header.isSeeded, header.origin ?? null,
    header.delegationDepth ?? null, header.agentPreset ?? null, inheritedEventCount,
  ])).digest('hex');
}

/**
 * A derived archive of the exact live native session. Native events remain the
 * authority. A single initial observation verifies the whole durable prefix;
 * subsequent writes consume immutable event references from the native feed.
 */
export class NotaraContextHistory extends Service {
  static inject = ['sessions', 'sessionQuery'];

  constructor(ctx, { path } = {}) {
    super(ctx, 'notaraHistory');
    this.path = path ?? ctx.get('dshHomePath')?.('notara-history', 'history.sqlite')
      ?? (isAbsolute(process.env.DSH_HOME ?? '') ? join(process.env.DSH_HOME, 'notara-history', 'history.sqlite') : undefined);
    this.owners = new WeakMap();
    this.active = new Map();
    this.deleted = new Set();
    this.rpcTail = Promise.resolve();
    this.closed = false;
    ctx.on('session/event', (owner, event) => this.feed(owner, event));
    ctx.on('session/disposed', owner => this.detach(owner));
    ctx.effect(() => () => this.close());
  }

  assertOwner(state, signal) {
    signal?.throwIfAborted();
    state?.controller.signal.throwIfAborted();
    if (this.closed) fail('HISTORY_CLOSED');
    if (!state || this.deleted.has(state.owner.id) || this.ctx.sessions.get(state.owner.id) !== state.owner) fail('HISTORY_STALE_OWNER');
  }

  stateFor(owner) {
    if (!owner || typeof owner.id !== 'string' || this.ctx.sessions.get(owner.id) !== owner || this.deleted.has(owner.id)) fail('HISTORY_STALE_OWNER');
    let state = this.owners.get(owner);
    if (!state) {
      const previous = this.active.get(owner.id);
      if (previous) this.detach(previous.owner);
      state = { owner, controller: new AbortController(), chain: Promise.resolve(),
        queue: [], head: 0, dirty: false, initialized: false, scheduled: false, nextSeq: 0 };
      this.owners.set(owner, state);
      this.active.set(owner.id, state);
    }
    this.assertOwner(state);
    return state;
  }

  detach(owner) {
    const state = this.owners.get(owner);
    if (!state) return;
    state.controller.abort(Object.assign(new Error('HISTORY_STALE_OWNER'), { code: 'HISTORY_STALE_OWNER' }));
    state.queue = []; state.head = 0;
    if (this.active.get(owner.id) === state) this.active.delete(owner.id);
  }

  feed(owner, event) {
    const state = this.owners.get(owner);
    if (!state || state.controller.signal.aborted || this.closed || state.dirty || event.seq < state.nextSeq) return;
    if (state.queue.length - state.head >= FEED_LIMIT) {
      // A later explicit ensure takes one fresh cut. Never resnapshot the whole
      // history for every batch while a writer outruns indexing.
      state.dirty = true;
      state.queue = []; state.head = 0;
      return;
    }
    state.queue.push(event);
    if (state.initialized) this.schedule(state);
  }

  schedule(state) {
    if (state.scheduled || state.dirty || !state.initialized || state.controller.signal.aborted || this.closed) return;
    state.scheduled = true;
    // Each pass has a fixed cut, allowing foreground requests into the chain.
    queueMicrotask(() => {
      const target = state.owner.seq;
      this.enqueue(state, undefined, signal => this.drain(state, target, signal))
        .catch(() => { state.initialized = false; })
        .finally(() => {
          state.scheduled = false;
          if (state.initialized && state.queue.length > state.head) this.schedule(state);
        });
    });
  }

  enqueue(state, callerSignal, action) {
    const signal = callerSignal ? AbortSignal.any([callerSignal, state.controller.signal]) : state.controller.signal;
    const operation = state.chain.then(async () => {
      this.assertOwner(state, signal);
      try { return await action(signal); }
      catch (error) {
        // Cancellation may occur after a worker COMMIT but before its receipt.
        // The next observation checks its watermark and resumes exact offsets.
        state.initialized = false;
        throw error;
      }
    });
    state.chain = operation.catch(() => {});
    // A cancelled foreground caller need not wait behind a background archive.
    // The queued action still observes the signal before touching the worker.
    return waitForOperation(operation, signal);
  }

  async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        if (!this.path || !isAbsolute(this.path)) fail('HISTORY_STORAGE_UNAVAILABLE');
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const client = new ContextHistoryClient({ path: this.path });
        this.archive = client;
        await client.ready;
        return client;
      })();
      this.clientPromise.catch(() => {});
    }
    return this.clientPromise;
  }

  rpc(state, signal, method, ...args) {
    // Serialize small worker operations, not complete classrooms. This also
    // bounds transport reservations when many teachers request history at once.
    const operation = this.rpcTail.then(async () => {
      if (state) this.assertOwner(state, signal);
      else { signal?.throwIfAborted(); if (this.closed) fail('HISTORY_CLOSED'); }
      const client = await this.client();
      if (state) this.assertOwner(state, signal);
      const result = await client[method](...args, { signal });
      if (state) this.assertOwner(state, signal);
      return result;
    });
    this.rpcTail = operation.catch(() => {});
    return operation;
  }

  async ensure(owner, { signal } = {}) {
    const state = this.stateFor(owner), target = owner.seq;
    return this.enqueue(state, signal, async currentSignal => {
      if (!state.initialized || state.dirty) await this.bootstrap(state, currentSignal);
      if (state.nextSeq < target) {
        await this.drain(state, target, currentSignal);
        if (state.nextSeq < target) await this.bootstrap(state, currentSignal);
      }
      this.assertOwner(state, currentSignal);
      if (state.nextSeq < target) fail('HISTORY_INCOMPLETE_PREFIX');
      this.schedule(state);
      return { scope: state.scope, generation: state.generation, nextSeq: state.nextSeq };
    });
  }

  async bootstrap(state, signal) {
    this.assertOwner(state, signal);
    const observation = await this.ctx.sessionQuery.observeSession(state.owner.id, { projectionMode: 'none', signal });
    try {
      this.assertOwner(state, signal);
      if (observation.source !== 'live' || observation.header !== state.owner.header) fail('HISTORY_STALE_OBSERVATION');
      const events = observation.events; // one immutable cut, one full-array materialization
      const end = observation.cursor + 1;
      if (events.length !== end) fail('HISTORY_BROKEN_NATIVE_PREFIX');
      const bindingHash = nativeHistoryBinding(observation.header, observation.inheritedEventCount);
      Object.assign(state, await this.rpc(state, signal, 'bindSession', state.owner.id, bindingHash));
      let stored = await this.rpc(state, signal, 'inspect', state.scope);
      let reset = stored.nextSeq > end;
      if (!reset && stored.nextSeq) {
        const digest = createHistoryPrefixHasher();
        for (let index = 0; index < stored.nextSeq; index++) {
          const event = events[index];
          if (event?.seq !== index) fail('HISTORY_BROKEN_NATIVE_PREFIX');
          const record = await prepareNativeEventRecord(event, { signal });
          digest.append(record.kind === 'skip' ? { ...skipRow(record), state: 'omitted' } : record.metadata);
          if ((index + 1) % 256 === 0) { await yieldTurn(); this.assertOwner(state, signal); }
        }
        const persisted = await this.rpc(state, signal, 'inspectPrefix', state.scope, state.generation, stored.nextSeq);
        reset = persisted.prefixHash !== digest.digest().prefixHash;
      }
      // An interrupted final record is outside the completed prefix. Validate
      // it too before resuming; a changed unflushed tail must not reuse bytes.
      state.pendingSeq = undefined;
      if (!reset) {
        let pending;
        try { pending = await this.rpc(state, signal, 'inspectEvent', state.scope, state.generation, stored.nextSeq); }
        catch (error) { if (error.code !== 'MISSING_EVENT_REFERENCE') throw error; }
        if (pending) {
          const record = events[stored.nextSeq] ? await prepareNativeEventRecord(events[stored.nextSeq], { signal }) : null;
          reset = record?.kind !== 'record' || ['seq', 'hash', 'chars', 'bytes', 'type', 'role', 'encoding']
            .some(key => record.metadata[key] !== pending.event[key])
            || JSON.stringify(searchMetadataFrame(record?.metadata?.search)) !== JSON.stringify(searchMetadataFrame(pending.event.search));
          if (!reset) state.pendingSeq = stored.nextSeq;
        }
      }
      if (reset) {
        await this.rpc(state, signal, 'deleteScope', state.scope, state.generation);
        Object.assign(state, await this.rpc(state, signal, 'bindSession', state.owner.id, bindingHash));
        stored = await this.rpc(state, signal, 'inspect', state.scope);
        state.pendingSeq = undefined;
      }
      state.nextSeq = stored.nextSeq;
      // Feed entries beyond the cut must survive. A previous overflow's missing
      // interval is now covered by this cut; a new overflow during copying is
      // detected by drain on the next explicit ensure.
      state.dirty = false;
      await this.writeEvents(state, events, state.nextSeq, end, signal);
      state.initialized = true;
      this.trimQueue(state);
    } finally { observation[Symbol.dispose](); }
  }

  async writeEvents(state, events, start, end, signal) {
    let items = [];
    const flush = async () => {
      if (!items.length) return;
      const result = await this.rpc(state, signal, 'appendEventBatch', state.scope, state.generation, state.nextSeq, items);
      state.nextSeq = result.nextSeq;
      items = [];
    };
    const collect = async item => {
      if (items.length && (items.length === BATCH_BUDGET.events || rpcBytes('appendEventBatch',
        [state.scope, state.generation, state.nextSeq, [...items, item]]) > STREAM_BUDGET.rpcBytes)) await flush();
      items.push(item);
    };
    for (let index = start; index < end; index++) {
      this.assertOwner(state, signal);
      const event = events[index];
      if (!event || event.seq !== state.nextSeq + items.length) fail('HISTORY_BROKEN_NATIVE_PREFIX');
      const record = await prepareNativeEventRecord(event, { signal });
      if (record.kind === 'skip') {
        await collect({ kind: 'skip', ...skipRow(record) });
      } else if (record.metadata.chars <= BATCH_BUDGET.shortRecordChars && event.seq !== state.pendingSeq) {
        // Size is known from the streaming hash pass. Only bounded small
        // records are materialized, never a large source while deciding size.
        const chunks = [...record.searchChunks({ signal })];
        await collect({ kind: 'record', metadata: record.metadata, ...compactHistorySearchChunk({
          body: chunks.map(chunk => chunk.body).join(''), search: chunks.map(chunk => chunk.search).join(''),
        }) });
      } else {
        await flush();
        let receipt = await this.rpc(state, signal, 'beginEvent', state.scope, state.generation, record.metadata);
        let offset = 0, parts = 0;
        for await (const batch of record.searchBatches({ signal })) {
          const remaining = [];
          for (const chunk of batch) {
            if (parts < receipt.parts) {
              offset += chunk.body.length; parts++;
              if (parts === receipt.parts && offset !== receipt.offset) fail('HISTORY_RESUME_CURSOR_MISMATCH');
            } else remaining.push(chunk);
          }
          if (remaining.length) {
            receipt = await this.rpc(state, signal, 'appendChunks', state.scope, state.generation, event.seq, receipt.offset, remaining);
            offset = receipt.offset; parts = receipt.parts;
          }
        }
        receipt = await this.rpc(state, signal, 'finishEvent', state.scope, state.generation, event.seq, receipt.parts);
        state.nextSeq = receipt.nextSeq;
        state.pendingSeq = undefined;
      }
    }
    await flush();
  }

  trimQueue(state) {
    while (state.head < state.queue.length && state.queue[state.head].seq < state.nextSeq) state.head++;
    if (state.head >= 256 || state.head === state.queue.length) { state.queue = state.queue.slice(state.head); state.head = 0; }
  }

  async drain(state, target, signal) {
    if (state.dirty || !state.initialized) return;
    this.trimQueue(state);
    while (state.nextSeq < target && state.head < state.queue.length && !state.dirty) {
      if (state.queue[state.head].seq !== state.nextSeq) { state.dirty = true; return; }
      // Capture references so feed overflow cannot replace the in-flight array.
      const batch = state.queue.slice(state.head, Math.min(state.queue.length, state.head + 256));
      const end = batch.findIndex(event => event.seq >= target);
      await this.writeEvents(state, batch, 0, end < 0 ? batch.length : end, signal);
      this.trimQueue(state);
    }
    if (state.nextSeq < target) state.dirty = true;
  }

  async search(owner, { query, signal } = {}) {
    await this.ensure(owner, { signal });
    const state = this.stateFor(owner);
    return this.rpc(state, signal, 'search', state.scope, state.generation, query);
  }

  async page(owner, { seq, afterPart = -1, signal } = {}) {
    await this.ensure(owner, { signal });
    const state = this.stateFor(owner);
    return this.rpc(state, signal, 'page', state.scope, state.generation, seq, afterPart);
  }

  async deleteSessionIds(ids) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.length > 512)) fail('HISTORY_INVALID_SESSION_IDS');
    const unique = [...new Set(ids)], draining = [];
    for (const id of unique) {
      this.deleted.add(id);
      const state = this.active.get(id);
      if (state) { this.detach(state.owner); draining.push(state.chain); }
    }
    await Promise.allSettled(draining);
    for (let index = 0; index < unique.length; index += 256) await this.rpc(null, undefined, 'deleteSessionIds', unique.slice(index, index + 256));
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const states = [...this.active.values()];
    for (const state of states) this.detach(state.owner);
    this.closePromise = (async () => {
      await Promise.allSettled(states.map(state => state.chain));
      await this.rpcTail;
      await this.clientPromise?.catch(() => {});
      await this.archive?.close();
    })();
    return this.closePromise;
  }
}
