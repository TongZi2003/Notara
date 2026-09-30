import { spawn } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginVersions } from './vault-launcher-state.ts';
import { codeContract, discoverRelease, prepareRelease, runPackageScript, UpdateController } from './vault-updates.ts';
import type { Release } from './vault-updates.ts';
import { startUpdateServer } from './vault-update-server.ts';

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

interface Worker { authUrl: string; stop(): Promise<void> }
export async function superviseVault(root: string, code: string, port?: number, updates?: { discover(): Promise<Release | null>; prepare(release: Release): Promise<string> }): Promise<{ authUrl: string; controller: UpdateController; stop(): Promise<void> }> {
  let active: Worker | undefined;
  let activeCode = code;
  let activePort = port;
  let stopped = false;
  const contract = await codeContract(code);
  const installed = await pluginVersions(root, code);
  // A mutable checkout after git pull is not the old code needed for rollback.
  // Start the supervisor only after the explicit local snapshot upgrade.
  if (installed.snapshot && installed.snapshot !== contract.version) throw new Error('插件快照与启动代码版本不同。先运行 npm run vault:upgrade，再启动；课堂与资料会保留。');
  const controller: UpdateController = new UpdateController(contract.version, code, {
    discover: async signal => { if (updates) return updates.discover(); const current = await codeContract(activeCode); return discoverRelease(controller.status().currentVersion, current.runtime, fetch, signal); },
    prepare: (release, signal) => updates ? updates.prepare(release) : prepareRelease(release, fetch, undefined, signal),
    stop: async () => { await active?.stop(); active = undefined; },
    upgrade: next => runPackageScript(next, 'vault-upgrade.ts', ['--root', root, '--keep-source']),
    start: async next => { active = await launch(next); },
    commit: async (next, release) => {
      const path = pointerPath(root), pending = path + '.next';
      await writeFile(pending, JSON.stringify({ format: 1, code: next, version: release.version, sha256: release.sha256 }), { mode: 0o600 });
      await rename(pending, path); activeCode = next;
    },
  });
  const bridge = await startUpdateServer(controller);
  async function launch(source: string): Promise<Worker> {
    if (stopped) throw new Error('启动器已停止。');
    const child = spawn(process.execPath, ['--import', pathToFileURL(join(source, 'node_modules/tsx/dist/loader.mjs')).href, join(source, 'scripts/vault-process.ts'), root, String(activePort ?? NaN)], {
      cwd: source, env: { ...process.env, NOTARA_UPDATE_URL: bridge.url, NOTARA_UPDATE_TOKEN: bridge.token }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true,
    });
    let exited = false;
    const exit = new Promise<void>(done => { child.once('exit', () => { exited = true; done(); }); child.once('error', () => { exited = true; done(); }); });
    const stop = async () => {
      if (exited) return;
      if (child.connected) child.send({ type: 'stop' });
      const timer = setTimeout(() => { child.kill('SIGTERM'); }, 15_000);
      try { await exit; } finally { clearTimeout(timer); }
    };
    try {
      const authUrl = await new Promise<string>((done, reject) => {
        const timer = setTimeout(() => { reject(new Error('更新后的服务启动超时。')); }, 90_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', status => { clearTimeout(timer); reject(new Error(`学习服务未能启动（退出码 ${status ?? '未知'}）。`)); });
        child.on('message', (value: unknown) => {
          if (value && typeof value === 'object' && 'type' in value && value.type === 'ready' && 'authUrl' in value && typeof value.authUrl === 'string') { clearTimeout(timer); done(value.authUrl); }
        });
      });
      activePort = Number(new URL(authUrl).port);
      return { authUrl, stop };
    } catch (error) { await stop(); throw error; }
  }
  try { active = await launch(code); }
  catch (error) { await bridge.close(); throw error; }
  void controller.check();
  const interval = setInterval(() => { void controller.check(); }, 30 * 60_000); interval.unref();
  return { authUrl: active.authUrl, controller, async stop() { clearInterval(interval); await controller.close(); stopped = true; await active?.stop(); await bridge.close(); } };
}
