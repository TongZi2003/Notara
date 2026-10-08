import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ContextHistoryClient } from './context-history-client.js';

const tables = ['source','events','omissions','chunks','postings','termStats','streams','toolCalls'];
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'notara-delete-pressure-')), clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.terminate()));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('notara-delete-pressure-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { path: join(directory, 'private.sqlite'), client() {
    const client = new ContextHistoryClient({ path: this.path }); clients.push(client); return client;
  } };
}
// Direct SQL creates a synthetic owned-row graph so pressure targets physical
// cleanup, independently of canonical formatting and native Host ingestion.
async function probe(path, operation, size = 0) {
  const source = `const {parentPort,workerData}=require('node:worker_threads');
  (async()=>{const {ContextHistoryStore}=await import(workerData.module);const store=new ContextHistoryStore(workerData.path);
    let bound,error,transactions=0,maxChunkRows=0,maxStoredBytes=0;
    const pragmas=()=>({synchronous:store.db.prepare('PRAGMA synchronous').get().synchronous,
      secureDelete:store.db.prepare('PRAGMA secure_delete').get().secure_delete});
    if(workerData.operation==='seed'){
      bound=await store.bindSession('synthetic-pressure','a'.repeat(64),{check(){}});
      const keep=await store.bindSession('synthetic-survivor','b'.repeat(64),{check(){}});
      const event=store.db.prepare("INSERT INTO events(scope,seq,type,role,encoding,hash,chars,bytes,state,chunkCount) VALUES(?,?,'synthetic','user','plain-text',?,?,?,?,?)");
      const stream=store.db.prepare("INSERT INTO streams VALUES(?,?,1,0,0,1,1,'complete')");
      const small='synthetic_receipt_'.padEnd(256,'x'),large='synthetic_prefix_'.padEnd(512,'x')+'中文学习'.repeat(1000),masked=' '.repeat(512)+large.slice(512);
      store.transaction(()=>{
        for(let seq=0;seq<workerData.size;seq++){
          const captured=seq<Math.ceil(workerData.size*5/9),body=seq<Math.floor(workerData.size/9)?large:small;
          event.run(bound.scope,seq,captured?'c'.repeat(64):'',captured?body.length:0,captured?Buffer.byteLength(body):0,captured?'complete':'omitted',captured?1:0);
          if(captured){store.sql.insert.run(bound.scope,seq,0,0,body.length,body,seq<Math.floor(workerData.size/9)?masked:'');stream.run(bound.scope,seq);}
          else store.sql.insertOmission.run(bound.scope,seq,'synthetic-skip');
          if(seq<Math.floor(workerData.size*2/9))store.sql.insertCall.run(bound.scope,seq,0,'synthetic-call-'+seq,'history_read',seq);
        }
        for(let i=0;i<37;i++){store.sql.posting.run(bound.scope,'synthetic-term-'+i,1,0);store.sql.stat.run(bound.scope,'synthetic-term-'+i);}
        store.sql.updateCursor.run(workerData.size,bound.scope);
        event.run(keep.scope,0,'d'.repeat(64),small.length,Buffer.byteLength(small),'complete',1);
        const keepChunk=store.sql.insert.run(keep.scope,0,0,0,small.length,small,null).lastInsertRowid;
        stream.run(keep.scope,0);store.sql.posting.run(keep.scope,'synthetic-term-0',keepChunk,0);store.sql.stat.run(keep.scope,'synthetic-term-0');store.sql.updateCursor.run(1,keep.scope);
      });
    } else if(workerData.operation==='interrupt') {
      const original=store.transaction.bind(store),deleteChunk=store.sql.deleteChunk;
      let rows=0,bytes=0,committedChunkBatch=false;
      store.sql.deleteChunk={run(id,scope){const body=store.db.prepare('SELECT length(CAST(body AS BLOB))+coalesce(length(CAST(search AS BLOB)),0) AS bytes FROM chunks WHERE id=?').get(id);rows++;bytes+=body.bytes;return deleteChunk.run(id,scope);}};
      store.transaction=work=>{rows=0;bytes=0;const value=original(work);transactions++;maxChunkRows=Math.max(maxChunkRows,rows);maxStoredBytes=Math.max(maxStoredBytes,bytes);if(rows)committedChunkBatch=true;return value;};
      try{await store.deleteSessionIds(['synthetic-pressure'],{check(){if(committedChunkBatch)throw Object.assign(new Error('OP_CANCELLED'),{code:'OP_CANCELLED'});}});}catch(caught){error=caught.code;}
    } else if(workerData.operation==='sql-error') {
      const deleteChunk=store.sql.deleteChunk;let deletedRows=0;
      store.sql.deleteChunk={run(id,scope){if(++deletedRows===129)throw Object.assign(new Error('synthetic cleanup SQL failure'),{code:'SYNTHETIC_CLEANUP_SQL_FAILURE'});return deleteChunk.run(id,scope);}};
      try{await store.deleteSessionIds(['synthetic-pressure'],{check(){}});}catch(caught){error=caught.code??caught.message;}
      const afterErrorPragmas=pragmas();
      await store.bindSession('synthetic-later-write','c'.repeat(64),{check(){}});
      const afterWritePragmas=pragmas();
      const scopes=store.db.prepare('SELECT * FROM scopeMeta ORDER BY scope').all(),bindings=store.db.prepare('SELECT * FROM sessionBindings ORDER BY sessionId').all();
      const counts=Object.fromEntries(workerData.tables.map(table=>[table,store.db.prepare('SELECT count(*) AS count FROM '+table+' WHERE scope=(SELECT scope FROM scopeOwners WHERE sessionId=?)').get('synthetic-pressure').count]));
      const survivors=Object.fromEntries(workerData.tables.map(table=>[table,store.db.prepare('SELECT count(*) AS count FROM '+table+' WHERE scope=(SELECT scope FROM scopeOwners WHERE sessionId=?)').get('synthetic-survivor').count]));
      store.close();parentPort.postMessage({bound,error,counts,survivors,scopes,bindings,afterErrorPragmas,afterWritePragmas});return;
    } else if(workerData.operation==='recover') {
      await store.resumeDeletions({check(){}});
      await store.deleteSessionIds(['synthetic-pressure'],{check(){}});
    }
    const scopes=store.db.prepare('SELECT * FROM scopeMeta ORDER BY scope').all(),bindings=store.db.prepare('SELECT * FROM sessionBindings ORDER BY sessionId').all();
    const counts=Object.fromEntries(workerData.tables.map(table=>[table,store.db.prepare('SELECT count(*) AS count FROM '+table+' WHERE scope=(SELECT scope FROM scopeOwners WHERE sessionId=?)').get('synthetic-pressure').count]));
    const survivors=Object.fromEntries(workerData.tables.map(table=>[table,store.db.prepare('SELECT count(*) AS count FROM '+table+' WHERE scope=(SELECT scope FROM scopeOwners WHERE sessionId=?)').get('synthetic-survivor').count]));
    const databasePragmas=pragmas();
    store.close();parentPort.postMessage({bound,error,counts,survivors,scopes,bindings,transactions,maxChunkRows,maxStoredBytes,databasePragmas});
  })().catch(error=>{throw error;});`;
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(source, { eval: true, execArgv: [], workerData: {
      path, operation, size, tables, module: new URL('./context-history-store.js', import.meta.url).href,
    } }); let result;
    worker.on('message', value => { result = value; }); worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolveResult(result) : reject(new Error('synthetic cleanup worker failed')));
  });
}

