import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '@deepseek-ai/dsh-session';
const module = await import('./solver-runtime.js').catch(() => ({}));

function setup({ models = ['gpt-5.6-sol'], start } = {}) {
  assert.equal(typeof module.NotaraSolver, 'function');
  const session = Session.create('solver-parent', [], { version: 3, id: 'solver-parent', createdAt: Date.now(), isSeeded: false, agentPreset: 'notara-teacher' });
  const agent = { session };
  const calls = [];
  const ctx = { llm: { listProviders: () => [{ id: 'test', name: 'Test' }], listModels: async () => models.map(id => ({ id, name: id })), resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high', name: 'High' }] } }) }, subagents: { listChildren: async () => [{ id: 'child', kind: 'child', mode: 'one-shot' }], start: async (provider, request) => { calls.push({ provider, request }); return start ? start(request) : { id: 'child', result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'PRIVATE_SOLUTION：先约去公因子。' }] }), dispose: async () => {} }; } } };
  ctx.get = name => ctx[name];
  const teaching = { isTeaching: a => a?.session?.header?.agentPreset === 'notara-teacher', agentFor: async () => agent, flush: async () => {} };
  return { solver: new module.NotaraSolver(ctx, teaching), ctx, teaching, session, agent, calls, exec: { agent, callId: 'solve-once', signal: new AbortController().signal } };
}

test('solver requires an available exact model and never falls back to the teacher', async () => {
  const { solver, calls, exec } = setup({ models: ['teacher-flash'] });
  const view = await solver.read({ sessionId: 'solver-parent' });
  assert.equal(view.workers[0].ready, false);
  assert.equal(view.workers[0].preferredModel, 'gpt-5.6-sol');
  await assert.rejects(solver.ask({ preset: 'problem', goal: '求 x² 的导数' }, exec), /solver_model_unavailable/);
  assert.equal(calls.length, 0);
});

test('solver receives only selected text with no tools on its independent model route', async () => {
  const { solver, calls, exec, session } = setup();
  session.append('user/message', { id: 'secret', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'PARENT_ONLY_HISTORY' }] }, { surfaceOp: 'append' });
  const result = await solver.ask({ preset: 'problem', goal: '求 x² 的导数', focus: '给出定义法的教学拆解', materials: [{ title: '学生原话', text: '我不知道差商是什么。' }] }, exec);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'spawn');
  assert.deepEqual(calls[0].request.toolFilter, { allow: [] });
  assert.equal(calls[0].request.agentOptions.model, 'gpt-5.6-sol');
  assert.equal(calls[0].request.maxDepth, 1);
  assert.match(JSON.stringify(calls[0].request.prompt), /差商/);
  assert.doesNotMatch(JSON.stringify(calls[0].request.prompt), /PARENT_ONLY_HISTORY/);
  assert.match(result.analysis, /PRIVATE_SOLUTION/);
  const view = await solver.read({ sessionId: session.id });
  assert.equal(view.tasks[0].status, 'completed');
  assert.equal(view.tasks[0].inspectable, true);
  assert.deepEqual(await solver.task({ sessionId: session.id, taskId: result.taskId }), { parentSessionId: session.id, childSessionId: 'child', mode: 'one-shot', status: 'completed' });
  await assert.rejects(solver.task({ sessionId: session.id, taskId: 'foreign-task' }), /solver_task_not_found/);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_SOLUTION|差商|PARENT_ONLY_HISTORY|childId/);
  assert.doesNotMatch(JSON.stringify(session.snapshotEvents().filter(e => e.type.startsWith('notara/worker'))), /PRIVATE_SOLUTION/);
  await assert.rejects(solver.ask({ preset: 'problem', goal: '重复' }, exec), /solver_task_already_finished/);
  assert.equal(calls.length, 1);
});

