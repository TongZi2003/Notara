import { expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import * as launches from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';
import { WELCOME_NOTICE_VERSION } from '../../scripts/legacy-settings.ts';
import { writeVaultState } from '../../scripts/vault-launcher-state.ts';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const version = async (dir: string): Promise<string> => JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version;

async function legacyInstallation(root: string) {
  await writeVaultState(root, { kind: 'notara-vault-persistent', version: 1, port: 0, testModel: false });
  for (const [name, version] of [['vault-plugin', '0.11.0'], ['vault-plugin-0.17.2', '0.17.2']]) {
    await mkdir(join(root, name!), { recursive: true });
    await writeFile(join(root, name!, 'package.json'), JSON.stringify({ version }));
  }
  for (const prefix of ['workspace', 'home/profiles/web']) {
    await mkdir(join(root, prefix, 'node_modules/@notara'), { recursive: true });
    await symlink(join(root, 'vault-plugin-0.17.2'), join(root, prefix, 'node_modules/@notara/vault-native'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const pixel = join(root, 'pixel-classroom-plugin-0.3.0', 'index.js');
  await writeFile(join(root, 'home/cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'notara-pixel-classroom', name: pixel }] }]));
  return pixel;
}

test('upgrading a versioned installation switches both module links and keeps the pixel classroom', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-upgrade-versioned-'));
  try {
    const pixel = await legacyInstallation(root);
    const result = await launches.upgradeVaultPersistent(root);
    expect(result.from).toBe('0.17.2');
    expect(await version(join(root, 'vault-plugin-0.17.2'))).toBe('0.17.2');
    for (const prefix of ['workspace', 'home/profiles/web']) {
      expect(await realpath(join(root, prefix, 'node_modules/@notara/vault-native'))).toBe(await realpath(join(root, 'vault-plugin')));
    }
    expect(await readFile(join(root, 'home/cordis.patch.yml'), 'utf8')).toContain(pixel);
    // Reinstalling from another checkout also refreshes dependencies at the same version.
    await rm(join(root, 'vault-plugin/node_modules'));
    await mkdir(join(root, 'retired-dependencies'));
    await symlink(join(root, 'retired-dependencies'), join(root, 'vault-plugin/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await launches.upgradeVaultPersistent(root)).toMatchObject({ upgraded: true, from: result.to, to: result.to });
    expect(await realpath(join(root, 'vault-plugin/node_modules'))).toBe(await realpath(join(checkout, 'node_modules')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an upgrade failure after replacing the patch restores the patch, snapshot and module links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-upgrade-rollback-'));
  try {
    await legacyInstallation(root);
    const patch = await readFile(join(root, 'home/cordis.patch.yml'), 'utf8');
    // A registered synthetic adapter with a broken plugins parent fails after patch installation.
    await writeVaultState(root, { kind: 'notara-vault-persistent', version: 1, port: 0, testModel: true });
    await writeFile(join(root, 'plugins'), 'occupied');
    await expect(launches.upgradeVaultPersistent(root)).rejects.toThrow();
    expect(await readFile(join(root, 'home/cordis.patch.yml'), 'utf8')).toBe(patch);
    await expect(stat(join(root, 'home/profiles/web/cordis.patch.yml'))).rejects.toThrow(/ENOENT/);
    expect(await version(join(root, 'vault-plugin'))).toBe('0.11.0');
    for (const prefix of ['workspace', 'home/profiles/web']) {
      expect(await realpath(join(root, prefix, 'node_modules/@notara/vault-native'))).toBe(await realpath(join(root, 'vault-plugin-0.17.2')));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('vault:upgrade replaces a stopped instance’s plugin snapshot, keeps the old one and every lesson and file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-upgrade-test-'));
  let runtime: launches.VaultRuntime | undefined;
  try {
    runtime = await launches.startVaultPersistent(root, { port: 0, testModel: true });
    const client = await connectVault(runtime);
    const session = await client.createSession();
    await client.rename(session, '升级前的课堂');
    await client.close();
    await writeFile(join(root, 'workspace/vault/保留.md'), '# 保留资料\n');

    // A running instance is never upgraded under its own feet.
    await expect(launches.upgradeVaultPersistent(root)).rejects.toThrow(/正在运行/);
    await runtime.stop(); runtime = undefined;

    // Pretend this instance was created by an older release.
    const plugin = join(root, 'vault-plugin');
    const manifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'));
    await writeFile(join(plugin, 'package.json'), JSON.stringify({ ...manifest, version: '0.0.1-old' }));
    await writeFile(join(plugin, 'old-only.txt'), 'from the old snapshot\n');
    // Releases before 0.21.0 seeded settings.yaml, which DSH 0.2.0 imports into the profile.
    await writeFile(join(root, 'home/settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\nui-theme:\n  mode: system\nui-chat:\n  transcriptView: normal\n');

    // A snapshot from before DSH 0.2.0 is not started until it is upgraded.
    await expect(launches.startVaultPersistent(root)).rejects.toThrow(/vault:upgrade/);
    const result = await launches.upgradeVaultPersistent(root);
    const current = await version(join(checkout, 'examples/native-vault'));
    expect(result).toMatchObject({ upgraded: true, from: '0.0.1-old', to: current });
    expect(await version(plugin)).toBe(current);
    await expect(stat(join(plugin, 'old-only.txt'))).rejects.toThrow(/ENOENT/);
    expect(await readFile(join(result.backup!, 'old-only.txt'), 'utf8')).toBe('from the old snapshot\n');
    expect(await readlink(join(plugin, 'node_modules'))).toBe(join(checkout, 'node_modules'));
    expect(JSON.stringify(JSON.parse(await readFile(join(root, 'home/cordis.patch.yml'), 'utf8')))).toContain('notara-vault-native');
    expect((await launches.vaultVersions(root))).toEqual({ snapshot: current, checkout: current });
    // The two old seeds are what the Vault sets now; the student's own choices are untouched.
    expect(await readFile(join(root, 'home/settings.yaml'), 'utf8')).toBe(`ui-onboarding:\n  welcomeNoticeVersion: ${WELCOME_NOTICE_VERSION}\nui-theme:\n  mode: system\nui-chat:\n  transcriptView: verbose\n`);

    // Nothing to do the second time.
    expect(await launches.upgradeVaultPersistent(root)).toMatchObject({ upgraded: false, from: current, to: current });

    runtime = await launches.startVaultPersistent(root);
    const resumed = await connectVault(runtime);
    expect((await resumed.sessions()).some(row => row.sessionId === session)).toBe(true);
    await resumed.close();
    // DSH imports the file into the profile after its Loader settles.
    const profile = join(root, 'home/profiles/web/cordis.patch.yml');
    await expect.poll(async () => readFile(profile, 'utf8').catch(() => ''), { timeout: 15_000 }).toMatch(/transcriptView: verbose/);
    expect(await readFile(profile, 'utf8')).not.toMatch(/transcriptView: normal/);
    expect(await readFile(join(root, 'workspace/vault/保留.md'), 'utf8')).toBe('# 保留资料\n');
  } finally { await runtime?.stop(); await rm(root, { recursive: true, force: true }); }
});

test('vault:upgrade refuses a directory that is not a Vault instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-upgrade-empty-'));
  try { await expect(launches.upgradeVaultPersistent(root)).rejects.toThrow(/不是已登记的 Vault/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
