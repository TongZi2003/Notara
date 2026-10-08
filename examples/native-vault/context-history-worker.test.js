import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { ContextHistoryClient, createHistoryPrefixHasher, STREAM_BUDGET } from './context-history-client.js';

const sha = text => createHash('sha256').update(text).digest('hex');
const metadata = (seq, text, extra = {}) => ({ seq, chars: text.length, bytes: Buffer.byteLength(text), hash: sha(text), type: 'message', role: 'user', ...extra });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'notara-history-worker-')); let clients = [];
  const path = join(dir, 'private.sqlite');
  t.after(async () => { await Promise.all(clients.map(client => client.terminate())); await rm(dir, { recursive: true, force: true }); });
  return { path, dir, client() { const client = new ContextHistoryClient({ path }); clients.push(client); return client; } };
}
async function append(client, scope, generation, seq, text, extra) {
  const meta = metadata(seq, text, extra); let receipt = await client.beginEvent(scope, generation, meta);
  while (receipt.offset < text.length) {
    const chunks = []; let offset = receipt.offset;
    for (let i = 0; i < 8 && offset < text.length; i++) {
      let end = Math.min(offset + 8192, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      chunks.push(text.slice(offset, end)); offset = end;
    }
    receipt = await client.appendChunks(scope, generation, seq, receipt.offset, chunks);
  }
  await client.finishEvent(scope, generation, seq, receipt.parts); return meta;
}
async function pageText(client, scope, generation, seq) {
  const parts = []; let after = -1;
  for (;;) { const page = await client.page(scope, generation, seq, after); parts.push(...page.rows.map(row => row.body)); if (page.done) return parts.join(''); after = page.rows.at(-1).part; }
}

test('stream cancellation, restart, original hash and encoded payload metadata', async t => {
  const f = await fixture(t), scope = 'session:synthetic-a', text = '中文😀 marker_resume_283920 '.repeat(80000);
  let client = f.client(); const { generation } = await client.openScope(scope), meta = metadata(0, text, { encoding: 'native-event-v1' });
  let receipt = await client.beginEvent(scope, generation, meta);
  receipt = await client.appendChunks(scope, generation, 0, 0, [text.slice(0, 8191)]);
  assert.equal(receipt.offset, 8191);
  assert.equal((await client.inspect(scope)).nextSeq, 0);
  assert.deepEqual((await client.search(scope, generation, 'marker_resume_283920')).results, []);
  await assert.rejects(client.page(scope, generation, 0), { code: 'INCOMPLETE_EVENT' });
  await assert.rejects(client.finishEvent(scope, generation, 0, receipt.parts), { code: 'EVENT_INCOMPLETE' });
  await assert.rejects(client.appendChunks(scope, generation, 0, 0, ['wrong']), { code: 'OFFSET_MISMATCH' });
  await client.cancelEvent(scope, generation, 0); await client.terminate(); client = f.client();
  await assert.rejects(client.beginEvent(scope, generation, { ...meta, hash: sha('different') }), { code: 'RESUME_SOURCE_MISMATCH' });
  receipt = await client.beginEvent(scope, generation, meta);
  assert.equal(receipt.offset, 8191);
  while (receipt.offset < text.length) {
    const chunks = []; let offset = receipt.offset;
    for (let i = 0; i < 8 && offset < text.length; i++) { let end = Math.min(offset + 8192, text.length); if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--; chunks.push(text.slice(offset, end)); offset = end; }
    receipt = await client.appendChunks(scope, generation, 0, receipt.offset, chunks);
  }
  await client.finishEvent(scope, generation, 0, receipt.parts);
  assert.equal(sha(await pageText(client, scope, generation, 0)), meta.hash);
  assert.equal((await client.inspectEvent(scope, generation, 0)).event.encoding, 'native-event-v1');
  assert.equal((await client.inspect(scope)).nextSeq, 1);
  assert.ok(client.maxRpcBytes <= STREAM_BUDGET.rpcBytes);
  await client.close();
});

test('omissions preserve native sequences, prefix fingerprints detect rewritten tails', async t => {
  const f = await fixture(t), client = f.client(), scope = 'prefix'; const { generation } = await client.openScope(scope);
  const skip = [{ seq: 0, type: 'header', reason: 'header' }, { seq: 1, type: 'user', reason: 'unindexed-user-source' }];
  const expected = createHistoryPrefixHasher(); skip.forEach(row => expected.append({ ...row, state: 'omitted' }));
  await client.skipEvents(scope, generation, 0, skip);
  const first = await append(client, scope, generation, 2, 'old user A'); expected.append(first);
  const last = await append(client, scope, generation, 3, 'generic last end'); expected.append(last);
  assert.deepEqual(await client.inspectPrefix(scope, generation), { generation, ...expected.digest() });
  await assert.rejects(client.inspectPrefix(scope, generation, 5), { code: 'PREFIX_NOT_COMPLETE' });
  await assert.rejects(client.page(scope, generation, 0), { code: 'EVENT_OMITTED' });
  await assert.rejects(client.page(scope, generation, 99), { code: 'MISSING_EVENT_REFERENCE' });
  assert.equal((await client.inspectEvent(scope, generation, 1)).event.omissionReason, 'unindexed-user-source');
  const changed = createHistoryPrefixHasher(); skip.forEach(row => changed.append({ ...row, state: 'omitted' }));
  changed.append(metadata(2, 'new user B')).append(last);
  assert.notEqual((await client.inspectPrefix(scope, generation)).prefixHash, changed.digest().prefixHash);
  const many = Array.from({ length: 256 }, (_, i) => ({ seq: 4 + i, type: 'reasoning', reason: 'reasoning' }));
  await client.skipEvents(scope, generation, 4, many);
  assert.equal((await client.inspectPrefix(scope, generation)).nextSeq, 260);
  await assert.rejects(client.skipEvents(scope, generation, 260, [{ seq: 261, type: 'header', reason: 'header' }]), { code: 'INVALID_SKIP_BATCH' });
  await client.beginEvent(scope, generation, metadata(260, 'pending'));
  await assert.rejects(client.skipEvents(scope, generation, 260, [{ seq: 260, type: 'header', reason: 'header' }]), { code: 'PENDING_EVENT_CONFLICT' });
  assert.equal((await client.inspectPrefix(scope, generation)).nextSeq, 260);
  await client.close();
});

test('rare identifiers, overlap evidence, regex punctuation, Han and Unicode case offsets', async t => {
  const f = await fixture(t), client = f.client(), scope = 'search'; const { generation } = await client.openScope(scope);
  for (let seq = 0; seq < 140; seq++) await append(client, scope, generation, seq, 'common terms definition another common phrase');
  const queries = ['marker_rare_983482', 'special_29384 .*+?^${}()|[]\\', '中文', 'emoji_32948😀', 'unicode_82348 CASE'];
  const text = 'x'.repeat(8184) + ' ' + queries.join(' separate ') + ' İ prefix unicode_82348 case';
  await append(client, scope, generation, 140, text);
  for (const query of queries) {
    const result = (await client.search(scope, generation, query)).results.find(row => row.seq === 140 && row.hitKind === 'query-literal');
    assert.ok(result, query); assert.equal(text.slice(result.hitStart, result.hitEnd).toLowerCase(), query.toLowerCase());
    assert.ok(result.preview.toLowerCase().includes(query.toLowerCase()));
  }
  const rare = await client.search(scope, generation, 'common terms marker_rare_983482');
  assert.equal(rare.results[0].seq, 140); assert.ok(rare.diagnostics.candidates <= 128); assert.match(rare.diagnostics.recall, /incomplete recall/);
  assert.deepEqual((await client.search(scope, generation, '😀')).results, []);
  const other = await client.openScope('other'); assert.deepEqual((await client.search('other', other.generation, 'marker_rare_983482')).results, []);
  await client.close();
});

test('persisted hash mismatch, empty events and stale generations fail explicitly', async t => {
  const f = await fixture(t), client = f.client(), scope = 'integrity'; const { generation } = await client.openScope(scope);
  await append(client, scope, generation, 0, ''); assert.equal(await pageText(client, scope, generation, 0), '');
  await client.beginEvent(scope, generation, metadata(1, 'good'));
  await client.appendChunks(scope, generation, 1, 0, ['evil']);
  await assert.rejects(client.finishEvent(scope, generation, 1, 1), { code: 'PERSISTED_HASH_MISMATCH' });
  assert.equal((await client.inspect(scope)).nextSeq, 1);
  const deleted = await client.deleteScope(scope, generation); assert.equal(deleted.generation, generation + 1);
  const reopened = await client.openScope(scope); assert.equal(reopened.generation, generation + 1);
  await assert.rejects(client.page(scope, generation, 0), { code: 'STALE_SCOPE_GENERATION' });
  await assert.rejects(client.inspectEvent(scope, reopened.generation, 0), { code: 'MISSING_EVENT_REFERENCE' });
  assert.equal((await client.inspectPrefix(scope, reopened.generation)).nextSeq, 0); await client.close();
});

test('foreign and existing blank databases are never adopted', async t => {
  const f = await fixture(t); await writeFile(f.path, '');
  let client = f.client(); await assert.rejects(client.ready, { code: 'WRONG_DATABASE_NAMESPACE' }); await client.terminate();
  assert.equal((await readFile(f.path)).length, 0); await assert.rejects(access(f.path + '-wal'));
  await rm(f.path);
  const code = `const {parentPort,workerData}=require('node:worker_threads'); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(workerData);db.exec("CREATE TABLE secrets(value TEXT); INSERT INTO secrets VALUES('foreign-secret')");db.close();parentPort.postMessage(true);`;
  await new Promise((resolve, reject) => { const worker = new Worker(code, { eval: true, workerData: f.path }); worker.on('error', reject); worker.on('exit', value => value === 0 ? resolve() : reject(new Error('fixture failed'))); });
  const before = sha(await readFile(f.path)); client = f.client();
  await assert.rejects(client.ready, { code: 'WRONG_DATABASE_NAMESPACE' }); await client.terminate();
  assert.equal(sha(await readFile(f.path)), before); await assert.rejects(access(f.path + '-wal'));
});
