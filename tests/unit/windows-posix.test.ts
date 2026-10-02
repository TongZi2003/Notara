import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test } from 'vitest';
import { ensureWindowsPosix, ensureWindowsPosixBundle, WINDOWS_POSIX_PIN, type WindowsPosixInternals, type WindowsPosixPin } from '../../scripts/windows-posix.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
async function temporary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'notara-windows-posix-')); roots.push(root); return root;
}
function sourceArchive(license: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write('busybox-w32/LICENSE');
  header.write(license.byteLength.toString(8).padStart(11, '0') + '\0', 124);
  header[156] = 48;
  return gzipSync(Buffer.concat([header, license, Buffer.alloc((512 - license.byteLength % 512) % 512 + 1024)]));
}
function fixture(): { pin: WindowsPosixPin; binary: Buffer; source: Buffer; license: Buffer; internals: WindowsPosixInternals; calls: string[] } {
  const binary = Buffer.from('synthetic native executable; never executed');
  const license = Buffer.from('Synthetic GPL fixture\n');
  const source = sourceArchive(license);
  const pin: WindowsPosixPin = { version: 'FRP-test', binary: { name: 'busybox-w64u-FRP-test.exe', sha256: hash(binary) },
    source: { name: 'busybox-w32-FRP-test.tgz', sha256: hash(source) }, licenseSha256: hash(license) };
  const calls: string[] = [];
  const fetcher: typeof fetch = async url => {
    const value = String(url); calls.push(value);
    if (value === `https://frippery.org/files/busybox/${pin.binary.name}`) return new Response(new Uint8Array(binary));
    if (value === `https://frippery.org/files/busybox/${pin.source.name}`) return new Response(new Uint8Array(source));
    throw new Error('unexpected fixture download');
  };
  return { pin, binary, source, license, calls, internals: { pin, fetcher, platform: 'win32', arch: 'x64', osRelease: '10.0.18362' } };
}

test('the runtime pin names the exact reviewed executable and corresponding complete source', () => {
  expect(WINDOWS_POSIX_PIN.binary.sha256).toBe('6e263d154d8548d1eb936f65d1d8312c80df31c45974e48d6335e4dcc0f4f34c');
  expect(WINDOWS_POSIX_PIN.source.sha256).toBe('44401413c86a839deeec3eba088af244a1594f18ff9fd0622811100e4cc2e7b4');
  expect(WINDOWS_POSIX_PIN.binary.name).toBe(`busybox-w64u-${WINDOWS_POSIX_PIN.version}.exe`);
  expect(WINDOWS_POSIX_PIN.source.name).toBe(`busybox-w32-${WINDOWS_POSIX_PIN.version}.tgz`);
});

test('provisioning verifies every asset, includes GPL source and license, and works offline from a complete cache', async () => {
  const root = await temporary(), f = fixture();
  const executable = await ensureWindowsPosix(root, f.internals);
  expect(executable).toBe(join(root, 'vendor/windows-posix/FRP-test', f.pin.binary.name));
  expect(await readFile(executable)).toEqual(f.binary);
  const bundle = await ensureWindowsPosixBundle(root, { ...f.internals, fetcher: async () => { throw new Error('offline'); } });
  expect(bundle.files).toHaveLength(4);
  expect(await readFile(join(root, bundle.files[1]!))).toEqual(f.source);
  expect(await readFile(join(root, bundle.files[2]!))).toEqual(f.license);
  expect(await readFile(join(root, bundle.files[3]!), 'utf8')).toContain('GNU General Public License version 2 only');
  expect(f.calls).toHaveLength(2);
  expect(await readdir(join(root, 'vendor/windows-posix/FRP-test'))).not.toContain('.provision.lock');
});

test.each([
  { platform: 'linux' as const, arch: 'x64', osRelease: '10.0.22631' },
  { platform: 'win32' as const, arch: 'arm64', osRelease: '10.0.22631' },
  { platform: 'win32' as const, arch: 'ia32', osRelease: '10.0.22631' },
  { platform: 'win32' as const, arch: 'x64', osRelease: '10.0.17763' },
  { platform: 'win32' as const, arch: 'x64', osRelease: 'unknown' },
])('unsupported OS or architecture fails before creating any cache: %j', async host => {
  const root = await temporary(), f = fixture();
  await expect(ensureWindowsPosix(root, { ...f.internals, ...host })).rejects.toThrow(/Windows 10 1903/);
  expect(f.calls).toEqual([]);
  expect(await readdir(root)).toEqual([]);
});

