import { expect, test, type BrowserContext, type Route } from '@playwright/test';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { startRemoteProxy } from '../../scripts/remote-access-proxy.ts';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

const publicHost = 'models.synthetic.invalid';
const username = 'synthetic-remote-user';
const password = 'synthetic-remote-password-24';
const connectionResource = '@deepseek-ai/dsh-client-connection/client.js';

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

test('fresh remote Settings → Models trusts only the configured HTTPS host and never caches the connection bundle', async ({ browser }) => {
  test.setTimeout(180_000);
  const proxyPort = await unusedPort();
  const runtime = await startVaultIsolated({ testModel: true });
  const localPort = Number(new URL(runtime.authUrl).port);
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  let proxy: Awaited<ReturnType<typeof startRemoteProxy>> | undefined;
  let context: BrowserContext | undefined;
  const comboReplies: Array<{ status: number; cacheControl: string | undefined; body: string }> = [];
  let loginReply: ProxyReply | undefined;

  try {
    proxy = await startRemoteProxy({
      localPort,
      proxyPort,
      publicHost,
      username,
      password,
      getLoginUrl: async () => runtime.authUrl,
    });
    loginReply = await callProxy(proxy.port, '/login', {
      host: publicHost,
      authorization: basic,
    });
    expect(loginReply.status).toBe(303);
    expect(loginReply.headers.location).toMatch(/^\/?\?token=.+/);
    context = await browser.newContext({ serviceWorkers: 'block' });
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
      } catch {
        await route.abort('failed').catch(() => {});
      }
    });

    const page = await context.newPage();
    const loginLocation = loginReply.headers.location;
    if (typeof loginLocation !== 'string') throw new Error('Synthetic /login did not return a redirect location.');
    const entryUrl = new URL(loginLocation, `https://${publicHost}/`).href;
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.nv-rail')).toBeVisible({ timeout: 60_000 });
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

    expect(loginReply?.status).toBe(303);
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
  } finally {
    await context?.close();
    await proxy?.close();
    await runtime.stop();
  }
});
