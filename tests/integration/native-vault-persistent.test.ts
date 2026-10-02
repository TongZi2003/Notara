import { expect, test } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, stat, realpath, lstat, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as launches from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';
import { relocateVaultRuntime } from '../../scripts/migrate-vault-runtime.ts';
import { liveVaultUrl } from '../../scripts/vault-launcher-state.ts';

test('persistent Vault keeps its origin, browser login, settings, files and classroom across process starts', async () => {
  expect('startVaultPersistent' in launches).toBe(true);
  const root = await mkdtemp(join(tmpdir(), 'notara-persistent-test-'));
  const migrated = root + '-stable';
  let runtime: launches.VaultRuntime | undefined;
  try {
    runtime = await launches.startVaultPersistent(root, { port: 0, testModel: true });
    const origin = new URL(runtime.authUrl).origin, oldUrl = runtime.authUrl;
    const login = await fetch(oldUrl, { redirect: 'manual' });
    expect(login.status).toBe(303);
    expect(await liveVaultUrl(root)).toBe(oldUrl);
    const cookie = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    expect(cookie).not.toBe('');
    // Writable defaults belong to the profile; home overlay fields lock their UI.
    const patchPath = (base: string): string => join(base, 'home/cordis.patch.yml');
    const settings = await readFile(patchPath(root), 'utf8');
    expect(await readFile(join(root, 'home/profiles/web/cordis.patch.yml'), 'utf8')).toContain('welcomeNoticeVersion');
    expect(settings).not.toContain('transcriptView');
    await expect(stat(join(root, 'home/settings.yaml'))).rejects.toThrow(/ENOENT/);
    await writeFile(join(root, 'workspace/vault/保留.md'), '# 保留资料\n');
    const client = await connectVault(runtime);
    const session = await client.createSession();
    await client.rename(session, '保留课堂');
    await client.close();
    await expect(launches.startVaultPersistent(root)).rejects.toThrow(/lock|locked|使用|运行/i);
    await runtime.stop(); runtime = undefined;
    expect(await liveVaultUrl(root)).toBeUndefined();
    await expect(stat(join(root, 'launcher.json'))).rejects.toThrow(/ENOENT/);
    expect(await stat(join(root, 'home/.credentials.yaml')).then(() => true)).toBe(true);
    runtime = await launches.startVaultPersistent(root);
    expect(new URL(runtime.authUrl).origin).toBe(origin);
    expect(runtime.authUrl).not.toBe(oldUrl);
    expect((await fetch(origin, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(oldUrl, { redirect: 'manual' })).status).toBe(401);
    expect((await fetch(runtime.authUrl, { redirect: 'manual' })).status).toBe(303);
    expect(await readFile(patchPath(root), 'utf8')).toBe(settings);
    expect(await readFile(join(root, 'workspace/vault/保留.md'), 'utf8')).toBe('# 保留资料\n');
    const resumed = await connectVault(runtime);
    expect((await resumed.sessions()).some(row => row.sessionId === session)).toBe(true);
    await resumed.close();
    // Windows reports synthetic POSIX mode bits; its native ACL is a separate contract.
    if (process.platform !== 'win32') expect((await stat(join(root, 'launcher.json'))).mode & 0o777).toBe(0o600);
    await runtime.stop(); runtime = undefined;
    await relocateVaultRuntime(root, migrated, Number(new URL(origin).port));
    expect(await realpath(root)).toBe(await realpath(migrated));
    const relocatedPlugin = await realpath(join(migrated, 'vault-plugin'));
    for (const pluginLink of [
      join(migrated, 'workspace/node_modules/@notara/vault-native'),
      join(migrated, 'home/profiles/web/node_modules/@notara/vault-native'),
    ]) expect(await realpath(pluginLink)).toBe(relocatedPlugin);
    // The plugin snapshot's dependency junction points outside the moved
    // runtime and must still resolve to this checkout's installed modules.
    expect(await realpath(join(migrated, 'vault-plugin/node_modules'))).toBe(await realpath(join(process.cwd(), 'node_modules')));
    runtime = await launches.startVaultPersistent(migrated);
    expect((await fetch(origin, { headers: { cookie } })).status).toBe(200);
    const moved = await connectVault(runtime);
    expect((await moved.sessions()).some(row => row.sessionId === session)).toBe(true);
    expect((await moved.ask(session, '继续课堂', { '继续课堂': '课堂已续接。' })).length).toBeGreaterThan(0);
    await moved.close();
    expect(await readFile(patchPath(migrated), 'utf8')).toBe(settings);
    expect(await readFile(join(migrated, 'workspace/vault/保留.md'), 'utf8')).toBe('# 保留资料\n');
  } finally { await runtime?.stop(); for (const path of [root, migrated, root + '.pre-persistent']) await rm(path, { recursive: true, force: true }); }
}, 120_000);

test('failed relocation restores the source and removes its partial copy', async () => {
  const source = await mkdtemp(join(tmpdir(), 'notara-migration-rollback-'));
  const destination = source + '-stable';
  const linked = join(source, 'linked-directory');
  const target = join(source, 'real-directory');
  try {
    await mkdir(join(source, 'home/storages'), { recursive: true });
    await mkdir(target);
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(source, 'home/storages/workspace.json'), '{"tables":{}}');

    await expect(relocateVaultRuntime(source, destination, 57101)).rejects.toThrow('Unsupported workspace registry');

    const sourceInfo = await lstat(source);
    expect(sourceInfo.isDirectory()).toBe(true);
    expect(sourceInfo.isSymbolicLink()).toBe(false);
    expect(await readFile(join(source, 'home/storages/workspace.json'), 'utf8')).toBe('{"tables":{}}');
    expect(await realpath(linked)).toBe(await realpath(target));
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(source + '.pre-persistent')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    for (const path of [source, destination, source + '.pre-persistent']) await rm(path, { recursive: true, force: true });
  }
});
