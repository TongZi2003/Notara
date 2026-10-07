import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { securePrivatePath } from '../../scripts/remote-access-config.ts';
import { isBrowserBlockedPort, liveVaultUrl, mustUpgradeBeforeStart, pluginVersions, readVaultState, upgradeBeforeStartMessage, validateVaultPort, writeVaultState } from '../../scripts/vault-launcher-state.ts';

vi.mock('../../scripts/remote-access-config.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../scripts/remote-access-config.ts')>();
  return { ...actual, securePrivatePath: vi.fn(actual.securePrivatePath) };
});

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
  if (isBrowserBlockedPort(port)) return freePort();
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
  for (const removed of [true, false]) it(removed
    ? 'returns not running when shutdown removes its record during the login probe'
    : 'keeps ACL failures visible while the launcher record still exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'notara-launcher-probe-'));
    roots.push(root);
    const launcher = join(root, 'launcher.json');
    const server = createHttpServer((_request, response) => {
      void (async () => {
        if (removed) await rm(launcher);
        response.writeHead(303, { location: './', 'set-cookie': 'dsh-auth-synthetic=1' });
        response.end();
      })().catch(error => { response.destroy(error); });
    });
    const port = await freePort();
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    try {
      await writeVaultState(root, { kind: 'notara-vault-persistent', version: 1, port, testModel: true });
      await writeFile(launcher, JSON.stringify({ pid: process.pid, authUrl: `http://127.0.0.1:${port}/?token=synthetic` }));
      if (removed) await expect(liveVaultUrl(root)).resolves.toBeUndefined();
      else {
        vi.mocked(securePrivatePath).mockRejectedValueOnce(new Error('synthetic ACL denied'));
        await expect(liveVaultUrl(root)).rejects.toThrow('synthetic ACL denied');
      }
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
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
  it('blocks the 0.24.1 formatVersion 2 boundary, while 0.24.0 remains readable by the old snapshot', () => {
    expect(mustUpgradeBeforeStart({ snapshot: '0.23.12', checkout: '0.24.0' })).toBe(false);
    expect(mustUpgradeBeforeStart({ snapshot: '0.23.12', checkout: '0.24.1' })).toBe(true);
    expect(mustUpgradeBeforeStart({ snapshot: '0.24.0', checkout: '0.24.1' })).toBe(true);
    expect(mustUpgradeBeforeStart({ snapshot: '0.24.1', checkout: '0.24.2' })).toBe(false);
    expect(upgradeBeforeStartMessage({ snapshot: '0.23.12', checkout: '0.24.1' })).toContain('旧版无法读取新版白板');
    expect(upgradeBeforeStartMessage({ snapshot: '0.23.12', checkout: '0.24.1' })).toContain('备份整个数据目录');
  });
});

it('rejects browser-blocked manual ports while keeping automatic selection and normal ports usable', () => {
  for (const port of [22, 6000, 6667, 10080]) expect(() => validateVaultPort(port)).toThrow('被浏览器禁止访问');
  for (const port of [0, 80, 443, 47093, 57093, 65535]) expect(() => validateVaultPort(port)).not.toThrow();
  for (const port of [-1, 1.5, NaN, 65536]) expect(() => validateVaultPort(port)).toThrow('端口必须是 0 到 65535 之间的整数');
  expect(isBrowserBlockedPort(0)).toBe(true);
});

it('can recover an old blocked-port registration by saving a usable override, but never publishes a new blocked port', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-port-state-'));
  roots.push(root);
  const state = { kind: 'notara-vault-persistent' as const, version: 1 as const, port: 6000, testModel: false };
  const path = join(root, 'vault-runtime.json');
  await writeFile(path, JSON.stringify(state));
  expect(await readVaultState(root)).toEqual(state);
  await expect(writeVaultState(root, state)).rejects.toThrow('被浏览器禁止访问');
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(state);
  await writeVaultState(root, { ...state, port: 57093 });
  expect((await readVaultState(root))?.port).toBe(57093);
});
