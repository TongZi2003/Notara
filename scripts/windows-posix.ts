import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import * as http from 'node:http';
import { release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';

export interface WindowsPosixPin {
  version: string;
  binary: { name: string; sha256: string };
  source: { name: string; sha256: string };
  licenseSha256: string;
}

/** Official FRP release; its source files were also compared with the same GitHub tag. */
export const WINDOWS_POSIX_PIN: WindowsPosixPin = Object.freeze({
  version: 'FRP-6075-g169694ebd',
  binary: Object.freeze({ name: 'busybox-w64u-FRP-6075-g169694ebd.exe', sha256: '6e263d154d8548d1eb936f65d1d8312c80df31c45974e48d6335e4dcc0f4f34c' }),
  source: Object.freeze({ name: 'busybox-w32-FRP-6075-g169694ebd.tgz', sha256: '44401413c86a839deeec3eba088af244a1594f18ff9fd0622811100e4cc2e7b4' }),
  licenseSha256: 'bbfc9843646d483c334664f651c208b9839626891d8f17604db2146962f43548',
});
const BASE_URL = 'https://frippery.org/files/busybox/';
const CACHE = 'vendor/windows-posix';
const LICENSE = 'LICENSE.txt';
const NOTICE = 'NOTICE.txt';
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/** Test seams never select a different binary through the launcher or user environment. */
export interface WindowsPosixInternals {
  fetcher?: typeof fetch;
  pin?: WindowsPosixPin;
  platform?: NodeJS.Platform;
  arch?: string;
  osRelease?: string;
  downloadTimeoutMs?: number;
  lockWaitMs?: number;
  seedExecutable?: string;
}
export interface WindowsPosixBundle { executable: string; files: string[] }

function assertSupported(internals: WindowsPosixInternals): void {
  const platform = internals.platform ?? process.platform;
  const arch = internals.arch ?? process.arch;
  const osRelease = internals.osRelease ?? release();
  const parts = osRelease.split('.').map(Number);
  if (platform !== 'win32' || arch !== 'x64' || !parts.every(Number.isFinite)
    || (parts[0] ?? 0) < 10 || ((parts[0] ?? 0) === 10 && (parts[2] ?? 0) < 18362)) {
    throw new Error('Notara 的 Windows shell 需要 Windows 10 1903 或更新版本及 x64 Node；当前系统或架构尚未支持。');
  }
}

async function directory(path: string): Promise<void> {
  await mkdir(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Windows shell 缓存不能使用链接或普通文件：${path}`);
}

async function verified(path: string, hash: string, limit: number): Promise<Uint8Array | undefined> {
  let info;
  try { info = await lstat(path); } catch (error) { if (missing(error)) return undefined; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Windows shell 依赖不能使用链接或目录：${path}`);
  if (info.size > limit) return undefined;
  const bytes = await readFile(path);
  return bytes.byteLength <= limit && sha256(bytes) === hash ? bytes : undefined;
}

async function publish(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = join(dirname(path), `.download-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

let proxyConfigured = false;
function defaultFetch(): typeof fetch {
  if (!proxyConfigured) {
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
    if (proxy) {
      const configure = (http as typeof http & { setGlobalProxyFromEnv?: () => unknown }).setGlobalProxyFromEnv;
      if (configure) configure();
      else if (process.env.NODE_USE_ENV_PROXY !== '1' && !process.execArgv.includes('--use-env-proxy')) {
        throw new Error('Windows shell 下载使用系统代理需要 Node 24.14 或更新版本，或通过 NODE_USE_ENV_PROXY=1 启动支持该选项的 Node。');
      }
    }
    proxyConfigured = true;
  }
  return fetch;
}

async function download(name: string, hash: string, limit: number, internals: WindowsPosixInternals): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(internals.downloadTimeoutMs ?? 60_000);
  const fetcher = internals.fetcher ?? defaultFetch();
  const response = await fetcher(BASE_URL + name, { signal, headers: { 'user-agent': 'Notara-Windows-Shell' }, redirect: 'error' });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Windows shell 依赖下载失败（HTTP ${response.status}）：${name}`);
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error(`Windows shell 依赖超过大小限制：${name}`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new Error(`Windows shell 依赖超过大小限制：${name}`);
      chunks.push(result.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (sha256(bytes) !== hash) throw new Error(`Windows shell 依赖 SHA-256 校验失败：${name}`);
  return bytes;
}

/** Read only the GPL text from a verified archive; never extract or execute source files. */
function licenseFromSource(source: Uint8Array, expected: string): Uint8Array {
  const tar = gunzipSync(source, { maxOutputLength: 32_000_000 });
  for (let offset = 0; offset + 512 <= tar.byteLength;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').split('\0', 1)[0];
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim();
    if (!name) break;
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Windows shell 源码归档格式不正确。');
    const size = parseInt(sizeText, 8);
    const start = offset + 512;
    if (start + size > tar.byteLength) throw new Error('Windows shell 源码归档不完整。');
    if (name === 'busybox-w32/LICENSE' && (header[156] === 0 || header[156] === 48)) {
      const license = tar.subarray(start, start + size);
      if (sha256(license) !== expected) throw new Error('Windows shell 许可证校验失败。');
      return license;
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error('Windows shell 源码归档缺少许可证。');
}

function notice(pin: WindowsPosixPin): Uint8Array {
  return new TextEncoder().encode(`BusyBox for Windows ${pin.version} (w64u)\n\nUnmodified upstream executable, distributed separately from Notara.\nCopyright: BusyBox contributors and Ronald M. Yorston; see AUTHORS and source file notices in the accompanying source archive.\nLicense: GNU General Public License version 2 only; full text is in ${LICENSE}.\n\nExecutable: ${pin.binary.name}\nSHA-256: ${pin.binary.sha256}\nOfficial download: ${BASE_URL}${pin.binary.name}\nCorresponding complete source: ${pin.source.name}\nSHA-256: ${pin.source.sha256}\nOfficial source: ${BASE_URL}${pin.source.name}\nUpstream: https://github.com/rmyorston/busybox-w32/tree/${pin.version}\n\nThe accompanying source archive includes build scripts and the mingw64u configuration. See README.md and INSTALL, configs/mingw64u_defconfig, and scripts/mk_mingw64u_defconfig. The source archive's .frp_describe records the release version. Notara has not modified this executable or its source.\n`);
}

/** Provision distributable Windows assets on any build host, including Linux release CI. */
export async function ensureWindowsPosixBundle(projectRoot: string, internals: WindowsPosixInternals = {}): Promise<WindowsPosixBundle> {
  const root = resolve(projectRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Windows shell 代码目录不能是链接或普通文件。');
  const pin = internals.pin ?? WINDOWS_POSIX_PIN;
  if (![pin.version, pin.binary.name, pin.source.name].every(name => /^[a-zA-Z0-9._-]+$/.test(name) && name !== '.' && name !== '..')
    || ![pin.binary.sha256, pin.source.sha256, pin.licenseSha256].every(hash => /^[a-f0-9]{64}$/.test(hash))) throw new Error('Windows shell 固定版本信息不正确。');
  await directory(join(root, 'vendor'));
  await directory(join(root, CACHE));
  const relative = `${CACHE}/${pin.version}`;
  const cache = join(root, relative);
  await directory(cache);
  const binary = join(cache, pin.binary.name);
  const source = join(cache, pin.source.name);
  const notices = notice(pin);
  const complete = async (): Promise<boolean> => (await verified(binary, pin.binary.sha256, 2_000_000)) !== undefined
    && (await verified(source, pin.source.sha256, 8_000_000)) !== undefined
    && (await verified(join(cache, LICENSE), pin.licenseSha256, 100_000)) !== undefined
    && (await verified(join(cache, NOTICE), sha256(notices), 100_000)) !== undefined;
  const bundle = { executable: binary, files: [pin.binary.name, pin.source.name, LICENSE, NOTICE].map(name => `${relative}/${name}`) };
  if (await complete()) return bundle;
  const lock = join(cache, '.provision.lock');
  const deadline = Date.now() + (internals.lockWaitMs ?? 150_000);
  let lockHandle;
  while (!lockHandle) {
    try { lockHandle = await open(lock, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await complete()) return bundle;
      if (Date.now() >= deadline) throw new Error(`Windows shell 正由另一进程准备，或上次准备被中断。请稍后重试；确认无安装进程后可删除 ${lock}。`);
      await delay(50);
    }
  }
  try {
    if (await complete()) return bundle;
    let binaryBytes = await verified(binary, pin.binary.sha256, 2_000_000);
    if (!binaryBytes && internals.seedExecutable) binaryBytes = await verified(internals.seedExecutable, pin.binary.sha256, 2_000_000);
    binaryBytes ??= await download(pin.binary.name, pin.binary.sha256, 2_000_000, internals);
    const sourceBytes = await verified(source, pin.source.sha256, 8_000_000)
      ?? await download(pin.source.name, pin.source.sha256, 8_000_000, internals);
    const license = licenseFromSource(sourceBytes, pin.licenseSha256);
    // Every input is verified before any usable executable is published.
    await publish(source, sourceBytes);
    await publish(join(cache, LICENSE), license);
    await publish(join(cache, NOTICE), notices);
    await publish(binary, binaryBytes);
    return bundle;
  } finally {
    await lockHandle.close();
    await rm(lock, { force: true });
  }
}

/** Return the verified, versioned native POSIX shell for supported Windows machines. */
export async function ensureWindowsPosix(projectRoot: string, internals: WindowsPosixInternals = {}): Promise<string> {
  assertSupported(internals);
  return (await ensureWindowsPosixBundle(projectRoot, internals)).executable;
}
