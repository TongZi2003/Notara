import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { ContextHistoryClient, STREAM_BUDGET, BATCH_BUDGET, rpcBytes, validateRpc, validateSearchProjection, createHistoryPrefixHasher } from './context-history-client.js';
import { NATIVE_HISTORY_SEARCH_POLICY, expandHistorySearchProjection } from './context-history-search-policy.js';

const sha = text => createHash('sha256').update(text).digest('hex');
const record = (seq, body, search = null) => ({ kind: 'record', body, search, metadata: {
  seq, type: 'user/message', role: 'user', encoding: 'native-event-v1', chars: body.length,
  bytes: Buffer.byteLength(body), hash: sha(body), search: {
    policy: NATIVE_HISTORY_SEARCH_POLICY, hash: sha(expandHistorySearchProjection(body, search)),
  },
} });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'notara-history-transport-')), path = join(directory, 'private.sqlite'), clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.terminate()));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('notara-history-transport-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { path, client() { const client = new ContextHistoryClient({ path }); clients.push(client); return client; } };
}
async function inspectStorage(path) {
  const source = `const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(workerData,{readOnly:true});
    const result={version:db.prepare('PRAGMA user_version').get().user_version,
      chunks:db.prepare('SELECT seq,part,search FROM chunks ORDER BY seq,part').all(),
      counts:Object.fromEntries(['events','chunks','postings','termStats','streams'].map(name=>[name,db.prepare('SELECT count(*) AS count FROM '+name).get().count]))};
    db.close();parentPort.postMessage(result);`;
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(source, { eval: true, workerData: path, execArgv: [] }); let result;
    worker.on('message', value => { result = value; }); worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolveResult(result) : reject(new Error('synthetic inspection failed')));
  });
}

test('compact batch projections preserve offsets, canonical pages, prefix and v2 storage after restart', async t => {
  const f = await fixture(t), scope = 'transport-batch'; let client = f.client();
  const { generation } = await client.openScope(scope);
  const hidden = 'hidden_transport_98217', visible = ' visible_transport_18329 中文😀';
  const records = [record(0, 'ordinary_transport_91328'), record(1, 'blank_transport_82319', ''),
    record(2, hidden + visible, ' '.repeat(hidden.length) + visible)];
  await client.appendEventBatch(scope, generation, 0, records);
  const prefix = createHistoryPrefixHasher(); records.forEach(item => prefix.append(item.metadata));
  const expected = { generation, ...prefix.digest() };
  await client.close(); client = f.client();
  assert.deepEqual(await client.inspectPrefix(scope, generation), expected);
  for (const item of records) {
    const page = await client.page(scope, generation, item.metadata.seq);
    assert.equal(page.rows[0].body, item.body); assert.equal(sha(page.rows[0].body), item.metadata.hash);
    assert.deepEqual(page.event.search, item.metadata.search);
  }
  for (const query of [hidden, 'blank_transport_82319']) assert.deepEqual((await client.search(scope, generation, query)).results, []);
  assert.ok((await client.search(scope, generation, 'ordinary_transport_91328')).results.length);
  const hits = (await client.search(scope, generation, 'visible_transport_18329')).results;
  assert.ok(hits.length); assert.equal(hits[0].hitStart, records[2].body.indexOf('visible_transport_18329'));
  assert.ok(hits.every(hit => !hit.preview.includes(hidden)));
  await client.close(); const stored = await inspectStorage(f.path);
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.chunks.map(chunk => chunk.search), [null, '', records[2].search]);
});

