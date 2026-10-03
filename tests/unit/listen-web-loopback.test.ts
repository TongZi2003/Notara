import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, vi } from 'vitest';
import { listenWebLoopback } from '../../scripts/listen-web-loopback.ts';
import { isBrowserBlockedPort } from '../../examples/native-vault/http-port.js';

test('the actual HTTP listener retries blocked OS candidates before returning a Fetch-usable address', async () => {
  const server = createServer((_request, response) => response.end('usable'));
  const initialListeners = server.listeners('listening');
  const actualAddress = server.address.bind(server);
  let checks = 0;
  const inspect = vi.spyOn(server, 'address').mockImplementation(() => {
    const actual = actualAddress() as AddressInfo;
    return checks++ < 2 ? { ...actual, port: checks === 1 ? 6000 : 6667 } : actual;
  });
  const bind = vi.spyOn(server, 'listen');
  try {
    const port = await listenWebLoopback(server);
    expect(bind.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(isBrowserBlockedPort(port)).toBe(false);
    expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('usable');
    expect(server.listenerCount('error')).toBe(0);
    expect(server.listeners('listening')).toEqual(initialListeners);
  } finally {
    inspect.mockRestore(); bind.mockRestore();
    if (server.listening) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
  }
});

test('the retry limit releases all bound candidates rather than leaving an unusable listener', async () => {
  const server = createServer();
  const initialListeners = server.listeners('listening');
  const address = vi.spyOn(server, 'address').mockReturnValue({ address: '127.0.0.1', family: 'IPv4', port: 6000 });
  const bind = vi.spyOn(server, 'listen');
  try {
    await expect(listenWebLoopback(server)).rejects.toThrow('浏览器禁止访问的端口');
    expect(bind).toHaveBeenCalledTimes(16);
    expect(server.listening).toBe(false);
    expect(server.listenerCount('error')).toBe(0);
    expect(server.listeners('listening')).toEqual(initialListeners);
  } finally { address.mockRestore(); bind.mockRestore(); }
});

test('an ordinary bind failure is preserved and listener handlers are removed', async () => {
  const server = createServer();
  const initialListeners = server.listeners('listening');
  const failure = Object.assign(new Error('synthetic bind refusal'), { code: 'EACCES' });
  const bind = vi.spyOn(server, 'listen').mockImplementation(() => { throw failure; });
  try {
    await expect(listenWebLoopback(server)).rejects.toBe(failure);
    expect(bind).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(false);
    expect(server.listenerCount('error')).toBe(0);
    expect(server.listeners('listening')).toEqual(initialListeners);
  } finally { bind.mockRestore(); }
});
