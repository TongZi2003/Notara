import { randomBytes, randomUUID, createHash, createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, rm, lstat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isBrowserBlockedPort } from './http-port.js';

const exec = promisify(execFile);
export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');
const fail = code => { throw new Error(code); };
const issuedClient = value => typeof value === 'string' && value !== 'dynamic_agent_client' && /^[A-Za-z0-9_-]{1,200}$/.test(value);

function closeCallbackServer(server) {
  return new Promise(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

function listenCallbackServer(server, signal) {
  return new Promise((resolve, reject) => {
    const binding = new AbortController();
    let settled = false;
    const finish = error => {
      if (settled) return; settled = true;
      signal.removeEventListener('abort', aborted);
      server.removeListener('error', failed); server.removeListener('listening', listening);
      if (error) reject(error); else resolve();
    };
    const aborted = () => { binding.abort(signal.reason); finish(signal.reason); };
    const failed = error => finish(error);
    const listening = () => finish();
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    server.once('error', failed); server.once('listening', listening);
    try { server.listen({ port: 0, host: '127.0.0.1', signal: binding.signal }); }
    catch (error) { finish(error); }
  });
}

async function protectPrivatePath(path, directory) {
  if (process.platform !== 'win32') await chmod(path, directory ? 0o700 : 0o600);
  if (process.platform === 'win32') {
    // Replace inherited AND explicit ACL entries. Path data never enters shell code.
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$path = $env:NOTARA_CHATGPT_PRIVATE_PATH',
      '$isDirectory = [System.IO.Directory]::Exists($path)',
      '$acl = if ($isDirectory) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }',
      '$acl.SetAccessRuleProtection($true, $false)',
      'foreach ($entry in @($acl.Access)) { $acl.RemoveAccessRuleAll($entry) }',
      '$inheritance = [System.Security.AccessControl.InheritanceFlags]::None',
      'if ($isDirectory) { $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit }',
      '$rights = [System.Security.AccessControl.FileSystemRights]::FullControl',
      '$propagation = [System.Security.AccessControl.PropagationFlags]::None',
      '$allow = [System.Security.AccessControl.AccessControlType]::Allow',
      '$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$system = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")',
      '$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($user, $rights, $inheritance, $propagation, $allow))',
      '$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($system, $rights, $inheritance, $propagation, $allow))',
      'if ($isDirectory) { [System.IO.Directory]::SetAccessControl($path, $acl) } else { [System.IO.File]::SetAccessControl($path, $acl) }',
    ].join('; ');
    try { await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, NOTARA_CHATGPT_PRIVATE_PATH: path } }); }
    catch { fail('chatgpt_storage_permissions'); }
  }
}

/** Files never enter the browser or the Vault. Windows mode bits do not restrict ACLs. */
export async function protectDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) fail('chatgpt_storage_link');
  await protectPrivatePath(directory, true);
}

export async function validateIdToken(token, { clientId, nonce, subject, jwks, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 32_768) fail('chatgpt_identity_invalid');
  let header, claims, parts = token.split('.');
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); }
  catch { fail('chatgpt_identity_invalid'); }
  if (parts.length !== 3 || header.alg !== 'RS256' || !header.kid) fail('chatgpt_identity_invalid');
  const key = jwks.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
  if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) fail('chatgpt_identity_invalid');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId) || (claims.azp && claims.azp !== clientId) || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now || (claims.nbf && claims.nbf * 1000 > now + 30_000) || typeof claims.sub !== 'string' || !claims.sub || (nonce !== undefined && claims.nonce !== nonce) || (subject && claims.sub !== subject)) fail('chatgpt_identity_invalid');
  return claims;
}

