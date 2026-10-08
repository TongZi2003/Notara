import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ContextHistoryClient, BATCH_BUDGET, STREAM_BUDGET, validateRpc, rpcBytes, createHistoryPrefixHasher } from './context-history-client.js';
import { prepareNativeEventRecord } from './context-history-record.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'notara-history-batch-')), clients = [];
  const path = join(root, 'private.sqlite');
  t.after(async () => { await Promise.all(clients.map(client => client.terminate())); await rm(root, { recursive: true, force: true }); });
  return { path, client() { const client = new ContextHistoryClient({ path }); clients.push(client); return client; } };
}
const skip = seq => ({ kind: 'skip', seq, type: 'step/end', reason: 'unindexed-event-type' });
async function record(seq, text = 'batch_marker_392849 中文😀') {
  const prepared = await prepareNativeEventRecord({ seq, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } });
  assert.ok(prepared.metadata.chars <= BATCH_BUDGET.shortRecordChars);
  const chunks = [...prepared.searchChunks()];
  return { kind: 'record', metadata: prepared.metadata, body: chunks.map(chunk => chunk.body).join(''), search: chunks.map(chunk => chunk.search).join('') };
}
function prefix(items) {
  const hash = createHistoryPrefixHasher();
  for (const item of items) hash.append(item.kind === 'skip' ? { ...item, state: 'omitted' } : item.metadata);
  return hash.digest();
}
// Inject interruption at an exact check boundary while SQLite stays worker-only.
async function probe(path, operation = {}) {
  const source = `const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { ContextHistoryStore } = await import(workerData.module);
      const store = new ContextHistoryStore(workerData.path); let checks = 0, value, error;
      try { if (workerData.args) value = await store.appendEventBatch(...workerData.args, { check() {
        if (++checks === workerData.stopAt) throw Object.assign(new Error(workerData.code), { code: workerData.code });
      } }); } catch (caught) { error = caught.code; }
      const counts = Object.fromEntries(['events','omissions','chunks','postings','termStats','streams'].map(table =>
        [table, store.db.prepare('SELECT count(*) AS count FROM ' + table).get().count]));
      const cursor = store.sql.cursor.get(workerData.scope);
      store.close(); parentPort.postMessage({ value, error, checks, counts, nextSeq: cursor?.nextSeq });
    })().catch(error => { throw error; });`;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { path, module: new URL('./context-history-store.js', import.meta.url).href, ...operation } });
    let result; worker.on('message', value => { result = value; }); worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve(result) : reject(new Error('batch probe worker failed')));
  });
}

test('mixed atomic batch restores canonical text, indexes records and preserves the full ordered prefix', async t => {
  const f = await fixture(t), client = f.client(), scope = 'synthetic-mixed';
  const { generation } = await client.openScope(scope);
  const items = [skip(0), await record(1), skip(2), await record(3, '\n"quote"\\slash 中文😀'), skip(4)];
  assert.deepEqual(await client.appendEventBatch(scope, generation, 0, items), { generation, nextSeq: 5, appendedCount: 5 });
  assert.deepEqual(await client.inspectPrefix(scope, generation), { generation, ...prefix(items) });
  const page = await client.page(scope, generation, 3);
  assert.equal(page.event.state, 'complete');
  assert.equal(page.event.chunkCount, 1);
  assert.equal(page.rows[0].start, 0);
  assert.equal(page.rows[0].end, items[3].metadata.chars);
  assert.equal(page.rows[0].body, items[3].body);
  assert.equal(JSON.parse(page.rows[0].body).blocks[0].text, '\n"quote"\\slash 中文😀');
  assert.ok((await client.search(scope, generation, 'batch_marker_392849')).results.some(hit => hit.seq === 1));
  assert.equal((await client.inspectEvent(scope, generation, 2)).event.omissionReason, 'unindexed-event-type');
  assert.deepEqual((await client.inspectEvent(scope, generation, 3)).receipt, {
    generation, seq: 3, offset: items[3].metadata.chars, receivedBytes: items[3].metadata.bytes,
    parts: 1, indexedParts: 1, state: 'complete', expectedHash: items[3].metadata.hash, nextSeq: 5,
  });
  assert.ok(client.maxRpcBytes <= STREAM_BUDGET.rpcBytes);
  await client.close();
});

test('bad final hash and in-transaction interruption roll back every event, posting and watermark', async t => {
  const f = await fixture(t), client = f.client(), scope = 'synthetic-rollback';
  const { generation } = await client.openScope(scope);
  const first = await record(0), second = await record(2);
  const items = [first, skip(1), { ...second, metadata: { ...second.metadata, hash: '0'.repeat(64) } }];
  await assert.rejects(client.appendEventBatch(scope, generation, 0, items), { code: 'PERSISTED_HASH_MISMATCH' });
  assert.equal((await client.inspect(scope)).nextSeq, 0);
  await client.close();
  const clean = await probe(f.path, { scope });
  assert.ok(Object.values(clean.counts).every(count => count === 0));
  const interrupted = await probe(f.path, { scope, args: [scope, generation, 0, [first, skip(1), second]], stopAt: 4, code: 'OP_CANCELLED' });
  assert.equal(interrupted.error, 'OP_CANCELLED');
  assert.equal(interrupted.nextSeq, 0);
  assert.ok(Object.values(interrupted.counts).every(count => count === 0));
});

