import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { Session } from '@deepseek-ai/dsh-session';
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';

import { sourceRef } from './agent-io.js';
import { revisionFor } from './vault.js';

const state = await import('./teaching-state.js').catch(() => ({}));

test('teaching settings persist in the native log before the first user message', () => {
  assert.equal(typeof state.updateTeachingSettings, 'function');
  const session = Session.create('settings-before-first-input');
  const next = state.updateTeachingSettings(session, { teachingRef: 'feynman', learningGoal: { title: '理解条件概率' }, temporaryInstructions: '先让我尝试' }, 0);
  assert.equal(next.revision, 1);
  assert.equal(session.snapshotEvents().filter(event => event.type === 'user/message').length, 0);
  const resumed = Session.create(session.id, session.snapshotEvents());
  assert.equal(state.readTeachingSettings(resumed).teachingRef, 'feynman');
  assert.equal(state.readTeachingSettings(resumed).learningGoal.title, '理解条件概率');
});

test('clearing goals and reverting a teaching method preserve unrelated settings', () => {
  assert.equal(typeof state.updateTeachingSettings, 'function');
  const session = Session.create('settings-clear');
  state.updateTeachingSettings(session, {teachingRef:'lecture',learningGoal:{title:'导数'},temporaryInstructions:'慢一点',subjects:['数学']}, 0);
  const cleared = state.updateTeachingSettings(session, {teachingRef:null,learningGoal:null}, 1);
  assert.equal(cleared.teachingRef,'socratic');
  assert.equal(cleared.learningGoal,null);
  assert.equal(cleared.temporaryInstructions,'慢一点');
  assert.deepEqual(cleared.subjects,['数学']);
  assert.throws(()=>state.updateTeachingSettings(session,{temporaryInstructions:''},0),/conflict/);
  assert.throws(()=>state.updateTeachingSettings(session,{learningGoal:{title:'',dailyMinutes:0}},2),/invalid/);
});

test('ordinary session data does not inherit another lesson settings or binding', () => {
  assert.equal(typeof state.bindTeachingLesson, 'function');
  const first=Session.create('first-lesson'), second=Session.create('second-lesson');
  state.bindTeachingLesson(first,{scriptPath:'备课/第一课.md',routePath:'路线/微积分.md',nodeId:'lesson-1'});
  assert.equal(state.readTeachingSettings(first).scriptPath,'备课/第一课.md');
  assert.equal(state.readTeachingSettings(second).scriptPath,null);
  assert.throws(()=>state.updateTeachingSettings(first,{scriptPath:'../private.md'},0),/invalid/);
});

// --- 原生持久化接缝 ---------------------------------------------------------
// 这三类 notara/* 事件是 harness 未知类型，读侧 validateStoredEvents 只接受带
// `ignorable: true` 的信封；下面的往返测试用真实 JsonlSessionPersistence 走
// create → append → flush → 新 Context open/read，不用内存替身。

const userMessage = { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '我先把定义域写出来' }] };

async function jsonlRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'notara-teaching-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = new Context();
  new JsonlPersistence(ctx, { root });
  return { root, ctx };
}

async function readStored(root, id) {
  const cold = new Context();
  new JsonlPersistence(cold, { root });
  const reader = await cold.sessionPersistence.open(id, 'read');
  try { return (await reader.read()).events; } finally { await reader.close(); }
}

test('teaching events round-trip through the real JSONL log beside the native conversation', async t => {
  const { root, ctx } = await jsonlRoot(t);
  const id = 'state-roundtrip';
  const header = { version: 3, id, createdAt: Date.now(), isSeeded: false };
  const handle = await ctx.sessionPersistence.create(header);
  const session = Session.create(id, [], header);

  session.append('user/message', userMessage, { surfaceOp: 'append' });
  state.updateTeachingSettings(session, { teachingRef: 'feynman', learningGoal: { title: '条件概率' } }, 0);
  state.bindTeachingLesson(session, {
    scriptPath: '备课/第一课.md',
    scriptRevision: revisionFor('剧本原文'),
    scriptWorkspaceId: 'set-math',
    scriptSnapshot: '## 例题\n\n先不看答案。',
    routePath: '路线/概率.md',
    nodeId: 'n1',
  });
  state.appendTeachingEvent(session, state.SUMMARY_EVENT, { path: '备课/第一课.md', anchor: 'ls-0123456789abcdef', revision: revisionFor('剧本原文'), cutoff: 'empty' });

  await handle.append(session.snapshotEvents(), {});
  await handle.flush({});
  await handle.close();

  const events = await readStored(root, id);
  const stored = events.filter(event => String(event.type).startsWith('notara/'));
  assert.deepEqual(stored.map(event => event.type), [state.SETTINGS_EVENT, state.LESSON_EVENT, state.SUMMARY_EVENT]);
  assert.ok(stored.every(event => event.ignorable === true), 'every notara event carries the ignorable envelope');
  const conversation = events.find(event => event.type === 'user/message');
  assert.equal(conversation.data.content[0].text, '我先把定义域写出来');
  assert.equal(conversation.surfaceOp, 'append');

  const settings = state.readTeachingSettings(Session.create(id, events));
  assert.equal(settings.teachingRef, 'feynman');
  assert.equal(settings.learningGoal.title, '条件概率');
  assert.equal(settings.scriptPath, '备课/第一课.md');
  assert.equal(settings.scriptRevision, revisionFor('剧本原文'));
  assert.equal(settings.scriptWorkspaceId, 'set-math');
  assert.equal(settings.scriptSnapshot, null);
  assert.equal(settings.scriptSnapshotTruncated, false);
});

