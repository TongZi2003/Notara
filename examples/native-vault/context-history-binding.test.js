import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { ContextHistoryClient, validateRpc, createHistoryPrefixHasher } from './context-history-client.js';

const sha = text => createHash('sha256').update(text).digest('hex');
const bindingA = sha('synthetic immutable header A'), bindingB = sha('synthetic inherited cut B');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'notara-history-binding-')), clients = [];
  const path = join(dir, 'private.sqlite');
  t.after(async () => { await Promise.all(clients.map(client => client.terminate())); await rm(dir, { recursive: true, force: true }); });
  return { path, client() { const client = new ContextHistoryClient({ path }); clients.push(client); return client; } };
}
async function append(client, bound, text) {
  const meta = { seq: 0, chars: text.length, bytes: Buffer.byteLength(text), hash: sha(text), type: 'message', role: 'user' };
  await client.beginEvent(bound.scope, bound.generation, meta);
  const receipt = await client.appendChunks(bound.scope, bound.generation, 0, 0, [text]);
  await client.finishEvent(bound.scope, bound.generation, 0, receipt.parts); return meta;
}
// Deterministic failure at a check boundary proves the tombstone commit survives interruption.
// SQLite remains inside a worker, and every path below is a synthetic fixture.
async function probe(path, operation = {}) {
  const source = `const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { ContextHistoryStore } = await import(workerData.module);
      const store = new ContextHistoryStore(workerData.path); let checks = 0, value, error;
      try { if (workerData.method) value = await store[workerData.method](...workerData.args, { check() {
        if (++checks === workerData.stopAt) throw Object.assign(new Error(workerData.code), { code: workerData.code });
      } }); } catch (caught) { error = caught.code; }
      const scopes = store.db.prepare('SELECT * FROM scopeMeta ORDER BY scope').all();
      const bindings = store.db.prepare('SELECT * FROM sessionBindings ORDER BY sessionId').all();
      const counts = Object.fromEntries(['source','events','omissions','chunks','postings','termStats','streams'].map(table =>
        [table, store.db.prepare('SELECT count(*) AS count FROM ' + table).get().count]));
      store.close(); parentPort.postMessage({ value, error, scopes, bindings, counts });
    })().catch(error => { throw error; });`;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { path, module: new URL('./context-history-store.js', import.meta.url).href, ...operation } });
    let result; worker.on('message', value => { result = value; }); worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve(result) : reject(new Error('probe worker failed')));
  });
}

test('session binding shapes reject unbounded batches and non-hash identities', () => {
  assert.throws(() => validateRpc('bindSession', ['', bindingA]), { code: 'INVALID_SESSION_ID' });
  assert.throws(() => validateRpc('bindSession', ['synthetic', 'header text']), { code: 'INVALID_SESSION_BINDING' });
  assert.throws(() => validateRpc('deleteSessionIds', [[]]), { code: 'INVALID_SESSION_BATCH' });
  assert.throws(() => validateRpc('deleteSessionIds', [Array(257).fill('synthetic')]), { code: 'INVALID_SESSION_BATCH' });
  assert.throws(() => validateRpc('deleteSessionIds', [['synthetic', null]]), { code: 'INVALID_SESSION_ID' });
});

test('binding survives Host restart, isolates sessions and preserves complete prefix proof', async t => {
  const f = await fixture(t); let client = f.client();
  const first = await client.bindSession('synthetic-A', bindingA), other = await client.bindSession('synthetic-B', bindingA);
  assert.notEqual(first.scope, other.scope); assert.notEqual(first.scope, 'synthetic-A');
  const meta = await append(client, first, 'marker_binding_823920 historical content');
  const expected = createHistoryPrefixHasher().append(meta).digest();
  await client.close(); client = f.client();
  assert.deepEqual(await client.bindSession('synthetic-A', bindingA), first);
  assert.deepEqual(await client.inspectPrefix(first.scope, first.generation), { generation: first.generation, ...expected });
  assert.ok((await client.search(first.scope, first.generation, 'marker_binding_823920')).results.length);
  assert.deepEqual((await client.search(other.scope, other.generation, 'marker_binding_823920')).results, []);
  await client.close();
});