/** One manager per locked DSH runtime. All credential mutations/refreshes are serialized. */
export class ChatgptAccounts {
  constructor(directory, { fetch: fetcher = globalThis.fetch, protect = protectDirectory, onChange = () => {}, now = Date.now, createCallbackServer = createServer } = {}) {
    this.directory = directory; this.fetch = fetcher; this.protect = protect; this.onChange = onChange; this.now = now;
    this.queue = Promise.resolve(); this.pending = null; this.notice = ''; this.controllers = new Map();
    this.shutdown = new AbortController();
    // A local constructor seam for deterministic allocator tests; no environment override.
    this.createCallbackServer = createCallbackServer;
  }
  exclusive(fn) { const work = this.queue.then(fn); this.queue = work.catch(() => {}); return work; }
  async load() {
    if (this.data) return this.data;
    await this.protect(this.directory);
    try {
      const path = join(this.directory, 'accounts.json');
      if ((await lstat(path)).isSymbolicLink()) fail('chatgpt_storage_link');
      await protectPrivatePath(path, false);
      const data = JSON.parse(await readFile(path, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.accounts) || !/^urn:uuid:[0-9a-f-]{36}$/.test(data.hostId) || (data.pendingClientId !== undefined && !issuedClient(data.pendingClientId)) || data.accounts.some(a => !a || !/^[0-9a-f-]{36}$/.test(a.id) || !issuedClient(a.clientId) || typeof a.subject !== 'string' || !Array.isArray(a.scopes) || a.scopes.some(s => typeof s !== 'string') || (a.accessToken !== undefined && (typeof a.accessToken !== 'string' || !Number.isFinite(a.expiresAt))))) fail('chatgpt_storage_invalid');
      this.data = data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [] }; await this.save();
    }
    return this.data;
  }
  async save() {
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(this.data), { mode: 0o600, flag: 'wx' }); await rename(temporary, join(this.directory, 'accounts.json')); }
    catch (error) { this.data = undefined; throw error; }
    finally { await rm(temporary, { force: true }); }
  }
  async request(url, options = {}) {
    try { return await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.any([this.shutdown.signal, options.signal ?? AbortSignal.timeout(30_000)]) }); }
    catch (error) { if (options.signal?.aborted) throw error; fail('chatgpt_network_error'); }
  }
  async json(url, options) {
    const response = await this.request(url, options);
    if (!response.ok) {
      let code; try { const body = await response.json(); code = typeof body.error === 'string' ? body.error : body.error?.code; } catch {}
      if (code === 'invalid_grant' || response.status === 401) fail('chatgpt_signin_required');
      if (response.status === 429 || String(code).startsWith('subscription_sharing_usage_')) fail('chatgpt_usage_limit');
      fail('chatgpt_request_failed');
    }
    return response.json();
  }
  async status() {
    return this.exclusive(async () => {
      const data = await this.load();
      return { accounts: data.accounts.map(({ id, email, idToken, accessToken, scopes }) => ({ id, label: `${email || 'ChatGPT'} · ${id.slice(0, 6)}`, connected: !!idToken || !!accessToken, planEnabled: !!accessToken && scopes.includes('chatgpt.tokens.use.direct'), provider: `notara-chatgpt-${id}` })), pending: !!this.pending, notice: this.notice };
    });
  }
  async begin(id) {
    return this.exclusive(async () => {
      const data = await this.load(); this.cancel(); this.notice = '';
      this.shutdown.signal.throwIfAborted();
      const account = id ? data.accounts.find(a => a.id === id) : undefined;
      if (id && !account) fail('chatgpt_account_missing');
      const attempt = { id: random(), state: random(), nonce: random(), verifier: random(), account, clientId: account?.clientId || data.pendingClientId, expires: this.now() + 300_000, controller: new AbortController() };
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new Error('chatgpt_request_failed')), 5000); timer.unref();
      const signal = AbortSignal.any([this.shutdown.signal, attempt.controller.signal, deadline.signal]);
      this.pending = attempt;
      try {
        for (let n = 0; n < 16; n++) {
          signal.throwIfAborted();
          const server = this.createCallbackServer((req, res) => { void this.callback(attempt, req, res); });
          attempt.server = server;
          try { await listenCallbackServer(server, signal); }
          catch (error) {
            await closeCallbackServer(server);
            signal.throwIfAborted();
            if (error.code === 'EADDRINUSE' || error.code === 'EACCES') continue;
            fail('chatgpt_request_failed');
          }
          const address = server.address();
          if (!address || typeof address === 'string' || address.address !== '127.0.0.1' || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535 || isBrowserBlockedPort(address.port)) {
            await closeCallbackServer(server);
            continue;
          }
          signal.throwIfAborted();
          server.on('error', () => { if (this.pending === attempt) { this.notice = 'chatgpt_request_failed'; this.cancel(); } });
          attempt.redirect = `http://127.0.0.1:${address.port}/auth/callback`;
          attempt.timer = setTimeout(() => { if (this.pending === attempt) { this.notice = 'chatgpt_signin_expired'; this.cancel(); } }, 300_000);
          attempt.timer.unref();
          // The ID-token hint is sent only by a server redirect to the official issuer.
          return { url: `http://127.0.0.1:${address.port}/start/${attempt.id}` };
        }
        fail('chatgpt_request_failed');
      } catch (error) {
        if (this.pending === attempt) this.cancel();
        throw error;
      } finally { clearTimeout(timer); }
    });
  }
  cancel() {
    const attempt = this.pending; if (!attempt) return;
    this.pending = null; clearTimeout(attempt.timer); attempt.controller.abort();
    if (attempt.server) void closeCallbackServer(attempt.server);
  }
  async callback(attempt, req, res) {
    res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('content-type', 'text/plain; charset=utf-8');
    try {
      const expectedHost = new URL(attempt.redirect).host;
      if (req.method !== 'GET' || req.headers.host !== expectedHost || this.pending !== attempt || this.now() > attempt.expires) { res.writeHead(400); res.end('登录请求已失效。'); return; }
      const url = new URL(req.url, attempt.redirect);
      if (url.pathname === `/start/${attempt.id}`) {
        const params = new URLSearchParams({ client_id: attempt.clientId || 'dynamic_agent_client', ext_agent_host_id: this.data.hostId, response_type: 'code', redirect_uri: attempt.redirect, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') });
        if (!attempt.clientId) params.set('agent_name_hint', 'Notara');
        if (attempt.account?.idToken) params.set('id_token_hint', attempt.account.idToken);
        if (attempt.account?.email) params.set('login_hint', attempt.account.email);
        res.writeHead(302, { location: `${ISSUER}/api/accounts/authorize?${params}` }); res.end(); return;
      }
      if (url.pathname !== '/auth/callback' || ['state', 'code', 'client_id', 'error'].some(key => url.searchParams.getAll(key).length > 1) || url.searchParams.get('state') !== attempt.state) { res.writeHead(400); res.end('无法验证登录请求。'); return; }
      // Consume once, including declined consent. A mismatched state cannot cancel a valid attempt.
      this.pending = null; clearTimeout(attempt.timer); attempt.server.close();
      await this.exclusive(async () => {
        if (url.searchParams.has('error')) fail('chatgpt_consent_declined');
        const clientId = url.searchParams.get('client_id') || attempt.clientId;
        if (!issuedClient(clientId) || (attempt.clientId && attempt.clientId !== clientId)) fail('chatgpt_registration_invalid');
        const code = url.searchParams.get('code'); if (!code) fail('chatgpt_registration_invalid');
        // Preserve an issued registration before code exchange, including an invalid_grant retry.
        // It is not an account and cannot route inference until the signed identity is validated.
        if (!attempt.account) { this.data.pendingClientId = clientId; await this.save(); }
        const tokens = await this.json(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirect, resource: RESOURCE }) });
        const jwks = await this.json(`${ISSUER}/.well-known/jwks.json`);
        const identity = await validateIdToken(tokens.id_token, { clientId, nonce: attempt.nonce, subject: attempt.account?.subject, jwks, now: this.now() });
        this.shutdown.signal.throwIfAborted();
        const previous = this.data.accounts.find(a => a.clientId === clientId);
        if (previous && previous.subject !== identity.sub) fail('chatgpt_identity_invalid');
        const account = previous ?? { id: randomUUID(), clientId, subject: identity.sub };
        const next = { ...account, email: typeof identity.email === 'string' ? identity.email : '', ...this.tokenFields(tokens), idToken: tokens.id_token };
        this.data.accounts = [...this.data.accounts.filter(a => a.id !== next.id), next]; delete this.data.pendingClientId; await this.save();
        this.notice = next.scopes.includes('chatgpt.tokens.use.direct') ? 'chatgpt_connected' : 'chatgpt_plan_disabled'; this.onChange({ accountId: next.id, reason: 'signed-in' });
      });
      res.end('已连接 ChatGPT。可以关闭此页并返回 Notara。');
    } catch (error) { this.notice = /^chatgpt_/.test(error.message) ? error.message : 'chatgpt_signin_failed'; res.writeHead(400); res.end('登录未完成，请返回 Notara 查看提示并重试。'); }
  }
  tokenFields(tokens, previous = {}) {
    const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : (previous.scopes ?? []);
    if (!tokens.access_token && tokens.id_token && !scopes.includes('chatgpt.tokens.use.direct')) return { accessToken: undefined, refreshToken: undefined, expiresAt: undefined, scopes };
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || String(tokens.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) fail('chatgpt_token_invalid');
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous.refreshToken, expiresAt: this.now() + tokens.expires_in * 1000, scopes };
  }
  async access(id) {
    return this.exclusive(async () => {
      await this.load(); const account = this.data.accounts.find(a => a.id === id);
      if (!account?.accessToken) fail('chatgpt_signin_required');
      if (!account.scopes.includes('chatgpt.tokens.use.direct')) fail('chatgpt_plan_disabled');
      if (account.expiresAt <= this.now() + 60_000) {
        if (!account.refreshToken) fail('chatgpt_signin_required');
        try {
          const tokens = await this.json(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource: RESOURCE }) });
          Object.assign(account, this.tokenFields(tokens, account)); await this.save();
        } catch (error) {
          if (error.message === 'chatgpt_signin_required') { this.clearTokens(account); await this.save(); this.onChange(); }
          throw error;
        }
      }
      if (!account.scopes.includes('chatgpt.tokens.use.direct')) fail('chatgpt_plan_disabled');
      return account.accessToken;
    });
  }
  clearTokens(account) { delete account.accessToken; delete account.refreshToken; delete account.idToken; delete account.expiresAt; }
  track(id, controller) { let set = this.controllers.get(id); if (!set) this.controllers.set(id, set = new Set()); set.add(controller); return () => set.delete(controller); }
  async signOut(id) {
    return this.exclusive(async () => {
      await this.load(); const account = this.data.accounts.find(a => a.id === id); if (!account) fail('chatgpt_account_missing');
      if (this.pending?.account?.id === id) this.cancel();
      for (const controller of this.controllers.get(id) ?? []) controller.abort();
      let revoked = !account.refreshToken;
      if (account.refreshToken) {
        try {
          const discovery = await this.json(`${ISSUER}/.well-known/openid-configuration`);
          if (new URL(discovery.revocation_endpoint).origin !== ISSUER) fail('chatgpt_endpoint_invalid');
          for (let n = 0; n < 2 && !revoked; n++) {
            if (n) await new Promise(resolve => setTimeout(resolve, 300));
            try {
              const response = await this.request(discovery.revocation_endpoint, { method: 'POST', body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }), signal: AbortSignal.timeout(5000) });
              revoked = response.status === 200;
              if (!revoked && response.status < 500) break;
            } catch { /* One bounded backoff retry while the refresh token is available. */ }
          }
        } catch {}
      }
      this.clearTokens(account); await this.save(); this.notice = revoked ? 'chatgpt_signed_out' : 'chatgpt_revocation_unconfirmed'; this.onChange();
      return { revoked };
    });
  }
  close() { this.shutdown.abort(); this.cancel(); for (const set of this.controllers.values()) for (const controller of set) controller.abort(); }
}
