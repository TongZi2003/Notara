import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

test('browser login tolerates accumulated localhost cookies without bypassing authentication', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  try {
    // Cookies are scoped to the host, not the port. Old random-port DSH
    // instances therefore contribute cookies to every new localhost request.
    const oldCookies = Array.from({ length: 170 }, (_, i) => {
      const name = createHash('sha256').update(`127.0.0.1:${10000 + i}`).digest('base64url');
      return `dsh-auth-${name}=${'x'.repeat(240)}`;
    }).join('; ');
    expect(Buffer.byteLength(oldCookies)).toBeGreaterThan(48 * 1024);
    const origin = new URL(runtime.authUrl).origin;
    const request = async (url: string, init: RequestInit = {}) => {
      const response = await fetch(url, { ...init, redirect: 'manual' });
      await response.body?.cancel();
      return response;
    };

    expect((await request(origin, { headers: { cookie: oldCookies } })).status).toBe(401);
    expect((await request(`${origin}/?token=invalid`, { headers: { cookie: oldCookies } })).status).toBe(401);
    const login = await request(runtime.authUrl, { headers: { cookie: oldCookies } });
    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('/');
    const sessionCookie = login.headers.getSetCookie().find(value => value.startsWith('dsh-auth-'));
    expect(sessionCookie).toContain('HttpOnly; SameSite=Strict');
    const cookie = `${oldCookies}; ${sessionCookie!.split(';')[0]}`;
    expect((await request(origin, { headers: { cookie } })).status).toBe(200);
    expect((await request(`${origin}/index.html`, { headers: { cookie } })).status).toBe(200);
    expect((await request(`${origin}/api/session/list`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', origin }, body: '{}',
    })).status).toBe(200);
    expect((await request(`${origin}/api/session/list`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'https://untrusted.example' }, body: '{}',
    })).status).toBe(403);
    expect((await request(origin, { headers: { cookie: `oversized=${'x'.repeat(70 * 1024)}` } })).status).toBe(431);
  } finally {
    await runtime.stop();
  }
}, 90_000);