test('compact streamed chunks resume exact pending receipt across cancellation and restart', async t => {
  const f = await fixture(t), scope = 'transport-stream'; let client = f.client();
  const { generation } = await client.openScope(scope);
  const first = 'visible_stream_83912 '.padEnd(8192, 'a'), second = 'hidden_stream_92381 '.padEnd(8192, 'b');
  const hidden = 'hidden_tail_72931', tail = hidden + ' visible_tail_31928 😀中文';
  const tailSearch = ' '.repeat(hidden.length) + tail.slice(hidden.length);
  const body = first + second + tail, projected = first + ' '.repeat(second.length) + tailSearch;
  const metadata = record(0, body).metadata; metadata.search.hash = sha(projected);
  await client.beginEvent(scope, generation, metadata);
  const firstReceipt = await client.appendChunks(scope, generation, 0, 0, [{ body: first, search: null }]);
  assert.equal(firstReceipt.offset, 8192); assert.equal(firstReceipt.parts, 1);
  await client.cancelEvent(scope, generation, 0); await client.close(); client = f.client();
  const resumed = await client.beginEvent(scope, generation, metadata);
  assert.equal(resumed.offset, firstReceipt.offset); assert.equal(resumed.parts, firstReceipt.parts);
  await assert.rejects(client.appendChunks(scope, generation, 0, 0, [{ body: first, search: null }]), { code: 'OFFSET_MISMATCH' });
  const receipt = await client.appendChunks(scope, generation, 0, resumed.offset, [{ body: second, search: '' }, { body: tail, search: tailSearch }]);
  await client.finishEvent(scope, generation, 0, receipt.parts);
  await client.close(); client = f.client();
  const page = await client.page(scope, generation, 0), original = page.rows.map(row => row.body).join('');
  assert.equal(original, body); assert.equal(sha(original), metadata.hash);
  assert.equal(page.rows.length, 3); assert.deepEqual(page.rows.map(row => row.start), [0, 8192, 16384]);
  assert.deepEqual(await client.inspectPrefix(scope, generation), { generation, ...createHistoryPrefixHasher().append(metadata).digest() });
  for (const query of ['hidden_stream_92381', hidden]) assert.deepEqual((await client.search(scope, generation, query)).results, []);
  const hits = (await client.search(scope, generation, 'visible_tail_31928')).results;
  assert.ok(hits.length); assert.equal(hits[0].hitStart, body.indexOf('visible_tail_31928'));
});

test('both sentinels retain independent search and canonical hash checks with atomic rollback', async t => {
  const f = await fixture(t), client = f.client(), scope = 'transport-hashes';
  const { generation } = await client.openScope(scope);
  for (const search of [null, '']) {
    const valid = record(0, 'valid_atomic_73192', null), bad = record(1, 'bad_atomic_82913', search);
    bad.metadata.search.hash = sha(expandHistorySearchProjection(bad.body, search === null ? '' : null));
    await assert.rejects(client.appendEventBatch(scope, generation, 0, [valid, bad]), { code: 'PERSISTED_SEARCH_HASH_MISMATCH' });
    assert.equal((await client.inspect(scope)).nextSeq, 0);
    await assert.rejects(client.inspectEvent(scope, generation, 0), { code: 'MISSING_EVENT_REFERENCE' });
    assert.deepEqual((await client.search(scope, generation, 'valid_atomic_73192')).results, []);
  }
  const canonicalBad = record(0, 'original_checksum_18372', null); canonicalBad.metadata.hash = sha('different original');
  await assert.rejects(client.appendEventBatch(scope, generation, 0, [canonicalBad]), { code: 'PERSISTED_HASH_MISMATCH' });
  await client.close(); const stored = await inspectStorage(f.path);
  assert.ok(Object.values(stored.counts).every(count => count === 0));
});

test('compact stream cannot complete a wrong projection hash or change it on resume', async t => {
  const f = await fixture(t), client = f.client(), scope = 'transport-finish';
  const { generation } = await client.openScope(scope), item = record(0, 'pending_checksum_18329', '');
  const correctHash = item.metadata.search.hash; item.metadata.search.hash = sha(item.body);
  await client.beginEvent(scope, generation, item.metadata);
  const receipt = await client.appendChunks(scope, generation, 0, 0, [{ body: item.body, search: '' }]);
  await assert.rejects(client.finishEvent(scope, generation, 0, receipt.parts), { code: 'PERSISTED_SEARCH_HASH_MISMATCH' });
  assert.equal((await client.inspect(scope)).nextSeq, 0);
  await client.close(); const restarted = f.client();
  await assert.rejects(restarted.beginEvent(scope, generation, { ...item.metadata, search: { ...item.metadata.search, hash: correctHash } }), { code: 'RESUME_SOURCE_MISMATCH' });
  const resumed = await restarted.beginEvent(scope, generation, item.metadata);
  assert.equal(resumed.offset, item.body.length); assert.equal(resumed.parts, 1);
  await assert.rejects(restarted.finishEvent(scope, generation, 0, resumed.parts), { code: 'PERSISTED_SEARCH_HASH_MISMATCH' });
});

