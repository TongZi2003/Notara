import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { ContextHistoryClient, createHistoryPrefixHasher, historyPrefixFrame, validateRpc } from './context-history-client.js';
import { NATIVE_HISTORY_SEARCH_POLICY } from './context-history-search-policy.js';

const sha = text => createHash('sha256').update(text).digest('hex');
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'notara-history-search-store-')), path = join(directory, 'private.sqlite'), clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.terminate()));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('notara-history-search-store-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { path, client() { const client = new ContextHistoryClient({ path }); clients.push(client); return client; } };
}
const item = (seq, body, search = body, identity = {}, type = 'user/message') => ({ kind: 'record', body, search,
  metadata: { seq, type, role: type.startsWith('tool/') ? 'tool' : 'user', encoding: 'native-event-v1', chars: body.length,
    bytes: Buffer.byteLength(body), hash: sha(body), search: { policy: NATIVE_HISTORY_SEARCH_POLICY, hash: sha(search), ...identity } } });
async function sqlite(path, sql, inspect = false) {
  const source = `const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(workerData.path);if(workerData.sql)db.exec(workerData.sql);
    let result=true;if(workerData.inspect)result={version:db.prepare('PRAGMA user_version').get().user_version,
      counts:Object.fromEntries(['source','events','omissions','chunks','postings','termStats','streams','toolCalls'].map(table=>[table,db.prepare('SELECT count(*) AS count FROM '+table).get().count])),
      schemas:db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name").all(),
      chunks:db.prepare('SELECT part,search FROM chunks ORDER BY id LIMIT 4').all(),
      chunkPostings:db.prepare('SELECT c.seq,c.part,count(p.chunkId) AS postings FROM chunks c LEFT JOIN postings p ON p.scope=c.scope AND p.chunkId=c.id GROUP BY c.id ORDER BY c.id LIMIT 128').all(),
      stats:db.prepare('SELECT scope,term,df FROM termStats ORDER BY scope,term LIMIT 128').all()};
    db.close();parentPort.postMessage(result);`;
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { path, sql, inspect }, execArgv: [] }); let result;
    worker.on('message', value => { result = value; }); worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolveResult(result) : reject(new Error('synthetic SQLite fixture failed')));
  });
}
async function append(client, scope, generation, record) {
  let receipt = await client.beginEvent(scope, generation, record.metadata);
  for (let offset = 0; offset < record.body.length;) {
    let end = Math.min(record.body.length, offset + 8192);
    if (end < record.body.length && /[\uD800-\uDBFF]/.test(record.body[end - 1])) end--;
    receipt = await client.appendChunks(scope, generation, record.metadata.seq, receipt.offset,
      [{ body: record.body.slice(offset, end), search: record.search.slice(offset, end) }]); offset = end;
  }
  return client.finishEvent(scope, generation, record.metadata.seq, receipt.parts);
}

test('masked search preserves native offsets and original canonical page bytes', async t => {
  const f = await fixture(t), client = f.client(), scope = 'masked-evidence', { generation } = await client.openScope(scope);
  const hidden = 'hidden_invocation_marker_39182', visible = ' visible_evidence_marker_18239 中文😀 original text';
  const record = item(0, hidden + visible, ' '.repeat(hidden.length) + visible);
  await client.appendEventBatch(scope, generation, 0, [record]);
  const hits = await client.search(scope, generation, 'visible_evidence_marker_18239');
  assert.ok(hits.results.length); assert.equal(hits.results[0].hitStart, record.body.indexOf('visible_evidence_marker_18239'));
  assert.ok(hits.results.every(hit => !hit.preview.includes(hidden)));
  const missing = await client.search(scope, generation, hidden);
  assert.deepEqual(missing.results, []); assert.equal(missing.diagnostics.anchors, 0); assert.equal(missing.diagnostics.candidates, 0);
  const page = await client.page(scope, generation, 0);
  assert.equal(page.rows[0].body, record.body); assert.equal(sha(page.rows[0].body), record.metadata.hash);
  assert.deepEqual(page.event.search, record.metadata.search);
  const expected = createHistoryPrefixHasher().append(record.metadata).digest();
  assert.deepEqual(await client.inspectPrefix(scope, generation), { generation, ...expected });
  const reordered = { ...record.metadata, search: { hash: record.metadata.search.hash, policy: NATIVE_HISTORY_SEARCH_POLICY } };
  assert.deepEqual(historyPrefixFrame(record.metadata), historyPrefixFrame(reordered));
  assert.notDeepEqual(historyPrefixFrame(record.metadata), historyPrefixFrame({ ...record.metadata, search: undefined }));
  await client.close();
});

