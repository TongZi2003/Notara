import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { liveVaultUrl } from '../../scripts/vault-launcher-state.ts';
import { packageBin } from '../../scripts/package-bin.ts';
import { startRemoteProxy, type RemoteProxy } from '../../scripts/remote-access-proxy.ts';
import { superviseVault } from '../../scripts/vault-supervisor.ts';

const execute = promisify(execFile);
const listen = (server: Server): Promise<number> => new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject);
    const address = server.address();
    if (!address || typeof address === 'string') reject(new Error('Synthetic listener did not bind'));
    else done(address.port);
  });
});
const close = (server: Server): Promise<void> => new Promise(done => { server.close(() => done()); server.closeAllConnections(); });

test('remote HTTP truncation aborts the downstream response instead of hanging or reporting successful completion', async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.write('synthetic partial response', () => { setTimeout(() => response.destroy(), 40); });
  });
  const localPort = await listen(upstream);
  const probe = createServer();
  const proxyPort = await listen(probe);
  await close(probe);
  let proxy: RemoteProxy | undefined;
  try {
    proxy = await startRemoteProxy({ localPort, proxyPort, publicHost: 'synthetic.example.invalid', username: 'synthetic-user', password: 'synthetic-password-42', getLoginUrl: async () => undefined });
    const result = await new Promise<{ kind: string; body: string }>(done => {
      let body = '';
      const finish = (kind: string): void => { clearTimeout(timer); done({ kind, body }); };
      const request = httpRequest({ hostname: '127.0.0.1', port: proxyPort, path: '/synthetic-stream',
        headers: { host: 'synthetic.example.invalid', authorization: `Basic ${Buffer.from('synthetic-user:synthetic-password-42').toString('base64')}` } }, response => {
        response.on('data', chunk => { body += String(chunk); });
        response.once('end', () => finish('end'));
        response.once('error', () => finish('error'));
      });
      const timer = setTimeout(() => { request.destroy(); finish('timeout'); }, 2000);
      request.once('error', () => finish('error'));
      request.end();
    });
    expect(result).toEqual({ kind: 'error', body: 'synthetic partial response' });
  } finally { await proxy?.close(); await close(upstream); }
});