test('90k owned events with 25KiB receipt projections delete within the default RPC deadline', async t => {
  const f = await fixture(t), seeded = await probe(f.path, 'seed', 90001), client = f.client();
  assert.equal(seeded.counts.events, 90001); assert.equal(seeded.counts.chunks, 50001);
  assert.equal(seeded.counts.toolCalls, 20000); assert.equal(seeded.counts.postings, 37);
  const start = performance.now(); let readyMs;
  void client.ready.then(() => { readyMs = performance.now() - start; });
  assert.deepEqual(await client.deleteSessionIds(['synthetic-pressure']), { state: 'deleted', deletedSessionCount: 1 });
  const totalMs = performance.now() - start;
  t.diagnostic(`worker ready ${Math.round(readyMs)} ms; deletion after ready ${Math.round(totalMs - readyMs)} ms; end-to-end default deadline ${Math.round(totalMs)} ms`);
  await assert.rejects(client.bindSession('synthetic-pressure', 'a'.repeat(64)), { code: 'SESSION_DELETED' });
  await assert.rejects(client.page(seeded.bound.scope, seeded.bound.generation, 0), { code: 'SCOPE_UNAVAILABLE' });
  await client.close(); const deleted = await probe(f.path, 'inspect');
  assert.ok(Object.values(deleted.counts).every(count => count === 0));
  assert.deepEqual(deleted.survivors, seeded.survivors);
  assert.equal(deleted.databasePragmas.synchronous, 2, 'a fresh connection uses FULL synchronous mode');
  assert.equal(deleted.databasePragmas.secureDelete, 1, 'secure deletion remains enabled');
  const restarted = f.client(); await restarted.ready;
  assert.deepEqual(await restarted.deleteSessionIds(['synthetic-pressure']), { state: 'deleted', deletedSessionCount: 1 });
  await assert.rejects(restarted.bindSession('synthetic-pressure', 'a'.repeat(64)), { code: 'SESSION_DELETED' });
});

