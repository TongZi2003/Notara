import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, expect, test, vi } from 'vitest';
import { acquireCachedCodeLease, cleanupPreparedReleaseCache, collectReleaseCache, compareVersions, parseRelease, extractRelease, releaseCachedCodeLease, UpdateController } from '../../scripts/vault-updates.ts';

const runtime = { dsh: '0.2.0-rc.1', cordis: '4.0.4', dataVersion: 4 };
const asset = (name: string) => ({ name, browser_download_url: `https://github.com/TongZi2003/Notara/releases/download/v0.21.5/${name}` });
const manifest = { format: 1, version: '0.21.5', runtime, archive: 'notara-0.21.5.zip', sha256: 'a'.repeat(64) };
const release = { tag_name: 'v0.21.5', prerelease: false, draft: false, html_url: 'https://github.com/TongZi2003/Notara/releases/tag/v0.21.5', assets: [asset('notara-update.json'), asset(manifest.archive)] };
const roots: string[] = [];
const execFileAsync = promisify(execFile);
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function writeLegacyCacheCode(path: string, packageVersion: string): Promise<void> {
  await mkdir(join(path, 'examples/native-vault'), { recursive: true });
  await mkdir(join(path, 'docs/runtime'), { recursive: true });
  await writeFile(join(path, 'package.json'), JSON.stringify({ devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.1', '@deepseek-ai/cordis': '4.0.4' } }));
  await writeFile(join(path, 'examples/native-vault/package.json'), JSON.stringify({ version: packageVersion }));
  await writeFile(join(path, 'docs/runtime/update-contract.json'), JSON.stringify({ dataVersion: 5 }));
}

test('only a newer stable version with a matching release manifest is offered', () => {
  expect(compareVersions('0.21.10', '0.21.9')).toBe(1);
  expect(compareVersions('0.23.13-dev.4', '0.23.12')).toBe(1);
  expect(compareVersions('0.23.13-dev.4', '0.23.13-dev.5')).toBe(-1);
  expect(compareVersions('0.24.1', '0.23.13-dev.5')).toBe(1);
  expect(compareVersions('0.23.13', '0.23.13-dev.4')).toBe(1);
  expect(compareVersions('0.23.13-dev.4', '0.23.13-dev.4')).toBe(0);
  expect(parseRelease(release, manifest, '0.21.4', runtime)?.version).toBe('0.21.5');
  expect(parseRelease(release, manifest, '0.21.5-dev.4', runtime)?.version).toBe('0.21.5');
  const nextVersion = '0.24.1';
  const nextAsset = (name: string) => ({ name, browser_download_url: `https://github.com/TongZi2003/Notara/releases/download/v${nextVersion}/${name}` });
  const nextManifest = { ...manifest, version: nextVersion, archive: `notara-${nextVersion}.zip`, runtime: { ...runtime, dataVersion: 5 } };
  const nextRelease = { ...release, tag_name: `v${nextVersion}`, html_url: `https://github.com/TongZi2003/Notara/releases/tag/v${nextVersion}`, assets: [nextAsset('notara-update.json'), nextAsset(nextManifest.archive)] };
  expect(parseRelease(nextRelease, nextManifest, '0.23.12', runtime)?.compatible).toBe(false);
  expect(parseRelease(release, manifest, nextVersion, runtime)).toBeNull();
  expect(parseRelease({ ...release, prerelease: true }, manifest, '0.21.4', runtime)).toBeNull();
  expect(parseRelease(release, manifest, '0.21.5', runtime)).toBeNull();
  expect(() => parseRelease(release, { ...manifest, version: '0.21.6' }, '0.21.4', runtime)).toThrow();
  expect(() => parseRelease({ ...release, assets: [asset('notara-update.json'), { ...asset(manifest.archive), browser_download_url: 'https://example.com/evil.zip' }] }, manifest, '0.21.4', runtime)).toThrow();
  expect(parseRelease(release, { ...manifest, runtime: { ...runtime, dataVersion: 5 } }, '0.21.4', runtime)?.compatible).toBe(false);
  expect(() => compareVersions('01.2.3', '1.2.3')).toThrow(/格式/);
  expect(() => compareVersions('9007199254740993.0.0', '1.0.0')).toThrow(/格式/);
  expect(() => compareVersions('0.23.13-dev.01', '0.23.13')).toThrow(/格式/);
});

test('partial stop failures restore the old Host and repeated recovery failure is reported honestly', async () => {
  for (const recoveryFails of [false, true]) {
    const calls: string[] = []; let stopped = 0;
    const controller = new UpdateController('0.21.4', '/old', {
      discover: async () => parseRelease(release, manifest, '0.21.4', runtime), prepare: async () => '/new',
      stop: async () => { calls.push('stop'); stopped++; if (stopped === 1 || recoveryFails) throw new Error('worker already stopped; remote cleanup failed'); },
      upgrade: async code => { calls.push(`upgrade:${code}`); }, start: async code => { calls.push(`start:${code}`); }, commit: async () => { calls.push('commit'); },
    });
    await controller.check(); await controller.apply();
    expect(controller.status()).toMatchObject({ phase: 'error', currentVersion: '0.21.4' });
    expect(calls).toEqual(recoveryFails ? ['stop', 'stop'] : ['stop', 'stop', 'upgrade:/old', 'start:/old']);
    expect(controller.status().message).toContain(recoveryFails ? '原版本也未能启动' : '已恢复原版本');
    await controller.close();
  }
});

test('the public launch identity stays stable through checks and changes with a fresh launcher', async () => {
  const operations = { discover: async () => null, prepare: async () => '/unused', stop: async () => {}, upgrade: async () => {}, start: async () => {}, commit: async () => {} };
  const first = new UpdateController('0.21.4', '/old', operations), second = new UpdateController('0.21.4', '/old', operations);
  const launchId = first.status().launchId;
  expect(launchId).toMatch(/^[a-f0-9-]{36}$/);
  await first.check();
  expect(first.status().launchId).toBe(launchId);
  expect(second.status().launchId).not.toBe(launchId);
  await Promise.all([first.close(), second.close()]);
});

test('a checksum or escaping archive cannot change the staged installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-extract-')); roots.push(root);
  const archive = zipSync({ 'notara/package.json': strToU8('{}'), 'notara/scripts/vault.ts': strToU8('') });
  const hash = createHash('sha256').update(archive).digest('hex');
  await expect(extractRelease(archive, 'b'.repeat(64), root)).rejects.toThrow(/校验/);
  const bad = zipSync({ 'notara/../../escape': strToU8('escape') });
  await expect(extractRelease(bad, createHash('sha256').update(bad).digest('hex'), root)).rejects.toThrow(/路径/);
  await extractRelease(archive, hash, root);
  expect(await readFile(join(root, 'package.json'), 'utf8')).toBe('{}');
});

