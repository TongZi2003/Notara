import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { superviseVault } from '../../scripts/vault-supervisor.ts';
import { connectVault } from '../fixtures/vault-http.ts';
import { futureRelease } from '../fixtures/vault-update-release.ts';
import { managedCode } from '../../scripts/vault-supervisor.ts';

test('the real Host reaches its launcher without exposing the private bridge to the client', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-update-host-'));
  const seed = await startVaultPersistent(root, { testModel: true, port: 0 });
  await seed.stop();
  const runtime = await superviseVault(root, resolve('.'), undefined, { discover: async () => null, prepare: async () => { throw new Error('no release'); } });
  const client = await connectVault({ ...runtime, root, log: () => '', restart: async () => {} });
  try {
    const status = client.value(await client.rpc<{ phase: string; currentVersion: string }>('notaraVault/updateStatus', { input: {} }));
    expect(status.phase).toBe('current');
    expect(status.currentVersion).toBe(JSON.parse(await readFile('examples/native-vault/package.json', 'utf8')).version);
    expect(JSON.stringify(status)).not.toMatch(/NOTARA_UPDATE|Bearer|127\.0\.0\.1|token/i);
    const result = await client.rpc('notaraVault/applyUpdate', { input: {} });
    expect(result.ok).toBe(false);
    await writeFile(join(root, 'workspace/vault/保留.md'), '# 仍在\n');
    expect(await readFile(join(root, 'workspace/vault/保留.md'), 'utf8')).toContain('仍在');
  } finally { await client.close(); await runtime.stop(); await rm(root, { recursive: true, force: true }); }
}, 120_000);

test('a downloaded release installs and restarts the real DSH while keeping a lesson and its files', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-update-install-')), root = join(base, 'runtime');
  const fixture = await futureRelease(base);
  const seed = await startVaultPersistent(root, { testModel: true, port: 0 }); await seed.stop();
  const runtime = await superviseVault(root, resolve('.'), undefined, { discover: async () => fixture.release, prepare: fixture.prepare });
  let client = await connectVault({ ...runtime, root, log: () => '', restart: async () => {} });
  try {
    const sessionId = await client.createSession();
    await client.ask(sessionId, '更新前', { '更新前': '课堂会保留下来。' });
    await client.writeVaultFile('保留.md', '# 保留资料\n');
    await runtime.controller.check();
    expect(runtime.controller.status().phase).toBe('ready');
    await client.close();
    await runtime.controller.apply();
    expect(runtime.controller.status()).toMatchObject({ phase: 'current', currentVersion: fixture.release.version });
    expect(await readFile(join(root, 'vault-plugin/update-marker.txt'), 'utf8')).toBe('synthetic release installed');
    expect(await managedCode(root)).toBeTruthy();
    const launcher = JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8'));
    client = await connectVault({ ...runtime, authUrl: launcher.authUrl, root, log: () => '', restart: async () => {} });
    expect((await client.sessions()).some(row => row.sessionId === sessionId)).toBe(true);
    expect(await client.readVaultFile('保留.md')).toBe('# 保留资料\n');
    await client.ask(sessionId, '更新后', { '更新后': '继续原来的课堂。' });
    expect((await client.turns(sessionId)).length).toBeGreaterThanOrEqual(2);
  } finally { await client.close(); await runtime.stop(); await rm(base, { recursive: true, force: true }); }
}, 240_000);

test('a real next-release startup failure restores the original snapshot and can continue the same lesson', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-update-recovery-')), root = join(base, 'runtime');
  const fixture = await futureRelease(base, { brokenStartup: true });
  const seed = await startVaultPersistent(root, { testModel: true, port: 0 }); await seed.stop();
  const runtime = await superviseVault(root, resolve('.'), undefined, { discover: async () => fixture.release, prepare: fixture.prepare });
  let client = await connectVault({ ...runtime, root, log: () => '', restart: async () => {} });
  try {
    const sessionId = await client.createSession();
    await client.ask(sessionId, '恢复前', { '恢复前': '保留这节课。' });
    await runtime.controller.check();
    expect(runtime.controller.status().phase).toBe('ready');
    await client.close(); await runtime.controller.apply();
    expect(runtime.controller.status().phase).toBe('error');
    const original = JSON.parse(await readFile('examples/native-vault/package.json', 'utf8')).version;
    expect(JSON.parse(await readFile(join(root, 'vault-plugin/package.json'), 'utf8')).version).toBe(original);
    expect(await managedCode(root)).toBeUndefined();
    const launcher = JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8'));
    client = await connectVault({ ...runtime, authUrl: launcher.authUrl, root, log: () => '', restart: async () => {} });
    await client.ask(sessionId, '恢复后', { '恢复后': '旧版本里继续原课。' });
    expect((await client.turns(sessionId)).length).toBeGreaterThanOrEqual(2);
  } finally { await client.close(); await runtime.stop(); await rm(base, { recursive: true, force: true }); }
}, 240_000);