test('changed immutable binding retires old content; prefix reset allocates a new scope', async t => {
  const f = await fixture(t), client = f.client(), first = await client.bindSession('synthetic-A', bindingA);
  await append(client, first, 'marker_binding_reset_23094');
  const next = await client.bindSession('synthetic-A', bindingB);
  assert.notEqual(next.scope, first.scope); assert.equal((await client.inspect(first.scope)).state, 'deleted');
  await assert.rejects(client.page(first.scope, first.generation, 0), { code: 'SCOPE_UNAVAILABLE' });
  await assert.rejects(client.openScope(first.scope), { code: 'SCOPE_UNAVAILABLE' });
  assert.deepEqual((await client.search(next.scope, next.generation, 'marker_binding_reset_23094')).results, []);
  const deleted = await client.deleteScope(next.scope, next.generation);
  assert.equal(deleted.generation, next.generation + 1);
  assert.equal((await client.deleteScope(next.scope, next.generation)).state, 'deleted');
  const reset = await client.bindSession('synthetic-A', bindingB);
  assert.notEqual(reset.scope, next.scope); assert.equal((await client.inspect(reset.scope)).nextSeq, 0);
  await client.close();
});

test('session deletion covers every owned scope and permanently rejects delayed binds', async t => {
  const f = await fixture(t), client = f.client(), first = await client.bindSession('synthetic-A', bindingA);
  await append(client, first, 'marker_delete_owned_23094');
  const next = await client.bindSession('synthetic-A', bindingB), other = await client.bindSession('synthetic-B', bindingA);
  await append(client, next, 'marker_delete_owned_23094 current');
  await append(client, other, 'marker_keep_other_23094');
  const receipt = await client.deleteSessionIds(['synthetic-A', 'synthetic-A', 'never-bound']);
  assert.deepEqual(receipt, { state: 'deleted', deletedSessionCount: 2 });
  assert.deepEqual(await client.deleteSessionIds(['synthetic-A', 'never-bound']), receipt);
  for (const bound of [first, next]) assert.equal((await client.inspect(bound.scope)).state, 'deleted');
  for (const id of ['synthetic-A', 'never-bound']) await assert.rejects(client.bindSession(id, bindingA), { code: 'SESSION_DELETED' });
  assert.ok((await client.search(other.scope, other.generation, 'marker_keep_other_23094')).results.length);
  await client.close();
});

for (const code of ['OP_CANCELLED', 'OP_TIMEOUT']) test(`restart resumes session deletion after committed ${code}`, async t => {
  const f = await fixture(t); let client = f.client();
  const bound = await client.bindSession('synthetic-deleted', bindingA);
  await append(client, bound, 'marker_interrupted_delete_392048'); await client.close();
  const interrupted = await probe(f.path, { method: 'deleteSessionIds', args: [['synthetic-deleted']], stopAt: 3, code });
  assert.equal(interrupted.error, code); assert.equal(interrupted.scopes[0].state, 'deleting');
  assert.equal(interrupted.scopes[0].generation, bound.generation + 1);
  assert.equal(interrupted.bindings[0].state, 'deleted'); assert.equal(interrupted.counts.events, 1);
  client = f.client(); await client.ready;
  assert.equal((await client.inspect(bound.scope)).state, 'deleted');
  await assert.rejects(client.bindSession('synthetic-deleted', bindingA), { code: 'SESSION_DELETED' });
  await assert.rejects(client.page(bound.scope, bound.generation, 0), { code: 'SCOPE_UNAVAILABLE' });
  assert.deepEqual(await client.deleteSessionIds(['synthetic-deleted']), { state: 'deleted', deletedSessionCount: 1 });
  await client.close();
  const recovered = await probe(f.path);
  for (const count of Object.values(recovered.counts)) assert.equal(count, 0);
});

test('binding retry resumes a retirement committed before cancellation without another reset', async t => {
  const f = await fixture(t); let client = f.client();
  const first = await client.bindSession('synthetic-reset', bindingA);
  await append(client, first, 'marker_retirement_482390'); await client.close();
  const interrupted = await probe(f.path, { method: 'bindSession', args: ['synthetic-reset', bindingB], stopAt: 3, code: 'OP_CANCELLED' });
  assert.equal(interrupted.error, 'OP_CANCELLED');
  const committedScope = interrupted.bindings[0].scope;
  assert.notEqual(committedScope, first.scope);
  client = f.client(); const next = await client.bindSession('synthetic-reset', bindingB);
  assert.equal(next.scope, committedScope); assert.equal((await client.inspect(first.scope)).state, 'deleted');
  await client.close();
});

test('unreleased old v1 schema is rejected before journal or schema changes', async t => {
  const f = await fixture(t);
  const source = `const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(workerData);
    db.exec('PRAGMA application_id=1313362737; PRAGMA user_version=1; CREATE TABLE source(scope TEXT PRIMARY KEY,nextSeq INTEGER NOT NULL)');
    db.close(); parentPort.postMessage(true);`;
  await new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: f.path }); worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve() : reject(new Error('fixture failed')));
  });
  const before = sha(await readFile(f.path)), client = f.client();
  await assert.rejects(client.ready, { code: 'WRONG_SCHEMA_SHAPE' }); await client.terminate();
  assert.equal(sha(await readFile(f.path)), before);
});
