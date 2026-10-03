import { expect, test } from 'vitest';
import { readyVaultHasStopped } from '../../scripts/remote-vault-health.ts';

test('a ready controller distinguishes a live Vault, a stopped Vault and an unverified service', async () => {
  const ready = () => ({ phase: 'ready', updating: false });
  expect(await readyVaultHasStopped('/synthetic', ready, async () => 'http://127.0.0.1:57093/?token=synthetic')).toBe(false);
  expect(await readyVaultHasStopped('/synthetic', ready, async () => undefined)).toBe(true);
  await expect(readyVaultHasStopped('/synthetic', ready, async () => { throw new Error('Cannot safely verify the saved service'); }))
    .rejects.toThrow('Cannot safely verify');
});

test('startup, normal shutdown and updates do not interpret a temporary missing listener as a crash', async () => {
  for (const state of [{ phase: 'starting', updating: false }, { phase: 'stopping', updating: false }, { phase: 'ready', updating: true }]) {
    let probes = 0;
    expect(await readyVaultHasStopped('/synthetic', () => state, async () => { probes++; return undefined; })).toBe(false);
    expect(probes).toBe(0);
  }
  for (const state of [{ phase: 'stopping', updating: false }, { phase: 'ready', updating: true }]) {
    let phase = 'ready', updating = false;
    expect(await readyVaultHasStopped('/synthetic', () => ({ phase, updating }), async () => {
      phase = state.phase; updating = state.updating; return undefined;
    })).toBe(false);
  }
});
