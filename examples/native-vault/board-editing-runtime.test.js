import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { Session } from '@deepseek-ai/dsh-session';
import { NotaraTeaching } from './teaching-runtime.js';
import { createEditorVaultIO, sourceRef } from './agent-io.js';
import { boardPath, readBoardDocument } from './board-runtime.js';
import { renderBoard } from './board-data.js';
import { createBoardEditing } from './board-editing-runtime.js';
import { captureForkBoard, inheritForkBoard } from './board-fork.js';
import { createBoardObjectStore } from './board-storage.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z8sAAAAASUVORK5CYII=';
const textElement = (id, text, x = 20) => ({ id, type: 'text', x, y: 20, width: 180, height: 40, text, originalText: text, fontSize: 20 });
const imageScene = () => ({ version: 1, elements: [{ id: 'image', type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: 'picture' }], appState: {}, files: { picture: { id: 'picture', mimeType: 'image/png', dataURL: png } } });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'notara-board-editing-'));
  const workspace = join(root, 'lesson'); await mkdir(workspace);
  const ctx = new Context(); new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 });
  ctx.reflect.provide('workspaceRegistry', { list: () => [{ id: 'workspace-one', path: workspace }] });
  const agents = new Map();
  const addSession = id => {
    const session = Session.create(id, [], { version: 4, id, createdAt: Date.now(), isSeeded: false, cwd: workspace, agentPreset: 'notara-teacher' });
    const agent = { session, status: 'idle', followup() {} }; agents.set(id, agent); return agent;
  };
  addSession('lesson-one');
  ctx.reflect.provide('sessionController', { inspect: async id => ({ meta: { cwd: agents.get(id)?.session.header.cwd } }) });
  const service = new NotaraTeaching(ctx, { root: workspace }, { resolveAgent: async id => agents.get(id), archive: async () => {} });
  const io = createEditorVaultIO(ctx, workspace);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, workspace, ctx, io, service, addSession };
}

const commit = (service, sessionId, expectedRevision, ops, requestId) => service.lessonBoard.commit({ sessionId, expectedRevision, ...(requestId ? { requestId } : {}), ops });

