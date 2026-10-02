import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { liveVaultUrl } from '../../scripts/vault-launcher-state.ts';
import { packageBin } from '../../scripts/package-bin.ts';

const execFileAsync = promisify(execFile);
const project = resolve('.');
const coldLoadMs = 60_000;

async function isolatedEnvironment(directory: string, extraPreload = ''): Promise<NodeJS.ProcessEnv> {
  const profile = join(directory, 'isolated user profile');
  const preload = join(directory, 'isolated CLI preload.mjs');
  await mkdir(profile, { recursive: true });
  await writeFile(preload, `
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (target.hostname === 'api.github.com') return new Response(null, { status: 404 });
  if (['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) return nativeFetch(input, init);
  throw new Error('Network access blocked by isolated cold-launch test: ' + target.hostname);
};
${extraPreload}
`);
  return {
    ...process.env,
    USERPROFILE: profile,
    APPDATA: join(profile, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(profile, 'AppData', 'Local'),
    HOME: profile,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`.trim(),
  };
}

test('desktop start waits for a sixty-second cold controller load and preserves the isolated classroom', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Notara cold desktop CLI & '));
  const root = join(directory, 'synthetic runtime');
  const config = join(directory, 'private config', 'remote.json');
  const timingPath = join(directory, 'controller load timing.json');
  const cancelPath = join(directory, 'cancel cold load');
  let seed: Awaited<ReturnType<typeof startVaultPersistent>> | undefined;
  let cleanup: (() => Promise<unknown>) | undefined;
  try {
    const env = await isolatedEnvironment(directory, `
if (process.argv.includes('__supervisor')) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const timingPath = ${JSON.stringify(timingPath)};
  const cancelPath = ${JSON.stringify(cancelPath)};
  const timing = { startedAt: Date.now(), pid: process.pid };
  await writeFile(timingPath, JSON.stringify(timing));
  const cancelled = await new Promise(resolve => {
    const finish = setTimeout(() => { clearInterval(check); resolve(false); }, ${coldLoadMs});
    const check = setInterval(async () => {
      if (await readFile(cancelPath, 'utf8').catch(() => '') === 'cancel') {
        clearTimeout(finish); clearInterval(check); resolve(true);
      }
    }, 150);
  });
  await writeFile(timingPath, JSON.stringify({ ...timing, cancelled, loadedAt: Date.now() }));
  if (cancelled) process.exit(0);
}
`);
    seed = await startVaultPersistent(root, { port: 0, testModel: true });
    const port = Number(new URL(seed.authUrl).port);
    expect(port).toBeGreaterThan(0);
    const retained = join(root, 'workspace', 'vault', '卡片', '冷启动保留.md');
    await mkdir(join(retained, '..'), { recursive: true });
    await writeFile(retained, '# 冷启动保留\n合成学习资料。\n');
    await seed.stop(); seed = undefined;
    const tsx = packageBin(project, 'tsx', 'tsx');
    const desktop = (action: 'start' | 'stop') => execFileAsync(process.execPath, [
      tsx, join(project, 'scripts', 'desktop-vault.ts'), action,
      '--root', root, '--config', config,
      ...(action === 'start' ? ['--port', String(port), '--no-open'] : []),
    ], { cwd: project, env, encoding: 'utf8', timeout: 150_000, maxBuffer: 64_000, windowsHide: true });
    cleanup = () => desktop('stop');
    const startedAt = Date.now();
    const started = await desktop('start');
    const elapsedMs = Date.now() - startedAt;
    expect(started.stdout).toContain('Notara 已在后台运行');
    expect(Number(new URL((await liveVaultUrl(root))!).port)).toBe(port);
    const timing = JSON.parse(await readFile(timingPath, 'utf8')) as { startedAt: number; loadedAt: number; cancelled: boolean };
    expect(timing.cancelled).toBe(false);
    expect(timing.loadedAt - timing.startedAt).toBeGreaterThanOrEqual(coldLoadMs);
    expect(elapsedMs).toBeGreaterThanOrEqual(coldLoadMs);
    expect(await readFile(retained, 'utf8')).toContain('合成学习资料');
    expect((await desktop('stop')).stdout).toContain('Notara 已关闭');
    expect(await liveVaultUrl(root)).toBeUndefined();
    const reportDirectory = join(project, '.runtime', 'release-0231');
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(join(reportDirectory, 'integration-cold-launch-report.json'), JSON.stringify({
      simulatedControllerLoadMs: timing.loadedAt - timing.startedAt,
      desktopStartElapsedMs: elapsedMs,
      isolatedDataRoot: root,
      syntheticProvider: true,
      externalNetworkBlocked: true,
      retainedFiles: true,
      stopped: true,
    }, null, 2) + '\n');
  } finally {
    // Cancel only this fixture's delayed preloader if start failed before the
    // controller published state; it must not wake up after the test cleans up.
    await writeFile(cancelPath, 'cancel');
    await seed?.stop();
    await cleanup?.().catch(() => undefined);
    const timing = JSON.parse(await readFile(timingPath, 'utf8').catch(() => 'null')) as { loadedAt?: number } | null;
    if (timing && !timing.loadedAt) {
      await expect.poll(async () => JSON.parse(await readFile(timingPath, 'utf8')) as { cancelled?: boolean }, { timeout: 5_000 }).toMatchObject({ cancelled: true });
    }
    expect(await liveVaultUrl(root).catch(() => undefined)).toBeUndefined();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);

test('remote CLI reports a failed startup immediately while waiting for controller readiness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Notara failed controller CLI '));
  const root = join(directory, 'synthetic runtime');
  const config = join(directory, 'private config', 'remote.json');
  const token = randomBytes(32).toString('hex');
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
    requests++;
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      running: requests < 3, phase: requests < 3 ? 'starting' : 'failed',
      ownsVault: true, runtimeRoot: root, remoteActive: false,
      ...(requests < 3 ? {} : { error: 'synthetic cold controller startup failed' }),
    }));
  });
  try {
    await mkdir(root, { recursive: true });
    const canonicalRoot = await realpath(root);
    await mkdir(join(config, '..'), { recursive: true });
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test controller did not bind a port.');
    await writeFile(config.replace(/\.json$/, '.controller.json'), JSON.stringify({
      format: 1, pid: process.pid, startedAt: Date.now(), runtimeRoot: canonicalRoot,
      endpoint: `http://127.0.0.1:${address.port}/`, token,
      phase: 'starting', ownsVault: true, remoteActive: false,
    }));
    const env = await isolatedEnvironment(directory);
    await expect(execFileAsync(process.execPath, [
      packageBin(project, 'tsx', 'tsx'), join(project, 'scripts', 'remote-vault.ts'),
      'local-start', '--root', root, '--config', config,
    ], { cwd: project, env, encoding: 'utf8', timeout: 15_000, maxBuffer: 64_000, windowsHide: true })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('synthetic cold controller startup failed'),
    });
    expect(requests).toBe(3);
  } finally {
    await new Promise<void>(done => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
