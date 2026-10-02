import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ChatgptAccounts, ISSUER, RESOURCE, validateIdToken } from './chatgpt-auth.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' }] };
const jwt = claims => { const data = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url')].join('.'); return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`; };
const claims = { iss: ISSUER, aud: 'oaiapp_test', sub: 'person', nonce: 'nonce', exp: Math.floor(Date.now() / 1000) + 3600, email: 'learner@example.com' };

test('ID validation rejects tampering, wrong issuer/audience/nonce/subject, expiry and ambiguous audience', async () => {
  const options = { clientId: 'oaiapp_test', nonce: 'nonce', jwks };
  assert.equal((await validateIdToken(jwt(claims), options)).sub, 'person');
  for (const patch of [{ iss: 'https://evil.example' }, { aud: 'wrong' }, { nonce: 'wrong' }, { exp: 1 }, { sub: '' }, { aud: ['oaiapp_test', 'other'] }, { azp: 'other' }]) await assert.rejects(validateIdToken(jwt({ ...claims, ...patch }), options), /chatgpt_identity_invalid/);
  await assert.rejects(validateIdToken(jwt(claims), { ...options, subject: 'another-person' }), /identity_invalid/);
  const token = jwt(claims).split('.'); token[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'attacker' })).toString('base64url');
  await assert.rejects(validateIdToken(token.join('.'), options), /identity_invalid/);
});

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'notara chatgpt-$()`-'));
  let authorize, exchanges = 0, refreshes = 0, grant = 'openid chatgpt.tokens.use.direct resource.invoke', rejectRefresh = false, rejectExchange = false, revokeStatus = 200;
  const requests = [];
  const accounts = new ChatgptAccounts(root, { fetch: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/jwks.json')) return Response.json(jwks);
    if (url.endsWith('/openid-configuration')) return Response.json({ revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke` });
    if (url.endsWith('/revoke')) return new Response('', { status: revokeStatus });
    if (url.endsWith('/token')) {
      assert.equal(options.body.get('resource'), RESOURCE);
      assert.notEqual(options.body.get('client_id'), 'dynamic_agent_client');
      if (options.body.get('grant_type') === 'refresh_token') {
        refreshes++; assert.equal(options.body.has('scope'), false);
        if (rejectRefresh) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ access_token: 'new-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 });
      }
      exchanges++;
      assert.equal(options.body.get('redirect_uri'), authorize.searchParams.get('redirect_uri'));
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), authorize.searchParams.get('code_challenge'));
      if (rejectExchange) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', token_type: 'Bearer', scope: grant, expires_in: 3600, id_token: jwt({ ...claims, nonce: authorize.searchParams.get('nonce') }) });
    }
    throw new Error('Unexpected request');
  } });
  t.after(async () => { accounts.close(); await rm(root, { recursive: true, force: true }); });
  return { accounts, root, requests, get exchanges() { return exchanges; }, get refreshes() { return refreshes; }, set grant(value) { grant = value; }, set rejectRefresh(value) { rejectRefresh = value; }, set rejectExchange(value) { rejectExchange = value; }, set revokeStatus(value) { revokeStatus = value; }, async start(id) {
    const started = await accounts.begin(id);
    assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/start\//);
    const redirect = await fetch(started.url, { redirect: 'manual' }); assert.equal(redirect.status, 302);
    authorize = new URL(redirect.headers.get('location'));
    assert.equal(authorize.origin, ISSUER);
    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', authorize.searchParams.get('state')); callback.searchParams.set('code', 'test-code'); callback.searchParams.set('client_id', 'oaiapp_test');
    return { authorize, callback };
  } };
}

test('real loopback OAuth flow persists private credentials; public status never includes them; returning login reuses host/client', async t => {
  const fixture = await setup(t), { accounts } = fixture;
  const first = await fixture.start();
  assert.equal(first.authorize.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(first.authorize.searchParams.get('code_challenge_method'), 'S256');
  const host = first.authorize.searchParams.get('ext_agent_host_id');
  const bad = new URL(first.callback); bad.searchParams.set('state', 'bad');
  assert.equal((await fetch(bad)).status, 400); assert.equal(fixture.exchanges, 0);
  assert.equal((await fetch(first.callback)).status, 200); assert.equal(fixture.exchanges, 1);
  const state = await accounts.status(); assert.equal(state.accounts[0].connected, true); assert.equal(state.accounts[0].planEnabled, true);
  assert.doesNotMatch(JSON.stringify(state), /private-access|private-refresh|idToken/);
  const stored = JSON.parse(await readFile(join(fixture.root, 'accounts.json'), 'utf8')); assert.equal(stored.accounts[0].refreshToken, 'private-refresh');
  const returning = await fixture.start(state.accounts[0].id);
  assert.equal(returning.authorize.searchParams.get('client_id'), 'oaiapp_test'); assert.equal(returning.authorize.searchParams.get('ext_agent_host_id'), host); assert.equal(returning.authorize.searchParams.has('agent_name_hint'), false);
  returning.callback.searchParams.set('client_id', 'oaiapp_different');
  assert.equal((await fetch(returning.callback)).status, 400); assert.equal(fixture.exchanges, 1);
  assert.equal((await accounts.status()).accounts[0].connected, true);
});

test('failed code exchange retains issued registration across restart and retries with a fresh PKCE attempt', async t => {
  const fixture = await setup(t);
  fixture.rejectExchange = true;
  const first = await fixture.start();
  assert.equal((await fetch(first.callback)).status, 400);
  assert.deepEqual((await fixture.accounts.status()).accounts, []);
  const stored = JSON.parse(await readFile(join(fixture.root, 'accounts.json'), 'utf8'));
  assert.equal(stored.pendingClientId, 'oaiapp_test');
  fixture.accounts.close();
  const restarted = new ChatgptAccounts(fixture.root);
  t.after(() => restarted.close());
  const started = await restarted.begin();
  const response = await fetch(started.url, { redirect: 'manual' });
  const authorize = new URL(response.headers.get('location'));
  assert.equal(authorize.searchParams.get('client_id'), 'oaiapp_test');
  assert.equal(authorize.searchParams.get('ext_agent_host_id'), first.authorize.searchParams.get('ext_agent_host_id'));
  assert.equal(authorize.searchParams.has('agent_name_hint'), false);
  for (const key of ['state', 'nonce', 'code_challenge']) assert.notEqual(authorize.searchParams.get(key), first.authorize.searchParams.get(key));
  restarted.cancel();
  assert.equal((await restarted.status()).pending, false);
  await assert.rejects(fetch(started.url));
});

test('declined consent consumes state without token exchange; missing grant disables plan', async t => {
  const fixture = await setup(t);
  const attempt = await fixture.start(); attempt.callback.searchParams.set('error', 'access_denied');
  assert.equal((await fetch(attempt.callback)).status, 400); assert.equal(fixture.exchanges, 0);
  fixture.grant = 'openid email'; const second = await fixture.start();
  assert.equal((await fetch(second.callback)).status, 200);
  const state = await fixture.accounts.status(); assert.equal(state.accounts[0].planEnabled, false);
  await assert.rejects(fixture.accounts.access(state.accounts[0].id), /plan_disabled/);
});

test('refresh is serialized and rotation saved; invalid_grant clears tokens; logout preserves registration and reports failed revocation', async t => {
  const fixture = await setup(t), { accounts } = fixture;
  const attempt = await fixture.start(); await fetch(attempt.callback);
  const account = accounts.data.accounts[0]; account.expiresAt = 0;
  assert.deepEqual(await Promise.all([accounts.access(account.id), accounts.access(account.id)]), ['new-access', 'new-access']);
  assert.equal(fixture.refreshes, 1); assert.equal(account.refreshToken, 'rotated-refresh');
  account.expiresAt = 0; fixture.rejectRefresh = true;
  await assert.rejects(accounts.access(account.id), /signin_required/); assert.equal(account.accessToken, undefined);
  const again = await fixture.start(account.id); await fetch(again.callback);
  fixture.revokeStatus = 503;
  const controller = new AbortController(); accounts.track(account.id, controller);
  const result = await accounts.signOut(account.id); assert.equal(result.revoked, false); assert.equal(controller.signal.aborted, true);
  const saved = accounts.data.accounts[0]; assert.equal(saved.clientId, 'oaiapp_test'); assert.equal(saved.idToken, undefined);
  assert.equal((await accounts.status()).notice, 'chatgpt_revocation_unconfirmed');
});

test('Windows storage removes explicit broad ACLs from an existing directory and credential file', { skip: process.platform !== 'win32' }, async t => {
  const fixture = await setup(t), run = promisify(execFile);
  await fixture.accounts.status(); fixture.accounts.close();
  const path = join(fixture.root, 'accounts.json');
  await run('icacls.exe', [fixture.root, '/grant', '*S-1-1-0:(OI)(CI)R'], { windowsHide: true });
  await run('icacls.exe', [path, '/grant', '*S-1-1-0:R'], { windowsHide: true });
  const reopened = new ChatgptAccounts(fixture.root); t.after(() => reopened.close());
  await reopened.status();
  const script = '$p = $env:NOTARA_ACL_TEST_PATH; $a = if ([System.IO.Directory]::Exists($p)) { [System.IO.Directory]::GetAccessControl($p) } else { [System.IO.File]::GetAccessControl($p) }; $u = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($r in $a.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) { if ($r.IdentityReference.Value -ne $u -and $r.IdentityReference.Value -ne "S-1-5-18") { exit 9 } }; if (-not $a.AreAccessRulesProtected) { exit 10 }';
  for (const target of [fixture.root, path]) await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, NOTARA_ACL_TEST_PATH: target } });
});

test('signing out one account preserves an unrelated login but cancels its own reauthorization', async t => {
  const fixture = await setup(t), { accounts } = fixture;
  const first = await fixture.start(); await fetch(first.callback);
  const id = accounts.data.accounts[0].id;
  const another = await accounts.begin();
  await accounts.signOut(id);
  assert.equal((await accounts.status()).pending, true);
  assert.equal((await fetch(another.url, { redirect: 'manual' })).status, 302);
  accounts.cancel();
  const same = await accounts.begin(id);
  await accounts.signOut(id);
  assert.equal((await accounts.status()).pending, false);
  await assert.rejects(fetch(same.url));
});