test('all-space projections have no features even when a neighboring chunk contains evidence', async t => {
  const f = await fixture(t), client = f.client(), scope = 'blank-projection', { generation } = await client.openScope(scope);
  const body = 'hidden_blank_marker_21983'.padEnd(8192, 'x') + 'visible_neighbor_marker_29183';
  const record = item(0, body, ' '.repeat(8192) + body.slice(8192));
  await append(client, scope, generation, record);
  assert.deepEqual((await client.search(scope, generation, 'hidden_blank_marker_21983')).results, []);
  assert.ok((await client.search(scope, generation, 'visible_neighbor_marker_29183')).results.length);
  await client.close();
  const inspected = await sqlite(f.path, undefined, true);
  assert.equal(inspected.chunks[0].search, '');
  assert.equal(inspected.chunkPostings[0].postings, 0, 'blank chunks cannot consume candidate postings from their neighbors');
});

test('causal same-scope native pairing excludes history result postings and survives restart', async t => {
  const f = await fixture(t); let client = f.client(); const scope = 'paired-results', otherScope = 'other-results';
  const { generation } = await client.openScope(scope), other = await client.openScope(otherScope);
  const call = (seq, name, turn) => item(seq, `native_call_${seq}`, ' '.repeat(`native_call_${seq}`.length), { call: { callId: 'same-call', name, turn, step: 0 } }, 'tool/call');
  const result = (seq, text, turn) => item(seq, text, text, { result: { callId: 'same-call', turn, step: 0 } }, 'tool/result');
  const records = [call(0, 'history_read', 0), result(1, 'excluded_history_result_marker_32910', 0),
    call(2, 'vault_read', 1), result(3, 'ordinary_result_marker_93210', 1), result(4, 'unresolved_result_marker_23109', 2),
    result(5, 'before_future_call_marker_21093', 3), call(6, 'history_search', 3), result(7, 'after_history_call_marker_93201', 3)];
  await client.appendEventBatch(scope, generation, 0, records);
  await client.appendEventBatch(otherScope, other.generation, 0, [result(0, 'foreign_scope_result_marker_23091', 0)]);
  await client.close(); client = f.client();
  for (const query of ['excluded_history_result_marker_32910', 'after_history_call_marker_93201']) {
    const search = await client.search(scope, generation, query);
    assert.deepEqual(search.results, []); assert.equal(search.diagnostics.anchors, 0); assert.equal(search.diagnostics.candidates, 0);
  }
  for (const query of ['ordinary_result_marker_93210','unresolved_result_marker_23109','before_future_call_marker_21093']) assert.ok((await client.search(scope, generation, query)).results.length, query);
  assert.ok((await client.search(otherScope, other.generation, 'foreign_scope_result_marker_23091')).results.length);
  assert.equal((await client.page(scope, generation, 1)).rows[0].body, records[1].body);
  await assert.rejects(client.appendEventBatch(scope, generation, 8, [call(8, 'vault_read', 0)]), { code: 'CONFLICTING_SEARCH_CALL_IDENTITY' });
  assert.equal((await client.inspect(scope)).nextSeq, 8);
  const classified = await sqlite(f.path, undefined, true);
  for (const seq of [1,7]) assert.equal(classified.chunkPostings.find(row => row.seq === seq).postings, 0);
  for (const query of ['excluded_history_result_marker_32910','after_history_call_marker_93201']) {
    assert.equal(classified.stats.find(row => row.scope === scope && row.term === `e:${sha(query)}`), undefined, 'excluded results cannot inflate termStats');
  }
  for (const seq of [3,4,5]) assert.ok(classified.chunkPostings.find(row => row.seq === seq).postings > 0);
  await client.deleteScope(scope, generation); await client.deleteScope(otherScope, other.generation); await client.close();
  const inspected = await sqlite(f.path, undefined, true);
  for (const count of Object.values(inspected.counts)) assert.equal(count, 0);
});

