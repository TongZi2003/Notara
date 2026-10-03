import type { Server } from 'node:net';
import { isBrowserBlockedPort } from '../examples/native-vault/http-port.js';

/** Bind the actual private HTTP listener atomically, retrying unusable OS ports. */
export async function listenWebLoopback(server: Server): Promise<number> {
  for (let attempt = 0; attempt < 16; attempt++) {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        server.off('error', failed); server.off('listening', listening);
        if (error) reject(error); else resolve();
      };
      const failed = (error: Error): void => finish(error);
      const listening = (): void => finish();
      server.once('error', failed); server.once('listening', listening);
      try { server.listen(0, '127.0.0.1'); } catch (error) { finish(error as Error); }
    });
    const address = server.address();
    if (address && typeof address !== 'string' && !isBrowserBlockedPort(address.port)) return address.port;
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
  }
  throw new Error('系统连续分配了浏览器禁止访问的端口，无法启动本地 HTTP 服务。请重试。');
}
