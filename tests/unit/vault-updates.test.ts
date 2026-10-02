import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, expect, test } from 'vitest';
import { compareVersions, parseRelease, extractRelease, UpdateController } from '../../scripts/vault-updates.ts';

const runtime = { dsh: '0.2.0-rc.1', cordis: '4.0.4', dataVersion: 4 };
const asset = (name: string) => ({ name, browser_download_url: `https://github.com/TongZi2003/Notara/releases/download/v0.21.5/${name}` });
const manifest = { format: 1, version: '0.21.5', runtime, archive: 'notara-0.21.5.zip', sha256: 'a'.repeat(64) };
const release = { tag_name: 'v0.21.5', prerelease: false, draft: false, html_url: 'https://github.com/TongZi2003/Notara/releases/tag/v0.21.5', assets: [asset('notara-update.json'), asset(manifest.archive)] };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test('only a newer stable version with a matching release manifest is offered', () => {
  expect(compareVersions('0.21.10', '0.21.9')).toBe(1);
  expect(parseRelease(release, manifest, '0.21.4', runtime)?.version).toBe('0.21.5');
  expect(parseRelease({ ...release, prerelease: true }, manifest, '0.21.4', runtime)).toBeNull();
  expect(parseRelease(release, manifest, '0.21.5', runtime)).toBeNull();
  expect(() => parseRelease(release, { ...manifest, version: '0.21.6' }, '0.21.4', runtime)).toThrow();
  expect(() => parseRelease({ ...release, assets: [asset('notara-update.json'), { ...asset(manifest.archive), browser_download_url: 'https://example.com/evil.zip' }] }, manifest, '0.21.4', runtime)).toThrow();
  expect(parseRelease(release, { ...manifest, runtime: { ...runtime, dataVersion: 5 } }, '0.21.4', runtime)?.compatible).toBe(false);
  expect(() => compareVersions('01.2.3', '1.2.3')).toThrow(/格式/);
  expect(() => compareVersions('9007199254740993.0.0', '1.0.0')).toThrow(/格式/);
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
