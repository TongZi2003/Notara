import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { connect as connectTcp, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const TRUST_SNIPPET = 'isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),';

export interface RemoteProxyOptions {
  localPort: number;
  proxyPort: number;
  publicHost: string;
  username: string;
  password: string;
  getLoginUrl(): Promise<string | undefined>;
}

export interface RemoteProxy {
  readonly port: number;
  close(): Promise<void>;
}

function authDigest(value: string): Buffer { return createHash('sha256').update(value).digest(); }

function authorized(request: IncomingMessage, expected: Buffer): boolean {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Basic ')) return false;
  const encoded = value.slice(6);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.toString('base64') !== encoded) return false;
  return timingSafeEqual(authDigest(decoded.toString('utf8')), expected);
}

function hasExpectedOrigin(request: IncomingMessage, options: RemoteProxyOptions): boolean {
  const expectedOrigin = `https://${options.publicHost}`;
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  try { if (new URL(`https://${host}`).origin !== expectedOrigin) return false; }
  catch { return false; }
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  try { return new URL(origin).origin === expectedOrigin; } catch { return false; }
}

function respond(response: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(message);
}

function bundlePath(path: string | undefined): boolean {
  if (!path) return false;
  try { return new URL(path, 'http://127.0.0.1').pathname.includes('@deepseek-ai/dsh-client-connection/client.js'); }
  catch { return false; }
}

function mapRequestHeaders(request: IncomingMessage, options: RemoteProxyOptions, identity: boolean): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...request.headers, host: `127.0.0.1:${options.localPort}` };
  // The proxy's Basic credentials authorize entry here; DSH never receives them.
  delete headers.authorization;
  delete headers['proxy-authorization'];
  // Do not let caller-supplied forwarding headers influence the loopback service.
  delete headers.forwarded;
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  delete headers['x-forwarded-port'];
  if (typeof headers.origin === 'string') headers.origin = `http://127.0.0.1:${options.localPort}`;
  if (identity) headers['accept-encoding'] = 'identity';
  return headers;
}

function mapResponseHeaders(headers: IncomingMessage['headers'], options: RemoteProxyOptions): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = { ...headers };
  const localOrigin = `http://127.0.0.1:${options.localPort}`;
  const publicOrigin = `https://${options.publicHost}`;
  const secureCookie = (cookie: string): string => {
    if (!cookie.trim()) return cookie;
    const attributes = cookie.split(';');
    const pair = attributes.shift() ?? '';
    const retained = attributes.filter(attribute => !/^\s*secure(?:\s*=.*)?\s*$/i.test(attribute));
    return [pair, ...retained, ' Secure'].join(';');
  };
  const setCookie = result['set-cookie'];
  if (typeof setCookie === 'string') result['set-cookie'] = secureCookie(setCookie);
  else if (Array.isArray(setCookie)) result['set-cookie'] = setCookie.map(secureCookie);
  const location = result.location;
  if (typeof location === 'string') {
    try {
      const target = new URL(location, localOrigin);
      if (target.origin === localOrigin) result.location = `${publicOrigin}${target.pathname}${target.search}${target.hash}`;
    } catch { /* Preserve non-URL Location values for the browser to resolve. */ }
  }
  if (typeof result['access-control-allow-origin'] === 'string' && result['access-control-allow-origin'] === localOrigin)
    result['access-control-allow-origin'] = publicOrigin;
  return result;
}

function proxyWebSocket(request: IncomingMessage, socket: Duplex, head: Buffer, options: RemoteProxyOptions): void {
  const upstream = connectTcp(options.localPort, '127.0.0.1');
  const shutdown = (): void => { upstream.destroy(); socket.destroy(); };
  upstream.once('connect', () => {
    const headers = mapRequestHeaders(request, options, false);
    const rows = Object.entries(headers).flatMap(([name, value]) => {
      if (value === undefined) return [];
      return (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}`);
    });
    upstream.write(`${request.method} ${request.url ?? '/'} HTTP/1.1\r\n${rows.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once('error', shutdown);
  socket.once('error', () => upstream.destroy());
  upstream.once('close', () => socket.destroy());
  socket.once('close', () => upstream.destroy());
}

function readBundle(response: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BUNDLE_BYTES) {
        response.destroy(new Error('Remote connection bundle exceeded its size limit.'));
        return;
      }
      chunks.push(chunk);
    });
    response.once('end', () => resolve(Buffer.concat(chunks)));
    response.once('error', reject);
  });
}

async function handleLogin(response: ServerResponse, options: RemoteProxyOptions): Promise<void> {
  const login = await options.getLoginUrl();
  if (!login) {
    respond(response, 503, 'Notara is starting. Try again shortly.');
    return;
  }
  let target: URL;
  try { target = new URL(login); } catch { respond(response, 503, 'The current Notara login entry is unavailable.'); return; }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.port !== String(options.localPort) ||
    target.pathname !== '/' || !target.searchParams.has('token') || target.username || target.password || target.hash) {
    respond(response, 503, 'The current Notara login entry is unavailable.');
    return;
  }
  response.writeHead(303, {
    location: `${target.pathname}${target.search}`,
    'cache-control': 'no-store',
    'clear-site-data': '"cache"',
    'referrer-policy': 'no-referrer',
  });
  response.end();
}