test('free content commits scene images, source refs, manual links, groups and contribution receipts', async t => {
  const { service, io, workspace } = await fixture(t);
  await mkdir(join(workspace, '资料'));
  const source = await io.save('资料/定义.md', '# 定义\n本课资料。', null);
  const ref = sourceRef('workspace-one', source.path, source.revision);
  await writeFile(join(workspace, '资料', '插图.png'), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  const imageSource = await io.readAsset('资料/插图.png');
  const created = await commit(service, 'lesson-one', null, [
    { type: 'create', ref: 'drawing', title: '自由图', body: '', contentType: 'drawing', content: imageScene() },
    { type: 'create', ref: 'source', title: '资料卡', body: '保留原资料定位。', contentType: 'source', sourceRef: ref },
    { type: 'create', ref: 'imageSource', title: '插图卡', body: '图片原引用。', contentType: 'source', sourceRef: sourceRef('workspace-one', imageSource.path, imageSource.revision) },
    { type: 'create', ref: 'link', title: '延伸阅读', body: '', contentType: 'link', url: 'https://example.org/lesson' },
    { type: 'connect', from: 'drawing', to: 'source', label: '依据', direction: 'both' },
    { type: 'group', title: '第一组', members: ['drawing', 'source'] },
  ], 'student-create');
  assert.equal(created.saved, true);
  assert.equal(created.workspaceId, 'workspace-one');
  assert.equal(created.blocks.length, 4);
  assert.equal(created.blocks.find(block => block.id === created.created.source).sourceState, 'current');
  assert.equal(created.blocks.find(block => block.id === created.created.imageSource).sourceState, 'current', 'non-Markdown source refs are checked through readAsset');
  assert.equal(created.manualEdges[0].direction, 'both');
  assert.deepEqual(created.groups[0].members, [created.created.drawing, created.created.source]);
  assert.equal(created.contributions.at(-1).actor, 'student');
  assert.equal(created.contributions.at(-1).contentChanged, true);

  const full = await service.lessonBoard.content({ sessionId: 'lesson-one', blockId: created.created.drawing });
  assert.equal(full.content.files.picture.dataURL, png);
  const safe = await service.lessonBoard.readForTeacher({ sessionId: 'lesson-one', blockId: created.created.drawing });
  assert.doesNotMatch(JSON.stringify(safe), /base64/);
  const boardDoc = await io.read(boardPath('lesson-one'));
  assert.doesNotMatch(boardDoc.content, /data:image|base64/);
  assert.match(boardDoc.content, /formatVersion: 2/);
  assert.match(boardDoc.content, new RegExp(created.blocks.find(block => block.id === created.created.drawing).contentRef));

  const changedSource = await io.save('资料/定义.md', '# 定义\n新版本。', source.revision);
  await writeFile(join(workspace, '资料', '插图.png'), Buffer.concat([Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'), Buffer.from('changed')]));
  const changedProjection = await service.board({ sessionId: 'lesson-one' });
  assert.equal(changedProjection.blocks.find(block => block.id === created.created.source).sourceState, 'changed');
  assert.equal(changedProjection.blocks.find(block => block.id === created.created.imageSource).sourceState, 'changed');
  await assert.rejects(commit(service, 'lesson-one', created.revision, [
    { type: 'create', ref: 'stale', title: '旧来源', body: '内容', contentType: 'source', sourceRef: ref },
  ]), /vault_reference_stale/);
  assert.equal((await service.board({ sessionId: 'lesson-one' })).revision, created.revision);
  assert.notEqual(changedSource.revision, source.revision);
});

test('undo removes a newly created block after parseBoard normalizes its property order', async t => {
  const { service, io } = await fixture(t);
  const created = await commit(service, 'lesson-one', null, [
    { type: 'create', ref: 'new', title: '刚新增的块', body: '先写一条。', contentType: 'text' },
  ]);
  const state = await readBoardDocument(io, 'lesson-one');
  const entry = await createBoardObjectStore(io.rootPath).read('lesson-one', state.board.historyRefs[0]);
  assert.notDeepEqual(Object.keys(state.board.blocks[0]), Object.keys(entry.changes[0].after), 'the persisted block and commit snapshot use different insertion orders');

  const undone = await commit(service, 'lesson-one', created.revision, [{ type: 'undo', commitId: created.commitId }]);
  assert.equal(undone.saved, true);
  assert.deepEqual((await service.board({ sessionId: 'lesson-one' })).blocks, []);
  assert.equal(undone.contributions.at(-1).undoOf, created.commitId);
});

test('source cards keep their original ref and body when the target is missing, foreign, or unreadable', async t => {
  const { service, io, workspace } = await fixture(t);
  await mkdir(join(workspace, '资料'));
  const original = await io.save('资料/保留.md', '# 原资料', null);
  const originalRef = sourceRef('workspace-one', original.path, original.revision);
  const created = await commit(service, 'lesson-one', null, [
    { type: 'create', ref: 'source', title: '原资料卡', body: '白板保留的说明。', contentType: 'source', sourceRef: originalRef },
  ]);
  const blockId = created.created.source;
  const preserved = block => {
    assert.equal(block.sourceRef, originalRef);
    assert.equal(block.body, '白板保留的说明。');
  };

  await rm(join(workspace, '资料', '保留.md'));
  let projection = await service.board({ sessionId: 'lesson-one' });
  let block = projection.blocks.find(item => item.id === blockId);
  assert.equal(block.sourceState, 'missing');
  preserved(block);

  const replacement = await io.save('资料/保留.md', '# 同名新资料', null);
  const state = await readBoardDocument(io, 'lesson-one');
  const foreignRef = sourceRef('workspace-outside', replacement.path, replacement.revision);
  state.board.blocks.find(item => item.id === blockId).sourceRef = foreignRef;
  const saved = await io.save(boardPath('lesson-one'), renderBoard(state.board), state.revision);
  projection = await service.board({ sessionId: 'lesson-one' });
  block = projection.blocks.find(item => item.id === blockId);
  assert.equal(block.sourceState, 'unavailable', 'a foreign ref is not resolved against a same-named local path');
  assert.equal(block.sourceRef, foreignRef);
  assert.equal(block.body, '白板保留的说明。');

  const localRef = sourceRef('workspace-one', replacement.path, replacement.revision);
  const latest = await readBoardDocument(io, 'lesson-one');
  latest.board.blocks.find(item => item.id === blockId).sourceRef = localRef;
  await io.save(boardPath('lesson-one'), renderBoard(latest.board), saved.revision);
  const editorFor = service.editorFor.bind(service);
  service.editorFor = async input => {
    const real = await editorFor(input);
    return { ...real, read: async (path, ...args) => {
      if (path === replacement.path) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return real.read(path, ...args);
    } };
  };
  try {
    projection = await service.board({ sessionId: 'lesson-one' });
  } finally {
    service.editorFor = editorFor;
  }
  block = projection.blocks.find(item => item.id === blockId);
  assert.equal(block.sourceState, 'unavailable', 'an IO failure is not misreported as a missing file');
  assert.equal(block.sourceRef, localRef);
  assert.equal(block.body, '白板保留的说明。');
});

test('teacher edits use target-read baselines, preserve concurrent layout and undo only their contribution', async t => {
  const { service } = await fixture(t);
  const first = await commit(service, 'lesson-one', null, [
    { type: 'create', ref: 'main', title: '核心解释', body: '先前的说明。', contentType: 'text', x: 50, y: 60 },
    { type: 'create', ref: 'other', title: '另一块', body: '学生的想法。', contentType: 'text' },
  ]);
  const blockId = first.created.main;
  await service.lessonBoard.readForTeacher({ sessionId: 'lesson-one', blockId });
  const student = await commit(service, 'lesson-one', first.revision, [
    { type: 'patch', blockId, patch: { x: 420 } },
    { type: 'patch', blockId: first.created.other, patch: { body: '学生补充的另一条思路。' } },
  ]);
  const teacher = await service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, patch: { body: '先前的说明。再补上老师看到的条件。' } }] }, { operationId: 'teacher-note' });
  assert.equal(teacher.contributions.at(-1).actor, 'teacher');
  assert.equal((await service.lessonBoard.content({ sessionId: 'lesson-one', blockId })).contributions.at(-1).original[0].before, '先前的说明。');
  let board = await service.board({ sessionId: 'lesson-one' });
  assert.equal(board.blocks.find(block => block.id === blockId).x, 420);
  assert.equal(board.blocks.find(block => block.id === blockId).body, '先前的说明。再补上老师看到的条件。');

  const undone = await service.lessonBoard.undo({ sessionId: 'lesson-one', commitId: teacher.commitId });
  board = await service.board({ sessionId: 'lesson-one' });
  assert.equal(board.blocks.find(block => block.id === blockId).body, '先前的说明。');
  assert.equal(board.blocks.find(block => block.id === blockId).x, 420);
  assert.equal(board.blocks.find(block => block.id === first.created.other).body, '学生补充的另一条思路。');
  assert.ok(undone.contributions.some(item => item.undoOf === teacher.commitId && item.actor === 'teacher'));
  await assert.rejects(service.lessonBoard.undo({ sessionId: 'lesson-one', commitId: teacher.commitId }), /board_undo_unavailable/);

  await service.lessonBoard.readForTeacher({ sessionId: 'lesson-one', blockId });
  const stale = await service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, patch: { body: '老师的旧版本。' } }] }, { operationId: 'teacher-stale' });
  board = await service.board({ sessionId: 'lesson-one' });
  const later = await commit(service, 'lesson-one', board.revision, [{ type: 'patch', blockId, patch: { body: '学生后来又改了。' } }]);
  await assert.rejects(service.lessonBoard.undo({ sessionId: 'lesson-one', commitId: stale.commitId }), /board_undo_conflict/);
  assert.equal((await service.board({ sessionId: 'lesson-one' })).revision, later.revision);
});

