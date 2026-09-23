import { chmod, cp, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import lockfile from 'proper-lockfile';
import { ensureVaultAliases, readVaultState, writeVaultState, validateVaultPort } from './vault-launcher-state.ts';
import { VAULT_TEST_MODEL, VAULT_TEST_PROVIDER } from './fixtures/vault-test-model.ts';

await import('./build-native-vault.ts');

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
}

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
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** A user runtime is initialized once. Neither stop nor failed boot deletes it. */
export async function startVaultPersistent(rootInput: string, options: VaultPersistentOptions = {}): Promise<VaultRuntime> {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
  const root = resolve(rootInput);
  if (options.port !== undefined) validateVaultPort(options.port);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(root, { retries: 0, stale: 10_000 });
  let released = false;
  const unlock = async () => { if (!released) { released = true; await release(); } };
  try {
    let state = await readVaultState(root);
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
      async stop() { try { await runtime.stop(); } finally { await unlock(); } },
    };
  } catch (error) { await unlock(); throw error; }
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
  // Freeze this instance's plugin: another isolated build must not hot-reload
  // an in-progress browser test or change the version its classroom is using.
  const pluginRoot=join(root,'vault-plugin');
  await cp(join(project,'examples/native-vault'),pluginRoot,{recursive:true,filter:source=>!source.endsWith('.test.js')&&!source.endsWith('/node_modules')});
  await symlink(join(project,'node_modules'),join(pluginRoot,'node_modules'),dirLink);
  await mkdir(join(workspace, 'node_modules/@notara'), { recursive: true });
  await symlink(pluginRoot, join(workspace, 'node_modules/@notara/vault-native'), dirLink);
  await mkdir(join(home, 'profiles/web/node_modules/@notara'), { recursive: true });
  await symlink(pluginRoot, join(home, 'profiles/web/node_modules/@notara/vault-native'), dirLink);
  let pixelPluginRoot: string | undefined;
  if (options.pixelClassroom) {
    await (await import('./build-pixel-classroom.ts')).buildPixelClassroom();
    pixelPluginRoot = join(root, 'pixel-classroom-plugin');
    await mkdir(pixelPluginRoot);
    for (const file of ['package.json', 'index.js', 'client.js', 'dist']) {
      await cp(join(project, 'examples/pixel-classroom', file), join(pixelPluginRoot, file), { recursive: true });
    }
  }
  await writeFile(join(home, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n');
  if (options.testModel) await seedTestModel(root);
  await writeFile(join(home, 'cordis.patch.yml'), JSON.stringify([
    ...(options.testModel ? [
      { id: 'agent-default-model', config: { provider: VAULT_TEST_PROVIDER, model: VAULT_TEST_MODEL } },
      { id: 'llm-deepseek', disabled: true },
    ] : []),
    { id: 'agent-presets', config: { default: 'notara-teacher', roots: [{ path: join(pluginRoot,'presets'), trust: 'system' }], includeShippedRoot: true, includeUserRoot: false } },
    { insert: [
      { id: 'notara-vault-native', name: '@notara/vault-native' },
      ...(pixelPluginRoot ? [{ id: 'notara-pixel-classroom', name: join(pixelPluginRoot, 'index.js') }] : []),
      ...(options.testModel ? [{ id: 'notara-vault-test-model', name: join(root, 'plugins/vault-test-model/index.js'), config: { logPath: join(root, 'model-requests.jsonl'), repliesPath: join(root, 'teacher-replies.json') } }] : []),
    ] },
  ]));
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

async function bootVault(root: string, options: VaultOptions & { preserve?: boolean; port?: number; onReady?: (port: number) => Promise<void> }): Promise<VaultRuntime> {
  const home = join(root, 'home'), workspace = join(root, 'workspace');
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') && key !== 'DSH_HOME' && key !== 'DSH_TELEMETRY_DISABLED') delete env[key];
  }
  const redact = (text: string): string => text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
  let port = options.port ?? 0;
  function launch(): VaultProcess {
    const child = spawn(process.execPath, [`--max-http-header-size=${webMaxHeaderSizeBytes}`, join(project, 'node_modules/.bin/dsh'), 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let authUrl = '';
    let spawnError: Error | undefined;
    const exited = new Promise<void>(resolveExit => {
      child.once('exit', () => { resolveExit(); });
      child.once('error', error => { spawnError = error; resolveExit(); });
    });
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
      authUrl = /dsh web: (http:\/\/\S+)/.exec(output)?.[1] ?? authUrl;
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    async function stopProcess(): Promise<void> {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
        try { await exited; } finally { clearTimeout(timer); }
      }
    }
    async function ready(): Promise<void> {
      const deadline = Date.now() + bootTimeoutMs;
      while (!authUrl) {
        if (spawnError) throw new Error(`Notara Vault spawn failed: ${spawnError.message}`);
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Notara Vault boot failed: ${redact(output)}`);
        if (Date.now() > deadline) throw new Error(`Notara Vault boot timed out after ${bootTimeoutMs}ms: ${redact(output)}`);
        await new Promise(resolveReady => setTimeout(resolveReady, 50));
      }
      // launcher.json carries the live authUrl so a wrapper never parses stdout
      // for the login address; a restart rewrites it with the new pid and URL.
      if (options.preserve) port = Number(new URL(authUrl).port);
      await options.onReady?.(Number(new URL(authUrl).port));
      const launcher = join(root, 'launcher.json');
      await writeFile(launcher, JSON.stringify({ pid: child.pid, parentPid: process.pid, workspace, node: process.versions.node, testModel: options.testModel === true, authUrl }), { mode: 0o600 });
      await chmod(launcher, 0o600);
    }
    return { ready: ready(), stopProcess, authUrl: () => authUrl, log: () => redact(output) };
  }
  let active = launch();
  let pastLog = '';
  let stopping: Promise<void> | undefined;
  // stop() only clears the root once the child has actually exited: a boot that
  // failed mid-write must not be deleted out from under its own process.
  function stop(): Promise<void> {
    stopping ??= (async () => { await active.stopProcess(); if (!options.preserve) await rm(root, { recursive: true, force: true }); })();
    return stopping;
  }
  async function restart(): Promise<void> {
    if (stopping) throw new Error('Vault runtime already stopping');
    await active.stopProcess();
    pastLog += active.log() + '\n';
    active = launch();
    try { await active.ready; } catch (error) { await stop(); throw error; }
  }
  try { await active.ready; } catch (error) { await stop(); throw error; }
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
