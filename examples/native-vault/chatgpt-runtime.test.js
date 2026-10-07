import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm';
import { ChatgptAccounts } from './chatgpt-auth.js';
import { CHATGPT_AUTHENTICATED_EVENT } from './chatgpt-contract.js';
import { installChatgpt } from './chatgpt-runtime.js';
import { ChatgptAdapter } from './chatgpt-provider.js';

async function runtime(t) {
  t.mock.method(ChatgptAdapter.prototype, 'refreshModels', async () => []);
  const originalHome = process.env.DSH_HOME;
  process.env.DSH_HOME = 'synthetic-mocked-runtime';
  t.after(() => { if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome; });
  let accounts, remote;
  const calls = [], disposers = [];
  // The constructor is real; loading is replaced before effects run, so no user files are read.
  t.mock.method(ChatgptAccounts.prototype, 'status', async function () {
    accounts = this;
    this.data = { accounts: [
      { id: 'account-a', accessToken: 'synthetic-a', scopes: ['chatgpt.tokens.use.direct'] },
      { id: 'account-b', accessToken: 'synthetic-b', scopes: ['chatgpt.tokens.use.direct'] },
      { id: 'no-plan', accessToken: 'synthetic-no-plan', scopes: [] },
    ] };
    return { accounts: [] };
  });
  const scope = {
    get: () => undefined,
    plugin: service => { remote = service; },
    effect: effect => { disposers.push(effect()); },
    emit: (event, provider) => { calls.push({ event, provider }); },
    llm: { registerAdapter(routes) {
      calls.push({ registered: [...routes] });
      const dispose = () => {};
      dispose.replace = next => { calls.push({ replaced: [...next] }); };
      return dispose;
    } },
  };
  installChatgpt({ plugin: specification => specification.apply(scope) });
  await new Promise(resolve => setImmediate(resolve));
  t.after(() => { for (const dispose of disposers) dispose?.(); });
  return { accounts, calls, remote };
}

test('successful granted login emits only its provider after registration; startup and denied plan do not', async t => {
  const { accounts, calls } = await runtime(t);
  assert.deepEqual(calls, [{ registered: ['notara-chatgpt-account-a', 'notara-chatgpt-account-b'] }]);
  accounts.onChange({ accountId: 'account-b', reason: 'signed-in' });
  assert.deepEqual(calls.slice(1), [
    { replaced: ['notara-chatgpt-account-a', 'notara-chatgpt-account-b'] },
    { event: CHATGPT_AUTHENTICATED_EVENT, provider: 'notara-chatgpt-account-b' },
  ]);
  accounts.onChange({ accountId: 'no-plan', reason: 'signed-in' });
  accounts.onChange();
  assert.equal(calls.filter(call => call.event === CHATGPT_AUTHENTICATED_EVENT).length, 1);
  assert.doesNotMatch(JSON.stringify(calls), /synthetic-a|synthetic-b|accessToken/);
});

test('settings remote retains the subscription quota notice for the canonical DSH error code', async t => {
  const { remote } = await runtime(t);
  await assert.rejects(remote.prototype.call(() => { throw new LlmError('synthetic quota', QUOTA_EXCEEDED_CODE); }, {}), { message: 'chatgpt_usage_limit' });
  await assert.rejects(remote.prototype.call(() => { throw new LlmError('synthetic provider failure', 'PROVIDER_ERROR'); }, {}), { message: 'chatgpt_request_failed' });
});

test('a completed login catalog refresh invalidates a cached directory failure without repeating discovery', async t => {
  const { accounts, calls } = await runtime(t);
  let finish, requests = 0;
  t.mock.method(ChatgptAdapter.prototype, 'refreshModels', async () => {
    requests++;
    return new Promise(resolve => { finish = resolve; });
  });
  accounts.onChange({ accountId: 'account-a', reason: 'signed-in' });
  assert.equal(requests, 1);
  assert.equal(calls.filter(call => call.event === CHATGPT_AUTHENTICATED_EVENT).length, 1);
  finish([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.deepEqual(calls.filter(call => call.event === CHATGPT_AUTHENTICATED_EVENT), [
    { event: CHATGPT_AUTHENTICATED_EVENT, provider: 'notara-chatgpt-account-a' },
    { event: CHATGPT_AUTHENTICATED_EVENT, provider: 'notara-chatgpt-account-a' },
  ]);
});