test('late projection hash failure rolls back the entire mixed batch including call classification', async t => {
  const f = await fixture(t), client = f.client(), scope = 'search-hash-rollback', { generation } = await client.openScope(scope);
  const first = item(0, 'call_raw_marker_91382', ' '.repeat('call_raw_marker_91382'.length), { call: { callId: 'rollback-call', name: 'history_read', turn: 0, step: 0 } }, 'tool/call');
  const last = item(1, 'visible_bad_search_hash_31829'); last.metadata.search.hash = sha('wrong masked stream');
  await assert.rejects(client.appendEventBatch(scope, generation, 0, [first, last]), { code: 'PERSISTED_SEARCH_HASH_MISMATCH' });
  assert.equal((await client.inspect(scope)).nextSeq, 0); await client.close();
  const inspected = await sqlite(f.path, undefined, true);
  for (const table of ['events','chunks','postings','termStats','streams','toolCalls']) assert.equal(inspected.counts[table], 0);
});

test('stream finish validates search hash; resume refuses changed projection or native identity', async t => {
  const f = await fixture(t), client = f.client(), scope = 'search-stream-validation', { generation } = await client.openScope(scope);
  const hidden = 'stream_raw_marker_21093 ', record = item(0, hidden + 'x'.repeat(9000), ' '.repeat(hidden.length) + 'x'.repeat(9000));
  record.metadata.search.hash = sha('incorrect projection');
  await client.beginEvent(scope, generation, record.metadata);
  await client.appendChunks(scope, generation, 0, 0, [{ body: record.body.slice(0, 8192), search: record.search.slice(0, 8192) }]);
  const receipt = await client.appendChunks(scope, generation, 0, 8192, [{ body: record.body.slice(8192), search: record.search.slice(8192) }]);
  await assert.rejects(client.finishEvent(scope, generation, 0, receipt.parts), { code: 'PERSISTED_SEARCH_HASH_MISMATCH' });
  assert.equal((await client.inspect(scope)).nextSeq, 0);
  await assert.rejects(client.beginEvent(scope, generation, { ...record.metadata, search: { ...record.metadata.search, hash: sha(record.search) } }), { code: 'RESUME_SOURCE_MISMATCH' });
  await client.deleteScope(scope, generation); const reopened = await client.openScope(scope);
  const descriptor = item(0, 'native identity raw', 'native identity raw', { result: { callId: 'exact-call', turn: 0, step: 0 } }, 'tool/result');
  await client.beginEvent(scope, reopened.generation, descriptor.metadata);
  await assert.rejects(client.beginEvent(scope, reopened.generation, { ...descriptor.metadata, search: { ...descriptor.metadata.search, result: { callId: 'changed-call', turn: 0, step: 0 } } }), { code: 'RESUME_SOURCE_MISMATCH' });
  await assert.rejects(client.appendChunks(scope, reopened.generation, 0, 0, [descriptor.body]), { code: 'SEARCH_PROJECTION_REQUIRED' });
  await client.close();
});