test('an unknown event written without the marker still refuses the cold read', async t => {
  const { root, ctx } = await jsonlRoot(t);
  const id = 'state-unmarked';
  const header = { version: 3, id, createdAt: Date.now(), isSeeded: false };
  const handle = await ctx.sessionPersistence.create(header);
  const session = Session.create(id, [], header);
  session.append('user/message', userMessage, { surfaceOp: 'append' });
  session.append(state.SETTINGS_EVENT, { revision: 1 });          // 绕过 helper：不带 ignorable
  await handle.append(session.snapshotEvents(), {});
  await handle.flush({});
  await handle.close();

  await assert.rejects(() => readStored(root, id), error => {
    assert.equal(error.name, 'SessionFormatUnsupportedError');
    assert.match(error.message, /not marked ignorable/);
    return true;
  });
});

test('the seam refuses illegal metadata and foreign event types before writing', async t => {
  const { ctx } = await jsonlRoot(t);
  const header = { version: 3, id: 'state-guards', createdAt: Date.now(), isSeeded: false };
  const session = Session.create('state-guards', [], header);

  assert.throws(() => state.appendTeachingEvent(session, 'user/message', userMessage), /teaching_event_type_invalid/);
  assert.throws(() => state.appendTeachingEvent(session, 'notara/x', undefined), /non-JSON-serializable/);
  assert.throws(() => state.appendTeachingEvent(session, 'notara/x', { cb: () => {} }), /non-JSON-serializable/);
  assert.throws(() => state.appendTeachingEvent(session, 'notara/x', { when: 1n }), /non-JSON-serializable/);
  assert.equal(session.snapshotEvents().filter(event => String(event.type).startsWith('notara/')).length, 0);
  assert.throws(() => state.updateTeachingSettings(session, { learningGoal: { title: '' } }, 0), /invalid/);
  assert.throws(() => state.bindTeachingLesson(session, { scriptPath: '../逃逸.md' }), /invalid/);
  assert.throws(() => state.bindTeachingLesson(session, { scriptRevision: 42 }), /teaching_binding_invalid/);
  assert.throws(() => state.bindTeachingLesson(session, { continuation: { ref: 42 } }), /teaching_binding_invalid/);
  assert.equal(session.snapshotEvents().filter(event => String(event.type).startsWith('notara/')).length, 0);
  void ctx;
});

test('a missing native seam fails before the write instead of storing an unreadable log', () => {
  const writes = [];
  const unpatched = { snapshotEvents: () => [], append: (...args) => { writes.push(args); } };
  assert.throws(() => state.appendTeachingEvent(unpatched, 'notara/x', { a: 1 }), /teaching_ignorable_seam_missing/);
  assert.throws(() => state.updateTeachingSettings(unpatched, { teachingRef: 'feynman' }, 0), /teaching_ignorable_seam_missing/);
  assert.deepEqual(writes, []);
  assert.throws(() => state.appendTeachingEvent({}, 'notara/x', {}), /teaching_session_required/);
});