test('background preparation does not stop a lesson and a failed new boot restores the old runtime', async () => {
  const calls: string[] = [];
  const offered = parseRelease(release, manifest, '0.21.4', runtime)!;
  const controller = new UpdateController('0.21.4', '/old', {
    discover: async () => offered,
    prepare: async () => { calls.push('prepare'); return '/new'; },
    stop: async () => { calls.push('stop'); },
    upgrade: async code => { calls.push(`upgrade:${code}`); },
    start: async code => { calls.push(`start:${code}`); if (code === '/new') throw new Error('bad boot'); },
    commit: async () => { calls.push('commit'); },
  });
  await controller.check();
  expect(controller.status().phase).toBe('ready');
  expect(calls).toEqual(['prepare']);
  await controller.apply();
  expect(calls).toEqual(['prepare', 'stop', 'upgrade:/new', 'start:/new', 'stop', 'upgrade:/old', 'start:/old']);
  expect(controller.status()).toMatchObject({ phase: 'error', currentVersion: '0.21.4' });
});

test('incompatible releases do not download, stop, or migrate an existing learning space', async () => {
  const controller = new UpdateController('0.21.4', '/old', {
    discover: async () => ({ ...parseRelease(release, manifest, '0.21.4', runtime)!, compatible: false }),
    prepare: async () => { throw new Error('must not prepare'); },
    stop: async () => { throw new Error('must not stop'); },
    upgrade: async () => {}, start: async () => {}, commit: async () => {},
  });
  await controller.check();
  expect(controller.status().phase).toBe('manual');
  await expect(controller.apply()).rejects.toThrow(/尚未准备/);
});