test('projection validation rejects fabricated characters and split surrogate masking before cloning', () => {
  const record = item(0, 'abc😀', 'abc  ');
  validateRpc('appendEventBatch', ['s', 1, 0, [record]]);
  assert.throws(() => validateRpc('appendChunks', ['s', 1, 0, 0, [{ body: 'abc', search: 'xyz' }]]), { code: 'INVALID_SEARCH_PROJECTION' });
  assert.throws(() => validateRpc('appendChunks', ['s', 1, 0, 0, [{ body: '😀', search: '\ud83d ' }]]), { code: 'INVALID_SEARCH_PROJECTION' });
  assert.throws(() => validateRpc('beginEvent', ['s', 1, { ...record.metadata, search: { ...record.metadata.search, result: { callId: 'a', turn: -0, step: 0 } } }]), { code: 'INVALID_SEARCH_IDENTITY' });
  assert.throws(() => validateRpc('appendEventBatch', ['s', 1, 0, [{ ...record, search: undefined }]]), { code: 'SEARCH_PROJECTION_REQUIRED' });
});

// Frozen exact previous v1 DDL, independent from the implementation's migration.
const v1Schema = `PRAGMA application_id=1313362737; PRAGMA user_version=1;
CREATE TABLE source(scope TEXT PRIMARY KEY,nextSeq INTEGER NOT NULL);
CREATE TABLE events(scope TEXT NOT NULL,seq INTEGER NOT NULL,type TEXT NOT NULL,role TEXT NOT NULL,encoding TEXT NOT NULL,hash TEXT NOT NULL,chars INTEGER NOT NULL,bytes INTEGER NOT NULL,state TEXT NOT NULL,chunkCount INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,seq));
CREATE TABLE omissions(scope TEXT NOT NULL,seq INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(scope,seq));
CREATE TABLE chunks(id INTEGER PRIMARY KEY,scope TEXT NOT NULL,seq INTEGER NOT NULL,part INTEGER NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(scope,seq,part));
CREATE INDEX chunks_page ON chunks(scope,seq,part); CREATE INDEX chunks_scope_id ON chunks(scope,id);
CREATE TABLE postings(scope TEXT NOT NULL,term TEXT NOT NULL,chunkId INTEGER NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(scope,term,chunkId)) WITHOUT ROWID;
CREATE INDEX postings_chunk ON postings(scope,chunkId);
CREATE TABLE termStats(scope TEXT NOT NULL,term TEXT NOT NULL,df INTEGER NOT NULL,PRIMARY KEY(scope,term)) WITHOUT ROWID;
CREATE TABLE scopeMeta(scope TEXT PRIMARY KEY,generation INTEGER NOT NULL,state TEXT NOT NULL); CREATE INDEX scopes_state ON scopeMeta(state,scope);
CREATE TABLE sessionBindings(sessionId TEXT PRIMARY KEY,bindingHash TEXT,scope TEXT,state TEXT NOT NULL);
CREATE TABLE scopeOwners(scope TEXT PRIMARY KEY,sessionId TEXT NOT NULL); CREATE INDEX owners_session ON scopeOwners(sessionId,scope);
CREATE TABLE streams(scope TEXT NOT NULL,seq INTEGER NOT NULL,generation INTEGER NOT NULL,offset INTEGER NOT NULL,receivedBytes INTEGER NOT NULL,parts INTEGER NOT NULL,indexedParts INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(scope,seq));`;