test('lesson binding keeps provenance without answers and preserves the previous-lesson pointer', () => {
  const session = Session.create('state-binding');
  const scriptRef = revisionFor('剧本第一版');
  const previousRevision = revisionFor('上一课小结');
  const continuationRef = sourceRef('set-math', '备课/上一课.md', previousRevision, { anchor: 'ls-0123456789abcdef' });
  const longScript = `开头\n${'条文'.repeat(2000)}`;

  const bound = state.bindTeachingLesson(session, {
    scriptPath: '备课/第一课.md',
    scriptRevision: scriptRef,
    scriptWorkspaceId: 'set-math',
    scriptSnapshot: { content: longScript, title: '第一课', path: '备课/第一课.md', revision: scriptRef, ref: 'vault:x' },
    continuation: { ref: continuationRef, text: '继续第二题。', title: '上一课·椭圆' },
  });
  assert.equal(bound.scriptRevision, scriptRef);
  assert.equal(bound.scriptWorkspaceId, 'set-math');
  assert.equal(Object.hasOwn(bound.scriptSnapshot,'content'), false);
  assert.equal(bound.scriptSnapshot.title, '第一课');
  assert.equal(bound.scriptSnapshot.revision, scriptRef);
  assert.equal(bound.scriptSnapshotTruncated, false);
  assert.equal(bound.continuation.text, '继续第二题。');
  assert.equal(bound.continuation.workspaceId, 'set-math');
  assert.equal(bound.continuation.path, '备课/上一课.md');
  assert.equal(bound.continuation.anchor, 'ls-0123456789abcdef');
  assert.equal(bound.continuation.revision, previousRevision);

  // 旧形状（只有 ref/text/title）仍然是合法绑定，并从 ref 补齐定位字段。
  const legacy = state.bindTeachingLesson(Session.create('state-legacy'), { scriptPath: '备课/第二课.md', continuation: { ref: continuationRef, text: '旧形状。', title: '上一课' } });
  assert.equal(legacy.continuation.text, '旧形状。');
  assert.equal(legacy.continuation.anchor, 'ls-0123456789abcdef');

  // Legacy snapshot text is discarded instead of injected into a reopened class.
  const fromString = state.bindTeachingLesson(Session.create('state-string-snapshot'), { scriptSnapshot: '短原文' });
  assert.equal(fromString.scriptSnapshot, null);
  assert.equal(fromString.scriptSnapshotTruncated, false);
  assert.throws(() => state.bindTeachingLesson(Session.create('state-bad-snapshot'), { scriptSnapshot: { title: 42 } }), /teaching_binding_invalid/);
  assert.throws(() => state.bindTeachingLesson(Session.create('state-bad-snapshot-2'), { scriptSnapshot: ['x'] }), /teaching_binding_invalid/);

  // runtime 会把已投影的 settings 再展开进 bind：重复投影必须幂等，而不是越读越空。
  const again = state.bindTeachingLesson(session, { ...bound, scriptPath: '备课/第一课.md' });
  assert.equal(again.scriptRevision, bound.scriptRevision);
  assert.equal(Object.hasOwn(again.scriptSnapshot,'content'), false);
  assert.equal(again.continuation.text, '继续第二题。');
  assert.equal(again.continuation.anchor, 'ls-0123456789abcdef');
  assert.equal(again.continuation.workspaceId, 'set-math');

  // 重绑写全字段：上一课的剧本快照不会留在新绑定里。
  const rebound = state.bindTeachingLesson(session, { scriptPath: '备课/第三课.md' });
  assert.equal(rebound.scriptRevision, null);
  assert.equal(rebound.scriptWorkspaceId, null);
  assert.equal(rebound.scriptSnapshot, null);
  assert.equal(rebound.scriptSnapshotTruncated, false);
  assert.equal(rebound.scriptSnapshotTruncated, false);
  assert.equal(rebound.continuation, null);
  assert.equal(rebound.scriptPath, '备课/第三课.md');
});

test('route node binding carries bounded material refs instead of a bare route path', () => {
  const session = Session.create('state-materials');
  const first = state.bindTeachingLesson(session, { scriptPath: '备课/第一课.md', routePath: '路线/圆锥曲线.md', nodeId: 'n1' });
  assert.deepEqual(first.materials, []);

  const materials = [
    { path: '资料/椭圆定义.md', title: '椭圆定义', revision: revisionFor('椭圆定义'), ref: sourceRef('set-math', '资料/椭圆定义.md', revisionFor('椭圆定义')) },
    { path: '资料/习题.pdf', title: '习题第 3 题', revision: revisionFor('习题'), ref: sourceRef('set-math', '资料/习题.pdf', revisionFor('习题')) },
  ];
  const bound = state.bindTeachingLesson(session, { scriptPath: '备课/第一课.md', routePath: '路线/圆锥曲线.md', nodeId: 'n1', materials });
  assert.deepEqual(bound.materials.map(item => item.path), ['资料/椭圆定义.md', '资料/习题.pdf']);
  assert.equal(bound.materials[0].title, '椭圆定义');
  assert.equal(bound.materials[0].revision, revisionFor('椭圆定义'));
  assert.equal(bound.materials[0].ref, materials[0].ref);
  assert.equal(bound.materials[1].ref, materials[1].ref);

  // 重绑不带 materials 就清空，不把上一节点的材料留在新绑定里。
  assert.deepEqual(state.bindTeachingLesson(session, { scriptPath: '备课/第二课.md' }).materials, []);

  // 上限、条目形状与「引用类字段不许被截断」的边界。
  const many = Array.from({ length: state.MATERIAL_LIMIT + 1 }, (_, index) => ({ path: `资料/${index}.md` }));
  assert.throws(() => state.bindTeachingLesson(session, { materials: many }), /teaching_binding_invalid/);
  assert.throws(() => state.bindTeachingLesson(session, { materials: '资料/x.md' }), /teaching_binding_invalid/);
  assert.throws(() => state.bindTeachingLesson(session, { materials: [{ title: '缺 path' }] }), /teaching_binding_invalid/);
  assert.throws(() => state.bindTeachingLesson(session, { materials: [{ path: 42 }] }), /teaching_binding_invalid/);
  assert.throws(() => state.bindTeachingLesson(session, { materials: [{ path: '../逃逸.md' }] }), /vault_path_invalid/);
  assert.throws(() => state.bindTeachingLesson(session, { materials: [{ path: '资料/长引用.md', ref: `vault:${'a'.repeat(9000)}` }] }), /teaching_binding_invalid/);
  assert.equal(state.MATERIAL_LIMIT, 100);
  assert.equal(state.readTeachingSettings(session).materials.length, 0);
});