test('teacher apply with an AbortSignal stays bound to the session editor workspace', async t => {
  const { service } = await fixture(t);
  const first = await commit(service, 'lesson-one', null, [
    { type: 'create', ref: 'note', title: '课堂说明', body: '原说明。', contentType: 'text' },
  ]);
  const blockId = first.created.note;
  await service.lessonBoard.readForTeacher({ sessionId: 'lesson-one', blockId });

  const editorFor = service.editorFor.bind(service), editorCalls = [];
  service.editorFor = async input => {
    const io = await editorFor(input);
    editorCalls.push({ sessionId: input.sessionId, workspaceId: io.workspace.id });
    return io;
  };
  const controller = new AbortController();
  try {
    const applied = await service.lessonBoard.apply({
      sessionId: 'lesson-one',
      ops: [{ type: 'patch', blockId, patch: { body: '老师补充的说明。' } }],
    }, { operationId: 'signal-bound-apply', signal: controller.signal });
    assert.equal(applied.saved, true);
    assert.equal(applied.workspaceId, 'workspace-one');
    assert.equal((await service.board({ sessionId: 'lesson-one' })).blocks.find(block => block.id === blockId).body, '老师补充的说明。');
    assert.ok(editorCalls.length > 0);
    assert.ok(editorCalls.every(call => call.sessionId === 'lesson-one' && call.workspaceId === 'workspace-one'));
  } finally {
    service.editorFor = editorFor;
  }
});

