import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpdateBridge } from './update-runtime.js';

test('a teacher, worker, or background job prevents a restart request', async () => {
  let called = 0;
  const ctx = { get: name => name === 'agents' ? { list: () => [{ status: 'running' }] } : undefined };
  const bridge = createUpdateBridge(ctx, { url: 'http://127.0.0.1:1234', token: 'private' }, async () => { called++; return new Response('{}'); });
  await assert.rejects(bridge.apply(), /课堂或后台任务/);
  assert.equal(called, 0);
});

test('unsupported launchers report honestly and never accept an arbitrary update URL', async () => {
  const bridge = createUpdateBridge({ get: () => undefined }, {});
  assert.equal((await bridge.status()).phase, 'unsupported');
  await assert.rejects(bridge.apply(), /启动器/);
  assert.throws(() => createUpdateBridge({}, { url: 'http://evil.example', token: 'x' }), /更新服务/);
});

test('launcher credentials are retained privately and removed from the shell environment', async () => {
  process.env.NOTARA_UPDATE_URL = 'http://127.0.0.1:1234';
  process.env.NOTARA_UPDATE_TOKEN = 'test-only-private';
  const { createUpdateBridge: factory } = await import('./update-runtime.js?credentials-test');
  assert.equal(process.env.NOTARA_UPDATE_TOKEN, undefined);
  assert.equal(process.env.NOTARA_UPDATE_URL, undefined);
  const bridge = factory({}, undefined, async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer test-only-private');
    return new Response('{"phase":"current"}');
  });
  assert.equal((await bridge.status()).phase, 'current');
});
