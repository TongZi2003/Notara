import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '@deepseek-ai/dsh-session';
import { NotaraSolver, installSolver } from './solver-runtime.js';
import { appendTeachingEvent } from './teaching-state.js';
import { teachingManifest, teachingResource } from './teaching-catalog.js';

function setup() {
  const session = Session.create('workers-parent', [], { version: 3, id: 'workers-parent', createdAt: Date.now(), isSeeded: false, agentPreset: 'notara-teacher' });
  const agent = { session }, calls = [], handlers = {}, schemas = [];
  const ctx = { llm: { listProviders: () => [{ id: 'test' }], listModels: async () => ['gpt-5.6-sol', 'other'].map(id => ({ id })), resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high' }, { id: 'low' }] } }) }, subagents: {
    start: async (provider, request) => { calls.push({ provider, request }); return { id: `child-${calls.length}`, result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'PRIVATE_ARTIFACT' }] }), dispose: async () => {} }; },
  }, tools: { register: schema => schemas.push(schema), guard: () => {} }, effect: fn => fn(), on: (name, handler) => { handlers[name] = handler; } };
  ctx.get = name => ctx[name];
  const teaching = { isTeaching: a => a?.session?.header?.agentPreset === 'notara-teacher', agentFor: async () => agent, flush: async () => {} };
  return { solver: new NotaraSolver(ctx, teaching), ctx, teaching, session, agent, calls, handlers, schemas, exec: { agent, callId: 'one', signal: new AbortController().signal } };
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
  assert.ok(schemas[0].parameters.properties.skills.items.enum.includes(skill));
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
    assert.ok(schemas[0].parameters.properties.skills.items.enum.includes(`notara-${id}`));
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