test('selection scopes fail closed at capacity and stale rebinding keeps the prior scope', async () => {
  const io = { workspace: { id: 'workspace-one', path: tmpdir() }, rootPath: tmpdir() }, agents = new Map();
  const service = {
    ctx: {},
    async agentFor(sessionId) {
      if (!agents.has(sessionId)) agents.set(sessionId, { session: { id: sessionId, header: {} } });
      return agents.get(sessionId);
    },
    async editorFor() { return io; },
    isTeaching() { return true; },
  };
  const editing = createBoardEditing(service, {
    readState: async () => ({ revision: 'r1', board: { blocks: [{ id: 'selected' }, { id: 'outside' }], manualEdges: [], groups: [], historyRefs: [] } }),
    project: async () => ({}),
    pathFor: () => 'lesson-board/test.md',
  });
  for (let index = 0; index < 100; index++) {
    await editing.bindSelection([{ blockId: 'selected', elementIds: [] }], { sessionId: `scope-${index}` });
  }
  await assert.rejects(editing.bindSelection([{ blockId: 'selected', elementIds: [] }], { sessionId: 'scope-100' }), /board_patch_scope_capacity/);
  const outsidePatch = { sessionId: 'scope-0', ops: [{ type: 'patch', blockId: 'outside', patch: { body: '不在选区' } }] };
  await assert.rejects(editing.apply(outsidePatch), /board_patch_scope_invalid/);
  await assert.rejects(editing.bindSelection([{ blockId: 'outside', elementIds: [] }], { sessionId: 'scope-0', expectedRevision: 'stale' }), /vault_revision_conflict/);
  await assert.rejects(editing.apply(outsidePatch), /board_patch_scope_invalid/);

  await editing.bindSelection([], { sessionId: 'scope-0' });
  await editing.bindSelection([{ blockId: 'selected', elementIds: [] }], { sessionId: 'scope-100', expectedRevision: 'r1' });
  await assert.rejects(editing.apply({ ...outsidePatch, sessionId: 'scope-100' }), /board_patch_scope_invalid/);
});

