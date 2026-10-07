import { spawn } from 'node:child_process';
import { appendFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import lockfile from 'proper-lockfile';
import { httpUrlPort, liveVaultUrl, pluginVersions } from './vault-launcher-state.ts';
import { VaultRecovery, validateVaultRecoveryPolicy, type VaultRecoveryPolicy, type VaultRecoveryStatus } from './vault-recovery.ts';
import { acquireCachedCodeLease, cleanupPreparedReleaseCache, codeContract, collectReleaseCache, defaultReleaseCacheRoot, discoverRelease, prepareRelease, releaseCachedCodeLease, runPackageScript, UpdateController } from './vault-updates.ts';
import type { Release } from './vault-updates.ts';
import { startUpdateServer } from './vault-update-server.ts';
import { createRemoteAccessService, type RemoteAccessDependencies, type RemoteAccessService } from './remote-access-service.ts';

const pointerPath = (root: string): string => join(root, 'notara-release.json');
export async function managedCode(root: string): Promise<string | undefined> {
  let text: string;
  try { text = await readFile(pointerPath(root), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const pointer = JSON.parse(text) as { format?: number; code?: string; version?: string };
  if (pointer.format !== 1 || typeof pointer.code !== 'string' || typeof pointer.version !== 'string') throw new Error('更新安装记录无效，请按安装说明重新升级。');
  const code = resolve(pointer.code);
  if ((await codeContract(code)).version !== pointer.version) throw new Error('更新代码目录已被修改，请按安装说明重新升级。');
  return code;
}
export async function clearManagedCode(root: string): Promise<void> { await rm(pointerPath(root), { force: true }); }

interface Worker { authUrl: string; alive(): boolean; stop(): Promise<void> }
interface SupervisorOptions { recoveryPolicy?: VaultRecoveryPolicy; shutdown?: () => Promise<void> }
export async function superviseVault(root: string, code: string, port?: number, updates?: { discover(): Promise<Release | null>; prepare(release: Release): Promise<string> }, remoteAccess?: RemoteAccessDependencies, options: SupervisorOptions = {}): Promise<{ authUrl: string; controller: UpdateController; remoteAccess: RemoteAccessService; recoveryStatus(): VaultRecoveryStatus; requestStop(): void; stop(): Promise<void> }> {
  // Reject an invalid policy before allocating the bridge, worker or root lock.
  validateVaultRecoveryPolicy(options.recoveryPolicy);
  let active: Worker | undefined;
  let activeCode = code;
  let lastStableCode = code;
  let rollbackCode = code;
  let pendingCode: string | undefined;
  let activePort = port;
  let stopped = false;
  let stopRequested = false;
  let recovery: VaultRecovery | undefined;
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;
  let updateTimer: ReturnType<typeof setInterval> | undefined;
  function requestStop(): void {
    stopRequested = true;
    clearInterval(recoveryTimer); clearInterval(updateTimer);
    recovery?.requestClose();
  }
  const contract = await codeContract(code);
  const remote = createRemoteAccessService(root, () => active?.authUrl, remoteAccess);
  const installed = await pluginVersions(root, code);
  // A mutable checkout after git pull is not the old code needed for rollback.
  // Start the supervisor only after the explicit local snapshot upgrade.
  if (installed.snapshot && installed.snapshot !== contract.version) throw new Error('插件快照与启动代码版本不同。先运行 npm run vault:upgrade，再启动；课堂与资料会保留。');
  const controller: UpdateController = new UpdateController(contract.version, code, {
    discover: async signal => { if (updates) return updates.discover(); const current = await codeContract(activeCode); return discoverRelease(controller.status().currentVersion, current.runtime, fetch, signal); },
    prepare: async (release, signal) => {
      const previous = pendingCode;
      pendingCode = updates
        ? await updates.prepare(release)
        : await prepareRelease(release, fetch, defaultReleaseCacheRoot(), signal);
      if (updates) {
        if (previous) {
          try { await releaseCachedCodeLease(previous); }
          catch { console.error('新版已准备好，但旧版本缓存未能完全清理。'); }
        }
      } else {
        await cleanupPreparedReleaseCache(defaultReleaseCacheRoot(), [activeCode, rollbackCode, pendingCode], previous);
      }
      return pendingCode;
    },
    stop: async () => {
      await recovery?.suspend();
      const errors: unknown[] = [];
      try { await remote.close(); } catch (error) { errors.push(error); }
      try { await stopWorker(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Could not cleanly stop the managed Vault runtime.');
    },
    upgrade: next => runPackageScript(next, 'vault-upgrade.ts', ['--root', root, '--keep-source']),
    start: async next => {
      if (next !== lastStableCode) rollbackCode = lastStableCode;
      active = await launch(next); activeCode = next;
    },
    commit: async (next, release) => {
      const path = pointerPath(root), pending = path + '.next';
      await writeFile(pending, JSON.stringify({ format: 1, code: next, version: release.version, sha256: release.sha256 }), { mode: 0o600 });
      await rename(pending, path); activeCode = next; lastStableCode = next;
      if (pendingCode) { await releaseCachedCodeLease(pendingCode).catch(() => {}); pendingCode = undefined; }
      if (!updates) {
        try { await collectReleaseCache(defaultReleaseCacheRoot(), [activeCode, rollbackCode]); }
        catch { console.error('Notara 已完成更新，但未能清理旧版本缓存。'); }
      }
    },
  });
  const bridge = await startUpdateServer(controller, remote, () => {
    requestStop();
    return options.shutdown ?? stop;
  });
  async function stopWorker(): Promise<void> {
    const worker = active;
    if (worker) { await worker.stop(); if (active === worker) active = undefined; }
  }
  async function launch(source: string, signal?: AbortSignal): Promise<Worker> {
    if (stopped || stopRequested) throw new Error('启动器已停止。');
    const cacheRoot = defaultReleaseCacheRoot();
    await acquireCachedCodeLease(source, cacheRoot);
    let leaseReleased = false;
    const releaseLease = async () => {
      if (leaseReleased) return;
      leaseReleased = true;
      await releaseCachedCodeLease(source);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, ['--import', pathToFileURL(join(source, 'node_modules/tsx/dist/loader.mjs')).href, join(source, 'scripts/vault-process.ts'), root, String(activePort ?? NaN)], {
        cwd: source, env: { ...process.env, NOTARA_UPDATE_URL: bridge.url, NOTARA_UPDATE_TOKEN: bridge.token,
          NOTARA_REMOTE_SETTINGS_URL: bridge.url, NOTARA_REMOTE_SETTINGS_TOKEN: bridge.token }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true,
      });
    } catch (error) { await releaseLease(); throw error; }
    let exited = false;
    const exit = new Promise<void>(done => { child.once('exit', () => { exited = true; done(); }); child.once('error', () => { exited = true; done(); }); });
    const stop = async () => {
      if (exited) { await releaseLease(); return; }
      if (child.connected) { try { child.send({ type: 'stop' }); } catch { /* The exit listener still owns completion. */ } }
      const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* Process may already have exited. */ } }, 15_000);
      try { await exit; } finally { clearTimeout(timer); await releaseLease(); }
    };
    let onAbort: (() => void) | undefined;
    try {
      const authUrl = await new Promise<string>((done, reject) => {
        const timer = setTimeout(() => { reject(new Error('更新后的服务启动超时。')); }, 90_000);
        onAbort = () => { clearTimeout(timer); reject(new Error('Vault recovery cancelled')); };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', status => { clearTimeout(timer); reject(new Error(`学习服务未能启动（退出码 ${status ?? '未知'}）。`)); });
        child.on('message', (value: unknown) => {
          if (value && typeof value === 'object' && 'type' in value && value.type === 'ready' && 'authUrl' in value && typeof value.authUrl === 'string') { clearTimeout(timer); done(value.authUrl); }
        });
      });
      activePort = httpUrlPort(new URL(authUrl));
      return { authUrl, alive: () => !exited, stop };
    } catch (error) { await stop(); throw error; }
    finally { if (onAbort) signal?.removeEventListener('abort', onAbort); }
  }
  try { active = await launch(code); }
  catch (error) { try { await remote.close(); } finally { await bridge.close(); } throw error; }
  let lastAuthUrl = active.authUrl;
  recovery = new VaultRecovery({
    alive: async () => !!active?.alive() && (await liveVaultUrl(root)) !== undefined,
    paused: () => stopRequested || controller.status().phase === 'restarting',
    stopWorker,
    startWorker: async signal => {
      if (stopRequested || controller.status().phase === 'restarting') throw new Error('Vault recovery cancelled');
      // A hard-killed wrapper cannot release its lock. Wait for the owned Host
      // to finish parent-disconnect cleanup and for the heartbeat to expire.
      // Normal acquisition removes a stale lock; never delete one ourselves.
      const deadline = Date.now() + 15_000;
      while ((await liveVaultUrl(root)) || await lockfile.check(root, { stale: 10_000 })) {
        if (stopRequested || signal.aborted) throw new Error('Vault recovery cancelled');
        if (Date.now() >= deadline) throw new Error('Vault recovery ownership was not released');
        await delay(200, undefined, { signal });
      }
      if (stopRequested || signal.aborted) throw new Error('Vault recovery cancelled');
      active = await launch(activeCode, signal); lastAuthUrl = active.authUrl;
    },
    report: async (event, status) => {
      // Lifecycle metadata only: never log authentication URLs, raw Host output
      // or classroom contents. This file survives the launching tool's exit.
      await appendFile(join(root, 'launcher-events.log'), JSON.stringify({ time: new Date().toISOString(), event, ...status }) + '\n', { mode: 0o600 });
    },
  }, options.recoveryPolicy);
  recoveryTimer = setInterval(() => { void recovery!.check(); }, 1000); recoveryTimer.unref();
  void controller.check();
  updateTimer = setInterval(() => { void controller.check(); }, 30 * 60_000); updateTimer.unref();
  let bridgeClosing: Promise<void> | undefined;
  async function stop(): Promise<void> {
    requestStop();
    const errors: unknown[] = [];
    try { await recovery!.close(); } catch (error) { errors.push(error); }
    try { await controller.close(); } catch (error) { errors.push(error); }
    if (pendingCode) {
      try { await releaseCachedCodeLease(pendingCode); pendingCode = undefined; }
      catch (error) { errors.push(error); }
    }
    stopped = true;
    try { await remote.close(); } catch (error) { errors.push(error); }
    const worker = active;
    if (worker) {
      try { await worker.stop(); if (active === worker) active = undefined; }
      catch (error) { errors.push(error); }
    }
    try {
      // A first stop can close the bridge while another owned resource fails.
      // Retrying that cleanup must not fail merely because this part is done.
      bridgeClosing ??= bridge.close().catch(error => { bridgeClosing = undefined; throw error; });
      await bridgeClosing;
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Could not cleanly stop the Notara Vault supervisor.');
  }
  return { get authUrl() { return active?.authUrl ?? lastAuthUrl; }, controller, remoteAccess: remote, recoveryStatus: () => recovery!.status(), requestStop, stop };
}
