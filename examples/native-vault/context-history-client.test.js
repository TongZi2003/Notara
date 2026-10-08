import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ContextHistoryClient, STREAM_BUDGET, validateRpc, rpcBytes, createHistoryPrefixHasher, historyPrefixFrame } from './context-history-client.js';

async function fixture(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'notara-history-client-'));
  const client = new ContextHistoryClient({ path: join(dir, 'private.sqlite'), ...options });
  t.after(async () => { await client.terminate(); await rm(dir, { recursive: true, force: true }); });
  return client;
}
test('main imports client without importing SQLite; worker-only store rejects main imports', () => {
  const client = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./context-history-client.js', import.meta.url).href)})`], { encoding: 'utf8' });
  assert.equal(client.status, 0); assert.doesNotMatch(client.stderr, /SQLite|ExperimentalWarning/);
  const store = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./context-history-store.js', import.meta.url).href)})`], { encoding: 'utf8' });
  assert.notEqual(store.status, 0); assert.match(store.stderr, /requires a worker/); assert.doesNotMatch(store.stderr, /ExperimentalWarning/);
});
test('strict request shapes are bounded before clone; escaped control characters count bytes', () => {
  assert.throws(() => new ContextHistoryClient({ path: 'relative.sqlite' }), { code: 'INVALID_PRIVATE_DATABASE_PATH' });
  assert.throws(() => validateRpc('appendChunks', ['s', 1, 0, 0, Array(9).fill('a')]), { code: 'INVALID_CHUNK_BATCH' });
  assert.throws(() => validateRpc('skipEvents', ['s', 1, 0, [{ seq: 0, type: 'header', reason: 'header', raw: 'secret' }]]), { code: 'INVALID_SKIP_BATCH' });
  const args = ['s', 1, 0, 0, Array(8).fill('\0'.repeat(8192))]; validateRpc('appendChunks', args);
  assert.ok(rpcBytes('appendChunks', args) > STREAM_BUDGET.rpcBytes);
  assert.equal(Object.hasOwn(STREAM_BUDGET, 'recordBytes'), false);
});
test('startup timeout, startup abort, early termination and calls after exit settle', async t => {
  const slow = await fixture(t, { startupTimeoutMs: 1 });
  await assert.rejects(slow.ready, { code: 'STARTUP_TIMEOUT' }); await slow.terminate();
  const abortClient = await fixture(t), abort = new AbortController();
  const waiting = abortClient.openScope('abort', { signal: abort.signal }); abort.abort();
  await assert.rejects(waiting, { code: 'OP_CANCELLED' }); await abortClient.ready;
  const early = await fixture(t); const wait = early.ready; await early.terminate();
  await assert.rejects(wait, { code: 'WORKER_EXIT' });
  await assert.rejects(early.openScope('dead'), error => ['WORKER_EXIT','CLIENT_CLOSED'].includes(error.code));
  await early.close();
});
test('four in-flight calls enforce backpressure and close safely with occupied reservations', async t => {
  const client = await fixture(t); await client.ready;
  const calls = Array.from({ length: 5 }, (_, i) => client.openScope('queue-' + i));
  const results = await Promise.allSettled(calls);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 4);
  assert.equal(results[4].reason.code, 'RPC_QUEUE_BUDGET');
  const closingCalls = Array.from({ length: 4 }, (_, i) => client.inspect('queue-' + i));
  const settled = Promise.allSettled(closingCalls);
  await client.close(); await settled; assert.equal(client.pending.size, 0);
  await client.close(); await assert.rejects(client.openScope('closed'), error => ['CLIENT_CLOSED','WORKER_EXIT'].includes(error.code));
});
test('prefix shared frame is explicit and rejects gaps/pending state', () => {
  assert.deepEqual(historyPrefixFrame({ seq: 0, state: 'omitted', type: 'header', reason: 'header', role: 'user', hash: 'bad' }), [0,'omitted','header',null,null,null,0,0,'header']);
  const a = createHistoryPrefixHasher(), b = createHistoryPrefixHasher();
  a.append({ seq: 0, state: 'omitted', type: 'header', reason: 'header' });
  b.append({ seq: 0, state: 'omitted', type: 'header', omissionReason: 'header' });
  assert.deepEqual(a.digest(), b.digest());
  assert.throws(() => createHistoryPrefixHasher().append({ seq: 1 }), { code: 'BROKEN_PREFIX_CHAIN' });
  assert.throws(() => createHistoryPrefixHasher().append({ seq: 0, state: 'pending' }), { code: 'BROKEN_PREFIX_CHAIN' });
});
test('prefix scan cancellation and timeout leave complete watermark intact', async t => {
  const client = await fixture(t), scope = 'bounded-prefix'; const { generation } = await client.openScope(scope);
  for (let fromSeq = 0; fromSeq < 20000; fromSeq += 256) {
    const events = Array.from({ length: Math.min(256, 20000 - fromSeq) }, (_, i) => ({ seq: fromSeq + i, type: 'reasoning', reason: 'reasoning' }));
    await client.skipEvents(scope, generation, fromSeq, events);
  }
  const abort = new AbortController(), scan = client.inspectPrefix(scope, generation, null, { signal: abort.signal });
  setTimeout(() => abort.abort(), 5); await assert.rejects(scan, { code: 'OP_CANCELLED' });
  await assert.rejects(client.inspectPrefix(scope, generation, null, { timeoutMs: 1 }), { code: 'OP_TIMEOUT' });
  assert.ok(client.pending.size <= 4);
  assert.equal((await client.inspect(scope)).nextSeq, 20000);
  assert.equal((await client.inspectPrefix(scope, generation)).nextSeq, 20000); await client.close();
});