test('a periodic check and repeated click cannot displace or repeat an accepted update', async () => {
  let discovered = 0, stopped = 0;
  const controller = new UpdateController('0.21.4', '/old', {
    discover: async () => { discovered++; return parseRelease(release, manifest, '0.21.4', runtime); },
    prepare: async () => '/new', stop: async () => { stopped++; },
    upgrade: async () => {}, start: async () => {}, commit: async () => {},
  });
  await controller.check();
  const applying = controller.apply(10);
  await Promise.all([applying, controller.check(), controller.apply()]);
  expect(controller.status()).toMatchObject({ phase: 'current', currentVersion: '0.21.5' });
  expect(discovered).toBe(1); expect(stopped).toBe(1);
});

test('a local installation error does not disclose a private path to the student', async () => {
  const controller = new UpdateController('0.21.4', '/old', {
    discover: async () => parseRelease(release, manifest, '0.21.4', runtime),
    prepare: async () => { throw Object.assign(new Error('EACCES: /private/learner/releases'), { code: 'EACCES' }); },
    stop: async () => {}, upgrade: async () => {}, start: async () => {}, commit: async () => {},
  });
  await controller.check();
  expect(controller.status().message).toBe('没有权限写入更新目录，未安装更新。');
});

test('release cache collection keeps current, rollback and pending code and only deletes owned stable snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-release-cache-')); roots.push(root);
  const current = join(root, '0.23.12-aaaaaaaaaaaa');
  const rollback = join(root, '0.23.11-bbbbbbbbbbbb');
  const pending = join(root, '0.24.1-cccccccccccc');
  const stale = join(root, '0.22.0-dddddddddddd');
  const legacy = join(root, '0.22.0-eeeeeeeeeeee-1728222222000');
  const staging = join(root, 'staging-random');
  const owned = [[current, '0.23.12', 'a'], [rollback, '0.23.11', 'b'], [pending, '0.24.1', 'c'], [stale, '0.22.0', 'd']] as const;
  for (const [path, version, hash] of owned) {
    await mkdir(path);
    await writeFile(join(path, '.notara-release-cache.json'), JSON.stringify({ format: 1, version, sha256: hash.repeat(64) }));
  }
  await mkdir(legacy); await writeFile(join(legacy, '.notara-release-cache.json'), 'not owned by this cache format');
  await mkdir(staging);
  await writeFile(join(root, 'notes.txt'), 'keep');

  await collectReleaseCache(root, [current, rollback, pending]);

  for (const path of [current, rollback, pending, legacy, staging]) expect((await stat(path)).isDirectory()).toBe(true);
  await expect(stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('keep');
});

test('legacy timestamped cache inventory reports verification limits and GC leaves old directories untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-legacy-inventory-')); roots.push(root);
  const runtimeRoot = join(root, 'runtime'); await mkdir(runtimeRoot);
  const version = '0.23.12', digest = 'a'.repeat(64);
  const referenced = join(root, `${version}-${digest.slice(0, 12)}-1728222222000`);
  const mismatched = join(root, `0.24.1-${'b'.repeat(12)}-1728222222001`);
  await writeLegacyCacheCode(referenced, version);
  await writeLegacyCacheCode(mismatched, '0.23.99');
  await writeFile(join(runtimeRoot, 'notara-release.json'), JSON.stringify({ format: 1, code: referenced, version, sha256: digest }));
  await acquireCachedCodeLease(mismatched, root);
  try {
    const loader = pathToFileURL(join(resolve('.'), 'node_modules/tsx/dist/loader.mjs')).href;
    const { stdout } = await execFileAsync(process.execPath, ['--import', loader, resolve('scripts/vault-updates.ts'), 'cache-inventory', '--root', root, '--runtime-root', runtimeRoot], { cwd: resolve('.') });
    expect(stdout).toContain('旧式更新缓存（只读）');
    expect(stdout).toContain(`${version}-${digest.slice(0, 12)}-1728222222000: package/runtime=matches-directory; marker=missing; lease=none-observed; runtime-pointer=matches-provided-pointer; release-manifest=not-checked`);
    expect(stdout).toContain(`0.24.1-${'b'.repeat(12)}-1728222222001: package/runtime=mismatch; marker=missing; lease=active; runtime-pointer=not-referenced-by-provided-pointers; release-manifest=not-checked`);
    expect(stdout).toContain('本命令不会删除或迁移目录');
    await collectReleaseCache(root, []);
    expect((await stat(referenced)).isDirectory()).toBe(true);
    expect((await stat(mismatched)).isDirectory()).toBe(true);
  } finally { await releaseCachedCodeLease(mismatched); }
});