/** Loopback-only reverse proxy with app-level Basic Auth and the DSH remote-origin seam. */
export async function startRemoteProxy(options: RemoteProxyOptions): Promise<RemoteProxy> {
  if (!Number.isInteger(options.localPort) || options.localPort < 1 || options.localPort > 65535 ||
    !Number.isInteger(options.proxyPort) || options.proxyPort < 1 || options.proxyPort > 65535) throw new Error('Invalid remote proxy port.');
  const expected = authDigest(`${options.username}:${options.password}`);
  const sockets = new Set<Duplex>();
  const server: Server = createServer({ maxHeaderSize: 64 * 1024 }, (incoming, outgoing) => {
    if (!authorized(incoming, expected)) {
      respond(outgoing, 401, 'Remote access requires a username and password.', {
        'www-authenticate': 'Basic realm="Notara remote access", charset="UTF-8"',
      });
      incoming.resume();
      return;
    }
    if (!hasExpectedOrigin(incoming, options)) {
      respond(outgoing, 403, 'The request host or origin is not allowed.');
      incoming.resume();
      return;
    }
    const rawTarget = incoming.url ?? '/';
    let target: URL;
    try { target = new URL(rawTarget, 'http://127.0.0.1'); }
    catch {
      respond(outgoing, 400, 'The request target is invalid.');
      incoming.resume();
      return;
    }
    // ngrok forwards origin-form paths. Reject proxy-form and other absolute
    // targets so a malformed Host/target combination cannot escape parsing or
    // make Node's upstream request constructor throw from this event handler.
    if (!rawTarget.startsWith('/') || target.origin !== 'http://127.0.0.1' || target.hash) {
      respond(outgoing, 400, 'The request target is invalid.');
      incoming.resume();
      return;
    }
    if (target.pathname === '/login') {
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
        respond(outgoing, 405, 'Method not allowed.', { allow: 'GET, HEAD' });
        incoming.resume();
        return;
      }
      void handleLogin(outgoing, options).catch(() => {
        if (!outgoing.headersSent) respond(outgoing, 503, 'The current Notara login entry is unavailable.');
        else outgoing.destroy();
      });
      incoming.resume();
      return;
    }

    const isBundle = bundlePath(incoming.url);
    const upstream = httpRequest({
      hostname: '127.0.0.1',
      port: options.localPort,
      method: incoming.method,
      path: incoming.url,
      headers: mapRequestHeaders(incoming, options, isBundle),
    }, async upstreamResponse => {
      if (!isBundle) {
        const interrupted = (error: Error): void => { if (!outgoing.destroyed) outgoing.destroy(error); };
        upstreamResponse.once('error', interrupted);
        upstreamResponse.once('aborted', () => interrupted(new Error('The local Notara response ended before it was complete.')));
        outgoing.writeHead(upstreamResponse.statusCode ?? 502, mapResponseHeaders(upstreamResponse.headers, options));
        upstreamResponse.pipe(outgoing);
        return;
      }
      try {
        if (upstreamResponse.headers['content-encoding']) throw new Error('The DSH connection bundle was unexpectedly compressed.');
        const source = (await readBundle(upstreamResponse)).toString('utf8');
        const count = source.split(TRUST_SNIPPET).length - 1;
        if (count !== 1) throw new Error(`Expected one DSH remote trust seam, found ${count}.`);
        const trust = `isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname) || (pageLocation.protocol === "https:" && pageLocation.hostname === ${JSON.stringify(options.publicHost)}),`;
        const body = Buffer.from(source.replace(TRUST_SNIPPET, trust));
        const headers = mapResponseHeaders(upstreamResponse.headers, options);
        headers['cache-control'] = 'no-store';
        headers['content-length'] = String(body.length);
        delete headers.etag;
        delete headers['last-modified'];
        delete headers['transfer-encoding'];
        outgoing.writeHead(upstreamResponse.statusCode ?? 502, headers);
        outgoing.end(body);
      } catch {
        upstreamResponse.destroy();
        if (!outgoing.headersSent) respond(outgoing, 503, 'The remote Notara connection bundle could not be verified. Restart after updating Notara.');
        else outgoing.destroy();
      }
    });
    upstream.once('error', () => {
      if (!outgoing.headersSent) respond(outgoing, 502, 'The local Notara service is unavailable.');
      else outgoing.destroy();
    });
    incoming.once('aborted', () => upstream.destroy());
    incoming.once('error', () => upstream.destroy());
    outgoing.once('error', () => upstream.destroy());
    outgoing.once('close', () => { if (!outgoing.writableFinished) upstream.destroy(); });
    incoming.pipe(upstream);
  });

  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (incoming, socket, head) => {
    if (!authorized(incoming, expected)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Notara remote access", charset="UTF-8"\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (!hasExpectedOrigin(incoming, options)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    proxyWebSocket(incoming, socket, head, options);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(options.proxyPort, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new Error(`Remote proxy port ${options.proxyPort} is already in use; no tunnel was started.`, { cause: error });
    throw error;
  });

  let closing: Promise<void> | undefined;
  return {
    port: options.proxyPort,
    close() {
      closing ??= new Promise<void>(resolve => {
        server.close(() => resolve());
        const timer = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 2000);
        timer.unref();
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
