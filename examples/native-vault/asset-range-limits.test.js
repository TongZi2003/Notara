import test from 'node:test';
import assert from 'node:assert/strict';
import { NotaraVaultRemote } from './index.js';
import { PDF_RANGE_OPEN_MAX_JOBS } from './media.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('native range opening refuses excess concurrent file scans before starting another job', async () => {
  const remote = Object.create(NotaraVaultRemote.prototype), started = [], gates = [], validationJobCounts = [];
  remote.assetRangeOpenJobs = new Map();
  remote.assetRangeOpenReservations = new Map();
  remote.storeFor = async () => ({
    async validateAssetRange() { validationJobCounts.push(remote.assetRangeOpenJobs.size); return true; },
    openAssetRange(path, owner, requestId, signal) {
      const gate = deferred(); gates.push(gate); started.push({ path, owner, requestId, signal });
      return gate.promise;
    },
  });
  const requests = Array.from({ length: PDF_RANGE_OPEN_MAX_JOBS }, (_, index) => remote.openAssetRange({
    path: '资料/large.pdf', requestId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.length, PDF_RANGE_OPEN_MAX_JOBS);
  assert.equal(remote.assetRangeOpenJobs.size, PDF_RANGE_OPEN_MAX_JOBS);
  assert.deepEqual(validationJobCounts, Array(PDF_RANGE_OPEN_MAX_JOBS).fill(0), 'the size check completes before a hash job is registered');
  await assert.rejects(() => remote.openAssetRange({ path: '资料/large.pdf', requestId: '00000000-0000-4000-8000-000000000005' }), /vault_asset_range_busy/);
  assert.equal(started.length, PDF_RANGE_OPEN_MAX_JOBS);
  gates.forEach((gate, index) => gate.resolve({ rangeId: `lease-${index}` }));
  assert.deepEqual(await Promise.all(requests), gates.map((_, index) => ({ rangeId: `lease-${index}` })));
  assert.equal(remote.assetRangeOpenJobs.size, 0);
});

test('a failed PDF size preflight releases its reservation without starting a stream', async () => {
  const remote = Object.create(NotaraVaultRemote.prototype);
  remote.assetRangeOpenJobs = new Map();
  remote.assetRangeOpenReservations = new Map();
  remote.storeFor = async () => ({
    async validateAssetRange() { throw new Error('vault_pdf_too_large'); },
    async openAssetRange() { assert.fail('oversized assets must not start hashing'); },
  });
  await assert.rejects(() => remote.openAssetRange({ path: '资料/large.pdf', requestId: '00000000-0000-4000-8000-000000000001' }), /vault_pdf_too_large/);
  assert.equal(remote.assetRangeOpenReservations.size, 0);
  assert.equal(remote.assetRangeOpenJobs.size, 0);
});
