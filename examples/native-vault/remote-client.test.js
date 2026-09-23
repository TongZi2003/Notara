import assert from 'node:assert/strict';
import test from 'node:test';

import { VAULT_REMOTE_METHODS, createVaultClient, vaultScope } from './remote-client.js';
import { NotaraVaultRemote } from './index.js';

/** A stand-in for the DSH Remote proxy: a fresh proxy per access (as the real
 * `ctx.remote.notaraVault` does) that records every call. */
function remoteHarness() {
  const calls = [];
  const ctx = {
    remote: {
      get notaraVault() {
        return new Proxy({}, {
          get: (_target, method) => async input => {
            calls.push({ method, input });
            return { ok: true, value: { method, input } };
          },
        });
      },
    },
  };
  return { ctx, calls };
}

test('wrapper mirrors exactly the Remote marker methods', () => {
  const descriptor = Object.getOwnPropertyDescriptor(NotaraVaultRemote.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods');
  const declared = descriptor.value.methods.map(item => item.method).sort();
  assert.deepEqual([...VAULT_REMOTE_METHODS].sort(), declared);
});

test('every Vault method carries the pinned session into the request', async () => {
  const { ctx, calls } = remoteHarness();
  const vault = createVaultClient(ctx, 'lesson-math');
  for (const method of VAULT_REMOTE_METHODS) await vault[method]({ path: '知识/甲.md' });
  assert.equal(calls.length, VAULT_REMOTE_METHODS.length);
  for (const call of calls) assert.equal(call.input.sessionId, 'lesson-math', call.method);
  // 模板与任务也带同一个会话根，不与资产/图谱分成两套。
  assert.equal(calls.find(call => call.method === 'templates').input.sessionId, 'lesson-math');
  assert.equal(calls.find(call => call.method === 'tasks').input.sessionId, 'lesson-math');
});

test('no session yet means no sessionId key, never a fabricated one', async () => {
  const { ctx, calls } = remoteHarness();
  for (const sessionId of [undefined, '', null, 0]) {
    const vault = createVaultClient(ctx, sessionId);
    assert.equal(vault.sessionId, null);
    await vault.list({});
    assert.deepEqual(calls.at(-1), { method: 'list', input: {} });
  }
});

test('the pinned session wins over a caller-supplied one', async () => {
  const { ctx, calls } = remoteHarness();
  const vault = createVaultClient(ctx, 'lesson-math');
  await vault.read({ path: '知识/甲.md', sessionId: 'lesson-physics' });
  assert.equal(calls.at(-1).input.sessionId, 'lesson-math');
});

test('an unpinned client keeps the caller\'s explicit session (a fresh classroom)', async () => {
  const { ctx, calls } = remoteHarness();
  const vault = createVaultClient(ctx, undefined);
  await vault.teachingSettings({ sessionId: 'brand-new-room' });
  assert.equal(calls.at(-1).input.sessionId, 'brand-new-room');
});

test('the Remote envelope passes through unchanged and no key is invented', async () => {
  const { ctx, calls } = remoteHarness();
  const vault = createVaultClient(ctx, 'lesson-math');
  assert.deepEqual(await vault.graph({}), { ok: true, value: { method: 'graph', input: { sessionId: 'lesson-math' } } });
  assert.deepEqual(calls.at(-1).input, { sessionId: 'lesson-math' });
});

test('vaultScope only accepts a real non-empty sessionId', () => {
  assert.deepEqual(vaultScope('lesson-math'), { sessionId: 'lesson-math' });
  assert.deepEqual(vaultScope(''), {});
  assert.deepEqual(vaultScope(undefined), {});
  assert.deepEqual(vaultScope(null), {});
  assert.deepEqual(vaultScope(42), {});
  assert.deepEqual(vaultScope({ sessionId: 'x' }), {});
});
