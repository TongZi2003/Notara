import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { IsolatedRuntime } from '../../scripts/dev-isolated.ts';

/** Test-only native HTTP transport; credentials stay in memory and refresh after a test restart. */
export async function connectRuntime(runtime: IsolatedRuntime) {
  const origin = new URL(runtime.authUrl).origin;
  const login = await fetch(runtime.authUrl, { redirect: 'manual', headers: { connection: 'close' } });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return {
    async rpc<T>(method: string, args: unknown): Promise<RemoteResult<T>> {
      // One socket per call: undici does not retry a POST dispatched onto a
      // pooled connection the server has already decided to close, and a tight
      // rpc loop hits that race as ECONNRESET. Closing each time keeps every
      // call's outcome attributable to the call itself.
      const response = await fetch(origin + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json', cookie, connection: 'close' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) });
      if (response.status !== 200) throw new Error(`native ${method} HTTP ${response.status}`);
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('result' in body) || !body.result || typeof body.result !== 'object' || !('ok' in body.result)) throw new Error('Invalid native response envelope');
      return body.result as RemoteResult<T>;
    },
  };
}