test('preparing a replacement releases the old pending lease before GC and keeps active, rollback, new pending and leased snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-release-replace-')); roots.push(root);
  const active = join(root, '0.23.12-aaaaaaaaaaaa');
  const rollback = join(root, '0.23.11-bbbbbbbbbbbb');
  const oldPending = join(root, '0.24.1-cccccccccccc');
  const newPending = join(root, '0.24.2-dddddddddddd');
  const leased = join(root, '0.23.10-eeeeeeeeeeee');
  for (const [path, version, hash] of [
    [active, '0.23.12', 'a'], [rollback, '0.23.11', 'b'], [oldPending, '0.24.1', 'c'],
    [newPending, '0.24.2', 'd'], [leased, '0.23.10', 'e'],
  ] as const) {
    await mkdir(path);
    await writeFile(join(path, '.notara-release-cache.json'), JSON.stringify({ format: 1, version, sha256: hash.repeat(64) }));
  }
  await Promise.all([acquireCachedCodeLease(oldPending, root), acquireCachedCodeLease(newPending, root), acquireCachedCodeLease(leased, root)]);
  try {
    await cleanupPreparedReleaseCache(root, [active, rollback, newPending], oldPending);
    for (const path of [active, rollback, newPending, leased]) expect((await stat(path)).isDirectory()).toBe(true);
    await expect(stat(oldPending)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await Promise.all([oldPending, newPending, leased].map(path => releaseCachedCodeLease(path)));
  }
});

test('prepared-release cleanup failure warns without failing the successful prepare', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-release-cleanup-failure-')); roots.push(base);
  const blocked = join(base, 'cache-is-a-file');
  await writeFile(blocked, 'synthetic blocker');
  const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(cleanupPreparedReleaseCache(blocked, ['/active', '/rollback', '/pending'])).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith('新版已准备好，但旧版本缓存未能完全清理。');
  } finally { warning.mockRestore(); }
});

test('release cache collection retains code leased by another runtime and removes it after the final lease ends', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-release-lease-')); roots.push(root);
  const active = join(root, '0.23.10-ffffffffffff');
  await mkdir(active);
  await writeFile(join(active, '.notara-release-cache.json'), JSON.stringify({ format: 1, version: '0.23.10', sha256: 'f'.repeat(64) }));
  await Promise.all([acquireCachedCodeLease(active, root), acquireCachedCodeLease(active, root)]);
  try {
    await collectReleaseCache(root, []);
    expect((await stat(active)).isDirectory()).toBe(true);
    await releaseCachedCodeLease(active);
    await collectReleaseCache(root, []);
    expect((await stat(active)).isDirectory()).toBe(true);
  } finally { await releaseCachedCodeLease(active); }
  await collectReleaseCache(root, []);
  await expect(stat(active)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('non-cache code does not create or lock a release cache root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-no-cache-')); roots.push(root);
  const cache = join(root, 'releases');
  await acquireCachedCodeLease(join(root, 'checkout'), cache);
  await expect(stat(cache)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('an expired lease heartbeat is retained while its named owner process is still alive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-release-stale-lease-')); roots.push(root);
  const active = join(root, '0.23.10-eeeeeeeeeeee');
  await mkdir(active);
  await writeFile(join(active, '.notara-release-cache.json'), JSON.stringify({ format: 1, version: '0.23.10', sha256: 'e'.repeat(64) }));
  const pathKey = process.platform === 'win32' ? resolve(active).toLowerCase() : resolve(active);
  const codeKey = createHash('sha256').update(pathKey).digest('hex');
  const lease = join(root, `.notara-lease-${codeKey}-${process.pid}-synthetic`);
  await writeFile(lease, ''); // A stale/missing heartbeat must not override a live owner PID.

  await collectReleaseCache(root, []);
  expect((await stat(active)).isDirectory()).toBe(true);
  await rm(lease, { force: true });
  await collectReleaseCache(root, []);
  await expect(stat(active)).rejects.toMatchObject({ code: 'ENOENT' });
});
