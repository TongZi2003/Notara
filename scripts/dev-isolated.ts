import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface IsolatedRuntime {
  readonly authUrl: string;
  readonly root: string;
  log(): string;
  setHostEnabled(enabled: boolean): Promise<void>;
  stop(): Promise<void>;
}

/** Boot only this task's empty workspace through the released DSH launcher. */
export async function startIsolated(options: { hostEnabled?: boolean; clientEnabled?: boolean } = {}): Promise<IsolatedRuntime> {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
  const root = await mkdtemp(join(tmpdir(), 'studyforge-dsh-'));
  const home = join(root, 'home');
  const workspace = join(root, 'classroom');
  await Promise.all([mkdir(home), mkdir(workspace)]);
  const patch = join(home, 'cordis.patch.yml');
  const clientEnabled = options.clientEnabled ?? true;
  async function setHostEnabled(enabled: boolean): Promise<void> {
    const entries = [
      ...(enabled ? [{ id: 'studyforge-host', name: join(project, 'packages/host/lib/types/index.js') }] : []),
      ...(clientEnabled ? [{ id: 'studyforge-client', name: join(project, 'packages/client/lib/types/index.js') }] : []),
    ];
    await writeFile(patch, JSON.stringify(entries.length ? [{ insert: entries }] : []));
  }
  await setHostEnabled(options.hostEnabled ?? true);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') || key.startsWith('STUDYFORGE_')) delete env[key];
  }
  env.DSH_HOME = home;
  env.DSH_TELEMETRY_DISABLED = '1';
  const child = spawn(process.execPath, [join(project, 'node_modules/.bin/dsh'), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await writeFile(join(root, 'launcher.json'), JSON.stringify({ pid: child.pid, parentPid: process.pid, workspace, node: process.versions.node }));
  let output = '';
  let authUrl = '';
  const exited = once(child, 'exit');
  // All persisted and reported logs redact the temporary browser login token.
  const redact = (text: string): string => text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
  const collect = (chunk: Buffer): void => {
    output += chunk.toString();
    authUrl = /dsh web: (http:\/\/\S+)/.exec(output)?.[1] ?? authUrl;
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  async function stop(): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    await writeFile(join(root, 'boot.log'), redact(output));
  }
  try {
    const deadline = Date.now() + 45_000;
    while (!authUrl) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`DSH boot failed: ${redact(output)}`);
      if (Date.now() > deadline) throw new Error(`DSH boot timed out: ${redact(output)}`);
      await new Promise(resolveReady => setTimeout(resolveReady, 50));
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { authUrl, root, log: () => redact(output), setHostEnabled, stop };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const runtime = await startIsolated();
  console.log(`StudyForge: ${new URL(runtime.authUrl).origin}/`);
  console.log(`Isolated data: ${runtime.root}`);
  console.log('Authentication URL is kept in memory; browser tests use the same fixture.');
  process.once('SIGINT', () => { void runtime.stop(); });
  process.once('SIGTERM', () => { void runtime.stop(); });
}
