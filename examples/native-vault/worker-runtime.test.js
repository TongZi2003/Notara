import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '@deepseek-ai/dsh-session';
import { NotaraSolver, installSolver } from './solver-runtime.js';
import { appendTeachingEvent } from './teaching-state.js';
import { teachingManifest, teachingResource } from './teaching-catalog.js';

function setup() {
  const session = Session.create('workers-parent', [], { version: 4, id: 'workers-parent', createdAt: Date.now(), isSeeded: false, agentPreset: 'notara-teacher' });
  // The teacher's current request: workers without a saved model follow it.
  session.append('request/header', { header: { config: { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'high' } }, reason: 'initial' });
  const agent = { session }, calls = [], handlers = {}, schemas = [];
  const ctx = { llm: { listProviders: () => [{ id: 'test' }], listModels: async () => ['gpt-5.6-sol', 'other'].map(id => ({ id })), resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high' }, { id: 'low' }] } }) }, subagents: {
    start: async (provider, request) => { calls.push({ provider, request }); return { id: `child-${calls.length}`, result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'PRIVATE_ARTIFACT' }] }), dispose: async () => {} }; },
  }, tools: { register: schema => schemas.push(schema), guard: () => {} }, effect: fn => fn(), on: (name, handler) => { handlers[name] = handler; } };
  ctx.get = name => ctx[name];
  const teaching = { isTeaching: a => a?.session?.header?.agentPreset === 'notara-teacher', agentFor: async () => agent, flush: async () => {} };
  return { solver: new NotaraSolver(ctx, teaching, { defaultsPath: null }), ctx, teaching, session, agent, calls, handlers, schemas, exec: { agent, callId: 'one', signal: new AbortController().signal } };
}

test('classroom offers five independently configurable work presets', async () => {
  const { solver, session } = setup();
  const view = await solver.read({ sessionId: session.id });
  assert.deepEqual(view.workers?.map(row => row.id), ['problem', 'lesson', 'review', 'general', 'exercise']);
  assert.ok(view.workers.every(row => row.tools === 'none' && row.ready));
});

test('each preset uses a distinct persona and explicit materials, with no parent history', async () => {
  const { solver, exec, calls, session } = setup();
  session.append('user/message', { id: 'private', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'PARENT_PRIVATE' }] }, { surfaceOp: 'append' });
  for (const preset of ['problem', 'lesson', 'review', 'general', 'exercise']) {
    await solver.ask({ preset, goal: '仅完成本次工作', materials: [{ title: '证据', text: 'EXPLICIT_EVIDENCE' }] }, { ...exec, callId: preset });
  }
  assert.equal(new Set(calls.map(row => row.request.persona)).size, 5);
  for (const { provider, request } of calls) {
    assert.equal(provider, 'spawn');
    assert.equal(request.maxDepth, 1);
    assert.deepEqual(request.toolFilter, { allow: [] });
    assert.match(JSON.stringify(request.prompt), /EXPLICIT_EVIDENCE/);
    assert.doesNotMatch(JSON.stringify(request.prompt), /PARENT_PRIVATE/);
  }
  assert.doesNotMatch(JSON.stringify(await solver.read({ sessionId: session.id })), /PRIVATE_ARTIFACT|EXPLICIT_EVIDENCE|PARENT_PRIVATE/);
});

test('legacy settings and records survive while a new preset override affects only that preset', async () => {
  const { solver, session, ctx, teaching, calls, exec } = setup();
  const route = { provider: 'test', model: 'other', maxTokens: 8192 };
  appendTeachingEvent(session, 'notara/solver-settings', { revision: 2, route });
  appendTeachingEvent(session, 'notara/solver-task', { id: 'historic', task: 'draft', status: 'completed', childId: 'old-child', startedAt: '2026-09-22T00:00:00Z' });
  let view = await solver.read({ sessionId: session.id });
  assert.ok(view.workers?.every(row => row.route.model === 'other'));
  assert.equal(view.tasks[0].preset, 'problem');
  const next = { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'low', maxTokens: 4096 };
  await solver.configure({ sessionId: session.id, expectedRevision: 2, preset: 'exercise', route: next, tools: 'read' });
  view = await new NotaraSolver(ctx, teaching).read({ sessionId: session.id });
  assert.deepEqual(view.workers.find(row => row.id === 'exercise').route, next);
  assert.equal(view.workers.find(row => row.id === 'problem').route.model, 'other');
  await solver.ask({ preset: 'exercise', goal: '出一道变式' }, exec);
  assert.equal(calls[0].request.agentOptions.maxTokens, 4096);
  assert.deepEqual(calls[0].request.toolFilter.allow, ['read', 'glob', 'grep', 'read_image']);
  await assert.rejects(solver.configure({ sessionId: session.id, expectedRevision: 2, preset: 'problem', route: null, tools: 'none' }), /settings_conflict/);
});