test('scene operation patches merge unrelated student edits and respect bound selections', async t => {
  const { service } = await fixture(t);
  const scene = { version: 1, elements: [textElement('selected', '学生原文'), textElement('outside', '另一分支', 360)], appState: {}, files: {} };
  const first = await commit(service, 'lesson-one', null, [{ type: 'create', ref: 'map', title: '共建白板', body: '', contentType: 'mindmap', content: { ...scene, mindmap: { nodes: [{ elementId: 'selected', parentId: null }, { elementId: 'outside', parentId: null }], links: [], notes: [] } } }]);
  const blockId = first.created.map;
  await service.lessonBoard.readForTeacher({ sessionId: 'lesson-one', blockId });
  const studentScene = (await service.lessonBoard.content({ sessionId: 'lesson-one', blockId })).content;
  studentScene.elements[0].x = 300; studentScene.elements[1].text = '学生改了另一支';
  const student = await commit(service, 'lesson-one', first.revision, [{ type: 'patch', blockId, patch: { content: studentScene } }]);
  const teacher = await service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, sceneOps: [{ type: 'updateElement', elementId: 'selected', patch: { text: '老师补充这个节点' } }] }] }, { operationId: 'merge-scene' });
  const merged = (await service.lessonBoard.content({ sessionId: 'lesson-one', blockId })).content;
  assert.equal(merged.elements.find(element => element.id === 'selected').text, '老师补充这个节点');
  assert.equal(merged.elements.find(element => element.id === 'selected').x, 300);
  assert.equal(merged.elements.find(element => element.id === 'outside').text, '学生改了另一支');
  assert.equal(student.revision !== teacher.revision, true);

  await service.lessonBoard.bindSelection([{ blockId, elementIds: ['selected'] }], { sessionId: 'lesson-one' });
  await service.lessonBoard.readForTeacher({ sessionId: 'lesson-one', blockId });
  await assert.rejects(service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, sceneOps: [{ type: 'updateElement', elementId: 'outside', patch: { text: '选区之外' } }] }] }, { operationId: 'outside-selection' }), /board_patch_scope_invalid/);
  await assert.rejects(service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, patch: { body: '越权改正文' } }] }, { operationId: 'selection-body' }), /board_patch_scope_invalid/);
  await assert.rejects(service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, patch: { x: 480, y: 240 } }] }, { operationId: 'selection-layout' }), /board_patch_scope_invalid/);
  await assert.rejects(service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, sceneOps: [{ type: 'addElement', ref: 'stray', element: { type: 'text', x: 1200, y: 900, width: 180, height: 40, text: '选区外新增' } }] }] }, { operationId: 'selection-add-unanchored' }), /board_patch_scope_invalid/);
  const teacherAgent = await service.agentFor('lesson-one'),legacyExec = { agent: teacherAgent, signal: new AbortController().signal };
  let beforeLegacy = await service.board({ sessionId: 'lesson-one' });
  await assert.rejects(service.lessonBoard.write(legacyExec, { title: '共建白板', body: '旧接口越过选区' }), /board_patch_scope_invalid/);
  assert.equal((await service.board({ sessionId: 'lesson-one' })).revision, beforeLegacy.revision);
  await assert.rejects(service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, sceneOps: [{ type: 'addElement', ref: 'linked', element: { type: 'arrow', x: 20, y: 20, width: 80, height: 0, points: [[0, 0], [80, 0]], startBinding: { elementId: 'selected', focus: 0, gap: 0 } } }] }] }, { operationId: 'selection-add-anchored' }), /board_patch_scope_invalid/);
  await service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, sceneOps: [{ type: 'addNode', ref: 'child', parentId: 'selected', element: { type: 'text', x: 40, y: 140, width: 180, height: 40, text: '授权分支' } }] }] }, { operationId: 'selection-add-node' });
  const after = (await service.lessonBoard.content({ sessionId: 'lesson-one', blockId })).content;
  assert.equal(after.elements.find(element => element.id === 'outside').text, '学生改了另一支');
  assert.ok(after.mindmap.nodes.some(node => node.parentId === 'selected'));
  await service.lessonBoard.bindSelection([{ blockId, elementIds: [] }], { sessionId: 'lesson-one' });
  await service.lessonBoard.readForTeacher({ sessionId: 'lesson-one', blockId });
  beforeLegacy = await service.board({ sessionId: 'lesson-one' });
  await assert.rejects(service.lessonBoard.write(legacyExec, { title: '共建白板', body: '整块旧接口也越权' }), /board_patch_scope_invalid/);
  assert.equal((await service.board({ sessionId: 'lesson-one' })).revision, beforeLegacy.revision);
  const wholeBlockElement = await service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, sceneOps: [{ type: 'addElement', ref: 'whole-block', element: { type: 'text', x: 1200, y: 900, width: 180, height: 40, text: '整块授权新增' } }] }] }, { operationId: 'whole-block-add' });
  assert.ok(wholeBlockElement.commitId);
  assert.ok((await service.lessonBoard.content({ sessionId: 'lesson-one', blockId })).content.elements.some(element => element.text === '整块授权新增'));
  await service.lessonBoard.readForTeacher({ sessionId: 'lesson-one', blockId });
  const wholeBlock = await service.lessonBoard.apply({ sessionId: 'lesson-one', ops: [{ type: 'patch', blockId, patch: { body: '整块级说明' } }] }, { operationId: 'whole-block-body' });
  assert.equal((await service.board({ sessionId: 'lesson-one' })).blocks.find(block => block.id === blockId).body, '整块级说明');
  assert.ok(wholeBlock.commitId);
  await service.lessonBoard.bindSelection([], { sessionId: 'lesson-one' });
  const legacy = await service.lessonBoard.write(legacyExec, { title: '共建白板', body: '无选区时仍兼容旧写接口' });
  assert.equal(legacy.saved, true);
  assert.equal((await service.board({ sessionId: 'lesson-one' })).blocks.find(block => block.id === blockId).body, '无选区时仍兼容旧写接口');
});