test('route configuration validates candidates, rejects stale revisions, and survives recreation', async () => {
  const { solver, ctx, teaching, session } = setup();
  const route = { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high' };
  await assert.rejects(solver.configure({ preset: 'problem', tools: 'none', sessionId: session.id, expectedRevision: 0, route: { ...route, model: 'unknown' } }), /solver_model_unavailable/);
  const view = await solver.configure({ preset: 'problem', tools: 'none', sessionId: session.id, expectedRevision: 0, route });
  assert.equal(view.revision, 1);
  await assert.rejects(solver.configure({ preset: 'problem', tools: 'none', sessionId: session.id, expectedRevision: 0, route: null }), /solver_settings_conflict/);
  const restored = await new module.NotaraSolver(ctx, teaching).read({ sessionId: session.id });
  assert.deepEqual(restored.workers[0].route, route);
});

test('cancel beats a late completed result and disposes the native run', async () => {
  let finish, started, disposed = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const result = new Promise(resolve => { finish = resolve; });
  const { solver, exec, session } = setup({ start: async () => { started(); return { id: 'child', result, dispose: async () => { disposed++; finish({ stopReason: 'completed', output: [{ type: 'text', text: 'LATE_SECRET' }] }); } }; } });
  const pending = solver.ask({ preset: 'problem', goal: '难题' }, exec);
  const rejected = assert.rejects(pending, /solver_canceled/);
  await ready;
  const task = (await solver.read({ sessionId: session.id })).tasks[0];
  const view = await solver.cancel({ sessionId: session.id, taskId: task.id });
  await rejected;
  assert.equal(view.tasks[0].status, 'canceled');
  assert.ok(disposed > 0);
  await assert.rejects(solver.ask({ preset: 'problem', goal: '偷偷重试' }, { ...exec, callId: 'retry-after-cancel' }), /solver_paused/);
});

test('unfinished run after a restart is interrupted rather than silently rerun', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const result = new Promise(resolve => { finish = resolve; });
  const { solver, ctx, teaching, exec, session } = setup({ start: async () => { started(); return { id: 'child', result, dispose: async () => finish({ stopReason: 'aborted', output: [] }) }; } });
  const pending = solver.ask({ preset: 'problem', goal: '难题' }, exec);
  const rejected = assert.rejects(pending, /solver_canceled/);
  await ready;
  const view = await new module.NotaraSolver(ctx, teaching).read({ sessionId: session.id });
  assert.equal(view.tasks[0].status, 'interrupted');
  await solver.cancel({ sessionId: session.id, taskId: view.tasks[0].id });
  await rejected;
});

test('non-teachers and child agents cannot dispatch a solver', async () => {
  const { solver, exec, session, calls } = setup();
  const child = { session: { ...session, header: { ...session.header, origin: 'subagent' } } };
  await assert.rejects(solver.ask({ preset: 'problem', goal: '递归任务' }, { ...exec, agent: child }), /solver_teacher_required/);
  await assert.rejects(solver.ask({ preset: 'problem', goal: '伪造任务' }, { ...exec, agent: { session: { header: { agentPreset: 'standard' } } } }), /solver_teacher_required/);
  assert.equal(calls.length, 0);
});

test('native cleanup failure cannot leave a completed receipt beside a rejected call', async () => {
  const { solver, exec, session } = setup({ start: async () => ({ id: 'child', result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '已解出' }] }), dispose: async () => { throw Error('handle_dispose_failed'); } }) });
  await assert.rejects(solver.ask({ preset: 'problem', goal: '求 2+3' }, exec), /solver_cleanup_failed/);
  assert.equal((await solver.read({ sessionId: session.id })).tasks[0].status, 'failed');
});

test('solver gets its own generation allowance and strongest supported effort, not the parent cap', async () => {
  const { solver, ctx, exec, calls } = setup();
  exec.agent.options = { maxTokens: 512 };
  ctx.llm.resolveModelInfo = async () => ({ reasoning: { efforts: ['low', 'high', 'xhigh'].map(id => ({ id })) } });
  await solver.ask({ preset: 'problem', goal: '独立研究一道完整题目' }, exec);
  assert.equal(calls[0].request.agentOptions.maxTokens, 32768);
  assert.equal(calls[0].request.agentOptions.reasoningEffort, 'xhigh');
});