test('unknown roles, skills and write capabilities fail before starting work', async () => {
  const { solver, exec, calls, session } = setup();
  await assert.rejects(solver.ask({ preset: 'invented', goal: '工作' }, exec), /preset/);
  await assert.rejects(solver.ask({ preset: 'general', goal: '工作', skills: ['invented'] }, exec), /skills/);
  await assert.rejects(solver.configure({ sessionId: session.id, expectedRevision: 0, preset: 'general', route: null, tools: 'bash' }), /tools/);
  assert.equal(calls.length, 0);
});

test('only ask_worker is advertised and selected teaching skills are actually composed', async () => {
  const { ctx, teaching, schemas, exec, calls } = setup();
  const service = installSolver(ctx, teaching);
  assert.deepEqual(schemas.map(row => row.name), ['ask_worker']);
  const skill = 'notara-subject-math';
  const skillsField = schemas[0].parameters.properties.skills;
  assert.match(skill, new RegExp(skillsField.items.pattern));
  assert.ok(skillsField.description.includes(skill), 'the built-in skill is named for the model');
  await service.ask({ preset: 'exercise', goal: '出一道小测', skills: [skill] }, exec);
  assert.match(calls[0].request.persona, /notara-subject-math/);
  assert.doesNotMatch(calls[0].request.persona, /notara-subject-humanities/);
});

test('a removed reasoning level explains the configuration mismatch without changing the model', async () => {
  const { solver, session, ctx, exec, calls } = setup();
  await solver.configure({ sessionId: session.id, expectedRevision: 0, preset: 'review', tools: 'none', route: { provider: 'test', model: 'gpt-5.6-sol', reasoningEffort: 'low' } });
  ctx.llm.resolveModelInfo = async () => ({ reasoning: { efforts: [{ id: 'high' }] } });
  solver.catalog = null;
  const worker = (await solver.read({ sessionId: session.id })).workers.find(row => row.id === 'review');
  assert.equal(worker.ready, false);
  assert.match(worker.reason, /推理等级/);
  assert.equal(worker.route.model, 'gpt-5.6-sol');
  await assert.rejects(solver.ask({ preset: 'review', goal: '核验这一步' }, exec), /推理等级/);
  assert.equal(calls.length, 0);
});

const subjects = ['math', 'physics', 'chemistry', 'computing', 'chinese', 'english', 'science', 'humanities'];
for (const subject of subjects) {
  test(`selected subject body reaches an independent knowledge worker: ${subject}`, async () => {
    const { ctx, teaching, schemas, exec, calls, session } = setup();
    session.append('user/message', { id: 'private', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'PRIVATE_UNRELATED_HISTORY' }] }, { surfaceOp: 'append' });
    const solver = installSolver(ctx, teaching), id = `subject-${subject}`;
    const selected = teachingManifest.skills.find(item => item.id === id);
    assert.ok(selected, `${id} must be discoverable`);
    assert.ok(schemas[0].parameters.properties.skills.description.includes(`notara-${id}`));
    await solver.ask({ preset: 'general', goal: '研究一个完整知识单元', skills: [`notara-${id}`], materials: [{ title: '单元原文', text: 'ONLY_THIS_UNIT' }] }, exec);
    const { request } = calls[0];
    assert.ok(request.persona.includes(teachingResource(selected.file)));
    for (const other of teachingManifest.skills.filter(item => item.id.startsWith('subject-') && item.id !== id)) {
      assert.ok(!request.persona.includes(teachingResource(other.file)), other.id);
    }
    assert.ok(request.persona.includes(teachingResource('workers/general.md')));
    assert.deepEqual(request.toolFilter, { allow: [] });
    assert.equal(request.maxDepth, 1);
    assert.ok(JSON.stringify(request.prompt).includes('ONLY_THIS_UNIT'));
    // The spawn envelope includes a parent execution handle; only these fields
    // become child model content. The HTTP integration checks the final request.
    assert.ok(!JSON.stringify([request.persona, request.prompt]).includes('PRIVATE_UNRELATED_HISTORY'));
  });
}

