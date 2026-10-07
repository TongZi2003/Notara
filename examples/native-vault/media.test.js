import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoundedJobQueue,
  PDF_RANGE_MAX_ACTIVE_REQUESTS,
  PDF_RANGE_MAX_PENDING_REQUESTS,
  PDF_RANGE_OPEN_MAX_JOBS,
  PDF_RANGE_MAX_ACTIVE_PER_LEASE,
  PDF_RANGE_MAX_ACTIVE_PER_STORE,
  remotePdfErrorCode,
} from './media.js';

test('PDF reader restores only known business codes from Typert gateway/internal failures', () => {
  assert.equal(remotePdfErrorCode({ code: 'gateway/internal', message: 'vault_asset_range_busy', details: {} }), 'vault_asset_range_busy');
  assert.equal(remotePdfErrorCode({ code: 'gateway/internal', message: 'vault_asset_range_expired', details: {} }), 'vault_asset_range_expired');
  assert.equal(remotePdfErrorCode({ code: 'gateway/internal', message: 'unclassified host failure', details: {} }), 'gateway/internal');
  assert.equal(remotePdfErrorCode({ code: 'vault_revision_conflict', message: 'revision changed' }), 'vault_revision_conflict');
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('PDF range scheduler deduplicates intervals and bounds active and pending jobs', async () => {
  assert.equal(PDF_RANGE_MAX_ACTIVE_REQUESTS, 2);
  assert.equal(PDF_RANGE_MAX_PENDING_REQUESTS, 8);
  assert.equal(PDF_RANGE_OPEN_MAX_JOBS, 4);
  assert.equal(PDF_RANGE_MAX_ACTIVE_PER_LEASE, 2);
  assert.equal(PDF_RANGE_MAX_ACTIVE_PER_STORE, 4);
  const queue = createBoundedJobQueue({ maxActive: 2, maxPending: 2 });
  const gates = new Map(), started = [];
  const enqueue = key => {
    const gate = deferred(); gates.set(key, gate);
    return queue.enqueue(key, () => { started.push(key); return gate.promise; }, error => { throw error; });
  };
  assert.equal(enqueue('0:1'), 'queued');
  assert.equal(enqueue('1:2'), 'queued');
  assert.deepEqual(started, []);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['0:1', '1:2']);
  assert.equal(enqueue('2:3'), 'queued');
  assert.equal(enqueue('3:4'), 'queued');
  assert.equal(queue.enqueue('2:3', () => assert.fail('duplicate interval must not run'), () => {}), 'duplicate');
  assert.equal(queue.enqueue('4:5', () => {}, () => {}), 'full');
  assert.equal(queue.activeCount, 2);
  assert.equal(queue.pendingCount, 2);
  queue.close();
  assert.equal(queue.pendingCount, 0);
  gates.get('0:1').resolve(); gates.get('1:2').resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['0:1', '1:2']);
  assert.equal(queue.activeCount, 0);
  assert.equal(queue.enqueue('late', () => {}, () => {}), 'closed');

  const noPending = createBoundedJobQueue({ maxActive: 2, maxPending: 0 }), active = [deferred(), deferred()];
  assert.equal(noPending.enqueue('a', () => active[0].promise), 'queued', 'zero pending slots still allow free active slots');
  assert.equal(noPending.enqueue('b', () => active[1].promise), 'queued');
  assert.equal(noPending.enqueue('c', () => Promise.resolve()), 'full', 'zero pending slots reject only after active slots fill');
  noPending.close();
  active.forEach(gate => gate.resolve());
  await new Promise(resolve => setImmediate(resolve));
});
