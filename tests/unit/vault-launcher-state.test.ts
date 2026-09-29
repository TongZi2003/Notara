import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { liveVaultUrl, mustUpgradeBeforeStart, pluginVersions, writeVaultState } from '../../scripts/vault-launcher-state.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('reports the installed snapshot when older launchers used a versioned directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-version-'));
  roots.push(root);
  for (const [dir, version] of [['vault-plugin', '0.11.0'], ['vault-plugin-0.17.2', '0.17.2'], ['examples/native-vault', '0.21.1']]) {
    await mkdir(join(root, dir!), { recursive: true });
    await writeFile(join(root, dir!, 'package.json'), JSON.stringify({ version }));
  }
  for (const prefix of ['workspace', 'home/profiles/web']) {
    await mkdir(join(root, prefix, 'node_modules/@notara'), { recursive: true });
    await symlink(join(root, 'vault-plugin-0.17.2'), join(root, prefix, 'node_modules/@notara/vault-native'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  expect(await pluginVersions(root, root)).toEqual({ snapshot: '0.17.2', checkout: '0.21.1' });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

describe('a launcher record left behind by a stopped Vault', () => {
  // Windows reuses process ids quickly: after a reboot the recorded pid often
  // belongs to some other live process while nothing listens on the port.
  it('reads as not running when the recorded pid is alive but its port refuses connections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notara-launcher-'));
    roots.push(root);
    const port = await freePort();
    await writeVaultState(root, { kind: 'notara-vault-persistent', version: 1, port, testModel: false });
    await writeFile(join(root, 'launcher.json'), JSON.stringify({ pid: process.pid, authUrl: `http://127.0.0.1:${port}/?token=stale` }));
    await expect(liveVaultUrl(root)).resolves.toBeUndefined();
  });
});

describe('mustUpgradeBeforeStart', () => {
  it('a snapshot from before DSH 0.2.0 does not boot on a 0.21 checkout', () => {
    expect(mustUpgradeBeforeStart({ snapshot: '0.20.2', checkout: '0.21.0' })).toBe(true);
    expect(mustUpgradeBeforeStart({ snapshot: '0.17.2', checkout: '0.22.3' })).toBe(true);
  });
  it('the same side of 0.21.0, or an unknown version, starts as before', () => {
    expect(mustUpgradeBeforeStart({ snapshot: '0.21.0', checkout: '0.21.4' })).toBe(false);
    expect(mustUpgradeBeforeStart({ snapshot: '0.19.9', checkout: '0.20.2' })).toBe(false);
    expect(mustUpgradeBeforeStart({ snapshot: undefined, checkout: '0.21.0' })).toBe(false);
    expect(mustUpgradeBeforeStart({ snapshot: '0.0.1-old', checkout: undefined })).toBe(false);
  });
});