test('cross-subject work composes only explicit principles and rejects workflow skills before spawn', async () => {
  const { solver, exec, calls } = setup();
  const ids = ['notara-subject-math', 'notara-subject-computing', 'notara-socratic'];
  await solver.ask({ preset: 'lesson', goal: '将数学问题离散化', skills: ids }, exec);
  for (const id of ids) {
    const selected = [...teachingManifest.skills, ...teachingManifest.choices].find(item => `notara-${item.id}` === id);
    assert.ok(calls[0].request.persona.includes(teachingResource(selected.file)));
  }
  assert.ok(!calls[0].request.persona.includes(teachingResource('skills/subject-physics.md')));
  for (const skills of [['notara-material-outline'], [...ids, 'notara-subject-physics', 'notara-subject-chemistry']]) {
    await assert.rejects(solver.ask({ preset: 'general', goal: '不应启动', skills }, exec), /skills/);
  }
  assert.equal(calls.length, 1);
});

function deferredWorker(ctx, calls) {
  const pending = [];
  ctx.subagents.start = async (provider, request) => {
    calls.push({ provider, request });
    let settle; const result = new Promise(resolve => { settle = resolve; });
    const run = { id: `child-${calls.length}`, result, dispose: async () => {} };
    pending.push({ run, finish: text => settle({ stopReason: 'completed', output: [{ type: 'text', text }] }), abort: () => settle({ stopReason: 'aborted', output: [] }) });
    request.signal?.addEventListener('abort', () => pending.at(-1) && settle({ stopReason: 'aborted', output: [] }), { once: true });
    return run;
  };
  return pending;
}

function fakeJobs(ctx, { refuse = false } = {}) {
  const jobs = [];
  ctx.jobs = { start(spec) {
    if (refuse) throw new Error('background jobs unavailable: no job controller serves this agent (load @deepseek-ai/dsh-tool-jobs in its composition)');
    const id = `subagent-${jobs.length + 1}`; jobs.push({ id, spec, hooks: spec.run() }); return id;
  } };
  return jobs;
}

const until = async predicate => { for (let i = 0; i < 50 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve)); };

test('a background worker returns at once and hands its result to the native job', async () => {
  const { solver, ctx, calls, exec, session } = setup();
  const pending = deferredWorker(ctx, calls), jobs = fakeJobs(ctx);
  const receipt = await solver.ask({ preset: 'general', goal: '整理向量基底的知识单元', run_in_background: true }, exec);
  assert.equal(receipt.status, 'running');
  assert.equal(receipt.jobId, 'subagent-1');
  assert.equal(jobs[0].spec.kind, 'subagent');
  assert.equal(jobs[0].spec.owner, exec.agent.session.id);
  await until(() => pending.length === 1);
  assert.equal((await solver.read({ sessionId: session.id })).tasks[0].status, 'running');
  pending[0].finish('基底的研究结果');
  const outcome = await jobs[0].hooks.done;
  assert.equal(outcome.status, 'completed');
  assert.match(outcome.result, /基底的研究结果/);
  assert.equal((await solver.read({ sessionId: session.id })).tasks[0].status, 'completed');
});

test('at most five workers run at once in one classroom', async () => {
  const { solver, ctx, calls, exec } = setup();
  const pending = deferredWorker(ctx, calls), jobs = fakeJobs(ctx);
  for (let index = 0; index < 5; index++) await solver.ask({ preset: 'general', goal: `第${index + 1}个单元`, run_in_background: true }, { ...exec, callId: `bg-${index}` });
  await until(() => pending.length === 5);
  await assert.rejects(solver.ask({ preset: 'general', goal: '第六个单元', run_in_background: true }, { ...exec, callId: 'bg-6' }), /solver_busy/);
  await assert.rejects(solver.ask({ preset: 'general', goal: '同步的第六个' }, { ...exec, callId: 'sync-6' }), /solver_busy/);
  pending[0].finish('完成一个');
  await jobs[0].hooks.done;
  const sixth = await solver.ask({ preset: 'general', goal: '第六个单元', run_in_background: true }, { ...exec, callId: 'bg-6' });
  assert.equal(sixth.status, 'running');
});