test('compact markers cannot cross legacy classification or evade shape and mask validation', async t => {
  const f = await fixture(t), client = f.client(), scope = 'transport-shapes';
  const { generation } = await client.openScope(scope), item = record(0, 'legacy_original_71932');
  const legacy = { ...item.metadata }; delete legacy.search;
  await client.beginEvent(scope, generation, legacy);
  for (const search of [null, '']) await assert.rejects(client.appendChunks(scope, generation, 0, 0, [{ body: item.body, search }]), { code: 'SEARCH_PROJECTION_REQUIRED' });
  const receipt = await client.appendChunks(scope, generation, 0, 0, [item.body]);
  await client.finishEvent(scope, generation, 0, receipt.parts);
  const classified = record(1, 'classified_original_98123');
  await client.beginEvent(scope, generation, classified.metadata);
  await assert.rejects(client.appendChunks(scope, generation, 1, 0, [classified.body]), { code: 'SEARCH_PROJECTION_REQUIRED' });
  for (const search of [undefined, false, 0, [], {}]) assert.throws(() => validateRpc('appendChunks', [scope, generation, 1, 0, [{ body: classified.body, search }]]), { code: 'INVALID_SEARCH_PROJECTION' });
  for (const search of [null, '']) assert.throws(() => validateRpc('appendEventBatch', [scope, generation, 0, [{ ...item, metadata: legacy, search }]]), { code: 'SEARCH_PROJECTION_REQUIRED' });
  assert.throws(() => validateRpc('appendChunks', [scope, generation, 1, 0, [{ body: 'abc', search: null, extra: true }]]), { code: 'INVALID_CHUNK_BATCH' });
  assert.throws(() => validateSearchProjection('abc', 'abd'), { code: 'INVALID_SEARCH_PROJECTION' });
  assert.throws(() => validateSearchProjection('😀', '\ud83d '), { code: 'INVALID_SEARCH_PROJECTION' });
  assert.throws(() => validateSearchProjection('\ud83d', null), { code: 'INVALID_SEARCH_PROJECTION' });
  assert.throws(() => validateSearchProjection({ length: 1 }, ''), { code: 'INVALID_SEARCH_PROJECTION' });
});

test('compact transport reduces actual wire bytes while retaining all bounded RPC limits', async t => {
  const f = await fixture(t), client = f.client(), scope = 'transport-bounds';
  const { generation } = await client.openScope(scope), body = 'printable'.repeat(910).slice(0, 8190);
  const compact = Array.from({ length: STREAM_BUDGET.chunks }, () => ({ body, search: null }));
  const expanded = compact.map(chunk => ({ body: chunk.body, search: chunk.body }));
  const compactBytes = rpcBytes('appendChunks', [scope, generation, 0, 0, compact]);
  assert.ok(compactBytes < rpcBytes('appendChunks', [scope, generation, 0, 0, expanded]) * 0.55);
  assert.ok(compactBytes <= STREAM_BUDGET.rpcBytes);
  for (const search of [null, '']) {
    assert.throws(() => validateRpc('appendChunks', [scope, generation, 0, 0, [{ body: 'x'.repeat(8193), search }]]), { code: 'INVALID_CHUNK_BATCH' });
    assert.throws(() => validateRpc('appendChunks', [scope, generation, 0, 0, Array.from({ length: 9 }, () => ({ body: 'x', search }))]), { code: 'INVALID_CHUNK_BATCH' });
    const escaped = Array.from({ length: 8 }, () => ({ body: '\0'.repeat(8192), search }));
    validateRpc('appendChunks', [scope, generation, 0, 0, escaped]);
    assert.ok(rpcBytes('appendChunks', [scope, generation, 0, 0, escaped]) > STREAM_BUDGET.rpcBytes);
    await assert.rejects(client.appendChunks(scope, generation, 0, 0, escaped), { code: 'RPC_BYTE_BUDGET' });
    const batches = Array.from({ length: 6 }, (_, seq) => record(seq, '\0'.repeat(8192), search));
    validateRpc('appendEventBatch', [scope, generation, 0, batches]);
    await assert.rejects(client.appendEventBatch(scope, generation, 0, batches), { code: 'RPC_BYTE_BUDGET' });
  }
  const tooMany = Array.from({ length: BATCH_BUDGET.events + 1 }, (_, seq) => record(seq, 'x'));
  assert.throws(() => validateRpc('appendEventBatch', [scope, generation, 0, tooMany]), { code: 'INVALID_EVENT_BATCH' });
  assert.equal((await client.inspect(scope)).nextSeq, 0);
});
