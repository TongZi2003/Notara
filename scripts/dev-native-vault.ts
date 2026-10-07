import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import lockfile from 'proper-lockfile';
import { ensureVaultAliases, httpUrlPort, installedPluginRoot, isBrowserBlockedPort, liveVaultUrl, mustUpgradeBeforeStart, pluginVersions, readVaultState, vaultPluginLinks, writeVaultState, validateVaultPort, upgradeBeforeStartMessage } from './vault-launcher-state.ts';
import { packageBin } from './package-bin.ts';
import { ensureWindowsPosix } from './windows-posix.ts';
import { withVaultBuiltSnapshot } from './vault-build-lock.ts';
import { confirmTaskkillExited } from './taskkill-result.ts';
import { acquireVaultRootLock } from './vault-root-lock.ts';
import { upgradeLegacySettings } from './legacy-settings.ts';
import { studentProfile } from './vault-profile.ts';
import { writePrivateFile } from './remote-access-config.ts';
import { VAULT_TEST_MODEL, VAULT_TEST_PROVIDER } from './fixtures/vault-test-model.ts';
// @ts-expect-error Native Vault is plain JS; the preset module has no declarations.
import { TEACHER_PRESET, TEACHER_PRESET_ID } from '../examples/native-vault/teacher-preset.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Released portable builds already carry validated client/teaching/font assets.
// A source checkout and ordinary installed updates keep their existing build path.
const prebuilt = await (await import('./prebuilt-vault.ts')).verifyPrebuiltVault(project);
if (!prebuilt) await import('./build-native-vault.ts');

// Directory links need no privilege on Windows only as junctions; 'dir' stays elsewhere.
const dirLink = process.platform === 'win32' ? 'junction' as const : 'dir' as const;
const bootTimeoutMs = 45_000;
const killGraceMs = 10_000;
// Browsers send all host cookies regardless of port. Random-port DSH instances
// leave distinct signed cookies, which can exceed Node's default 16 KiB before
// the authentication handler runs. Keep a bounded 64 KiB parsing allowance.
const webMaxHeaderSizeBytes = 64 * 1024;

function samplePdf(): Buffer {
  const pageText = (lines: string[]): string => {
    const commands = ['BT', '/F1 24 Tf', '72 720 Td', `(${lines[0]}) Tj`, '/F1 15 Tf'];
    for (const line of lines.slice(1)) commands.push('0 -34 Td', `(${line}) Tj`);
    commands.push('ET');
    const content = commands.join('\n');
    return `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`;
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    pageText(['Vector foundations', 'A basis gives a coordinate language.', 'Drag a rectangle to extract this passage.']),
    pageText(['Coordinates', 'A point can be described by its coordinates.', 'The same vector has algebraic and geometric views.']),
  ];
  const header = Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'binary');
  const chunks = [header], offsets = [0];
  let length = header.length;
  objects.forEach((object, index) => {
    offsets[index + 1] = length;
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii');
    chunks.push(chunk); length += chunk.length;
  });
  const xrefOffset = length;
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
}

