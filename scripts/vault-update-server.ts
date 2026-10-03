import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { UpdateController } from './vault-updates.ts';
import type { RemoteAccessService, RemoteSettingsCode } from './remote-access-service.ts';
import { listenWebLoopback } from './listen-web-loopback.ts';

/** Only the authenticated DSH Host can reach this private launcher bridge. */
export async function startUpdateServer(controller: UpdateController, remote?: RemoteAccessService, reserveShutdown?: () => () => Promise<void>): Promise<{ url: string; token: string; close(): Promise<void> }> {
  const token = randomBytes(32).toString('hex');
  let shutdownRequested = false;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    const auth = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
    if (request.method !== 'POST' || auth.length !== expected.length || !timingSafeEqual(auth, expected) || request.headers.origin) {
      request.resume(); response.writeHead(403).end(); return;
    }
    const send = (value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value)); };
    if (request.url === '/shutdown') {
      request.resume();
      if (!reserveShutdown) { send({ message: '当前启动方式不支持从页面关闭，请回到启动终端按 Ctrl+C。' }, 409); return; }
      if (shutdownRequested) { send({ phase: 'stopping' }); return; }
      if (controller.status().phase === 'restarting') { send({ message: '更新正在重启服务，请稍等片刻再关闭。' }, 409); return; }
      // Reserve synchronously: no update/recovery can start after acceptance.
      const shutdown = reserveShutdown();
      shutdownRequested = true;
      send({ phase: 'stopping' });
      // Give the Host time to return the acknowledgement over its WebSocket.
      shutdownTimer = setTimeout(() => { void shutdown().catch(() => { /* The owner records failed cleanup. */ }); }, 500);
      return;
    }
    if (shutdownRequested) { request.resume(); send({ message: 'Notara 正在关闭。' }, 409); return; }
    const remoteRoute = /^\/remote\/(status|save|enable|disable)$/.exec(request.url ?? '');
    if (remoteRoute) {
      if (!remote) { request.resume(); response.writeHead(404).end(); return; }
      void (async () => {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const raw of request) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          size += chunk.length;
          if (size > 8 * 1024) throw new Error('remote_input_invalid');
          chunks.push(chunk);
        }
        let input: unknown = {};
        if (size) {
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { throw new Error('remote_input_invalid'); }
        }
        const method = remoteRoute[1] as 'status' | 'save' | 'enable' | 'disable';
        const result = await remote[method](input);
        send(result);
      })().catch(error => {
        if (response.headersSent || response.destroyed) return;
        const code = knownRemoteCode(error) ? error.message : 'remote_bridge_unavailable';
        const status = code === 'remote_busy' ? 409
          : code === 'remote_input_invalid' || code === 'remote_configuration_invalid' ? 400
            : code === 'remote_save_failed' || code === 'remote_stop_failed' ? 500 : 409;
        send({ code }, status);
      });
      return;
    }
    if (request.url === '/status') { send(controller.status()); return; }
    if (request.url === '/check') { void controller.check(); send(controller.status()); return; }
    if (request.url === '/apply') {
      if (!['ready', 'restarting'].includes(controller.status().phase)) { send({ message: '新版尚未准备好，请先检查更新。' }, 409); return; }
      // Reserve the update now, so a periodic check cannot displace it.
      // The delay lets the Host deliver its reply before its process stops.
      void controller.apply(500).catch(() => {});
      send(controller.status());
      return;
    }
    response.writeHead(404).end();
  });
  const port = await listenWebLoopback(server);
  return { url: `http://127.0.0.1:${port}`, token, close: () => new Promise<void>((done, reject) => { clearTimeout(shutdownTimer); server.close(error => error ? reject(error) : done()); server.closeIdleConnections(); }) };
}

function knownRemoteCode(error: unknown): error is Error & { message: RemoteSettingsCode } {
  return error instanceof Error && new Set<RemoteSettingsCode>([
    'remote_input_invalid', 'remote_configuration_invalid', 'remote_configuration_required', 'remote_ngrok_missing',
    'remote_ngrok_unconfigured', 'remote_busy', 'remote_start_failed', 'remote_stop_failed', 'remote_save_failed', 'remote_unsupported',
  ]).has(error.message as RemoteSettingsCode);
}
