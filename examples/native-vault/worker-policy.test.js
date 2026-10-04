import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '@deepseek-ai/dsh-session';
import { installWorkerPolicy } from './worker-policy.js';
import { workerAllows, workerToolScope } from './worker-catalog.js';
import { workerProgress } from './worker-progress.js';

const session = id => Session.create(id, [], {version: 4, id, createdAt: Date.now(), isSeeded: false, origin: 'subagent', agentPreset: 'notara-teacher'});
test('concurrent workers pin their own sandbox before publication and narrow a read-only parent', async () => {
  const parents = [{session: session('one')}, {session: session('two')}], children = [];
  const ctx = {effect: callback => callback(), get: name => ctx[name]};
  ctx.sandboxPolicy = {resolve: ({session}) => ({mode: session.id === 'two' ? 'read-only' : 'danger-full-access'})};
  ctx.agents = {async create(options) {
    const agent = {session: session('child-' + options.parentAgent.session.id)};
    await new Promise(resolve => setImmediate(resolve));
    await options.setup({}, agent);
    const mode = agent.session.snapshotEvents().findLast(e => e.type === 'sandbox/mode')?.data.mode;
    children.push({parent: options.parentAgent, mode, scope: workerToolScope(agent.session)});
    return agent;
  }};
  const policy = installWorkerPolicy(ctx);
  await Promise.all(parents.map(parent => policy.run({parent, tools: 'workspace'}, () => ctx.agents.create({meta: {origin: 'subagent'}, parentAgent: parent, setup: (_ctx, child) => child.session.append('sandbox/mode', {mode: 'danger-full-access'})}))));
  assert.deepEqual(children.map(row => [row.parent.session.id, row.mode, row.scope]).sort(), [['one', 'workspace-write', 'workspace'], ['two', 'read-only', 'read-only']]);
});

test('new worker scopes fail closed without native policy and old read cannot write or execute', () => {
  const policy = installWorkerPolicy({get: () => undefined});
  assert.throws(() => policy.run({tools: 'workspace'}, () => assert.fail()), /solver_sandbox_unavailable/);
  const old = session('old');
  assert.equal(workerAllows(old, 'read'), true);
  for (const name of ['bash', 'vault_save', 'ask_worker', 'web_search']) assert.equal(workerAllows(old, name), false);
});

test('worker progress counts visible Unicode characters without exposing thoughts, arguments or text', () => {
  let state = workerProgress({phase: 'starting', outputChars: 0}, {type: 'chunk', chunk: {type: 'reasoning-delta', text: 'PRIVATE_REASONING'}});
  assert.equal(state.phase, 'thinking');
  assert.equal(state.outputChars, 0);
  state = workerProgress(state, {type: 'chunk', chunk: {type: 'text-delta', text: '解😀'}});
  assert.equal(state.phase, 'writing');
  assert.equal(state.outputChars, 2);
  state = workerProgress(state, {type: 'chunk', chunk: {type: 'tool-call-delta', arguments: 'PRIVATE_TOOL_INPUT'}});
  assert.equal(state.phase, 'tool');
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE|解😀/);
});
