import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteSettingsBridge, publicRemoteSettings } from './remote-settings-runtime.js';

const status = { available: true, phase: 'disabled', configured: true, config: { publicHost: 'notara-test.ngrok-free.app', username: 'student', ngrokPath: 'ngrok', proxyPort: 57234, ngrokApiPort: 4040 }, hasPassword: true, hasAuthtoken: false };

test('unsupported launchers never attempt network or activate remote access', async () => {
  const bridge = createRemoteSettingsBridge({ url: undefined, token: undefined }, () => { throw new Error('must not fetch'); });
  assert.equal((await bridge.call('status', {})).phase, 'unsupported');
  await assert.rejects(bridge.call('enable', {}), /remote_unsupported/);
});

test('Host forwards only validated actions to the authenticated loopback launcher', async () => {
  const requests = [];
  const bridge = createRemoteSettingsBridge({ url: 'http://127.0.0.1:45678', token: 'private-bridge-token' }, async (url, options) => {
    requests.push({ url, options });
    return Response.json(status);
  });
  await bridge.call('save', { publicHost: status.config.publicHost, username: 'student', password: 'private-password', authtoken: 'private-ngrok-token', proxyPort: 57234 });
  assert.equal(requests[0].url, 'http://127.0.0.1:45678/remote/save');
  assert.equal(requests[0].options.headers.authorization, 'Bearer private-bridge-token');
  assert.equal(requests[0].options.method, 'POST');
  await assert.rejects(bridge.call('status', { password: 'extra' }), /remote_input_invalid/);
  await assert.rejects(bridge.call('save', { publicHost: 'a.ngrok.app', username: 'user', localPort: 57093 }), /remote_input_invalid/);
  await assert.rejects(bridge.call('save', { publicHost: 'a.ngrok.app', username: 'user', proxyPort: 0 }), /remote_input_invalid/);
  await assert.rejects(bridge.call('save', { publicHost: 'a.ngrok.app', username: 'user', ngrokPath: 'bad\npath' }), /remote_input_invalid/);
  assert.equal(requests.length, 1);
  assert.throws(() => createRemoteSettingsBridge({ url: 'https://example.com', token: 'secret' }), /remote_bridge_unavailable/);
});

test('status redaction excludes credentials and rejects unsafe public links', () => {
  const value = publicRemoteSettings({ ...status, phase: 'enabled', url: 'https://notara-test.ngrok-free.app/login', password: 'private-password', authtoken: 'private-ngrok-token', token: 'private-bridge-token', message: 'private-error',
    config: { ...status.config, password: 'nested-password', authtoken: 'nested-token' } });
  assert.equal(value.url, 'https://notara-test.ngrok-free.app/login');
  assert.doesNotMatch(JSON.stringify(value), /private-|nested-/);
  for (const url of ['javascript:alert(1)', 'https://evil.example/login', 'https://notara-test.ngrok-free.app/login?token=leaked', 'https://user:secret@notara-test.ngrok-free.app/login']) {
    assert.equal(publicRemoteSettings({ ...status, phase: 'enabled', url }).url, undefined);
  }
  assert.equal(publicRemoteSettings({ ...status, code: 'unknown-secret' }).code, undefined);
  assert.equal(publicRemoteSettings({ ...status, phase: 'error', canDisable: true, code: 'remote_stop_failed' }).canDisable, true);
});

test('bridge failure surfaces safe codes without response bodies or transport credentials', async () => {
  for (const fetcher of [async () => Response.json({ code: 'private-password', message: 'private-token' }, { status: 500 }), async () => { throw new Error('transport private-token'); }]) {
    const bridge = createRemoteSettingsBridge({ url: 'http://127.0.0.1:45678', token: 'private-token' }, fetcher);
    await assert.rejects(bridge.call('enable', {}), { message: 'remote_bridge_unavailable' });
  }
  const bridge = createRemoteSettingsBridge({ url: 'http://127.0.0.1:45678', token: 'private-token' }, async () => Response.json({ code: 'remote_ngrok_missing' }, { status: 409 }));
  await assert.rejects(bridge.call('enable', {}), { message: 'remote_ngrok_missing' });
});