test('a controller releases a crashed synthetic worker and permits Start to recover without changing learning data', async () => {
  const project = resolve('.');
  const base = await mkdtemp(join(tmpdir(), 'Notara lifecycle synthetic '));
  const code = join(base, 'synthetic code'), root = join(base, 'synthetic runtime');
  const config = join(base, 'private config', 'remote.json'), profile = join(base, 'synthetic profile');
  const statePath = config.replace(/\.[^./\\]+$/, '') + '.controller.json';
  const preload = join(base, 'block external fetch.mjs');
  await Promise.all(['scripts', 'examples/native-vault', 'docs/runtime'].map(name => mkdir(join(code, name), { recursive: true })));
  await mkdir(root, { recursive: true });
  await mkdir(profile, { recursive: true });
  for (const file of ['package.json', 'examples/native-vault/package.json', 'docs/runtime/update-contract.json'])
    await writeFile(join(code, file), await readFile(join(project, file)));
  await symlink(join(project, 'node_modules'), join(code, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(code, 'scripts/vault-process.ts'), `
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.argv[2];
const server = createServer((request, response) => {
  if (request.url === '/proof-exit') {
    response.end('synthetic worker exits'); setTimeout(() => process.exit(37), 50);
  } else if (request.url === '/proof-stall') {
    void writeFile(join(root, 'stall-recovery'), 'synthetic').then(() => { response.end('synthetic next worker will not become ready'); setTimeout(() => process.exit(38), 50); });
  } else if (request.url === '/proof-disappear') {
    response.end('synthetic listener exits'); setTimeout(() => server.close(), 50);
  } else if (request.url.includes('token=')) {
    response.writeHead(303, { location: './', 'set-cookie': 'dsh-auth-synthetic=fixture; Path=/; HttpOnly' }).end();
  } else response.end('synthetic worker');
});
const requestedPort = Number(process.argv[3]);
await new Promise(resolve => server.listen(Number.isFinite(requestedPort) ? requestedPort : 0, '127.0.0.1', resolve));
const port = server.address().port;
const authUrl = 'http://127.0.0.1:' + port + '/?token=synthetic-fixture-token';
await writeFile(join(root, 'vault-runtime.json'), JSON.stringify({ kind: 'notara-vault-persistent', version: 1, port, testModel: true }));
await writeFile(join(root, 'launcher.json'), JSON.stringify({ pid: process.pid, authUrl }));
process.on('message', message => {
  if (message?.type === 'stop') { server.closeAllConnections(); server.close(() => { if (process.connected) process.disconnect(); }); }
});
if (await readFile(join(root, 'stall-recovery'), 'utf8').catch(() => '')) await writeFile(join(root, 'recovery-start.entered'), 'starting');
else process.send?.({ type: 'ready', authUrl });
`);
  const { version } = JSON.parse(await readFile(join(code, 'examples/native-vault/package.json'), 'utf8')) as { version: string };
  await writeFile(join(root, 'notara-release.json'), JSON.stringify({ format: 1, code, version }));
  await writeFile(join(root, 'synthetic-learning.md'), '# Synthetic learning data remains unchanged\n');
  await writeFile(preload, `
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (target.hostname === 'api.github.com') return new Response(null, { status: 404 });
  if (['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) return nativeFetch(input, init);
  throw new Error('External network blocked by isolated lifecycle regression');
};
`);
  const env = { ...process.env, USERPROFILE: profile, HOME: profile, APPDATA: join(profile, 'AppData/Roaming'), LOCALAPPDATA: join(profile, 'AppData/Local'),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`.trim() };
  const command = (name: string) => execute(process.execPath, [packageBin(project, 'tsx', 'tsx'), join(project, 'scripts/remote-vault.ts'), name, '--root', root, '--config', config],
    { cwd: project, env, windowsHide: true, timeout: 90_000, maxBuffer: 64_000 });
  try {
    await command('local-start');
    for (const route of ['/proof-exit', '/proof-disappear']) {
      const url = await liveVaultUrl(root);
      expect(url).toBeDefined();
      const current = new URL(url!);
      const oldLauncher = JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8')) as { pid: number };
      await fetch(new URL(route, current.origin)).then(response => response.text());
      await expect.poll(async () => {
        if (!(await liveVaultUrl(root))) return false;
        const next = JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8')) as { pid: number };
        return next.pid !== oldLauncher.pid;
      }, { timeout: 30_000 }).toBe(true);
      expect((await command('status')).stdout).toContain('ready');
      expect(await liveVaultUrl(root)).toBeDefined();
      expect(new URL((await liveVaultUrl(root))!).origin).toBe(current.origin);
      expect(await readFile(join(root, 'synthetic-learning.md'), 'utf8')).toBe('# Synthetic learning data remains unchanged\n');
    }
    // Explicit Stop cancels a replacement stuck before IPC ready; it must not
    // wait for launch's normal 90 second timeout or leave its listener behind.
    await fetch(new URL('/proof-stall', (await liveVaultUrl(root))!)).then(response => response.text());
    await expect.poll(async () => lstat(join(root, 'recovery-start.entered')).then(() => true, () => false), { timeout: 15_000 }).toBe(true);
    const stopStarted = Date.now();
    await command('stop');
    expect(Date.now() - stopStarted).toBeLessThan(30_000);
    expect(await liveVaultUrl(root)).toBeUndefined();
    await rm(join(root, 'stall-recovery')); await rm(join(root, 'recovery-start.entered'));
    await command('local-start');
    // A transient log-path failure must keep ownership closed, still stop the
    // worker, and allow a later explicit Stop to retry after the fault is fixed.
    const logPath = config.replace(/\.[^./\\]+$/, '') + '.log';
    const backupLog = `${logPath}.synthetic-backup`;
    await rename(logPath, backupLog);
    try {
      await mkdir(logPath);
      const controller = JSON.parse(await readFile(statePath, 'utf8')) as { endpoint: string; token: string; pid: number };
      const stopped = await fetch(new URL('/v1/stop', controller.endpoint), { method: 'POST', headers: { authorization: `Bearer ${controller.token}` } });
      expect(stopped.status).toBe(202); await stopped.body?.cancel();
      await expect.poll(() => liveVaultUrl(root), { timeout: 10_000 }).toBeUndefined();
      await expect.poll(async () => (JSON.parse(await readFile(statePath, 'utf8')) as { phase: string }).phase, { timeout: 15_000 }).toBe('failed');
      expect((await lstat(config.replace(/\.[^./\\]+$/, '') + '.controller-lock.lock')).isDirectory()).toBe(true);
      expect(() => process.kill(controller.pid, 0)).not.toThrow();
    } finally {
      await rmdir(logPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      await rename(backupLog, logPath);
    }
    await command('stop');
    expect((await command('status')).stdout).toContain('not running');
    expect(await liveVaultUrl(root)).toBeUndefined();
    await expect(readFile(statePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await command('stop').catch(() => undefined);
    expect(await liveVaultUrl(root).catch(() => undefined)).toBeUndefined();
    const state = await readFile(statePath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (state) {
      const { pid } = JSON.parse(state) as { pid: number };
      let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      if (alive) throw new Error('Synthetic controller did not finish cleanup; its isolated fixture was retained');
    }
    await rm(base, { recursive: true, force: true });
  }
}, 240_000);

test('a failed remote shutdown still stops the owned worker and a later Stop completes the remaining cleanup', async () => {
  const project = resolve('.');
  const base = await mkdtemp(join(tmpdir(), 'Notara retry shutdown synthetic '));
  const code = join(base, 'synthetic code'), root = join(base, 'synthetic runtime');
  await Promise.all(['scripts', 'examples/native-vault', 'docs/runtime'].map(name => mkdir(join(code, name), { recursive: true })));
  await mkdir(root, { recursive: true });
  for (const file of ['package.json', 'examples/native-vault/package.json', 'docs/runtime/update-contract.json'])
    await writeFile(join(code, file), await readFile(join(project, file)));
  await symlink(join(project, 'node_modules'), join(code, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(code, 'scripts/vault-process.ts'), `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
const root = process.argv[2];
const server = createServer((request, response) => {
  if (request.url.includes('token=')) response.writeHead(303, {location:'./', 'set-cookie':'dsh-auth-synthetic=fixture; Path=/; HttpOnly'}).end();
  else response.end('synthetic owned worker');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const authUrl = 'http://127.0.0.1:' + port + '/?token=synthetic-fixture-token';
await writeFile(join(root, 'vault-runtime.json'), JSON.stringify({kind:'notara-vault-persistent',version:1,port,testModel:true}));
await writeFile(join(root, 'launcher.json'), JSON.stringify({pid:process.pid,authUrl}));
process.on('message', async message => {
  if (message?.type !== 'stop') return;
  await writeFile(join(process.argv[2], 'synthetic-worker-stopped.txt'), 'stopped');
  server.closeAllConnections(); server.close(() => { if (process.connected) process.disconnect(); });
});
process.send?.({ type: 'ready', authUrl });
`);
  let stopAttempts = 0;
  let runtime: Awaited<ReturnType<typeof superviseVault>> | undefined;
  try {
    runtime = await superviseVault(root, code, undefined, { discover: async () => null, prepare: async () => { throw new Error('No synthetic update'); } }, {
      assertNgrokReady: async () => join(root, 'synthetic-ngrok.yml'),
      startProxy: async options => ({ port: options.proxyPort, close: async () => undefined }),
      startTunnel: async config => ({ publicUrl: `https://${config.publicHost}`, exited: new Promise<never>(() => {}), stop: async () => {
        stopAttempts++; if (stopAttempts === 1) throw new Error('Synthetic first stop failure');
      } }),
    });
    await runtime.remoteAccess.save({ publicHost: 'synthetic.example.invalid', username: 'synthetic-user', password: 'synthetic-password-42', proxyPort: 57322, ngrokApiPort: 57323, ngrokPath: 'synthetic-ngrok' });
    await runtime.remoteAccess.enable({});
    await expect(runtime.stop()).rejects.toThrow('Could not cleanly stop');
    expect(await readFile(join(root, 'synthetic-worker-stopped.txt'), 'utf8')).toBe('stopped');
    expect(await runtime.remoteAccess.status({})).toMatchObject({ phase: 'error', canDisable: true });
    await expect(runtime.stop()).resolves.toBeUndefined();
    expect(stopAttempts).toBe(2);
    expect(await runtime.remoteAccess.status({})).toMatchObject({ phase: 'disabled', canDisable: false });
    await expect(runtime.stop()).resolves.toBeUndefined();
  } finally {
    await runtime?.stop().catch(() => undefined);
    await runtime?.stop().catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
}, 60_000);
