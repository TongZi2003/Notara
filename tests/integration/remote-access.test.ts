import { execFile } from 'node:child_process';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { liveVaultUrl, readVaultState } from '../../scripts/vault-launcher-state.ts';
import { superviseVault } from '../../scripts/vault-supervisor.ts';
import { startRemoteProxy, type RemoteProxy } from '../../scripts/remote-access-proxy.ts';
import { packageBin } from '../../scripts/package-bin.ts';

const execFileAsync = promisify(execFile);

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('Test listener did not bind a TCP port.')); return; }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: IncomingMessage['headers'] }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, response => {
      response.resume();
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers }));
    });
    request.once('error', reject);
    request.end();
  });
}

test('authenticated remote proxy signs into an isolated supervised synthetic Vault and proxy shutdown leaves local Vault running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-remote-synthetic-'));
  let seed: Awaited<ReturnType<typeof startVaultPersistent>> | undefined;
  let runtime: Awaited<ReturnType<typeof superviseVault>> | undefined;
  let proxy: RemoteProxy | undefined;
  try {
    // Seed the persistent runtime with the synthetic model adapter; stop the
    // seed worker so the tested supervisor owns the only DSH service process.
    seed = await startVaultPersistent(root, { port: 0, testModel: true });
    await seed.stop();
    seed = undefined;

    const discovered: string[] = [];
    runtime = await superviseVault(root, resolve('.'), undefined, {
      discover: async () => { discovered.push('checked'); return null; },
      prepare: async () => { throw new Error('The test never prepares release artifacts.'); },
    });
    await runtime.controller.check();
    expect(runtime.controller.status().phase).toBe('current');
    expect(discovered.length).toBeGreaterThan(0);
    expect(await liveVaultUrl(root)).toBe(runtime.authUrl);

    const proxyProbe = createServer();
    const proxyPort = await listen(proxyProbe);
    await close(proxyProbe);
    const localPort = Number(new URL(runtime.authUrl).port);
    const publicHost = 'notara-synthetic.example.invalid';
    const publicOrigin = `https://${publicHost}`;
    const username = 'synthetic-user';
    const password = 'synthetic-remote-password-44';
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    proxy = await startRemoteProxy({
      localPort,
      proxyPort,
      publicHost,
      username,
      password,
      getLoginUrl: () => liveVaultUrl(root),
    });

    expect((await get(proxyPort, '/login', { Host: publicHost })).status).toBe(401);
    const entry = await get(proxyPort, '/login', { Host: publicHost, authorization });
    expect(entry.status).toBe(303);
    const tokenLocation = entry.headers.location;
    expect(tokenLocation).toMatch(/^\/?\?token=/);

    const exchange = await get(proxyPort, tokenLocation!, { Host: publicHost, authorization, Origin: publicOrigin });
    expect(exchange.status).toBe(303);
    expect(exchange.headers.location).not.toContain('token=');
    const setCookies = exchange.headers['set-cookie'] ?? [];
    expect(setCookies.length).toBeGreaterThan(0);
    for (const cookie of setCookies) {
      expect(cookie.split(';').filter(attribute => attribute.trim().toLowerCase() === 'secure')).toHaveLength(1);
    }
    const cookies = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
    expect(cookies).toContain('dsh-auth-');
    const home = await get(proxyPort, '/', { Host: publicHost, authorization, Origin: publicOrigin, Cookie: cookies });
    expect(home.status).toBe(200);

    await proxy.close();
    proxy = undefined;
    expect(await liveVaultUrl(root)).toBe(runtime.authUrl);
    expect((await get(localPort, '/', { Host: `127.0.0.1:${localPort}` })).status).toBe(401);
  } finally {
    await proxy?.close();
    await runtime?.stop();
    await seed?.stop();
    expect(await liveVaultUrl(root).catch(() => undefined)).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test('remote Vault CLI serializes local start, status and repeated stops without crossing runtime roots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Notara remote CLI isolation '));
  const root = join(directory, 'synthetic runtime');
  const otherRoot = join(directory, 'other runtime');
  const config = join(directory, 'private config', 'remote.json');
  const profile = join(directory, 'isolated user profile');
  const preload = join(directory, 'block external fetches.mjs');
  let seeded: Awaited<ReturnType<typeof startVaultPersistent>> | undefined;
  let cleanupCli: (() => Promise<unknown>) | undefined;
  try {
    await mkdir(profile, { recursive: true });
    await writeFile(preload, [
      'const nativeFetch = globalThis.fetch.bind(globalThis);',
      'globalThis.fetch = async (input, init) => {',
      '  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);',
      '  if (target.hostname === "api.github.com") return new Response(null, { status: 404 });',
      '  if (["127.0.0.1", "localhost", "::1"].includes(target.hostname)) return nativeFetch(input, init);',
      '  throw new Error(`Network access blocked by isolated Notara CLI test: ${target.hostname}`);',
      '};',
    ].join('\n'));
    seeded = await startVaultPersistent(root, { port: 0, testModel: true });
    const randomPort = Number(new URL(seeded.authUrl).port);
    expect(randomPort).toBeGreaterThan(0);
    expect((await readVaultState(root))?.port).toBe(randomPort);
    await seeded.stop();
    seeded = undefined;

    const tsx = packageBin(resolve('.'), 'tsx', 'tsx');
    const env = {
      ...process.env,
      USERPROFILE: profile,
      APPDATA: join(profile, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(profile, 'AppData', 'Local'),
      HOME: profile,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`.trim(),
    };
    const command = async (name: string, dataRoot = root) => execFileAsync(process.execPath, [
      tsx, resolve('scripts/remote-vault.ts'), name, '--root', dataRoot, '--config', config,
      ...(name === 'local-start' ? ['--port', String(randomPort)] : []),
    ], { cwd: resolve('.'), env, encoding: 'utf8', timeout: 60_000, maxBuffer: 64_000, windowsHide: true });
    cleanupCli = () => command('stop');

    const before = await command('status');
    expect(before.stdout).toContain('not running');
    const lockTarget = config.replace(/\.[^./\\]+$/, '') + '.controller-lock';
    const staleLock = `${lockTarget}.lock`;
    await writeFile(lockTarget, '');
    await mkdir(staleLock);
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(staleLock, staleTime, staleTime);
    const started = await command('local-start');
    expect(started.stdout).toContain(`http://127.0.0.1:${randomPort}/`);
    expect((await command('local-start')).stdout).toContain(`http://127.0.0.1:${randomPort}/`);

    const status = await command('status');
    expect(status.stdout).toContain('ready');
    expect(status.stdout).toContain('Vault ownership=managed');

    await expect(command('stop', otherRoot)).rejects.toMatchObject({ code: 1 });
    const stillRunning = await command('status');
    expect(stillRunning.stdout).toContain('ready');
    expect(await liveVaultUrl(root)).toBeDefined();

    expect((await command('remote-stop')).stdout).toContain('No managed remote tunnel');
    expect((await command('remote-stop')).stdout).toContain('No managed remote tunnel');
    expect((await command('status')).stdout).toContain('ready');
    expect(await liveVaultUrl(root)).toBeDefined();

    expect((await command('stop')).stdout).toContain('shutdown requested');
    expect((await command('stop')).stdout).toContain('No managed Notara controller');
    expect((await command('status')).stdout).toContain('not running');
    expect(await liveVaultUrl(root)).toBeUndefined();
  } finally {
    await seeded?.stop();
    await cleanupCli?.().catch(() => undefined);
    expect(await liveVaultUrl(root).catch(() => undefined)).toBeUndefined();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