export interface VaultRuntime {
  readonly authUrl: string;
  readonly root: string;
  log(): string;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

export interface VaultOptions {
  /** Boot the synthetic Vault adapter and native llm routing instead of any real provider route. */
  testModel?: boolean;
  /** Optional Pixel Agents demo, installed as a separate native DSH plugin. */
  pixelClassroom?: boolean;
  /** Tests only: exercise the legacy Bash file executor on POSIX. Windows
   * always uses its pinned native POSIX shell inside the teacher preset. */
  gitBash?: string;
}

/** Whether this instance's teacher runs Bash through Notara's Git Bash executor. */
const usesGitBash = (options: { gitBash?: string | undefined }): boolean => process.platform !== 'win32' && options.gitBash !== undefined;

export interface VaultPersistentOptions extends Omit<VaultOptions, 'pixelClassroom'> { port?: number }

/** Boot the vault plugin alone on a random port: temp DSH_HOME, temp
 * workspace seeded with pages, media and a real two-page PDF. */
export async function startVaultIsolated(options: VaultOptions = {}): Promise<VaultRuntime> {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-native-'));
  try {
    await seedVault(root, options);
    return await bootVault(root, options);
  } catch (error) {
    // The worker may still own handles if stopping failed. Preserve its root
    // instead of deleting underneath it or obscuring the cleanup failure.
    if (error instanceof VaultCleanupError) throw error;
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    throw error;
  }
}

/** A user runtime is initialized once. Neither stop nor failed boot deletes it. */
export async function startVaultPersistent(rootInput: string, options: VaultPersistentOptions = {}): Promise<VaultRuntime> {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
  const root = resolve(rootInput);
  if (options.port !== undefined) validateVaultPort(options.port);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const unlock = await acquireVaultRootLock(root);
  try {
    let state = await readVaultState(root);
    if (state) {
      const versions = await vaultVersions(root);
      if (mustUpgradeBeforeStart(versions)) throw new Error(upgradeBeforeStartMessage(versions));
    }
    if (!state) {
      if ((await readdir(root)).length) throw new Error('数据目录已存在且未登记为持久化 Vault；请先迁移，不能重新初始化。');
      await seedVault(root, options, false);
      state = { kind: 'notara-vault-persistent', version: 1, port: options.port ?? 57093, testModel: options.testModel === true };
      await writeVaultState(root, state);
    }
    if (options.testModel !== undefined && options.testModel !== state.testModel) throw new Error('Cannot change the model adapter of an existing Vault runtime');
    await ensureVaultAliases(root, state);
    const runtime = await bootVault(root, {
      testModel: state.testModel, preserve: true, port: options.port ?? state.port,
      onReady: async port => { state = { ...state!, port }; await writeVaultState(root, state); },
    });
    return { get authUrl() { return runtime.authUrl; }, root, log: () => runtime.log(), restart: () => runtime.restart(),
      async stop() { await runtime.stop(); await unlock(); },
    };
  } catch (error) { if (!(error instanceof VaultCleanupError)) await unlock(); throw error; }
}

/** The plugin version an instance runs, and the one this checkout would install. */
export function vaultVersions(root: string): Promise<{ snapshot: string | undefined; checkout: string | undefined }> {
  return pluginVersions(root, project);
}

/**
 * `npm run vault:upgrade`: give a stopped instance this checkout's plugin. The
 * old snapshot stays beside it as vault-plugin-<version>, the patch is written
 * again from the registered options, and dependencies link to this checkout.
 * Lessons and credentials are untouched. Only obsolete display seeds are migrated.
 */
export async function upgradeVaultPersistent(rootInput: string): Promise<{ upgraded: boolean; from: string | undefined; to: string | undefined; backup?: string }> {
  const root = resolve(rootInput);
  const state = await readVaultState(root);
  if (!state) throw new Error('这个目录不是已登记的 Vault 运行目录，没有可升级的内容。');
  if (await liveVaultUrl(root)) throw new Error('Vault 正在运行。先停止它（在运行它的终端窗口按 Ctrl+C，或关闭那个窗口），再升级。');
  let release: () => Promise<void>;
  try { release = await lockfile.lock(root, { retries: 0, stale: 10_000 }); }
  catch { throw new Error('Vault 正在运行或刚刚停止。先停止它，稍等十几秒再升级。'); }
  try {
    const { snapshot: from, checkout: to } = await vaultVersions(root);
    const pluginRoot = join(root, 'vault-plugin');
    const installed = await installedPluginRoot(root);
    const dependencyRoot = await realpath(join(installed, 'node_modules')).catch(() => undefined);
    if (from === to && installed === await realpath(pluginRoot).catch(() => undefined) && dependencyRoot === await realpath(join(project, 'node_modules'))) return { upgraded: false, from, to };
    const patchPath = join(root, 'home', 'cordis.patch.yml');
    const patch = await readFile(patchPath, 'utf8');
    // This file is generated JSON. Retain the optional classroom across regeneration.
    const pixelRow = (JSON.parse(patch) as { insert?: { id?: string; name?: string }[] }[])
      .flatMap(row => row.insert ?? []).find(row => row.id === 'notara-pixel-classroom');
    const pixelPluginRoot = pixelRow?.name ? dirname(pixelRow.name) : undefined;
    const settingsPath = join(root, 'home', 'settings.yaml');
    const settings = await readFile(settingsPath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    const profilePath = join(root, 'home/profiles/web/cordis.patch.yml');
    const profile = await readFile(profilePath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    const nextProfile = studentProfile(profile);
    const present = await lstat(pluginRoot).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
    const fixedRoot = present ? await realpath(pluginRoot) : undefined;
    const fixedVersion = present ? (JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8')) as { version: string }).version : undefined;
    let backup = `${pluginRoot}-${fixedVersion ?? 'unknown'}`;
    for (let n = 2; await lstat(backup).then(() => true, () => false); n++) backup = `${pluginRoot}-${fixedVersion ?? 'unknown'}-${n}`;
    const rollback: (() => Promise<void>)[] = [];
    const replacedLinks: string[] = [];
    const writeAtomic = async (path: string, text: string) => {
      const pending = `${path}.${randomUUID()}.next`;
      try { await writeFile(pending, text, { mode: 0o600 }); await rename(pending, path); }
      finally { await rm(pending, { force: true }); }
    };
    const replaceLink = async (path: string, target: string) => {
      const old = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (old && !old.isSymbolicLink()) throw new Error(`安装链接被普通文件或目录占用：${path}`);
      const saved = `${path}.${randomUUID()}.previous`;
      if (old) { await rename(path, saved); replacedLinks.push(saved); }
      rollback.push(async () => { await rm(path, { force: true }); if (old) await rename(saved, path); });
      await symlink(target, path, dirLink);
    };
    try {
      if (present) await rename(pluginRoot, backup);
      rollback.push(async () => { await rm(pluginRoot, { recursive: true, force: true }); if (present) await rename(backup, pluginRoot); });
      await installPluginSnapshot(root);
      for (const path of vaultPluginLinks(root)) await replaceLink(path, pluginRoot);
      rollback.push(() => writeAtomic(patchPath, patch));
      await writeAtomic(patchPath, vaultPatch(root, pluginRoot, { testModel: state.testModel, gitBash: usesGitBash({}), ...(pixelPluginRoot ? { pixelPluginRoot } : {}) }));
      rollback.push(async () => { if (profile === undefined) await rm(profilePath, { force: true }); else await writeAtomic(profilePath, profile); });
      await writeAtomic(profilePath, nextProfile);
      if (state.testModel) await replaceLink(join(root, 'plugins', 'node_modules'), join(project, 'node_modules'));
      // Before DSH 0.2.0 first imports it: the old seeds become what the Vault sets now.
      if (settings !== undefined && upgradeLegacySettings(settings) !== settings) {
        rollback.push(() => writeAtomic(settingsPath, settings));
        await writeAtomic(settingsPath, upgradeLegacySettings(settings));
      }
    } catch (error) {
      const failures: unknown[] = [];
      for (const undo of rollback.reverse()) { try { await undo(); } catch (failure) { failures.push(failure); } }
      if (failures.length) throw new AggregateError([error, ...failures], '升级失败，部分回滚也失败；请保留数据目录并从整份备份恢复。');
      throw error;
    }
    for (const path of replacedLinks) await rm(path, { force: true });
    return { upgraded: true, from, to, backup: installed === fixedRoot ? backup : installed };
  } finally { await release(); }
}

/** Roots, seed files and the plugin patch are written once per instance: a
 * restart reboots the same DSH_HOME/workspace and must never reseed facts. */
async function seedVault(root: string, options: VaultOptions, samples = true): Promise<void> {
  const home = join(root, 'home'), workspace = join(root, 'workspace');
  await Promise.all([mkdir(home, { recursive: true }), mkdir(workspace, { recursive: true })]);
  const workspacePath = await realpath(workspace);
  const workspaceId = randomUUID(), workspaceNow = new Date().toISOString();
  await mkdir(join(home, 'storages'), { recursive: true });
  await writeFile(join(home, 'storages/workspace.json'), `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
    tables: { workspaces: { [workspaceId]: { path: workspacePath, title: 'Notara Vault', sessionIds: [], createdAt: workspaceNow, updatedAt: workspaceNow } } },
  }, null, 2)}\n`);
  await Promise.all([
    mkdir(join(workspace, 'vault/路线'), { recursive: true }),
    mkdir(join(workspace, 'vault/知识'), { recursive: true }),
    mkdir(join(workspace, 'vault/媒体'), { recursive: true }),
  ]);
  if (samples) await Promise.all([
    writeFile(join(workspace, 'vault/路线/向量路线.md'), `---
type: route
status: active
tags: [math]
---
# 向量学习路线

先从基底开始，再进入坐标表示。

- [ ] 理解基底
- [ ] 完成一个坐标例题

[[知识/向量]]
`),
    writeFile(join(workspace, 'vault/知识/向量.md'), `---
type: note
status: draft
tags: [math, vector]
---
# 向量

向量既可以用代数坐标表示，也可以用几何方向表示。

## 关键联系
- [ ] 能解释基底的作用
- [x] 看过一个例题

[[路线/向量路线]]
`),
    writeFile(join(workspace, 'vault/媒体/说明.html'), '<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:24px;color:#243}</style><h1>Vault 媒体示例</h1><p>HTML 文件以沙箱预览，可以复制 <code>![[媒体/说明.html]]</code> 嵌入到 Markdown。</p>'),
    writeFile(join(workspace, 'vault/媒体/色板.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#eef2ff"/><circle cx="150" cy="120" r="70" fill="#6370ff"/><circle cx="320" cy="120" r="70" fill="#ffb45c"/><circle cx="490" cy="120" r="70" fill="#55c79a"/></svg>'),
    writeFile(join(workspace, 'vault/媒体/向量讲义.pdf'), samplePdf()),
  ]);
  const pluginRoot=await installPluginSnapshot(root);
  await mkdir(join(workspace, 'node_modules/@notara'), { recursive: true });
  await symlink(pluginRoot, join(workspace, 'node_modules/@notara/vault-native'), dirLink);
  await mkdir(join(home, 'profiles/web/node_modules/@notara'), { recursive: true });
  await symlink(pluginRoot, join(home, 'profiles/web/node_modules/@notara/vault-native'), dirLink);
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), studentProfile(), { mode: 0o600 });
  let pixelPluginRoot: string | undefined;
  if (options.pixelClassroom) {
    if (!prebuilt) await (await import('./build-pixel-classroom.ts')).buildPixelClassroom();
    pixelPluginRoot = join(root, 'pixel-classroom-plugin');
    await mkdir(pixelPluginRoot);
    const copyPixel = async () => {
      for (const file of ['package.json', 'index.js', 'client.js', 'dist']) {
        await cp(join(project, 'examples/pixel-classroom', file), join(pixelPluginRoot!, file), { recursive: true });
      }
    };
    if (prebuilt) await copyPixel(); else await withVaultBuiltSnapshot(project, ['pixel-classroom'], copyPixel);
  }
  if (options.testModel) await seedTestModel(root);
  await writeFile(join(home, 'cordis.patch.yml'), vaultPatch(root, pluginRoot, { testModel: options.testModel === true, pixelPluginRoot, gitBash: usesGitBash(options) }));
}

/** Freeze this instance's plugin: another build must not hot-reload an
 * in-progress lesson or change the version its classroom is using. Seeding and
 * `npm run vault:upgrade` both install it this way; dependencies link to the
 * checkout that installs it. */
export async function installPluginSnapshot(root: string): Promise<string> {
  const pluginRoot=join(root,'vault-plugin');
  const copy = () => cp(join(project,'examples/native-vault'),pluginRoot,{recursive:true,filter:source=>!source.endsWith('.test.js')&&basename(source)!=='node_modules'});
  if (prebuilt) await copy(); else await withVaultBuiltSnapshot(project, ['native-vault'], copy);
  await symlink(join(project,'node_modules'),join(pluginRoot,'node_modules'),dirLink);
  return pluginRoot;
}

/** The DSH patch an instance boots with, derived only from its root and options. */
export function vaultPatch(root: string, pluginRoot: string, { testModel = false, pixelPluginRoot, gitBash = false }: { testModel?: boolean; pixelPluginRoot?: string | undefined; gitBash?: boolean } = {}): string {
  return JSON.stringify([
    // One ctx.shell per host: the Git Bash executor replaces the native one
    // (pwsh on Windows, the sandboxed bash elsewhere), under the same sandbox.
    ...(gitBash ? [{ id: process.platform === 'win32' ? 'pwsh-sandbox' : 'bash-sandbox', disabled: true }] : []),
    ...(testModel ? [
      { id: 'agent-default-model', config: { provider: VAULT_TEST_PROVIDER, model: VAULT_TEST_MODEL } },
      { id: 'llm-deepseek', disabled: true },
      { id: 'llm-deepseek-account', disabled: true },
    ] : []),
    // DSH 0.2.0: a preset is one `@deepseek-ai/dsh-agent-preset` row; the registry names the default.
    { id: 'agent-preset-registry', config: { default: TEACHER_PRESET_ID } },
    // Student display defaults live in the writable profile (vault-profile.ts).
    { insert: [
      { id: 'preset-notara-teacher', name: '@deepseek-ai/dsh-agent-preset', config: TEACHER_PRESET },
      { id: 'notara-vault-native', name: '@notara/vault-native' },
      ...(gitBash ? [{ id: 'notara-git-bash', name: '@notara/vault-native/git-bash-executor', config: { timeoutMs: 60000 } }] : []),
      ...(pixelPluginRoot ? [{ id: 'notara-pixel-classroom', name: join(pixelPluginRoot, 'index.js') }] : []),
      ...(testModel ? [{ id: 'notara-vault-test-model', name: join(root, 'plugins/vault-test-model/index.js'), config: { logPath: join(root, 'model-requests.jsonl'), repliesPath: join(root, 'teacher-replies.json') } }] : []),
    ] },
  ]);
}

/** Bundle the synthetic adapter outside the product package and give it a
 * local node_modules seam, exactly like the isolated launcher does. */
async function seedTestModel(root: string): Promise<void> {
  const plugins = join(root, 'plugins');
  await mkdir(join(plugins, 'vault-test-model'), { recursive: true });
  await symlink(join(project, 'node_modules'), join(plugins, 'node_modules'), dirLink);
  await writeFile(join(plugins, 'vault-test-model/package.json'), '{"type":"module"}\n');
  await build({ entryPoints: [join(project, 'scripts/fixtures/vault-test-model.ts')], outfile: join(plugins, 'vault-test-model/index.js'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
  // Both files live in the run's own root; the adapter only appends to the log
  // and reads whatever scripted replies this acceptance run writes.
  await writeFile(join(root, 'model-requests.jsonl'), '');
  await writeFile(join(root, 'teacher-replies.json'), '{}\n');
}

interface VaultProcess {
  readonly ready: Promise<void>;
  stopProcess(): Promise<void>;
  authUrl(): string;
  log(): string;
}

class BrowserBlockedVaultPortError extends Error {
  constructor(port: number) { super(`系统分配的端口 ${port} 被浏览器禁止访问，无法打开 Notara。`); }
}

class VaultCleanupError extends AggregateError {
  constructor(startup: unknown, cleanup: unknown) {
    super([startup, cleanup], 'Notara 启动失败，停止所属进程也未完成；已保留运行目录，请检查错误后重试关闭。');
  }
}

async function bootVault(root: string, options: VaultOptions & { preserve?: boolean; port?: number; onReady?: (port: number) => Promise<void> }): Promise<VaultRuntime> {
  let port = options.port ?? 0;
  validateVaultPort(port);
  const home = join(root, 'home'), workspace = join(root, 'workspace');
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') && key !== 'DSH_HOME' && key !== 'DSH_TELEMETRY_DISABLED') delete env[key];
  }
  // Windows uses a pinned native executable, verified before the Host boots.
  // Only the teacher preset replaces its shell; ordinary sessions retain pwsh.
  if (process.platform === 'win32') env.NOTARA_WINDOWS_POSIX = await ensureWindowsPosix(project);
  else if (options.gitBash !== undefined) env.NOTARA_GIT_BASH = options.gitBash;
  const redact = (text: string): string => text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
  function launch(): VaultProcess {
    const child = spawn(process.execPath, [`--max-http-header-size=${webMaxHeaderSizeBytes}`, '--import', pathToFileURL(join(project, 'scripts/vault-parent-guard.js')).href, packageBin(project, '@deepseek-ai/dsh', 'dsh'), 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    let output = '';
    let authUrl = '';
    let spawnError: Error | undefined;
    child.once('error', error => { spawnError = error; });
    const closed = new Promise<void>(resolveClose => { child.once('close', () => resolveClose()); });
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
      authUrl = /dsh web: (http:\/\/\S+)/.exec(output)?.[1] ?? authUrl;
    };
    child.stdout!.on('data', collect); child.stderr!.on('data', collect);
    async function stopProcess(): Promise<void> {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        // On Windows a signal only ends DSH itself; taskkill /T also ends the
        // shells and jobs it started, which would otherwise keep the port.
        const timer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
        try {
          if (process.platform === 'win32') {
            await new Promise<void>((resolveKill, reject) => {
              execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: killGraceMs, maxBuffer: 64_000 }, (error, stdout, stderr) => {
                if (!error) { resolveKill(); return; }
                void confirmTaskkillExited(error, child.pid!, stdout, stderr).then(gone => {
                  if (gone) resolveKill(); else reject(error);
                }, reject);
              });
            });
          } else child.kill('SIGTERM');
          // exit can precede pipe and descendant cleanup. Windows must finish
          // the owned taskkill tree operation before any workspace is removed.
          await closed;
        } finally { clearTimeout(timer); }
      } else {
        await closed;
      }
    }
    async function ready(): Promise<void> {
      const deadline = Date.now() + bootTimeoutMs;
      while (!authUrl) {
        if (spawnError) throw new Error(`Notara Vault spawn failed: ${spawnError.message}`);
        if (child.exitCode !== null || child.signalCode !== null) {
          if (/EADDRINUSE|EACCES/.test(output)) throw new Error(`端口 ${port} 无法使用：已被别的程序占用，或属于 Windows 预留的端口段。换一个端口启动，例如 npm run vault -- --port 47093；Windows 上可用 netsh interface ipv4 show excludedportrange protocol=tcp 查看预留段。\n${redact(output)}`);
          throw new Error(`Notara Vault boot failed: ${redact(output)}`);
        }
        if (Date.now() > deadline) throw new Error(`Notara Vault boot timed out after ${bootTimeoutMs}ms: ${redact(output)}`);
        await new Promise(resolveReady => setTimeout(resolveReady, 50));
      }
      // launcher.json carries the live authUrl so a wrapper never parses stdout
      // for the login address; a restart rewrites it with the new pid and URL.
      const actualPort = httpUrlPort(new URL(authUrl));
      if (isBrowserBlockedPort(actualPort)) throw new BrowserBlockedVaultPortError(actualPort);
      if (options.preserve) port = actualPort;
      await options.onReady?.(actualPort);
      const launcher = join(root, 'launcher.json');
      await writePrivateFile(launcher, JSON.stringify({ pid: child.pid, parentPid: process.pid, workspace, node: process.versions.node, testModel: options.testModel === true, authUrl }));
    }
    return { ready: ready(), stopProcess, authUrl: () => authUrl, log: () => redact(output) };
  }
  let active = launch();
  let pastLog = '';
  let stopping: Promise<void> | undefined;
  let stopRequested = false;
  async function waitUntilReady(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await active.ready; return; }
      catch (error) {
        // Keep the OS allocation atomic: bind port 0 in the actual Host and
        // retry only an unusable result, rather than probing/releasing a socket
        // that another process could claim before DSH starts. Stop each rejected
        // child before launching again; publish only the final usable URL.
        if (!(error instanceof BrowserBlockedVaultPortError) || port !== 0 || attempt >= 7) throw error;
        await active.stopProcess();
        pastLog += active.log() + '\n';
        active = launch();
      }
    }
  }
  // stop() only clears the root once the child has actually exited: a boot that
  // failed mid-write must not be deleted out from under its own process.
  function stop(): Promise<void> {
    // A kept root drops its login record with the process, so a later start
    // never mistakes an unrelated process that reused the pid for this Vault.
    stopRequested = true;
    if (!stopping) {
      const attempt = (async () => {
        await active.stopProcess();
        await rm(options.preserve ? join(root, 'launcher.json') : root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
      })();
      stopping = attempt;
      void attempt.catch(() => { if (stopping === attempt) stopping = undefined; });
    }
    return stopping;
  }
  async function restart(): Promise<void> {
    if (stopRequested) throw new Error('Vault runtime already stopping');
    await active.stopProcess();
    pastLog += active.log() + '\n';
    active = launch();
    await readyOrStop();
  }
  async function readyOrStop(): Promise<void> {
    try { await waitUntilReady(); }
    catch (error) {
      try { await stop(); } catch (cleanup) { throw new VaultCleanupError(error, cleanup); }
      throw error;
    }
  }
  await readyOrStop();
  return { get authUrl() { return active.authUrl(); }, root, log: () => pastLog + active.log(), restart, stop };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const testModel = process.argv.includes('--test-model');
  const runtime = await startVaultIsolated({ testModel });
  console.log(`Notara Vault: ${new URL(runtime.authUrl).origin}/`);
  console.log(`隔离数据目录：${runtime.root}`);
  if (testModel) console.log(`合成模型请求：${join(runtime.root, 'model-requests.jsonl')}`);
  process.once('SIGINT', () => { void runtime.stop(); });
  process.once('SIGTERM', () => { void runtime.stop(); });
}