test('explicit solver allowance and effort survive settings and reach the child', async () => {
  const { solver, session, exec, calls } = setup();
  await solver.configure({ preset: 'problem', tools: 'none', sessionId: session.id, expectedRevision: 0, route: { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high', maxTokens: 49152 } });
  await solver.ask({ preset: 'problem', goal: '比较本题的两种解法' }, exec);
  assert.equal(calls[0].request.agentOptions.maxTokens, 49152);
  assert.equal((await solver.read({ sessionId: session.id })).workers[0].route.maxTokens, 49152);
  await assert.rejects(solver.configure({ preset: 'problem', tools: 'none', sessionId: session.id, expectedRevision: 1, route: { provider: 'test', model: 'gpt-5.6-sol', maxTokens: -1 } }), /solver_budget_invalid/);
});

test('PDF evidence requires a real page and revision, never a bare path or parent history', async () => {
  const { solver, exec, calls } = setup();
  for (const source of ['媒体/test.pdf', '媒体/test.pdf#page=1', '![[媒体/test.pdf#page=0&revision=0123456789abcdef01234567]]', '![[../test.pdf#page=1&revision=0123456789abcdef01234567]]']) {
    await assert.rejects(solver.ask({ preset: 'problem', goal: '核对本题', sources: [source] }, exec), /solver_source_invalid/);
  }
  assert.equal(calls.length, 0);
});

test('a truncated solution reports budget exhaustion, never a successful card analysis', async () => {
  const { solver, exec, session } = setup({ start: async () => ({ id: 'child', result: Promise.resolve({ stopReason: 'max-tokens', output: [{ type: 'text', text: 'UNFINISHED_SOLUTION' }] }), dispose: async () => {} }) });
  await assert.rejects(solver.ask({ preset: 'problem', goal: '独立研究完整题目' }, exec), /solver_budget_exhausted/);
  const view = await solver.read({ sessionId: session.id });
  assert.equal(view.tasks[0].status, 'failed');
  assert.doesNotMatch(JSON.stringify(view), /UNFINISHED_SOLUTION/);
});

test('invalid JSON and invalid fields give actionable diagnostics before starting a child', async () => {
  const { solver, exec, calls, session } = setup();
  await assert.rejects(solver.ask('{"goal":"核对"CD=CE"这一步"}', exec), /solver_input_invalid: arguments.*JSON.*转义/);
  await assert.rejects(solver.ask(JSON.stringify({ preset: 'problem', goal: '核对题目' }), exec), /solver_input_invalid: arguments.*对象/);
  await assert.rejects(solver.ask({ preset: 'problem', goal: '核对', materials: [{ title: '原解', text: '' }] }, exec), /solver_input_invalid: materials\[0\]\.text/);
  await assert.rejects(solver.ask({ preset: 'problem', goal: '核对', materials: '一段文本' }, exec), /solver_input_invalid: materials.*数组/);
  await assert.rejects(solver.ask({ goal: '核对', preset: 'invented' }, exec), /solver_input_invalid: preset.*problem.*lesson/);
  await assert.rejects(solver.ask({ arguments: { preset: 'problem', goal: '核对' } }, exec), /solver_input_invalid: arguments.*goal/);
  assert.equal(calls.length, 0);
  assert.equal((await solver.read({ sessionId: session.id })).tasks.length, 0);
  // Correct escaping preserves the math text exactly; never repair the raw
  // string heuristically or strip quotes from evidence to get a successful call.
  await solver.ask({ preset: 'problem', goal: '核对"CD=CE"这一步' }, exec);
  assert.equal(JSON.parse(calls[0].request.prompt[0].text).goal, '核对"CD=CE"这一步');
});

test('an exhausted request cannot silently repeat in the same user turn, but narrowing it can run', async () => {
  const { solver, exec, calls, session } = setup({ start: async () => ({ id: 'child', result: Promise.resolve({ stopReason: 'max-tokens', output: [] }), dispose: async () => {} }) });
  const request = { preset: 'review', goal: '核对这两道题', focus: '核对推导' };
  await assert.rejects(solver.ask(request, exec), /solver_budget_exhausted/);
  await assert.rejects(solver.ask(request, { ...exec, callId: 'repeat' }), /solver_retry_unchanged.*缩小/);
  assert.equal(calls.length, 1);
  const restored = new module.NotaraSolver(solver.ctx, solver.teaching);
  await assert.rejects(restored.ask(request, { ...exec, callId: 'after-restart' }), /solver_retry_unchanged/);
  assert.equal(calls.length, 1);
  await assert.rejects(solver.ask({ ...request, goal: '只核对第一题的面积比等式' }, { ...exec, callId: 'narrowed' }), /solver_budget_exhausted/);
  assert.equal(calls.length, 2);
  // Explicit user continuation is a new intent, not a hidden automatic retry.
  session.append('user/message', { id: 'retry-request', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '请重试第一项' }] }, { surfaceOp: 'append' });
  await assert.rejects(solver.ask(request, { ...exec, callId: 'explicit-retry' }), /solver_budget_exhausted/);
  assert.equal(calls.length, 3);
});

test('changing the configured budget allows a new attempt without overriding the selected route', async () => {
  const { solver, exec, calls, session } = setup({ start: async () => ({ id: 'child', result: Promise.resolve({ stopReason: 'max-tokens', output: [] }), dispose: async () => {} }) });
  const request = { preset: 'problem', goal: '独立研究并写出本题卡片' };
  await assert.rejects(solver.ask(request, exec), /solver_budget_exhausted/);
  await solver.configure({ preset: 'problem', tools: 'none', sessionId: session.id, expectedRevision: 0, route: { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high', maxTokens: 49152 } });
  await assert.rejects(solver.ask(request, { ...exec, callId: 'changed-budget' }), /solver_budget_exhausted/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].request.agentOptions.maxTokens, 49152);
});