test('killing the native job cancels the worker and records it as canceled', async () => {
  const { solver, ctx, calls, exec, session } = setup();
  const pending = deferredWorker(ctx, calls), jobs = fakeJobs(ctx);
  await solver.ask({ preset: 'problem', goal: '研究这道题', run_in_background: true }, exec);
  await until(() => pending.length === 1);
  jobs[0].hooks.cancel('teacher stopped it');
  const outcome = await jobs[0].hooks.done;
  assert.equal(outcome.status, 'killed');
  assert.equal((await solver.read({ sessionId: session.id })).tasks[0].status, 'canceled');
});

test('without a job controller a background request starts nothing and frees its slot', async () => {
  const { solver, ctx, calls, exec, session } = setup();
  fakeJobs(ctx, { refuse: true });
  await assert.rejects(solver.ask({ preset: 'general', goal: '后台整理', run_in_background: true }, exec), /solver_background_unavailable/);
  assert.equal(calls.length, 0);
  assert.deepEqual((await solver.read({ sessionId: session.id })).tasks, []);
  assert.equal(solver.active.size, 0);
  delete ctx.jobs;
  await assert.rejects(solver.ask({ preset: 'general', goal: '后台整理', run_in_background: true }, { ...exec, callId: 'two' }), /solver_background_unavailable/);
  assert.equal(calls.length, 0);
});

test('model setup errors still return synchronously for a background request', async () => {
  const { solver, ctx, calls, exec, session } = setup();
  const jobs = fakeJobs(ctx);
  // A saved model this deployment no longer offers.
  await solver.configure({ sessionId: session.id, expectedRevision: 0, preset: 'general', tools: 'none', route: { provider: 'test', model: 'gpt-5.6-sol' } });
  ctx.llm.listModels = async () => [{ id: 'other' }]; solver.catalog = null;
  await assert.rejects(solver.ask({ preset: 'general', goal: '后台整理', run_in_background: true }, exec), /solver_model_unavailable/);
  assert.equal(jobs.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(solver.active.size, 0);
});

test('a worker gets an adopted user skill by name, and never a draft', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { saveUserSkill, setUserSkillStatus } = await import('./user-skills.js');
  const { solver, calls } = setup();
  const workspace = await mkdtemp(join(tmpdir(), 'notara-worker-skill-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const session = Session.create('workers-cwd', [], { version: 4, id: 'workers-cwd', createdAt: Date.now(), isSeeded: false, agentPreset: 'notara-teacher', cwd: workspace });
  session.append('request/header', { header: { config: { provider: 'test', model: 'gpt-5.6-sol' } }, reason: 'initial' });
  const exec = { agent: { session }, callId: 'one', signal: new AbortController().signal };
  const root = join(workspace, '技能');
  const file = id => `---\ntype: skill\nid: ${id}\ntitle: 解析几何要点\ndescription: 本学习集的解析几何要点。\nstatus: draft\n---\n# 要点\nADOPTED_SET_POINT ${id}\n`;
  const saved = await saveUserSkill(root, { content: file('conic-points') });
  await saveUserSkill(root, { content: file('still-draft') });
  await assert.rejects(solver.ask({ preset: 'lesson', goal: '完善一节课', skills: ['notara-set-conic-points'] }, { ...exec, callId: 'before' }), /学生尚未启用/);
  await setUserSkillStatus(root, { id: 'conic-points', status: 'active', expectedRevision: saved.revision });
  await solver.ask({ preset: 'lesson', goal: '完善一节课', skills: ['notara-set-conic-points', 'notara-subject-math'] }, { ...exec, callId: 'after' });
  assert.match(calls.at(-1).request.persona, /## 按需原则 notara-set-conic-points[\s\S]*ADOPTED_SET_POINT conic-points/);
  await assert.rejects(solver.ask({ preset: 'lesson', goal: '完善一节课', skills: ['notara-set-still-draft'] }, { ...exec, callId: 'draft' }), /学生尚未启用/);
});