test.each(['binary', 'source', 'license'])('a %s checksum failure never publishes a usable executable', async failure => {
  const root = await temporary(), f = fixture();
  if (failure === 'license') f.pin.licenseSha256 = 'a'.repeat(64);
  else f.pin[failure as 'binary' | 'source'].sha256 = 'a'.repeat(64);
  await expect(ensureWindowsPosix(root, f.internals)).rejects.toThrow(/校验失败/);
  const names = await readdir(join(root, 'vendor/windows-posix/FRP-test'));
  expect(names).toEqual([]);
});

test('simultaneous requests provision once and return the same complete verified bundle', async () => {
  const root = await temporary(), f = fixture();
  const original = f.internals.fetcher!;
  f.internals.fetcher = async (...args) => { await new Promise(done => setTimeout(done, 20)); return original(...args); };
  const paths = await Promise.all(Array.from({ length: 5 }, () => ensureWindowsPosix(root, f.internals)));
  expect(new Set(paths).size).toBe(1);
  expect(f.calls).toHaveLength(2);
  expect(await readFile(paths[0]!)).toEqual(f.binary);
});

test('invalid cached bytes are replaced only after a fresh download passes the pin', async () => {
  const root = await temporary(), f = fixture();
  const executable = await ensureWindowsPosix(root, f.internals);
  await writeFile(executable, 'corrupt');
  f.calls.length = 0;
  await expect(ensureWindowsPosix(root, f.internals)).resolves.toBe(executable);
  expect(await readFile(executable)).toEqual(f.binary);
  expect(f.calls).toEqual([`https://frippery.org/files/busybox/${f.pin.binary.name}`]);
});

test('a local seed is accepted only when its content matches the pinned executable', async () => {
  const root = await temporary(), f = fixture();
  const seed = join(root, 'seed.exe'); await writeFile(seed, f.binary);
  await ensureWindowsPosix(root, { ...f.internals, seedExecutable: seed });
  expect(f.calls).toEqual([`https://frippery.org/files/busybox/${f.pin.source.name}`]);
  const other = await temporary(); await writeFile(seed, 'unverified'); f.calls.length = 0;
  await ensureWindowsPosix(other, { ...f.internals, seedExecutable: seed });
  expect(f.calls).toHaveLength(2);
});

test('oversized and failed downloads leave neither an executable nor an installation lock', async () => {
  for (const response of [new Response('failed', { status: 503 }), new Response('too big', { headers: { 'content-length': '2000001' } })]) {
    const root = await temporary(), f = fixture();
    await expect(ensureWindowsPosix(root, { ...f.internals, fetcher: async () => response })).rejects.toThrow(/下载失败|大小限制/);
    expect(await readdir(join(root, 'vendor/windows-posix/FRP-test'))).toEqual([]);
  }
});

test('waiting for another installer is bounded and does not delete its lock', async () => {
  const root = await temporary(), f = fixture();
  const cache = join(root, 'vendor/windows-posix/FRP-test'); await mkdir(cache, { recursive: true });
  await writeFile(join(cache, '.provision.lock'), 'other installer');
  await expect(ensureWindowsPosix(root, { ...f.internals, lockWaitMs: 1 })).rejects.toThrow(/另一进程准备/);
  expect(await readFile(join(cache, '.provision.lock'), 'utf8')).toBe('other installer');
  expect(f.calls).toEqual([]);
});

test('a junction in the dedicated cache is rejected without writing outside the project', async () => {
  const root = await temporary(), outside = await temporary(), f = fixture();
  await mkdir(join(root, 'vendor')); await symlink(outside, join(root, 'vendor/windows-posix'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(ensureWindowsPosix(root, f.internals)).rejects.toThrow(/不能使用链接/);
  expect(await readdir(outside)).toEqual([]);
  expect(f.calls).toEqual([]);
});
