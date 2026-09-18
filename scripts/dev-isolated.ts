import { spawn } from 'node:child_process';
import { appendFile, copyFile, cp, mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Directory links need no privilege on Windows only as junctions; 'dir' stays elsewhere.
const dirLink = process.platform === 'win32' ? 'junction' as const : 'dir' as const;

export interface IsolatedRuntime {
  readonly authUrl: string;
  readonly root: string;
  log(): string;
  setHostEnabled(enabled: boolean): Promise<void>;
  setClientEnabled(enabled: boolean): Promise<void>;
  rebuildClient(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

/** Boot only this task's empty workspace through the released DSH launcher. */
export async function startIsolated(options: { hostEnabled?: boolean; clientEnabled?: boolean; testModel?: boolean } = {}): Promise<IsolatedRuntime> {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
  const root = await mkdtemp(join(tmpdir(), 'studyforge-dsh-'));
  try {
    return await boot(root, options);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** A trial instance keeps its DSH_HOME and classroom directory across restarts:
 * same assembly as the isolated runtime, minus the disposable temp root. */
export async function startPersistent(root: string, options: { hostEnabled?: boolean; clientEnabled?: boolean; testModel?: boolean; port?: number } = {}): Promise<IsolatedRuntime> {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
  await mkdir(root, { recursive: true });
  return boot(root, { ...options, persist: true });
}

async function boot(root: string, options: { hostEnabled?: boolean; clientEnabled?: boolean; testModel?: boolean; port?: number; persist?: boolean }): Promise<IsolatedRuntime> {
  const home = join(root, 'home');
  const workspace = join(root, 'classroom');
  await Promise.all([mkdir(home), mkdir(workspace)]);
  // The upstream testing notice is a one-time modal; seed its acknowledgement
  // (ui-onboarding.welcomeNoticeVersion in dsh-client-ui-settings-models) so
  // isolated runs behave like a real install that already read it.
  await writeFile(join(home, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n');
  const plugins = join(root, 'plugins');
  await mkdir(plugins);
  await symlink(join(project, 'node_modules'), join(plugins, 'node_modules'), dirLink);
  const localPackages = ['contracts', 'domain', 'host', 'client'];
  for (const name of localPackages) {
    const target = join(plugins, name);
    await mkdir(target);
    await copyFile(join(project, 'packages', name, 'package.json'), join(target, 'package.json'));
    await cp(join(project, 'packages', name, 'lib'), join(target, 'lib'), { recursive: true });
    if (name === 'host') await cp(join(project, 'packages/host/presets'), join(target, 'presets'), { recursive: true });
    // Local package imports must stay inside the same build snapshot. External
    // libraries resolve through the parent node_modules link as before.
    const scope = join(target, 'node_modules', '@studyforge');
    await mkdir(scope, { recursive: true });
    for (const dependency of localPackages) await symlink(join(plugins, dependency), join(scope, dependency === 'client' ? 'dsh-client' : dependency), dirLink);
  }
  const patch = join(home, 'cordis.patch.yml');
  if (options.testModel) {
    await mkdir(join(plugins, 'test-model'));
    await writeFile(join(plugins, 'test-model/package.json'), '{"type":"module"}');
    await build({ entryPoints: [join(project, 'scripts/fixtures/test-model.ts')], outfile: join(plugins, 'test-model/index.js'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
  }
  let hostEnabled = options.hostEnabled ?? true;
  let clientEnabled = options.clientEnabled ?? true;
  async function writePatch(): Promise<void> {
    const entries = [
      ...(options.testModel ? [{ id: 'studyforge-test-model', name: join(plugins, 'test-model/index.js'), config: { logPath: join(root, 'model-requests.jsonl') } }] : []),
      ...(hostEnabled ? [{ id: 'studyforge-host', name: join(plugins, 'host/lib/types/index.js'), config: { root: workspace, timeZone: 'Asia/Shanghai' } }] : []),
      ...(clientEnabled ? [{ id: 'studyforge-client', name: join(plugins, 'client/lib/types/index.js') }] : []),
    ];
    await writeFile(`${patch}.next`, JSON.stringify([
      ...(options.testModel ? [{ id: 'agent-default-model', config: { provider: 'studyforge-test', model: 'study-model-a' } }, { id: 'llm-deepseek', disabled: true }] : []),
      { id: 'fs-sandbox', disabled: hostEnabled },
      { id: 'agent-presets', config: hostEnabled ? {
        default: 'studyforge-learning', roots: [{ path: join(plugins, 'host/presets'), trust: 'system' }],
        includeShippedRoot: false, includeUserRoot: false,
      } : { default: 'standard', roots: [], includeShippedRoot: true, includeUserRoot: true } },
      ...(entries.length ? [{ insert: entries }] : []),
    ]));
    await rename(`${patch}.next`, patch);
  }
  async function setHostEnabled(enabled: boolean): Promise<void> { hostEnabled = enabled; await writePatch(); }
  async function setClientEnabled(enabled: boolean): Promise<void> { clientEnabled = enabled; await writePatch(); }
  async function rebuildClient(): Promise<void> {
    await appendFile(join(plugins, 'client/lib/client.js'), `\n// isolated HMR revision ${crypto.randomUUID()}\n`);
  }
  await writePatch();
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') || key.startsWith('STUDYFORGE_')) delete env[key];
  }
  env.DSH_HOME = home;
  env.DSH_TELEMETRY_DISABLED = '1';
  function launch() {
    const child = spawn(process.execPath, [join(project, 'node_modules/.bin/dsh'), 'web', '--host', '127.0.0.1', '--port', String(options.port ?? 0), '--no-open'], {
      cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let authUrl = '';
    let spawnError: Error | undefined;
    const exited = new Promise<void>(resolveExit => {
      child.once('exit', () => { resolveExit(); });
      child.once('error', error => { spawnError = error; resolveExit(); });
    });
    // All persisted and reported logs redact the temporary browser login token.
    const redact = (text: string): string => text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
      authUrl = /dsh web: (http:\/\/\S+)/.exec(output)?.[1] ?? authUrl;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    async function stopProcess(): Promise<void> {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        try { await exited; } finally { clearTimeout(timer); }
      }
    }
    async function ready(): Promise<void> {
      const deadline = Date.now() + 45_000;
      while (!authUrl) {
        if (spawnError) throw new Error(`DSH spawn failed: ${spawnError.message}`);
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`DSH boot failed: ${redact(output)}`);
        if (Date.now() > deadline) throw new Error(`DSH boot timed out: ${redact(output)}`);
        await new Promise(resolveReady => setTimeout(resolveReady, 50));
      }
      // launcher.json carries the live authUrl so a wrapper never has to parse
      // stdout for the login address — console encoding made that brittle on
      // Windows. The trial root already holds DSH_HOME secrets; the token URL
      // is the same trust level.
      await writeFile(join(root, 'launcher.json'), JSON.stringify({ pid: child.pid, parentPid: process.pid, workspace, node: process.versions.node, authUrl }));
    }
    return { child, stopProcess, ready, authUrl: () => authUrl, log: () => redact(output) };
  }
  let active = launch(), stopping: Promise<void> | undefined;
  let pastLog = '';
  function stop(): Promise<void> {
    stopping ??= (async () => { await active.stopProcess(); if (!options.persist) await rm(root, { recursive: true, force: true }); })();
    return stopping;
  }
  async function restart(): Promise<void> {
    if (stopping) throw new Error('Runtime already stopping');
    await active.stopProcess(); pastLog += active.log() + '\n';
    active = launch();
    try { await active.ready(); } catch (error) { await stop(); throw error; }
  }
  try { await active.ready(); } catch (error) { await stop(); throw error; }
  return { get authUrl() { return active.authUrl(); }, root, log: () => pastLog + active.log(), setHostEnabled, setClientEnabled, rebuildClient, restart, stop };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const runtime = await startIsolated();
  console.log(`StudyForge: ${new URL(runtime.authUrl).origin}/`);
  console.log(`Isolated data: ${runtime.root}`);
  console.log('Authentication URL is kept in memory; browser tests use the same fixture.');
  process.once('SIGINT', () => { void runtime.stop(); });
  process.once('SIGTERM', () => { void runtime.stop(); });
}
