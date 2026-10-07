import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatgptAccounts } from './chatgpt-auth.js';
import { ChatgptAdapter } from './chatgpt-provider.js';
import { chatgptModelCatalog } from './chatgpt-catalog.js';

const rows = ['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'].map(slug => ({ slug, visibility: 'list', display_name: slug }));
async function fixture(t, fetcher) {
  const directory = await mkdtemp(join(tmpdir(), 'notara-chatgpt-catalog-'));
  const options = { protect: path => mkdir(path, { recursive: true }), fetch: fetcher };
  const accounts = new ChatgptAccounts(directory, options);
  await accounts.load();
  const add = id => ({ id, clientId: `oaiapp_test_${id}`, subject: id, scopes: ['chatgpt.tokens.use.direct'], accessToken: `synthetic-${id}`, expiresAt: Date.now() + 3600_000 });
  const a = add(randomUUID()), b = add(randomUUID());
  accounts.data.accounts.push(a, b); await accounts.save();
  t.after(async () => { accounts.close(); await rm(directory, { recursive: true, force: true }); });
  return { accounts, a, b, directory, options, adapter: new ChatgptAdapter(accounts) };
}

test('SIWC parser displays every new visible GPT model in server order, ignoring malformed rows and duplicates', () => {
  assert.deepEqual(chatgptModelCatalog({ models: [...rows, null, { slug: '', visibility: 'list' }, rows[0], { slug: 'hidden', visibility: 'hide' }] }).map(model => model.id), rows.map(model => model.slug));
  assert.throws(() => chatgptModelCatalog({ data: rows }), /catalog_invalid/);
});

test('public authorization revisions survive token rotation but change for a replacement account', async t => {
  const { accounts, a } = await fixture(t, async () => Response.json({ models: rows }));
  const revision = (await accounts.status()).accounts.find(account => account.id === a.id).authorizationRevision;
  assert.match(revision, /^[0-9a-f-]{36}$/);
  a.accessToken = 'synthetic-rotated';
  assert.equal((await accounts.status()).accounts.find(account => account.id === a.id).authorizationRevision, revision);
  accounts.data.accounts = accounts.data.accounts.map(account => account === a ? { ...account } : account);
  assert.notEqual((await accounts.status()).accounts.find(account => account.id === a.id).authorizationRevision, revision);
});

test('SIWC account discovery is single-flight, saved per account, restored offline and manually refreshed', async t => {
  const requests = []; let response = rows;
  const fixtureData = await fixture(t, async (url, init) => { requests.push({ url, init }); return Response.json({ models: response }); });
  const { accounts, adapter, a, b, directory, options } = fixtureData, provider = `notara-chatgpt-${a.id}`;
  const answers = await Promise.all([adapter.listModels(provider), adapter.listModels(provider), adapter.listModels(provider)]);
  assert.equal(requests.length, 1); assert.deepEqual(answers[0].map(model => model.id), rows.map(model => model.slug));
  assert.equal(requests[0].url, 'https://api.openai.com/v1/models');
  assert.equal(requests[0].init.headers.authorization, `Bearer ${a.accessToken}`);
  response = [rows[2]];
  assert.equal((await adapter.listModels(provider)).length, 3); assert.equal(requests.length, 1);
  assert.equal((await adapter.refreshModels(provider)).length, 1); assert.equal(requests.length, 2);
  assert.equal((await adapter.listModels(`notara-chatgpt-${b.id}`)).length, 1); assert.equal(requests.length, 3);
  const reopened = new ChatgptAccounts(directory, { ...options, fetch: async () => { throw new Error('offline'); } });
  t.after(() => reopened.close());
  const restored = new ChatgptAdapter(reopened);
  assert.equal((await restored.listModels(provider))[0].id, 'gpt-6.1-sol');
  await assert.rejects(restored.refreshModels(provider), /请求未完成/);
  assert.equal((await restored.listModels(provider))[0].id, 'gpt-6.1-sol');
  await accounts.signOut(a.id);
  assert.equal(a.modelCatalog, undefined);
  await assert.rejects(adapter.listModels(provider), /重新登录/);
  assert.equal((await adapter.listModels(`notara-chatgpt-${b.id}`)).length, 1);
});

test('an empty SIWC account catalog stays empty and never borrows another account models', async t => {
  const { adapter, a, b } = await fixture(t, async (_url, init) => Response.json({ models: init.headers.authorization.endsWith(a.id) ? rows : [] }));
  assert.equal((await adapter.listModels(`notara-chatgpt-${a.id}`)).length, 3);
  assert.deepEqual(await adapter.listModels(`notara-chatgpt-${b.id}`), []);
});

test('logout or replacement account prevents a late catalog response from publishing old account choices', async t => {
  let release, requested;
  const started = new Promise(resolve => { requested = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { accounts, adapter, a } = await fixture(t, async () => { requested(); await gate; return Response.json({ models: rows }); });
  const pending = adapter.listModels(`notara-chatgpt-${a.id}`);
  const rejected = assert.rejects(pending);
  await started;
  await accounts.signOut(a.id);
  release(); await rejected;
  assert.equal(a.modelCatalog, undefined);
  const replacement = { ...a, accessToken: 'synthetic-new-token', expiresAt: Date.now() + 3600_000 };
  accounts.data.accounts = accounts.data.accounts.map(value => value.id === a.id ? replacement : value);
  await assert.rejects(accounts.cacheModels(a.id, a, [{ id: 'old-account-model', name: 'old' }]), /signin_required/);
  assert.equal(replacement.modelCatalog, undefined);
});

test('successful reauthorization fetches with the new token while an old catalog request is still pending', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const requests = [];
  const { accounts, adapter, a } = await fixture(t, async (_url, init) => {
    requests.push(init.headers.authorization);
    if (init.headers.authorization !== 'Bearer synthetic-new-token') { entered(); await gate; return Response.json({ models: rows }); }
    return Response.json({ models: [rows[2]] });
  });
  const provider = `notara-chatgpt-${a.id}`, old = adapter.refreshModels(provider), rejected = assert.rejects(old);
  await started;
  const replacement = { ...a, accessToken: 'synthetic-new-token' };
  accounts.data.accounts = accounts.data.accounts.map(account => account.id === a.id ? replacement : account);
  // The runtime resets in-flight discovery at the successful sign-in boundary.
  adapter.resetCatalog(provider);
  assert.deepEqual((await adapter.refreshModels(provider)).map(model => model.id), ['gpt-6.1-sol']);
  release(); await rejected;
  assert.deepEqual((await adapter.listModels(provider)).map(model => model.id), ['gpt-6.1-sol']);
  assert.deepEqual(requests, [`Bearer synthetic-${a.id}`, 'Bearer synthetic-new-token']);
  assert.equal(a.modelCatalog, undefined);
});
