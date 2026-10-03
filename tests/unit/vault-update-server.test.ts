import { expect, test, vi } from 'vitest';
import { Server, type AddressInfo } from 'node:net';
import { UpdateController } from '../../scripts/vault-updates.ts';
import { startUpdateServer } from '../../scripts/vault-update-server.ts';
import type { RemoteAccessService } from '../../scripts/remote-access-service.ts';
import { isBrowserBlockedPort } from '../../examples/native-vault/http-port.js';

test('the update bridge does not publish a browser-blocked OS-assigned endpoint', async () => {
  const controller = new UpdateController('0.23.7', '.', {
    discover: async () => null, prepare: async () => '.', stop: async () => {}, upgrade: async () => {}, start: async () => {}, commit: async () => {},
  });
  const actualAddress = Server.prototype.address;
  let rejected = false;
  const inspect = vi.spyOn(Server.prototype, 'address').mockImplementation(function (this: Server) {
    const actual = actualAddress.call(this);
    if (!rejected && actual && typeof actual !== 'string') { rejected = true; return { ...actual, port: 6000 } as AddressInfo; }
    return actual;
  });
  let bridge: Awaited<ReturnType<typeof startUpdateServer>> | undefined;
  try {
    bridge = await startUpdateServer(controller);
    expect(rejected).toBe(true);
    expect(isBrowserBlockedPort(Number(new URL(bridge.url).port))).toBe(false);
    const response = await fetch(bridge.url + '/status', { method: 'POST', headers: { authorization: `Bearer ${bridge.token}` } });
    expect(await response.json()).toMatchObject({ currentVersion: '0.23.7' });
  } finally { inspect.mockRestore(); await bridge?.close(); }
});

test('the private bridge denies browser and unauthenticated control requests', async () => {
  const controller = new UpdateController('0.21.4', '/old', {
    discover: async () => null, prepare: async () => '/new', stop: async () => {}, upgrade: async () => {}, start: async () => {}, commit: async () => {},
  });
  const bridge = await startUpdateServer(controller);
  try {
    expect((await fetch(bridge.url + '/check', { method: 'POST' })).status).toBe(403);
    expect((await fetch(bridge.url + '/check', { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, origin: 'https://example.com' } })).status).toBe(403);
    const response = await fetch(bridge.url + '/status', { method: 'POST', headers: { authorization: `Bearer ${bridge.token}` } });
    expect(await response.json()).toMatchObject({ phase: 'current', currentVersion: '0.21.4' });
  } finally { await bridge.close(); }
});

test('remote bridge requires the private bearer with no Origin and bounds malformed JSON bodies', async () => {
  const controller = new UpdateController('0.0.0', '.', {
    discover: async () => null,
    prepare: async () => '.',
    stop: async () => undefined,
    upgrade: async () => undefined,
    start: async () => undefined,
    commit: async () => undefined,
  });
  let statusCalls = 0;
  const remote: RemoteAccessService = {
    async status() { statusCalls++; return { available: true, phase: 'disabled', configured: false, config: {}, hasPassword: false, hasAuthtoken: false, canDisable: false }; },
    async save() { throw new Error('remote_configuration_invalid'); },
    async enable() { throw new Error('remote_configuration_required'); },
    async disable() { throw new Error('remote_stop_failed'); },
    async close() {},
  };
  const bridge = await startUpdateServer(controller, remote);
  try {
    const call = async (body: string, authorization?: string, origin?: string) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (authorization) headers.authorization = authorization;
      if (origin) headers.origin = origin;
      const response = await fetch(`${bridge.url}/remote/status`, { method: 'POST', headers, body });
      return { status: response.status, value: await response.json().catch(() => undefined) as { code?: string } | undefined };
    };

    expect(await call('{}')).toMatchObject({ status: 403 });
    expect(await call('{}', `Bearer ${bridge.token}`, 'https://untrusted.example')).toMatchObject({ status: 403 });
    expect(await call('{}', 'Bearer incorrect')).toMatchObject({ status: 403 });
    expect(await call('{', `Bearer ${bridge.token}`)).toMatchObject({ status: 400, value: { code: 'remote_input_invalid' } });
    expect(await call(`{"x":"${'a'.repeat(9 * 1024)}"}`, `Bearer ${bridge.token}`)).toMatchObject({ status: 400, value: { code: 'remote_input_invalid' } });
    expect(statusCalls).toBe(0);
    expect(await call('{}', `Bearer ${bridge.token}`)).toMatchObject({ status: 200, value: { phase: 'disabled', canDisable: false } });
    expect(statusCalls).toBe(1);
  } finally { await bridge.close(); }
});