test('exact current v1 migrates additively while preserving content, scope ownership and deletion tombstones', async t => {
  const f = await fixture(t), body = 'legacy_v1_original_marker_21039', binding = sha('v1 synthetic immutable header'), term = `e:${sha(body)}`;
  await sqlite(f.path, v1Schema + `
    INSERT INTO scopeMeta VALUES('legacy-scope',1,'active'),('deleted-scope',2,'deleted'); INSERT INTO source VALUES('legacy-scope',1);
    INSERT INTO sessionBindings VALUES('synthetic-v1','${binding}','legacy-scope','active'),('synthetic-v1-deleted',NULL,NULL,'deleted');
    INSERT INTO scopeOwners VALUES('legacy-scope','synthetic-v1'),('deleted-scope','synthetic-v1-deleted');
    INSERT INTO events VALUES('legacy-scope',0,'message','user','plain-text','${sha(body)}',${body.length},${body.length},'complete',1);
    INSERT INTO chunks VALUES(1,'legacy-scope',0,0,0,${body.length},'${body}');
    INSERT INTO streams VALUES('legacy-scope',0,1,${body.length},${body.length},1,1,'complete');
    INSERT INTO postings VALUES('legacy-scope','${term}',1,0); INSERT INTO termStats VALUES('legacy-scope','${term}',1);`);
  const client = f.client(); await client.ready;
  const bound = await client.bindSession('synthetic-v1', binding);
  assert.deepEqual(bound, { scope: 'legacy-scope', generation: 1, state: 'active' });
  assert.equal((await client.page(bound.scope, bound.generation, 0)).rows[0].body, body);
  assert.ok((await client.search(bound.scope, bound.generation, body)).results.length);
  const expected = createHistoryPrefixHasher().append({ seq: 0, type: 'message', role: 'user', encoding: 'plain-text', hash: sha(body), chars: body.length, bytes: body.length }).digest();
  assert.deepEqual(await client.inspectPrefix(bound.scope, bound.generation), { generation: 1, ...expected });
  await assert.rejects(client.bindSession('synthetic-v1-deleted', binding), { code: 'SESSION_DELETED' });
  await assert.rejects(client.openScope('deleted-scope'), { code: 'SCOPE_UNAVAILABLE' });
  await client.close();
  const inspected = await sqlite(f.path, undefined, true);
  assert.equal(inspected.version, 2); assert.equal(inspected.chunks[0].search, null); assert.equal(inspected.counts.events, 1);
  const restarted = f.client(); await restarted.ready;
  assert.equal((await restarted.page(bound.scope, bound.generation, 0)).rows[0].body, body);
  const replacement = await restarted.bindSession('synthetic-v1', sha('new native evidence policy header'));
  assert.notEqual(replacement.scope, bound.scope); assert.equal((await restarted.inspect(bound.scope)).state, 'deleted');
  await restarted.close();
});

test('v1 lookalike column names with unknown DDL are rejected before migration or journal modification', async t => {
  const f = await fixture(t);
  await sqlite(f.path, v1Schema.replace('nextSeq INTEGER NOT NULL', 'nextSeq TEXT NOT NULL'));
  const before = sha(await readFile(f.path)), client = f.client();
  await assert.rejects(client.ready, { code: 'WRONG_SCHEMA_SHAPE' }); await client.terminate();
  assert.equal(sha(await readFile(f.path)), before); await assert.rejects(access(f.path + '-wal'));
});

test('unknown v2 DDL is not adopted even when every table and column name matches', async t => {
  const f = await fixture(t);
  await sqlite(f.path, v1Schema.replace('df INTEGER NOT NULL', 'df TEXT NOT NULL') + `
    ALTER TABLE events ADD COLUMN search TEXT; ALTER TABLE chunks ADD COLUMN search TEXT;
    CREATE TABLE toolCalls(scope TEXT NOT NULL,turn INTEGER NOT NULL,step INTEGER NOT NULL,callId TEXT NOT NULL,name TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(scope,turn,step,callId)) WITHOUT ROWID;
    CREATE INDEX calls_event ON toolCalls(scope,seq); PRAGMA user_version=2;`);
  const before = sha(await readFile(f.path)), rejected = f.client();
  await assert.rejects(rejected.ready, { code: 'WRONG_SCHEMA_SHAPE' }); await rejected.terminate();
  assert.equal(sha(await readFile(f.path)), before);
});