test('request ids replay the original receipt and concurrent stale commits lose the board CAS', async t => {
  const { service } = await fixture(t);
  const initialOps = [{ type: 'create', ref: 'first', title: '同一请求', body: '正文。', contentType: 'text' }];
  const first = await commit(service, 'lesson-one', null, initialOps, 'request-once');
  const replay = await commit(service, 'lesson-one', null, initialOps, 'request-once');
  assert.equal(replay.commitId, first.commitId);
  assert.equal(replay.blocks.length, 1);
  await assert.rejects(commit(service, 'lesson-one', null, [{ type: 'create', ref: 'other', title: '不同请求内容', body: '正文。' }], 'request-once'), /board_request_reused/);

  const writes = await Promise.allSettled([
    commit(service, 'lesson-one', first.revision, [{ type: 'create', ref: 'a', title: '并发甲', body: '甲。' }]),
    commit(service, 'lesson-one', first.revision, [{ type: 'create', ref: 'b', title: '并发乙', body: '乙。' }]),
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(writes.find(result => result.status === 'rejected').reason.message, 'vault_revision_conflict');
  assert.equal((await service.board({ sessionId: 'lesson-one' })).blocks.length, 2);
});

test('offline object maintenance reclaims a failed scene CAS and keeps history required for undo', async t => {
  const { service, io } = await fixture(t);
  const scene = text => ({ version: 1, elements: [textElement('shape', text)], appState: {}, files: {} });
  const created = await commit(service, 'lesson-one', null, [{ type: 'create', ref: 'drawing', title: '并发场景', body: '', contentType: 'drawing', content: scene('初稿') }], 'gc-seed');
  const blockId = created.created.drawing;
  const originalReadBytes = service.ctx.fs.readBytes;
  let boardReads = 0, releaseReads;
  const bothBoardsRead = new Promise(resolve => { releaseReads = resolve; });
  service.ctx.fs.readBytes = async function (path, ...args) {
    const value = await originalReadBytes.call(this, path, ...args);
    if (String(path).endsWith(boardPath('lesson-one')) && boardReads < 2) {
      if (++boardReads === 2) releaseReads();
      await bothBoardsRead;
    }
    return value;
  };
  let outcomes;
  try {
    outcomes = await Promise.allSettled([
      commit(service, 'lesson-one', created.revision, [{ type: 'patch', blockId, patch: { content: scene('并发甲') } }], 'gc-race-a'),
      commit(service, 'lesson-one', created.revision, [{ type: 'patch', blockId, patch: { content: scene('并发乙') } }], 'gc-race-b'),
    ]);
  } finally { service.ctx.fs.readBytes = originalReadBytes; releaseReads(); }
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.message, 'vault_revision_conflict');
  const winner = outcomes.find(result => result.status === 'fulfilled').value;
  const store = createBoardObjectStore(io.rootPath), contentBeforeGC = await service.lessonBoard.content({ sessionId: 'lesson-one', blockId });
  const plan = await service.lessonBoard.maintainImmutableObjects({ sessionId: 'lesson-one' });
  assert.equal(plan.readOnly, true);
  assert.ok(plan.orphanRefs.length >= 2, `the failed CAS leaves its new scene and commit unreferenced: ${JSON.stringify(plan)}`);
  for (const ref of plan.orphanRefs) assert.ok(await store.read('lesson-one', ref), 'planning must not remove an object');

  const collected = await service.lessonBoard.maintainImmutableObjects({ sessionId: 'lesson-one', workspaceWritersStopped: true });
  assert.deepEqual(new Set(collected.deletedRefs), new Set(plan.orphanRefs));
  assert.equal((await service.lessonBoard.content({ sessionId: 'lesson-one', blockId })).content.elements[0].text,
    contentBeforeGC.content.elements[0].text);

  const latest = await readBoardDocument(io, 'lesson-one');
  await commit(service, 'lesson-one', latest.revision, [{ type: 'undo', commitId: winner.commitId }], 'gc-undo');
  assert.equal((await service.lessonBoard.content({ sessionId: 'lesson-one', blockId })).content.elements[0].text, '初稿',
    'retained commit before/after scenes remain available to undo after collection');
  assert.equal((await readBoardDocument(io, 'lesson-one')).board.historyRefs.length, 3);
});

test('fork copies immutable scene, raster assets and contribution history into a separate session', async t => {
  const { service, io, addSession } = await fixture(t);
  addSession('lesson-child');
  const first = await commit(service, 'lesson-one', null, [{ type: 'create', ref: 'drawing', title: '含图的贡献', body: '', contentType: 'drawing', content: imageScene() }], 'fork-seed');
  const snapshot = await captureForkBoard(io, 'lesson-one');
  assert.ok(snapshot.objectRefs.length >= 3, 'scene, asset, and commit history refs are included');
  await inheritForkBoard(io, snapshot, 'lesson-child');
  const child = await readBoardDocument(io, 'lesson-child');
  assert.deepEqual(child.board, { ...snapshot.board, sessionId: 'lesson-child' });
  assert.equal((await service.lessonBoard.content({ sessionId: 'lesson-child', blockId: first.created.drawing })).content.files.picture.dataURL, png);
  assert.equal((await service.lessonBoard.contributions({ sessionId: 'lesson-child' })).length, 1);
  const targetStore = createBoardObjectStore(io.rootPath);
  for (const ref of snapshot.objectRefs) assert.ok(await targetStore.read('lesson-child', ref));

  const childCommit = await commit(service, 'lesson-child', child.revision, [{ type: 'patch', blockId: first.created.drawing, patch: { content: { ...imageScene(), elements: [textElement('child', '分支修改')] }, } }]);
  assert.equal(childCommit.saved, true);
  assert.equal((await service.lessonBoard.content({ sessionId: 'lesson-one', blockId: first.created.drawing })).content.elements[0].type, 'image');
});