for (const code of ['OP_CANCELLED', 'OP_TIMEOUT']) test(`${code} after batch COMMIT recovers by complete prefix observation without duplicate writes`, async t => {
  const f = await fixture(t), scope = `synthetic-receipt-lost-${code}`;
  let client = f.client();
  const { generation } = await client.openScope(scope);
  await client.close();
  const items = [skip(0), await record(1), skip(2)];
  const interrupted = await probe(f.path, { scope, args: [scope, generation, 0, items], stopAt: items.length + 4, code });
  assert.equal(interrupted.error, code);
  assert.equal(interrupted.nextSeq, 3);
  assert.equal(interrupted.counts.events, 3);
  assert.equal(interrupted.counts.chunks, 1);
  client = f.client();
  assert.equal((await client.inspect(scope)).nextSeq, 3);
  assert.deepEqual(await client.inspectPrefix(scope, generation), { generation, ...prefix(items) });
  await assert.rejects(client.appendEventBatch(scope, generation, 0, items), { code: 'MISSING_OR_REORDERED_SEQUENCE' });
  assert.deepEqual(await client.appendEventBatch(scope, generation, 3, [skip(3)]), { generation, nextSeq: 4, appendedCount: 1 });
  await client.close();
  const final = await probe(f.path, { scope });
  assert.equal(final.counts.events, 4);
  assert.equal(final.counts.chunks, 1);
  assert.equal(final.counts.postings, interrupted.counts.postings);
  assert.equal(final.counts.termStats, interrupted.counts.termStats);
});

test('pending streamed tail and stale generation cannot be replaced by a batch', async t => {
  const f = await fixture(t), client = f.client(), scope = 'synthetic-pending';
  const { generation } = await client.openScope(scope), item = await record(0);
  await client.beginEvent(scope, generation, item.metadata);
  const partial = item.body.slice(0, 30);
  await client.appendChunks(scope, generation, 0, 0, [{ body: partial, search: item.search.slice(0, partial.length) }]);
  await assert.rejects(client.appendEventBatch(scope, generation, 0, [item]), { code: 'PENDING_EVENT_CONFLICT' });
  await assert.rejects(client.appendEventBatch(scope, generation + 1, 0, [item]), { code: 'STALE_SCOPE_GENERATION' });
  assert.equal((await client.inspectEvent(scope, generation, 0)).receipt.offset, partial.length);
  assert.equal((await client.inspect(scope)).nextSeq, 0);
  const receipt = await client.appendChunks(scope, generation, 0, partial.length, [{ body: item.body.slice(partial.length), search: item.search.slice(partial.length) }]);
  await client.finishEvent(scope, generation, 0, receipt.parts);
  assert.equal((await client.inspect(scope)).nextSeq, 1);
  await client.close();
});

test('batch validation rejects unbounded or nonstring shapes before JSON measurement and enforces escaped RPC byte budget', async t => {
  const f = await fixture(t), client = f.client(), scope = 'synthetic-shapes';
  const { generation } = await client.openScope(scope), item = await record(0);
  for (const items of [[], Array(129).fill(skip(0)), [skip(1)], [skip(0), null], [{ ...skip(0), raw: 'private' }], [{ ...item, body: 1n }],
    [{ ...item, body: { toJSON() { throw new Error('must not serialize malformed body'); } } }], [{ ...item, metadata: { ...item.metadata, chars: 1n } }]]) {
    await assert.rejects(client.appendEventBatch(scope, generation, 0, items), error => ['INVALID_EVENT_BATCH', 'INVALID_BATCH_RECORD', 'INVALID_EVENT_METADATA'].includes(error.code));
  }
  const oversized = await record(0, '\0'.repeat(1200));
  const items = Array.from({ length: 32 }, (_, seq) => ({ ...oversized, metadata: { ...oversized.metadata, seq } }));
  validateRpc('appendEventBatch', [scope, generation, 0, items]);
  assert.ok(rpcBytes('appendEventBatch', [scope, generation, 0, items]) > STREAM_BUDGET.rpcBytes);
  await assert.rejects(client.appendEventBatch(scope, generation, 0, items), { code: 'RPC_BYTE_BUDGET' });
  assert.equal((await client.inspect(scope)).nextSeq, 0);
  await client.close();
  const unsafe = await probe(f.path, { scope, args: [scope, generation, 0, [{ ...item, body: 1n }]] });
  assert.equal(unsafe.error, 'INVALID_BATCH_RECORD');
  const over = await probe(f.path, { scope, args: [scope, generation, 0, items] });
  assert.equal(over.error, 'RPC_BYTE_BUDGET');
  assert.ok(Object.values(over.counts).every(count => count === 0));
});
