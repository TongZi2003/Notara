import { expect, test, type BrowserContext, type Route, type WebSocketRoute } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { startRemoteProxy } from '../../scripts/remote-access-proxy.ts';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

const publicHost = 'models.synthetic.invalid';
const username = 'synthetic-remote-user';
const password = 'synthetic-remote-password-24';
const connectionResource = '@deepseek-ai/dsh-client-connection/client.js';

// `ws` is already locked as a DSH dependency. Its Node client lets this test
// preserve the public Host and Origin while dialing the loopback-only proxy.
interface ProxySocket {
  readonly readyState: number;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  send(message: string | Buffer, callback: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}
const ProxySocketClient = createRequire(import.meta.url)('ws') as {
  new(url: string, protocols: string[], options: { headers: Record<string, string>; handshakeTimeout: number }): ProxySocket;
  CONNECTING: number;
  OPEN: number;
};

async function bridgeRemoteWebSockets(context: BrowserContext, port: number, basic: string, errors: string[]) {
  const stats = { connectionsOpened: 0, nativeReady: 0, messagesToHost: 0, messagesToBrowser: 0 };
  const endpoints = new Set<string>();
  const active = new Set<{ socket: ProxySocket; closed: Promise<void> }>();
  await context.routeWebSocket(`wss://${publicHost}/api/remote.mux`, async (route: WebSocketRoute) => {
    const url = new URL(route.url());
    let socket: ProxySocket | undefined;
    try {
      const cookies = await context.cookies(`https://${publicHost}/`);
      if (!cookies.length) throw new Error('The remote WebSocket has no native browser session cookie.');
      socket = new ProxySocketClient(`ws://127.0.0.1:${port}${url.pathname}${url.search}`, route.protocols(), {
        headers: {
          host: publicHost,
          origin: `https://${publicHost}`,
          authorization: basic,
          cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
        },
        handshakeTimeout: 10_000,
      });
      const upstream = socket;
      const streams = new Map<string, string>();
      let pageClosed = false;
      let resolveClosed!: () => void;
      const bridge = { socket: upstream, closed: new Promise<void>(resolve => { resolveClosed = resolve; }) };
      active.add(bridge);
      const opening = new Promise<void>((resolve, reject) => {
        upstream.on('open', () => { stats.connectionsOpened++; resolve(); });
        upstream.on('error', error => {
          errors.push(`Remote WebSocket proxy failed: ${error.message}`);
          reject(error);
          void route.close({ code: 1011, reason: 'Remote proxy transport failed' });
        });
        upstream.on('close', (code, reason) => {
          active.delete(bridge);
          resolveClosed();
          reject(new Error(`Remote WebSocket closed before opening: ${code}`));
          if (!pageClosed) void route.close({ code, reason: reason.toString('utf8') });
        });
      });
      route.onMessage(message => {
        stats.messagesToHost++;
        if (typeof message === 'string') {
          const frame = JSON.parse(message) as { type?: string; streamId?: string; endpoint?: string };
          if (frame.type === 'open' && frame.streamId && frame.endpoint) {
            streams.set(frame.streamId, frame.endpoint);
            endpoints.add(frame.endpoint);
          }
        }
        upstream.send(message, error => {
          if (!error) return;
          errors.push(`Remote WebSocket uplink failed: ${error.message}`);
          upstream.terminate();
          void route.close({ code: 1011, reason: 'Remote proxy uplink failed' });
        });
      });
      upstream.on('message', (data, isBinary) => {
        stats.messagesToBrowser++;
        const message = isBinary ? data : data.toString('utf8');
        if (typeof message === 'string') {
          const frame = JSON.parse(message) as { type?: string; streamId?: string; value?: { type?: string; clientId?: string } };
          if (frame.type === 'item' && frame.streamId && streams.get(frame.streamId) === '$events' &&
            frame.value?.type === 'ready' && typeof frame.value.clientId === 'string') stats.nativeReady++;
        }
        if (!pageClosed) route.send(message);
      });
      route.onClose((code, reason) => {
        pageClosed = true;
        // Reserved status codes describe an absent close frame; preserve that
        // abnormal shutdown by terminating, rather than sending an invalid frame.
        if (code === 1005 || code === 1006 || upstream.readyState === ProxySocketClient.CONNECTING) upstream.terminate();
        else upstream.close(code, reason);
      });
      // Playwright opens its page-side socket after this handler returns. Wait
      // for the actual authenticated upstream upgrade before allowing that.
      await opening;
    } catch (error) {
      errors.push(`Remote WebSocket bridge could not open: ${String(error)}`);
      socket?.terminate();
      await route.close({ code: 1011, reason: 'Remote proxy upgrade failed' });
    }
  });
  return {
    stats,
    endpoints,
    async close() {
      await Promise.all([...active].map(async bridge => {
        const timer = setTimeout(() => {
          errors.push('Remote WebSocket did not complete its close handshake.');
          bridge.socket.terminate();
        }, 2_000);
        try {
          if (bridge.socket.readyState === ProxySocketClient.CONNECTING) bridge.socket.terminate();
          else if (bridge.socket.readyState === ProxySocketClient.OPEN) bridge.socket.close(1000, 'Synthetic browser finished');
          await bridge.closed;
        } finally { clearTimeout(timer); }
      }));
    },
  };
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate an isolated port.');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

interface ProxyReply {
  status: number;
  headers: import('node:http').IncomingHttpHeaders;
  body: Buffer;
}

function callProxy(port: number, path: string, headers: Record<string, string>, method = 'GET', body?: Buffer): Promise<ProxyReply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.once('end', () => resolve({
        status: incoming.statusCode ?? 0,
        headers: incoming.headers,
        body: Buffer.concat(chunks),
      }));
      incoming.once('error', reject);
    });
    outgoing.once('error', reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

function browserHeaders(route: Route, basic: string): Record<string, string> {
  const incoming = route.request().headers();
  const headers: Record<string, string> = {
    host: publicHost,
    authorization: basic,
    'accept-encoding': 'identity',
  };
  for (const key of ['accept', 'accept-language', 'content-type', 'cookie', 'origin', 'referer', 'range', 'user-agent']) {
    const value = incoming[key];
    if (value !== undefined) headers[key] = value;
  }
  return headers;
}

async function routeThroughProxy(route: Route, port: number, basic: string): Promise<ProxyReply> {
  const request = route.request();
  let target = new URL(request.url());
  let method = request.method();
  let body = request.postDataBuffer() ?? undefined;
  const headers = browserHeaders(route, basic);
  if (body) headers['content-length'] = String(body.length);
  const carriedCookies: string[] = [];
  for (let hop = 0; hop < 10; hop++) {
    const reply = await callProxy(port, `${target.pathname}${target.search}`, headers, method, body);
    const setCookie = reply.headers['set-cookie'];
    const responseCookies = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
    const location = reply.headers.location;
    if ([301, 302, 303, 307, 308].includes(reply.status) && typeof location === 'string') {
      const redirect = new URL(location, target);
      if (redirect.origin !== `https://${publicHost}`) throw new Error(`Synthetic remote redirect escaped the public host: ${redirect.origin}`);
      carriedCookies.push(...responseCookies);
      if (responseCookies.length) headers.cookie = mergeCookies(headers.cookie, responseCookies);
      if (reply.status === 303 || ((reply.status === 301 || reply.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        delete headers['content-length'];
        delete headers['content-type'];
      }
      target = redirect;
      continue;
    }
    if (carriedCookies.length) return { ...reply, headers: { ...reply.headers, 'set-cookie': [...carriedCookies, ...responseCookies] } };
    return reply;
  }
  throw new Error('Synthetic remote redirect chain exceeded ten hops.');
}

function mergeCookies(current: string | undefined, additions: string[]): string {
  const jar = new Map<string, string>();
  for (const cookie of current?.split(';') ?? []) {
    const pair = cookie.trim();
    const separator = pair.indexOf('=');
    if (separator > 0) jar.set(pair.slice(0, separator), pair);
  }
  for (const cookie of additions) {
    const pair = cookie.split(';', 1)[0]?.trim() ?? '';
    const separator = pair.indexOf('=');
    if (separator > 0) jar.set(pair.slice(0, separator), pair);
  }
  return [...jar.values()].join('; ');
}

async function fulfillProxyReply(route: Route, reply: ProxyReply): Promise<void> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(reply.headers)) {
    if (value === undefined || ['connection', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(key)) continue;
    if (Array.isArray(value)) headers[key] = value.join('\n');
    else headers[key] = value;
  }
  await route.fulfill({ status: reply.status, headers, body: reply.body });
}

test('fresh remote Settings → Models trusts only the configured HTTPS host and never caches the connection bundle', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const proxyPort = await unusedPort();
  const runtime = await startVaultIsolated({ testModel: true });
  const localPort = Number(new URL(runtime.authUrl).port);
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  let proxy: Awaited<ReturnType<typeof startRemoteProxy>> | undefined;
  let context: BrowserContext | undefined;
  let websocketBridge: Awaited<ReturnType<typeof bridgeRemoteWebSockets>> | undefined;
  const errors: string[] = [];
  const comboReplies: Array<{ status: number; cacheControl: string | undefined; body: string }> = [];

  try {
    await writeFile(join(runtime.root, 'teacher-replies.json'), JSON.stringify({
      '__session-title': '远程订阅课堂',
      '远程订阅验收': '远程订阅已经送达。',
    }));
    proxy = await startRemoteProxy({
      localPort,
      proxyPort,
      publicHost,
      username,
      password,
      getLoginUrl: async () => runtime.authUrl,
    });
    const loginReply = await callProxy(proxy.port, '/login', {
      host: publicHost,
      authorization: basic,
    });
    expect(loginReply.status).toBe(303);
    expect(loginReply.headers.location).toMatch(/^\/?\?token=.+/);
    expect(loginReply.headers['cache-control']).toBe('no-store');
    context = await browser.newContext({ serviceWorkers: 'block' });
    websocketBridge = await bridgeRemoteWebSockets(context, proxy.port, basic, errors);
    await context.route('**/*', async route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin !== `https://${publicHost}`) return route.abort();
      try {
        const reply = await routeThroughProxy(route, proxy!.port, basic);
        if (requestUrl.pathname === '/plugins/' && requestUrl.search.includes(connectionResource)) {
          comboReplies.push({
            status: reply.status,
            cacheControl: typeof reply.headers['cache-control'] === 'string' ? reply.headers['cache-control'] : undefined,
            body: reply.body.toString('utf8'),
          });
        }
        await fulfillProxyReply(route, reply);
      } catch (error) {
        errors.push(`Synthetic proxy request failed for ${requestUrl.pathname}: ${String(error)}`);
        await route.abort('failed').catch(() => {});
      }
    });

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const loginLocation = loginReply.headers.location;
    if (typeof loginLocation !== 'string') throw new Error('Synthetic /login did not return a redirect location.');
    const entryUrl = new URL(loginLocation, `https://${publicHost}/`).href;
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.nv-rail')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => websocketBridge!.stats.nativeReady).toBeGreaterThan(0);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try {
      await later.waitFor({ timeout: 8_000 });
      await later.click();
    } catch { /* The isolated runtime may already have completed onboarding. */ }

    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    const settings = page.locator('[data-shortcut-modal="settings"]');
    await expect(settings).toBeVisible();
    await settings.getByText(/^(Models|模型)$/).click();
    await expect(settings.getByRole('heading', { name: /^(Models|模型)$/ })).toBeVisible();
    await expect(settings.getByRole('button', { name: /^(Add model provider|添加模型提供商)$/ })).toBeVisible({ timeout: 30_000 });
    await expect(settings.getByText(/Loading the provider directory failed|加载提供商目录失败/)).toHaveCount(0);
    expect(await page.evaluate(() => `${location.protocol}//${location.hostname}`)).toBe(`https://${publicHost}`);

    expect(comboReplies.length).toBeGreaterThan(0);
    for (const combo of comboReplies) {
      expect(combo.status).toBe(200);
      expect(combo.cacheControl).toMatch(/(?:^|,)\s*no-store\s*(?:,|$)/i);
      expect(combo.body).toContain(`pageLocation.protocol === "https:" && pageLocation.hostname === "${publicHost}"`);
    }

    const badHost = await callProxy(proxy.port, '/login', {
      host: 'untrusted.synthetic.invalid',
      origin: `https://${publicHost}`,
      authorization: basic,
    });
    expect(badHost.status).toBe(403);

    // Exercise native session subscriptions through the same authenticated mux,
    // then prove an unsolicited Host change reaches the page without a reload.
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.fill('远程订阅验收');
    await composer.press('Enter');
    await expect(page.getByText('远程订阅已经送达。', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const sessionId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('notara-vault-view') ?? 'null')?.sessionId as string | undefined);
    expect(sessionId).toBeTruthy();
    const cookie = (await context.cookies(`https://${publicHost}/`)).map(item => `${item.name}=${item.value}`).join('; ');
    const renameBody = Buffer.from(JSON.stringify({
      type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/rename',
      payload: { args: { request: { sessionId, title: '远程订阅已更新' } } },
    }));
    const messagesBeforeRename = websocketBridge.stats.messagesToBrowser;
    const rename = await callProxy(proxy.port, '/api/session/rename', {
      host: publicHost, origin: `https://${publicHost}`, authorization: basic, cookie,
      'content-type': 'application/json', 'content-length': String(renameBody.length),
    }, 'POST', renameBody);
    expect(rename.status).toBe(200);
    expect(JSON.parse(rename.body.toString('utf8')).result.ok).toBe(true);
    await expect(page.locator('.nv-panel .nv-session-row').filter({ has: page.getByText('远程订阅已更新', { exact: true }) })).toBeVisible();
    expect(websocketBridge.stats.messagesToBrowser).toBeGreaterThan(messagesBeforeRename);
    expect(websocketBridge.stats.messagesToHost).toBeGreaterThan(0);
    expect(websocketBridge.endpoints.has('$events')).toBe(true);
    await testInfo.attach('remote-websocket-bridge', {
      body: JSON.stringify({ ...websocketBridge.stats, endpoints: [...websocketBridge.endpoints] }), contentType: 'application/json',
    });
    await context.close(); context = undefined;
    await websocketBridge.close(); websocketBridge = undefined;
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await websocketBridge?.close();
    await proxy?.close();
    await runtime.stop();
  }
});
