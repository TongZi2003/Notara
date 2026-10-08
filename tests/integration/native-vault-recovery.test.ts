import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { superviseVault } from '../../scripts/vault-supervisor.ts';
import { liveVaultUrl } from '../../scripts/vault-launcher-state.ts';
import { connectVault } from '../fixtures/vault-http.ts';

test('a crashed real synthetic Host recovers on the same origin, keeps the classroom and login, and stops after repeated crashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-recovery-synthetic-'));
  const seed = await startVaultPersistent(root, { testModel: true, port: 0 }); await seed.stop();
  const runtime = await superviseVault(root, resolve('.'), undefined, {
    discover: async () => null, prepare: async () => { throw new Error('No release in this isolated test'); },
  }, undefined, { recoveryPolicy: { maxRestarts: 3, windowMs: 600_000, delaysMs: [100] } });
  const connect = () => connectVault({ ...runtime, root, log: () => '', restart: async () => {} });
  let client = await connect();
  const launcher = async () => JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8')) as { pid: number; parentPid: number; authUrl: string };
  try {
    const origin = new URL(runtime.authUrl).origin;
    const login = await fetch(runtime.authUrl, { redirect: 'manual' });
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); await login.body?.cancel();
    const session = await client.createSession(); await client.rename(session, 'Synthetic retained lesson');
    await client.ask(session, 'before crash', { 'before crash': 'Synthetic lesson record before recovery.' });
    await client.writeVaultFile('recovery-sentinel.md', '# Synthetic retained material\n');
    await client.close();
    for (let count = 1; count <= 3; count++) {
      const old = await launcher();
      // The pid came from this test's newly seeded root and random port.
      // Never target the real user installation or a shared port.
      if (count === 2) process.kill(old.parentPid, 'SIGKILL');
      else process.kill(old.pid, 'SIGTERM');
      await expect.poll(async () => {
        if (runtime.recoveryStatus().phase !== 'ready' || !(await liveVaultUrl(root))) return false;
        return (await launcher()).pid !== old.pid;
      }, { timeout: 60_000 }).toBe(true);
      expect(runtime.recoveryStatus().restarts).toBe(count);
      expect(new URL(runtime.authUrl).origin).toBe(origin);
      expect(runtime.authUrl !== old.authUrl).toBe(true);
    }
    client = await connect();
    expect((await client.sessions()).some(row => row.sessionId === session)).toBe(true);
    expect(await client.readVaultFile('recovery-sentinel.md')).toBe('# Synthetic retained material\n');
    const cookieResponse = await fetch(origin, { headers: { cookie } }); expect(cookieResponse.status).toBe(200); await cookieResponse.body?.cancel();
    await client.ask(session, 'after crash', { 'after crash': 'Synthetic lesson continued after recovery.' });
    expect((await client.turns(session)).length).toBeGreaterThanOrEqual(2);
    await client.close();
    process.kill((await launcher()).pid, 'SIGKILL');
    await expect.poll(() => runtime.recoveryStatus(), { timeout: 10_000 }).toEqual({ phase: 'failed', restarts: 3, error: 'restart_limit' });
    const events = await readFile(join(root, 'launcher-events.log'), 'utf8');
    expect(events).toContain('restart_limit'); expect(events).not.toMatch(/token|Bearer|http:|Synthetic retained material|Synthetic lesson record/);
    await runtime.stop();
    await expect(stat(join(root, 'launcher.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await liveVaultUrl(root)).toBeUndefined();
  } finally { await client.close(); await runtime.stop(); await rm(root, { recursive: true, force: true }); }
}, 240_000);
