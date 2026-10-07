import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import lockfile from 'proper-lockfile';
import { packageBin } from './package-bin.ts';

export const REPOSITORY = 'TongZi2003/Notara';
export const MANIFEST_NAME = 'notara-update.json';
export const defaultReleaseCacheRoot = (): string => join(homedir(), '.notara', 'releases');
export interface RuntimeContract { dsh: string; cordis: string; dataVersion: number }
export interface Release { version: string; url: string; archiveUrl: string; sha256: string; runtime: RuntimeContract; compatible: boolean }
export interface UpdateStatus { phase: 'current' | 'checking' | 'downloading' | 'ready' | 'restarting' | 'error' | 'manual'; currentVersion: string; latestVersion?: string; releaseUrl?: string; message: string; launchId?: string }
function updateFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOSPC') return '磁盘空间不足，未安装更新。';
  if (code === 'EACCES' || code === 'EPERM') return '没有权限写入更新目录，未安装更新。';
  const message = error instanceof Error ? error.message : '';
  return /^(更新|发布包|暂时无法|请通过|插件版本)/.test(message) ? message : '检查或准备更新未完成，请稍后重试。';
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('更新信息格式不正确。');
  return value as Record<string, unknown>;
};
const parsedVersion = (version: string): { parts: number[]; dev: number | undefined } => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(0|[1-9]\d*))?$/.exec(version);
  if (!match) throw new Error('更新版本格式不正确。');
  const parts = match.slice(1, 4).map(Number);
  const dev = match[4] === undefined ? undefined : Number(match[4]);
  if (parts.some(part => !Number.isSafeInteger(part)) || (dev !== undefined && !Number.isSafeInteger(dev))) throw new Error('更新版本格式不正确。');
  return { parts, dev };
};
export function compareVersions(a: string, b: string): number {
  const left = parsedVersion(a), right = parsedVersion(b);
  for (let i = 0; i < 3; i++) if (left.parts[i] !== right.parts[i]) return left.parts[i]! > right.parts[i]! ? 1 : -1;
  if (left.dev === undefined || right.dev === undefined) return left.dev === right.dev ? 0 : left.dev === undefined ? 1 : -1;
  return Math.sign(left.dev - right.dev);
}
export function runtimeContract(value: unknown): RuntimeContract {
  const row = object(value);
  if (typeof row.dsh !== 'string' || typeof row.cordis !== 'string' || !Number.isSafeInteger(row.dataVersion) || Number(row.dataVersion) < 1) throw new Error('更新兼容信息不正确。');
  return { dsh: row.dsh, cordis: row.cordis, dataVersion: Number(row.dataVersion) };
}
export const sameRuntime = (a: RuntimeContract, b: RuntimeContract): boolean => a.dsh === b.dsh && a.cordis === b.cordis && a.dataVersion === b.dataVersion;
export function parseRelease(raw: unknown, manifestValue: unknown, current: string, runtime: RuntimeContract): Release | null {
  const release = object(raw);
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return null;
  const version = release.tag_name.slice(1);
  if (compareVersions(version, current) <= 0) return null;
  const manifest = object(manifestValue);
  if (manifest.format !== 1 || manifest.version !== version || manifest.archive !== `notara-${version}.zip` || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('发布包与版本信息不一致。');
  const nextRuntime = runtimeContract(manifest.runtime);
  const assets = Array.isArray(release.assets) ? release.assets.map(object) : [];
  const assetUrl = (name: string): string => {
    const matches = assets.filter(row => row.name === name);
    const expected = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
    if (matches.length !== 1 || matches[0]!.browser_download_url !== expected) throw new Error('更新下载地址不正确。');
    return expected;
  };
  assetUrl(MANIFEST_NAME);
  const url = `https://github.com/${REPOSITORY}/releases/tag/v${version}`;
  if (release.html_url !== url) throw new Error('更新发布地址不正确。');
  return { version, url, archiveUrl: assetUrl(String(manifest.archive)), sha256: manifest.sha256, runtime: nextRuntime, compatible: sameRuntime(runtime, nextRuntime) };
}

export async function download(url: string, limit: number, fetcher: typeof fetch, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetcher(url, { headers: { 'user-agent': 'Notara-Updater', accept: 'application/vnd.github+json' }, signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 403 || response.status === 429 ? '更新服务暂时限流，请稍后检查。' : '暂时无法获取更新，请稍后重试。'); }
  if (!response.body) throw new Error('更新下载没有内容。');
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('更新包超过大小限制。');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function discoverRelease(current: string, runtime: RuntimeContract, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Release | null> {
  const api = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
  const response = await fetcher(api, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Notara-Updater' }, signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]) });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); throw new Error('暂时无法检查更新，请稍后重试。'); }
  const release = object(await response.json());
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || compareVersions(release.tag_name.slice(1), current) <= 0) return null;
  const asset = (Array.isArray(release.assets) ? release.assets.map(object) : []).find(row => row.name === MANIFEST_NAME);
  // Existing releases predate the updater. They are not installable update packages.
  if (!asset) return null;
  const expected = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${MANIFEST_NAME}`;
  if (asset.browser_download_url !== expected) throw new Error('更新下载地址不正确。');
  const manifest = JSON.parse(new TextDecoder().decode(await download(expected, 64_000, fetcher, signal))) as unknown;
  return parseRelease(release, manifest, current, runtime);
}

/** No archive entry can create a link, escape the empty staging directory, or overwrite dependencies. */
export async function extractRelease(bytes: Uint8Array, hash: string, destination: string, decoder?: typeof import('fflate').unzipSync): Promise<void> {
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('更新包校验失败，请重新下载。');
  const unzipSync = decoder ?? (await import('fflate')).unzipSync;
  let total = 0, count = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, { filter: file => {
    const name = file.name;
    const parts = name.split('/');
    if (parts[0] !== 'notara' || parts.length < 2 || parts.slice(1).some(part => !part || part === '.' || part === '..' || part.startsWith('.') || part === 'node_modules' || /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part))) throw new Error('更新包含不安全路径。');
    const key = name.normalize('NFKC').toLowerCase();
    if (names.has(key)) throw new Error('更新包含重复路径。'); names.add(key);
    total += file.originalSize; count++;
    if (file.originalSize > 30_000_000 || total > 200_000_000 || count > 5000) throw new Error('更新包解压超过大小限制。');
    return true;
  } });
  const base = resolve(destination);
  for (const [name, value] of Object.entries(files)) {
    const path = resolve(base, name.slice('notara/'.length));
    if (!path.startsWith(base + sep)) throw new Error('更新包含不安全路径。');
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, value, { flag: 'wx' });
  }
}
export async function codeContract(code: string): Promise<{ version: string; runtime: RuntimeContract }> {
  const manifest = object(JSON.parse(await readFile(join(code, 'examples/native-vault/package.json'), 'utf8')));
  const pkg = object(JSON.parse(await readFile(join(code, 'package.json'), 'utf8')));
  const deps = object(pkg.devDependencies);
  if (Object.entries(deps).some(([name, version]) => name.startsWith('@deepseek-ai/dsh') && version !== deps['@deepseek-ai/dsh'])) throw new Error('发布包的 DSH 依赖版本不一致。');
  const data = object(JSON.parse(await readFile(join(code, 'docs/runtime/update-contract.json'), 'utf8')));
  if (typeof manifest.version !== 'string') throw new Error('插件版本缺失。'); parsedVersion(manifest.version);
  return { version: manifest.version, runtime: runtimeContract({ dsh: deps['@deepseek-ai/dsh'], cordis: deps['@deepseek-ai/cordis'], dataVersion: data.dataVersion }) };
}
export async function runPackageScript(code: string, script: string, args: string[] = [], signal?: AbortSignal): Promise<void> {
  await runNode(code, packageBin(code, 'tsx', 'tsx'), [join(code, 'scripts', script), ...args], signal);
}
export async function runNode(code: string, entry: string, args: string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: code, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    const abort = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
    };
    signal?.addEventListener('abort', abort, { once: true });
    let error = ''; child.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-4000); });
    child.once('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.once('exit', code => { signal?.removeEventListener('abort', abort); code === 0 ? done() : reject(new Error(`更新安装未完成（退出码 ${code ?? '未知'}）。${/ENOSPC/.test(error) ? '磁盘空间不足。' : ''}`)); });
  });
}
const cacheMarker = '.notara-release-cache.json';
const cacheKey = (path: string): string => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const cachedCodeLeases = new Map<string, { count: number; target: string; release: () => Promise<void> }>();
const legacyReleaseCacheName = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-([a-f0-9]{12})-(\d{13})$/;

interface LegacyReleaseCacheInventoryEntry {
  name: string;
  path: string;
  version: string;
  digestPrefix: string;
  createdAt: number;
  packageContract: 'matches-directory' | 'mismatch' | 'unreadable';
  ownershipMarker: 'missing' | 'matches-name' | 'mismatch-or-invalid';
  releaseManifest: 'not-checked';
  lease: 'active' | 'unknown' | 'expired-owner' | 'none-observed';
  runtimePointer: 'matches-provided-pointer' | 'path-metadata-mismatch' | 'not-referenced-by-provided-pointers' | 'not-checked';
  automaticallyRemovable: false;
  retainReason: string;
}

interface ReleaseCachePointerReference { path: string; version: string; sha256: string }

function isReleaseCachePath(code: string, cacheRoot: string): boolean {
  const rootKey = cacheKey(resolve(cacheRoot)), key = cacheKey(resolve(code));
  const rootPrefix = rootKey.endsWith(sep) ? rootKey : rootKey + sep;
  return key === rootKey || key.startsWith(rootPrefix);
}

async function withReleaseCacheLock<T>(cacheRoot: string, action: () => Promise<T>): Promise<T> {
  const root = resolve(cacheRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(root, { retries: 10, stale: 30_000, update: 10_000 });
  try { return await action(); } finally { await release(); }
}

async function acquireCachedCodeLeaseLocked(code: string, cacheRoot: string): Promise<void> {
  const root = resolve(cacheRoot), path = resolve(code);
  const key = cacheKey(path);
  if (!isReleaseCachePath(path, root)) return;
  const current = cachedCodeLeases.get(key);
  if (current) { current.count++; return; }
  const codeKey = createHash('sha256').update(key).digest('hex');
  const target = join(dirname(path), `.notara-lease-${codeKey}-${process.pid}-${randomUUID()}`);
  await writeFile(target, '', { flag: 'wx', mode: 0o600 });
  try {
    const release = await lockfile.lock(target, { retries: 0, stale: 30_000, update: 10_000 });
    cachedCodeLeases.set(key, { count: 1, target, release });
  } catch (error) { await rm(target, { force: true }); throw error; }
}

/** Keep a cached snapshot alive while a worker or pending update can still use it. */
export async function acquireCachedCodeLease(code: string, cacheRoot = defaultReleaseCacheRoot()): Promise<void> {
  if (!isReleaseCachePath(code, cacheRoot)) return;
  await withReleaseCacheLock(cacheRoot, () => acquireCachedCodeLeaseLocked(code, cacheRoot));
}

export async function releaseCachedCodeLease(code: string): Promise<void> {
  const key = cacheKey(code), lease = cachedCodeLeases.get(key);
  if (!lease) return;
  if (--lease.count > 0) return;
  cachedCodeLeases.delete(key);
  await lease.release();
  await rm(lease.target, { force: true });
}

export async function collectReleaseCache(cacheRoot: string, preservePaths: readonly string[]): Promise<void> {
  const root = resolve(cacheRoot);
  const keep = new Set(preservePaths.map(cacheKey));
  await withReleaseCacheLock(root, async () => {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      // Only remove completed snapshots created by this cache format. Older
      // timestamped snapshots have no ownership marker, so they may belong to
      // another runtime and are deliberately retained.
      if (!entry.isDirectory() || !/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(entry.name)) continue;
      const path = join(root, entry.name);
      if (keep.has(cacheKey(path))) continue;
      try {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        const marker = object(JSON.parse(await readFile(join(path, cacheMarker), 'utf8')));
        const match = /^(\d+\.\d+\.\d+)-([a-f0-9]{12})$/.exec(entry.name);
        if (!match || marker.format !== 1 || marker.version !== match[1] || typeof marker.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(marker.sha256) || !marker.sha256.startsWith(match[2]!)) continue;
        // The cache-wide lock serializes this scan with lease creation in every
        // new launcher. Leases live beside snapshots so code directories stay
        // immutable, and per-process names allow shared snapshots.
        let inUse = false;
        const codeKey = createHash('sha256').update(cacheKey(path)).digest('hex');
        for (const lease of await readdir(dirname(path), { withFileTypes: true })) {
          if (!lease.isFile() || !lease.name.startsWith(`.notara-lease-${codeKey}-`)) continue;
          const target = join(dirname(path), lease.name);
          if (await lockfile.check(target, { stale: 30_000 })) { inUse = true; break; }
          const matchOwner = new RegExp(`^\\.notara-lease-${codeKey}-(\\d+)-[\\w-]+$`).exec(lease.name);
          const pid = Number(matchOwner?.[1]);
          if (!matchOwner || !Number.isSafeInteger(pid) || pid < 1) { inUse = true; break; }
          try { process.kill(pid, 0); inUse = true; break; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { inUse = true; break; } }
          await rm(target, { force: true });
          await rm(`${target}.lock`, { recursive: true, force: true });
        }
        if (inUse) continue;
        await rm(path, { recursive: true, force: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  });
}

async function legacyCodeLeaseState(codePath: string): Promise<LegacyReleaseCacheInventoryEntry['lease']> {
  const codeKey = createHash('sha256').update(cacheKey(codePath)).digest('hex');
  const prefix = `.notara-lease-${codeKey}-`;
  let found = false;
  for (const lease of await readdir(dirname(codePath), { withFileTypes: true })) {
    if (!lease.isFile() || !lease.name.startsWith(prefix)) continue;
    found = true;
    const target = join(dirname(codePath), lease.name);
    let locked: boolean;
    try { locked = await lockfile.check(target, { stale: 30_000 }); }
    catch { return 'unknown'; }
    if (locked) return 'active';
    const owner = new RegExp(`^\\.notara-lease-${codeKey}-(\\d+)-[\\w-]+$`).exec(lease.name);
    const pid = Number(owner?.[1]);
    if (!owner || !Number.isSafeInteger(pid) || pid < 1) return 'unknown';
    try { process.kill(pid, 0); return 'active'; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return 'unknown'; }
  }
  return found ? 'expired-owner' : 'none-observed';
}

/** Read-only inventory for old timestamped snapshots; legacy entries are never auto-deleted or adopted. */
async function inspectLegacyReleaseCache(
  cacheRoot = defaultReleaseCacheRoot(),
  pointers?: readonly ReleaseCachePointerReference[],
): Promise<LegacyReleaseCacheInventoryEntry[]> {
  const root = resolve(cacheRoot);
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const results: LegacyReleaseCacheInventoryEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = legacyReleaseCacheName.exec(entry.name);
    if (!match) continue;
    const version = match[1]!;
    const digestPrefix = match[2]!;
    const timestamp = match[3]!;
    const path = join(root, entry.name);
    let info;
    try { info = await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) continue;

    let packageContract: LegacyReleaseCacheInventoryEntry['packageContract'] = 'unreadable';
    try { packageContract = (await codeContract(path)).version === version ? 'matches-directory' : 'mismatch'; }
    catch { /* Report limited verification; never treat a failed read as ownership evidence. */ }

    let ownershipMarker: LegacyReleaseCacheInventoryEntry['ownershipMarker'] = 'missing';
    const markerPath = join(path, cacheMarker);
    try {
      const markerInfo = await lstat(markerPath);
      if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) ownershipMarker = 'mismatch-or-invalid';
      else {
        const marker = object(JSON.parse(await readFile(markerPath, 'utf8')));
        ownershipMarker = marker.format === 1 && marker.version === version && typeof marker.sha256 === 'string' &&
          /^[a-f0-9]{64}$/.test(marker.sha256) && marker.sha256.startsWith(digestPrefix) ? 'matches-name' : 'mismatch-or-invalid';
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ownershipMarker = 'mismatch-or-invalid';
    }

    let runtimePointer: LegacyReleaseCacheInventoryEntry['runtimePointer'] = pointers ? 'not-referenced-by-provided-pointers' : 'not-checked';
    if (pointers) {
      const pathReference = pointers.find(pointer => cacheKey(pointer.path) === cacheKey(path));
      if (pathReference) runtimePointer = pathReference.version === version && /^[a-f0-9]{64}$/.test(pathReference.sha256) && pathReference.sha256.startsWith(digestPrefix)
        ? 'matches-provided-pointer' : 'path-metadata-mismatch';
    }
    results.push({
      name: entry.name, path, version, digestPrefix, createdAt: Number(timestamp), packageContract, ownershipMarker,
      releaseManifest: 'not-checked', lease: await legacyCodeLeaseState(path), runtimePointer, automaticallyRemovable: false,
      retainReason: '旧目录没有可验证的安装后完整性与归属证明；运行时指针和租约只覆盖已提供的引用，不能证明其他实例均已停止。',
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function readCachePointerReference(runtimeRoot: string): Promise<ReleaseCachePointerReference | undefined> {
  let source: string;
  try { source = await readFile(join(resolve(runtimeRoot), 'notara-release.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const pointer = object(JSON.parse(source));
  if (pointer.format !== 1 || typeof pointer.code !== 'string' || typeof pointer.version !== 'string' || typeof pointer.sha256 !== 'string')
    throw new Error('运行时更新指针格式无效，inventory 已停止。');
  return { path: resolve(pointer.code), version: pointer.version, sha256: pointer.sha256 };
}

const cacheInventoryUsage = '用法：npm exec -- tsx scripts/vault-updates.ts cache-inventory [--root <缓存目录>] [--runtime-root <数据目录>]';
async function runCacheInventoryCli(args: readonly string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) { console.log(cacheInventoryUsage); return; }
  if (args[0] !== 'cache-inventory') throw new Error(cacheInventoryUsage);
  let cacheRoot = defaultReleaseCacheRoot(), runtimeRoot: string | undefined;
  for (let index = 1; index < args.length; index++) {
    const option = args[index];
    if ((option === '--root' || option === '--runtime-root') && args[index + 1]) {
      if (option === '--root') cacheRoot = resolve(args[++index]!);
      else runtimeRoot = resolve(args[++index]!);
    } else throw new Error(cacheInventoryUsage);
  }
  const pointer = runtimeRoot ? await readCachePointerReference(runtimeRoot) : undefined;
  const inventory = await inspectLegacyReleaseCache(cacheRoot, runtimeRoot ? (pointer ? [pointer] : []) : undefined);
  console.log(`旧式更新缓存（只读）：${resolve(cacheRoot)}`);
  if (!inventory.length) console.log('未发现旧式 version-sha12-timestamp 目录。');
  for (const item of inventory) {
    console.log(`- ${item.name}: package/runtime=${item.packageContract}; marker=${item.ownershipMarker}; lease=${item.lease}; runtime-pointer=${item.runtimePointer}; release-manifest=${item.releaseManifest}`);
    console.log(`  保留：${item.retainReason}`);
    console.log(`  路径：${item.path}`);
  }
  console.log('本命令不会删除或迁移目录。人工清理前请停止所有可能共用该缓存的 Notara 实例（包括自定义 --root），核对每个运行时指针并备份；仅处理确认不再使用的列出目录。');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCacheInventoryCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : '无法读取旧式更新缓存清单。');
    process.exitCode = 1;
  });
}

/** Release the replaced candidate before collecting snapshots; cleanup is best-effort after preparation succeeds. */
export async function cleanupPreparedReleaseCache(cacheRoot: string, preservePaths: readonly string[], previousPendingCode?: string): Promise<void> {
  let failed = false;
  if (previousPendingCode) {
    try { await releaseCachedCodeLease(previousPendingCode); }
    catch { failed = true; }
  }
  try { await collectReleaseCache(cacheRoot, preservePaths); }
  catch { failed = true; }
  if (failed) console.error('新版已准备好，但旧版本缓存未能完全清理。');
}

async function validCachedRelease(path: string, release: Release): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    const marker = object(JSON.parse(await readFile(join(path, cacheMarker), 'utf8')));
    if (marker.format !== 1 || marker.version !== release.version || marker.sha256 !== release.sha256) return false;
    const actual = await codeContract(path);
    return actual.version === release.version && sameRuntime(actual.runtime, release.runtime);
  } catch { return false; }
}

export async function prepareRelease(release: Release, fetcher: typeof fetch = fetch, cacheRoot = defaultReleaseCacheRoot(), signal?: AbortSignal): Promise<string> {
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const installed = join(cacheRoot, `${release.version}-${release.sha256.slice(0, 12)}`);
  const reused = await withReleaseCacheLock(cacheRoot, async () => {
    if (await validCachedRelease(installed, release)) {
      await acquireCachedCodeLeaseLocked(installed, cacheRoot);
      return true;
    }
    const found = await lstat(installed).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
    if (found) throw new Error('当前更新缓存校验失败，未删除可能正在使用的代码。');
    return false;
  });
  if (reused) return installed;
  const staging = await mkdtemp(join(cacheRoot, 'staging-'));
  try {
    await extractRelease(await download(release.archiveUrl, 100_000_000, fetcher, signal), release.sha256, staging);
    signal?.throwIfAborted();
    const actual = await codeContract(staging);
    if (actual.version !== release.version || !sameRuntime(actual.runtime, release.runtime)) throw new Error('更新包内容与发布信息不一致。');
    // Platform-specific native modules are installed on the user's machine, never copied from CI.
    const npmEntry = process.env.npm_execpath;
    if (!npmEntry) throw new Error('请通过 npm run vault 启动，以便安装更新依赖。');
    await runNode(staging, npmEntry, ['ci', '--include=dev', '--no-audit', '--no-fund'], signal);
    await runPackageScript(staging, 'build-native-vault.ts', [], signal);
    await writeFile(join(staging, cacheMarker), JSON.stringify({ format: 1, version: release.version, sha256: release.sha256 }));
    await withReleaseCacheLock(cacheRoot, async () => {
      if (await validCachedRelease(installed, release)) {
        // Another runtime prepared the same release while this one built it.
        await acquireCachedCodeLeaseLocked(installed, cacheRoot);
        await rm(staging, { recursive: true, force: true });
        return;
      }
      const found = await lstat(installed).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
      if (found) throw new Error('当前更新缓存校验失败，未删除可能正在使用的代码。');
      await rename(staging, installed);
      await acquireCachedCodeLeaseLocked(installed, cacheRoot);
    });
    return installed;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

interface UpdateOperations {
  discover(signal: AbortSignal): Promise<Release | null>; prepare(release: Release, signal: AbortSignal): Promise<string>;
  stop(): Promise<void>; upgrade(code: string): Promise<void>; start(code: string): Promise<void>; commit(code: string, release: Release): Promise<void>;
}
export class UpdateController {
  private readonly launchId = randomUUID();
  private state: UpdateStatus;
  private offered: Release | undefined;
  private prepared: string | undefined;
  private checking: Promise<void> | undefined;
  private applying: Promise<void> | undefined;
  private readonly cancellation = new AbortController();
  private code: string;
  private readonly operations: UpdateOperations;
  constructor(version: string, code: string, operations: UpdateOperations) {
    this.code = code; this.operations = operations;
    this.state = { phase: 'current', currentVersion: version, message: '尚未检查更新。' };
  }
  // A public, non-credential identifier scopes dismissed notices to this launch.
  status(): UpdateStatus { return { ...this.state, launchId: this.launchId }; }
  check(): Promise<void> {
    if (this.cancellation.signal.aborted) return Promise.resolve();
    if (this.applying) return this.applying;
    this.checking ??= this.discover().finally(() => { this.checking = undefined; }); return this.checking;
  }
  private async discover(): Promise<void> {
    const cachedRelease = this.offered, cachedCode = this.prepared;
    this.state = { phase: 'checking', currentVersion: this.state.currentVersion, message: '正在检查更新…' };
    try {
      const release = await this.operations.discover(this.cancellation.signal);
      if (!release || compareVersions(release.version, this.state.currentVersion) <= 0) { this.state = { phase: 'current', currentVersion: this.state.currentVersion, message: '已是当前可用的正式版本。' }; this.offered = undefined; this.prepared = undefined; return; }
      this.offered = release;
      this.state = { phase: release.compatible ? 'downloading' : 'manual', currentVersion: this.state.currentVersion, latestVersion: release.version, releaseUrl: release.url, message: release.compatible ? '发现新版，正在后台准备；可以继续学习。' : '此版本涉及运行时或数据格式升级，请先备份，再按安装说明手动升级。' };
      if (!release.compatible) return;
      this.prepared = cachedRelease?.sha256 === release.sha256 && cachedRelease.version === release.version && cachedCode ? cachedCode : await this.operations.prepare(release, this.cancellation.signal);
      this.state = { ...this.state, phase: 'ready', message: '新版已准备好，课堂空闲时可以重启更新。' };
    } catch (error) { this.state = { ...this.state, phase: 'error', message: updateFailure(error) }; }
  }
  apply(delayMs = 0): Promise<void> {
    if (this.cancellation.signal.aborted) return Promise.reject(new Error('启动器已停止。'));
    if (this.applying) return this.applying;
    if (this.state.phase !== 'ready' || !this.offered || !this.prepared) return Promise.reject(new Error('新版尚未准备好，请先检查更新。'));
    const release = this.offered, nextCode = this.prepared;
    this.state = { ...this.state, phase: 'restarting', message: '正在重启更新，请保持页面打开…' };
    this.applying = (async () => {
      if (delayMs) await new Promise<void>(done => setTimeout(done, delayMs));
      await this.switchTo(nextCode, release);
    })().finally(() => { this.applying = undefined; }); return this.applying;
  }
  async close(): Promise<void> {
    this.cancellation.abort();
    await Promise.allSettled([this.checking, this.applying]);
  }
  private async switchTo(nextCode: string, release: Release): Promise<void> {
    let stopAttempted = false;
    try {
      // A failed stop may already have terminated the worker. Recovery must
      // also run after partial shutdown, never merely claim the old Host survived.
      stopAttempted = true;
      await this.operations.stop();
      await this.operations.upgrade(nextCode);
      await this.operations.start(nextCode);
      await this.operations.commit(nextCode, release);
      this.code = nextCode; this.offered = undefined; this.prepared = undefined;
      this.state = { phase: 'current', currentVersion: release.version, message: '已更新，可以继续学习。' };
    } catch {
      try {
        if (stopAttempted) { await this.operations.stop(); await this.operations.upgrade(this.code); await this.operations.start(this.code); }
        this.state = { ...this.state, phase: 'error', message: '更新未完成，已恢复原版本；可以继续学习，稍后重试。' };
      } catch { this.state = { ...this.state, phase: 'error', message: '更新未完成，原版本也未能启动。请在终端查看错误并按安装说明恢复。' }; }
    }
  }
}
