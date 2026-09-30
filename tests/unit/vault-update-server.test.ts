import { expect, test } from 'vitest';
import { UpdateController } from '../../scripts/vault-updates.ts';
import { startUpdateServer } from '../../scripts/vault-update-server.ts';

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
