import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { UpdateController } from './vault-updates.ts';

/** Only the authenticated DSH Host can reach this private launcher bridge. */
export async function startUpdateServer(controller: UpdateController): Promise<{ url: string; token: string; close(): Promise<void> }> {
  const token = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    const auth = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
    if (request.method !== 'POST' || auth.length !== expected.length || !timingSafeEqual(auth, expected) || request.headers.origin) {
      response.writeHead(403).end(); return;
    }
    const send = (value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value)); };
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
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('更新服务启动失败。');
  return { url: `http://127.0.0.1:${address.port}`, token, close: () => new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeIdleConnections(); }) };
}