test('interruption after a bounded cleanup commit preserves tombstone and resumes without touching another scope', async t => {
  const f = await fixture(t), seeded = await probe(f.path, 'seed', 1801), interrupted = await probe(f.path, 'interrupt');
  assert.equal(interrupted.error, 'OP_CANCELLED');
  assert.ok(interrupted.counts.chunks > 0 && interrupted.counts.chunks < seeded.counts.chunks);
  assert.equal(interrupted.counts.events, seeded.counts.events);
  assert.ok(interrupted.maxChunkRows > 8 && interrupted.maxChunkRows <= 128);
  assert.ok(interrupted.maxStoredBytes <= 256 * 1024);
  const tombstone = interrupted.scopes.find(scope => scope.scope === seeded.bound.scope);
  assert.equal(tombstone.state, 'deleting'); assert.equal(tombstone.generation, seeded.bound.generation + 1);
  assert.equal(interrupted.bindings.find(binding => binding.sessionId === 'synthetic-pressure').state, 'deleted');
  assert.deepEqual(interrupted.survivors, seeded.survivors);
  assert.equal(interrupted.databasePragmas.synchronous, 2, 'cancellation restores FULL synchronous mode on the interrupted connection');
  assert.equal(interrupted.databasePragmas.secureDelete, 1, 'cancellation leaves secure deletion enabled');
  const client = f.client(); await client.ready;
  assert.equal((await client.inspect(seeded.bound.scope)).state, 'deleted');
  await assert.rejects(client.bindSession('synthetic-pressure', 'a'.repeat(64)), { code: 'SESSION_DELETED' });
  await client.close(); const recovered = await probe(f.path, 'inspect');
  assert.ok(Object.values(recovered.counts).every(count => count === 0));
  assert.deepEqual(recovered.survivors, seeded.survivors);
  const resumed = await probe(f.path, 'recover');
  assert.ok(Object.values(resumed.counts).every(count => count === 0));
  assert.deepEqual(resumed.survivors, seeded.survivors);
  assert.equal(resumed.databasePragmas.synchronous, 2, 'completed resumed cleanup restores FULL synchronous mode');
  assert.equal(resumed.databasePragmas.secureDelete, 1, 'completed resumed cleanup leaves secure deletion enabled');
});

test('a cleanup SQL error restores durability settings and leaves other scopes intact for recovery', async t => {
  const f = await fixture(t), seeded = await probe(f.path, 'seed', 1801), failed = await probe(f.path, 'sql-error');
  assert.equal(failed.error, 'SYNTHETIC_CLEANUP_SQL_FAILURE');
  const tombstone = failed.scopes.find(scope => scope.scope === seeded.bound.scope);
  assert.equal(tombstone.state, 'deleting');
  assert.equal(tombstone.generation, seeded.bound.generation + 1);
  assert.equal(failed.bindings.find(binding => binding.sessionId === 'synthetic-pressure').state, 'deleted');
  assert.ok(failed.counts.chunks > 0 && failed.counts.chunks < seeded.counts.chunks);
  assert.deepEqual(failed.survivors, seeded.survivors);
  assert.equal(failed.afterErrorPragmas.synchronous, 2, 'SQL failure restores FULL synchronous mode');
  assert.equal(failed.afterErrorPragmas.secureDelete, 1, 'SQL failure preserves secure deletion');
  assert.equal(failed.bindings.find(binding => binding.sessionId === 'synthetic-later-write').state, 'active');
  assert.equal(failed.afterWritePragmas.synchronous, 2, 'a later ordinary write remains in FULL synchronous mode');
  assert.equal(failed.afterWritePragmas.secureDelete, 1, 'a later ordinary write keeps secure deletion enabled');
  const recovered = await probe(f.path, 'recover');
  assert.ok(Object.values(recovered.counts).every(count => count === 0));
  assert.deepEqual(recovered.survivors, seeded.survivors);
  assert.equal(recovered.databasePragmas.synchronous, 2, 'recovery restores FULL synchronous mode');
  assert.equal(recovered.databasePragmas.secureDelete, 1, 'recovery keeps secure deletion enabled');
});
