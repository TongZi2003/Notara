import { execFile } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { connect as connectTcp } from 'node:net';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { parse } from 'yaml';
import { readRemoteConfig, validateRemoteConfig, writePrivateFile, writeRemoteConfig, type RemoteAccessConfig } from '../../scripts/remote-access-config.ts';
import { buildNgrokConfigOverlay, buildNgrokPolicy, parseNgrokConfigPath, assertTcpPortAvailable } from '../../scripts/remote-ngrok.ts';
import { startRemoteProxy, type RemoteProxy } from '../../scripts/remote-access-proxy.ts';
import { packageBin } from '../../scripts/package-bin.ts';

const execFileAsync = promisify(execFile);
const password = 'unit-test-remote-password-42';
const username = 'notara-test';
const publicHost = 'notara-test.example.invalid';
const publicOrigin = `https://${publicHost}`;
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('Test server did not bind a port.')); return; }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

interface HttpResult { status: number; headers: IncomingMessage['headers']; body: string }
function request(port: number, path: string, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    req.end();
  });
}

function websocketRequest(port: number, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp(port, '127.0.0.1');
    let response = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Test WebSocket handshake timed out.')); }, 5_000);
    socket.once('connect', () => {
      const rows = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n');
      socket.write(`GET /socket HTTP/1.1\r\n${rows}\r\n\r\n`);
    });
    socket.on('data', chunk => {
      response += chunk.toString('latin1');
      if (response.includes('\r\n\r\n')) { clearTimeout(timer); socket.destroy(); resolve(response); }
    });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function malformedTargetRequest(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp(port, '127.0.0.1');
    let response = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Malformed HTTP request timed out.')); }, 5_000);
    socket.once('connect', () => socket.write([
      `GET ${target} HTTP/1.1`,
      `Host: ${publicHost}`,
      `Authorization: ${auth}`,
      `Origin: ${publicOrigin}`,
      'Connection: close',
      '', '',
    ].join('\r\n')));
    socket.on('data', chunk => { response += chunk.toString('latin1'); });
    socket.once('end', () => { clearTimeout(timer); resolve(response); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

test('ngrok policy requires Basic Auth and its private config overlay only binds the API to loopback', () => {
  const policy = parse(buildNgrokPolicy({ username, password })) as {
    on_http_request: { actions: { type: string; config: { credentials: string[]; enforce: boolean } }[] }[];
  };
  expect(policy.on_http_request[0]?.actions[0]).toMatchObject({ type: 'basic-auth', config: { credentials: [`${username}:${password}`], enforce: true } });

  const overlay = parse(buildNgrokConfigOverlay(4041)) as { version: number; agent: { web_addr: string; authtoken?: string } };
  expect(overlay).toEqual({ version: 3, agent: { web_addr: '127.0.0.1:4041' } });
  expect(JSON.stringify(overlay)).not.toContain(password);
  expect(parseNgrokConfigPath('Valid configuration file at C:\\Users\\A User\\AppData\\ngrok.yml\n')).toBe(resolve('C:\\Users\\A User\\AppData\\ngrok.yml'));
  expect(() => parseNgrokConfigPath('config is valid')).toThrow(/active config path/);
});

test('private config survives a path containing spaces and PowerShell metacharacters, outside the checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Notara remote $(ACL) private '));
  const configPath = join(directory, 'remote credentials with spaces.json');
  const config: RemoteAccessConfig = {
    format: 1,
    publicHost,
    username,
    password,
    ngrokPath: 'ngrok',
    localPort: 57093,
    proxyPort: 57094,
    ngrokApiPort: 4040,
  };
  try {
    expect(() => validateRemoteConfig({ ...config, username: 'user${actions.ngrok}' })).toThrow(/\$\{/);
    expect(() => validateRemoteConfig({ ...config, password: 'strong-${actions.ngrok}-password' })).toThrow(/\$\{/);
    await writeRemoteConfig(config, configPath);
    await expect(readRemoteConfig(configPath)).resolves.toEqual(config);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(config);
    await expect(writeRemoteConfig(config, join(resolve('.'), 'must-not-be-written.json'))).rejects.toThrow(/outside|checkout/i);

    if (process.platform === 'win32') {
      const script = [
        '$path = $env:NOTARA_TEST_PRIVATE_PATH',
        '$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
        '$acl = [System.IO.File]::GetAccessControl($path)',
        '$ids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)',
        '[Console]::WriteLine($user)',
        '[Console]::WriteLine(($ids -join ","))',
      ].join('; ');
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        windowsHide: true,
        env: { ...process.env, NOTARA_TEST_PRIVATE_PATH: configPath },
      });
      const [userSid, entries] = stdout.trim().split(/\r?\n/);
      expect(new Set(entries!.split(','))).toEqual(new Set([userSid, 'S-1-5-18']));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
// Windows performs real ACL setup and verification in separate PowerShell
// processes; cold starts can exceed Vitest's five-second default.
}, process.platform === 'win32' ? 30_000 : 5_000);

test('a controller for one runtime refuses a status request for a different --root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Notara controller ownership '));
  const configPath = join(directory, 'remote config.json');
  const firstRoot = join(directory, 'runtime A');
  const secondRoot = join(directory, 'runtime B');
  const base = configPath.replace(/\.[^./\\]+$/, '');
  const statePath = `${base}.controller.json`;
  try {
    const state = {
      format: 1,
      pid: process.pid,
      startedAt: Date.now(),
      runtimeRoot: firstRoot,
      endpoint: 'http://127.0.0.1:1/',
      token: 'controller-test-token-value-012345678901234567890',
      phase: 'ready',
      ownsVault: true,
      remoteActive: false,
    };
    await writePrivateFile(statePath, `${JSON.stringify(state)}\n`);
    const cli = packageBin(resolve('.'), 'tsx', 'tsx');
    const result = spawnSync(process.execPath, [cli, resolve('scripts/remote-vault.ts'), 'status', '--root', secondRoot, '--config', configPath], {
      cwd: resolve('.'), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to reuse or stop it');
    expect(result.stderr).toContain(firstRoot);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, process.platform === 'win32' ? 30_000 : 5_000);

let upstreamPort: number;
let proxyPort: number;
let upstream: Server;
let proxy: RemoteProxy;
let forwarded: IncomingMessage['headers'] | undefined;
let capturedWebsocketHeaders: IncomingMessage['headers'] | undefined;
const observedWebsocketHeaders = (): IncomingMessage['headers'] | undefined => capturedWebsocketHeaders;
let upstreamHits = 0;

beforeAll(async () => {
  upstream = createServer((incoming, outgoing) => {
    upstreamHits++;
    forwarded = incoming.headers;
    if (incoming.url?.includes('@deepseek-ai/dsh-client-connection/client.js')) {
      const body = incoming.url.includes('/bad/')
        ? 'unexpected upstream bundle'
        : 'const check = isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),';
      outgoing.writeHead(200, { 'content-type': 'text/javascript', 'content-length': String(Buffer.byteLength(body)) });
      outgoing.end(body);
      return;
    }
    outgoing.writeHead(200, {
      'content-type': 'application/json',
      location: `http://127.0.0.1:${upstreamPort}/after-login?step=1`,
      'access-control-allow-origin': `http://127.0.0.1:${upstreamPort}`,
      'set-cookie': ['dsh-auth=one; Path=/; HttpOnly', 'preference=two; Path=/; SameSite=Lax; secure; SECURE'],
    });
    outgoing.end(JSON.stringify(incoming.headers));
  });
  upstream.on('upgrade', (incoming, socket) => {
    capturedWebsocketHeaders = incoming.headers;
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  upstreamPort = await listen(upstream);
  const listener = createServer();
  proxyPort = await listen(listener);
  await close(listener);
  proxy = await startRemoteProxy({
    localPort: upstreamPort,
    proxyPort,
    publicHost,
    username,
    password,
    getLoginUrl: async () => undefined,
  });
});

afterAll(async () => {
  await proxy?.close();
  if (upstream) await close(upstream);
});

test('proxy fails closed without Basic Auth and rejects spoofed Host and Origin before forwarding', async () => {
  upstreamHits = 0;
  expect((await request(proxyPort, '/data', { Host: publicHost })).status).toBe(401);
  expect((await request(proxyPort, '/data', { Host: publicHost, authorization: 'Basic d3Jvbmc6Y3JlZHM=' })).status).toBe(401);
  expect((await request(proxyPort, '/data', { Host: publicHost, authorization: auth, origin: 'https://attacker.example' })).status).toBe(403);
  expect((await request(proxyPort, '/data', { Host: 'attacker.example', authorization: auth, origin: publicOrigin })).status).toBe(403);
  expect(upstreamHits).toBe(0);
});

test('malformed absolute request targets receive 400 and do not stop the authenticated proxy', async () => {
  const malformed = await malformedTargetRequest(proxyPort, 'http://[');
  expect(malformed).toMatch(/^HTTP\/1\.1 400/);
  const valid = await request(proxyPort, '/still-running', { Host: publicHost, authorization: auth });
  expect(valid.status).toBe(200);
});

test('authenticated HTTP forwards loopback identity and cookies, strips credentials, and rewrites response origin', async () => {
  const response = await request(proxyPort, '/data', {
    Host: publicHost,
    authorization: auth,
    origin: publicOrigin,
    cookie: 'dsh-auth=abc; preference=dark',
    'x-forwarded-host': 'attacker.example',
    'x-forwarded-proto': 'http',
  });
  const requestHeaders = JSON.parse(response.body) as Record<string, string | undefined>;
  expect(response.status).toBe(200);
  expect(requestHeaders.host).toBe(`127.0.0.1:${upstreamPort}`);
  expect(requestHeaders.origin).toBe(`http://127.0.0.1:${upstreamPort}`);
  expect(requestHeaders.authorization).toBeUndefined();
  expect(requestHeaders['x-forwarded-host']).toBeUndefined();
  expect(requestHeaders['x-forwarded-proto']).toBeUndefined();
  expect(requestHeaders.cookie).toBe('dsh-auth=abc; preference=dark');
  expect(response.headers.location).toBe(`${publicOrigin}/after-login?step=1`);
  expect(response.headers['access-control-allow-origin']).toBe(publicOrigin);
  expect(response.headers['set-cookie']).toEqual([
    'dsh-auth=one; Path=/; HttpOnly; Secure',
    'preference=two; Path=/; SameSite=Lax; Secure',
  ]);
});

test('WebSocket upgrades require auth and the exact public origin, then rewrite identity headers', async () => {
  capturedWebsocketHeaders = undefined;
  expect(await websocketRequest(proxyPort, { Host: publicHost, Origin: publicOrigin, Upgrade: 'websocket', Connection: 'Upgrade' })).toMatch(/^HTTP\/1\.1 401/);
  expect(await websocketRequest(proxyPort, { Host: publicHost, Origin: 'https://attacker.example', Authorization: auth, Upgrade: 'websocket', Connection: 'Upgrade' })).toMatch(/^HTTP\/1\.1 403/);
  const response = await websocketRequest(proxyPort, {
    Host: publicHost,
    Origin: publicOrigin,
    Authorization: auth,
    Cookie: 'session=kept',
    'X-Forwarded-Host': 'attacker.example',
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version': '13',
  });
  expect(response).toMatch(/^HTTP\/1\.1 101/);
  expect(observedWebsocketHeaders()?.host).toBe(`127.0.0.1:${upstreamPort}`);
  expect(observedWebsocketHeaders()?.origin).toBe(`http://127.0.0.1:${upstreamPort}`);
  expect(observedWebsocketHeaders()?.authorization).toBeUndefined();
  expect(observedWebsocketHeaders()?.cookie).toBe('session=kept');
  expect(observedWebsocketHeaders()?.['x-forwarded-host']).toBeUndefined();
});

test('only the exact DSH trust seam is patched and unknown client bundles fail closed', async () => {
  const patched = await request(proxyPort, '/@deepseek-ai/dsh-client-connection/client.js', { Host: publicHost, Authorization: auth });
  expect(patched.status).toBe(200);
  expect(patched.body).toContain(`pageLocation.hostname === "${publicHost}"`);
  expect(forwarded?.['accept-encoding']).toBe('identity');
  const unknown = await request(proxyPort, '/bad/@deepseek-ai/dsh-client-connection/client.js', { Host: publicHost, Authorization: auth });
  expect(unknown.status).toBe(503);
});

test('simultaneous proxy starts on one configured port yield one owner; occupied ports fail with an actionable error', async () => {
  await expect(assertTcpPortAvailable(upstreamPort, 'test ngrok API')).rejects.toThrow(/already in use/);
  const probe = createServer();
  const racePort = await listen(probe);
  await close(probe);
  const options = { localPort: upstreamPort, proxyPort: racePort, publicHost, username, password, getLoginUrl: async () => undefined };
  const starts = await Promise.allSettled([startRemoteProxy(options), startRemoteProxy(options)]);
  const owners = starts.filter((result): result is PromiseFulfilledResult<RemoteProxy> => result.status === 'fulfilled');
  const failures = starts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  expect(owners).toHaveLength(1);
  expect(failures).toHaveLength(1);
  expect(String(failures[0]!.reason)).toMatch(/already in use/);
  await owners[0]!.value.close();
});
