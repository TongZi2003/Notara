import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { packageBin } from './package-bin.ts';

export const REPOSITORY = 'TongZi2003/Notara';
export const MANIFEST_NAME = 'notara-update.json';
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
export async function prepareRelease(release: Release, fetcher: typeof fetch = fetch, cacheRoot = join(homedir(), '.notara', 'releases'), signal?: AbortSignal): Promise<string> {
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
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
    const installed = join(cacheRoot, `${release.version}-${release.sha256.slice(0, 12)}-${Date.now()}`);
    await rename(staging, installed); return installed;
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
