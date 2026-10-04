import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { createEditorVaultIO } from './agent-io.js';
import { boardPath, readBoardDocument } from './board-runtime.js';
import { parseBoard, renderBoard, upsertBoard } from './board-data.js';
import { boardComponents } from './board-components.js';
import { captureForkBoard, inheritForkBoard, installBoardForks } from './board-fork.js';
import { interactionPath, readInteractionDocument, saveInteractionDocument } from './interactive-runtime.js';
import { createVaultStore } from './vault.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'notara-fork-board-'));
  const ctx = new Context();
  new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 });
  ctx.reflect.provide('workspaceRegistry', { list: () => [{ id: 'work', path: root }] });
  const io = createEditorVaultIO(ctx, root);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { ctx, root, io };
}

async function seed(io, sessionId = 'parent') {
  const board = parseBoard(null, sessionId);
  const body = '```choice\n判断方向\n- 正\n- 负\n```';
  upsertBoard(board, { title: '关键一步', section: '第一题', body }, 'block-one', () => 's-aabbccdd');
  Object.assign(board.blocks[0], { x: 640, y: 230, width: 420, height: 350,
    answers: [{ id: 'abcdef012345', c: 0, fp: boardComponents(body)[0].fingerprint, at: '2026-10-04T04:00:00.000Z', v: { pick: [1], reason: '观察方向' } }] });
  board.sourceNotes['资料.md'] = { width: 500, height: 320, body: '学生的高亮备注' };
  await io.save(boardPath(sessionId), renderBoard(board), null);
  return board;
}

test('fork copies content, identities, answers, layout and notes into independent session-bound files', async t => {
  const { io } = await fixture(t), parent = await seed(io);
  const snapshot = await captureForkBoard(io, 'parent');
  await Promise.all(['child-a', 'child-b'].map(id => inheritForkBoard(io, snapshot, id)));
  const child = await readBoardDocument(io, 'child-a');
  assert.deepEqual(child.board, { ...parent, sessionId: 'child-a' });
  child.board.blocks[0].body = '分支自己继续推导';
  await io.save(boardPath('child-a'), renderBoard(child.board), child.revision);
  assert.deepEqual((await readBoardDocument(io, 'parent')).board, parent);
  assert.deepEqual((await readBoardDocument(io, 'child-b')).board, { ...parent, sessionId: 'child-b' });
  assert.deepEqual(snapshot.board, parent);
});

test('legacy interactive scenes are rebound and independently mutable after fork', async t => {
  const { io, root } = await fixture(t), parent = await seed(io);
  const id = '2b1a4fb3-6a57-4ba2-9c81-621d8e4f3428';
  const scene = await saveInteractionDocument(io, 'parent', id, { preset: 'parabola', parameters: { a: 1.2, h: 2, k: -1 }, observation: '开口与顶点' }, null);
  parent.blocks[0].interactive = scene.ref;
  const state = await readBoardDocument(io, 'parent');
  await io.save(boardPath('parent'), renderBoard(parent), state.revision);
  await inheritForkBoard(io, await captureForkBoard(io, 'parent'), 'child');
  const copied = await readInteractionDocument(io, 'child', id);
  assert.deepEqual(copied.scene, scene.scene);
  assert.notEqual(copied.revision, scene.revision);
  assert.deepEqual((await readBoardDocument(io, 'child')).board.blocks[0].interactive, copied.ref);
  assert.equal(JSON.parse(await readFile(join(root, interactionPath('child', id)), 'utf8')).session, 'child');
  await saveInteractionDocument(io, 'child', id, { ...copied.scene, parameters: { ...copied.scene.parameters, a: 2 } }, copied.revision);
  assert.equal((await readInteractionDocument(io, 'parent', id)).scene.parameters.a, 1.2);
});

test('empty boards remain empty; unreadable or foreign source boards are never treated as empty', async t => {
  const { io } = await fixture(t);
  assert.equal(await captureForkBoard(io, 'parent'), null);
  await inheritForkBoard(io, null, 'child');
  assert.equal((await readBoardDocument(io, 'child')).revision, null);
  await io.save(boardPath('parent'), renderBoard(parseBoard(null, 'foreign')), null);
  await assert.rejects(() => captureForkBoard(io, 'parent'), /board_binding_invalid/);
  await assert.rejects(() => captureForkBoard({ read: async () => { throw new Error('access denied'); } }, 'parent'), /access denied/);
});

test('target collisions and write failures reject rather than replace an existing board', async t => {
  const { io } = await fixture(t);
  await seed(io); await seed(io, 'child');
  const before = await io.read(boardPath('child')), snapshot = await captureForkBoard(io, 'parent');
  await assert.rejects(() => inheritForkBoard(io, snapshot, 'child'), /vault_revision_conflict/);
  assert.equal((await io.read(boardPath('child'))).content, before.content);
  await assert.rejects(() => inheritForkBoard({ save: async () => { throw new Error('disk write failed'); } }, snapshot, 'other'), /disk write failed/);
});

test('native setup sees the copied board before publication, preserves its commit and snapshots before later parent edits', async t => {
  const { ctx, root, io } = await fixture(t), parent = await seed(io);
  const commit = { commit() {} }; let originalSetup = false, published = false;
  const original = async options => {
    const current = await readBoardDocument(io, 'parent'); current.board.blocks[0].body = '父课堂后来更新';
    await io.save(boardPath('parent'), renderBoard(current.board), current.revision);
    const agent = { session: { id: options.sessionId, header: { cwd: root } } };
    const result = await options.setup(ctx, agent);
    assert.equal(result, commit);
    assert.ok(originalSetup);
    assert.deepEqual((await readBoardDocument(io, options.sessionId)).board, { ...parent, sessionId: options.sessionId });
    published = true; return { agent };
  };
  const agents = { create: original }; ctx.reflect.provide('agents', agents);
  const dispose = installBoardForks(ctx, { editorFor: async () => io });
  t.after(dispose);
  await agents.create({ sessionId: 'child', meta: { parentSession: 'parent', isSeeded: true, agentPreset: 'notara-teacher', cwd: root }, setup: () => { originalSetup = true; assert.equal(published, false); return commit; } });
  assert.equal(published, true);
  await dispose(); assert.equal(agents.create, original);
});

test('normal classrooms and workers retain native creation; invalid fork scope fails before native creation', async t => {
  const { ctx, root, io } = await fixture(t); let created = 0, read = 0;
  const original = async () => ++created, agents = { create: original }; ctx.reflect.provide('agents', agents);
  t.after(installBoardForks(ctx, { editorFor: async () => { read++; return io; } }));
  await agents.create({ sessionId: 'normal', meta: { agentPreset: 'notara-teacher' } });
  await agents.create({ sessionId: 'worker', meta: { parentSession: 'parent', isSeeded: true, origin: 'subagent', agentPreset: 'notara-teacher' } });
  await agents.create({ sessionId: 'coding', meta: { parentSession: 'parent', isSeeded: true, agentPreset: 'coding' } });
  assert.equal(created, 3); assert.equal(read, 0);
  await assert.rejects(() => agents.create({ sessionId: 'foreign', meta: { parentSession: 'parent', isSeeded: true, agentPreset: 'notara-teacher', cwd: join(root, 'other') } }), /vault_write_scope_invalid/);
  assert.equal(created, 3);
});

test('partial legacy scene copies are recovered when the final board write fails', async t => {
  const { io, root } = await fixture(t), parent = await seed(io);
  const id = '2b1a4fb3-6a57-4ba2-9c81-621d8e4f3428';
  parent.blocks[0].interactive = (await saveInteractionDocument(io, 'parent', id, { preset: 'parabola' }, null)).ref;
  await io.save(boardPath('parent'), renderBoard(parent), (await readBoardDocument(io, 'parent')).revision);
  const snapshot = await captureForkBoard(io, 'parent');
  await assert.rejects(() => inheritForkBoard({ ...io, save: async () => { throw new Error('disk write failed'); } }, snapshot, 'child'), /disk write failed/);
  await assert.rejects(() => io.readJson(interactionPath('child', id)), /vault_file_not_found/);
  assert.equal((await readBoardDocument(io, 'child')).revision, null);
  const entries = await createVaultStore(root).listTrash();
  assert.ok(entries.items.some(entry => entry.path === interactionPath('child', id)));
});

test('cancellation after atomic publication still records and recovers the newly saved file', async t => {
  const { io, root } = await fixture(t); await seed(io);
  const controller = new AbortController(), snapshot = await captureForkBoard(io, 'parent');
  const writer = { ...io, save: async (...args) => { const saved = await io.save(...args); controller.abort(); return saved; } };
  await assert.rejects(() => inheritForkBoard(writer, snapshot, 'child', controller.signal), { name: 'AbortError' });
  assert.equal((await readBoardDocument(io, 'child')).revision, null);
  assert.ok((await createVaultStore(root).listTrash()).items.some(entry => entry.path === boardPath('child')));
  assert.equal((await readBoardDocument(io, 'parent')).board.blocks.length, 1);
});

test('a parent change during capture retries instead of mixing the old board with new state', async t => {
  const { io } = await fixture(t); await seed(io);
  let changed = false;
  const racing = { ...io, read: async path => {
    const document = await io.read(path);
    if (!changed) { changed = true; const board = parseBoard(document.content, 'parent'); board.blocks[0].body = '刚保存的新板书'; await io.save(path, renderBoard(board), document.revision); }
    return document;
  } };
  const snapshot = await captureForkBoard(racing, 'parent');
  assert.equal(snapshot.board.blocks[0].body, '刚保存的新板书');
});

test('native publication failure recovers the cloned board and respects later wrapper disposal', async t => {
  const { ctx, root, io } = await fixture(t); await seed(io);
  const original = async options => { await options.setup(ctx, { session: { id: options.sessionId, header: { cwd: root } } }); throw new Error('native commit failed'); };
  const agents = { create: original }; ctx.reflect.provide('agents', agents);
  const stopBoard = installBoardForks(ctx, { editorFor: async () => io });
  const stoppedInner = agents.create;
  const outer = function (...args) { return stoppedInner.apply(this, args); }; agents.create = outer;
  const options = { sessionId: 'child', meta: { parentSession: 'parent', isSeeded: true, agentPreset: 'notara-teacher', cwd: root } };
  await assert.rejects(() => agents.create(options), /native commit failed/);
  assert.equal((await readBoardDocument(io, 'child')).revision, null);
  await stopBoard();
  // An outer lifecycle may later restore its saved, already-disposed inner method.
  agents.create = stoppedInner;
  await assert.rejects(() => agents.create({ ...options, setup: () => {} }), /native commit failed/);
});

test('a read-back error after native write publication still has a receipt for recovery', async t => {
  const { ctx, root, io } = await fixture(t); await seed(io);
  const snapshot = await captureForkBoard(io, 'parent'), fs = ctx.fs;
  const originalWrite = fs.writeText, originalRead = fs.readBytes;
  let published = false;
  fs.writeText = async function (...args) { const result = await originalWrite.apply(this, args); published = true; return result; };
  fs.readBytes = function (...args) { if (published) throw new Error('injected read-back failure'); return originalRead.apply(this, args); };
  try { await assert.rejects(() => inheritForkBoard(io, snapshot, 'child'), /injected read-back failure/); }
  finally { fs.writeText = originalWrite; fs.readBytes = originalRead; }
  assert.equal((await readBoardDocument(io, 'child')).revision, null);
  assert.ok((await createVaultStore(root).listTrash()).items.some(entry => entry.path === boardPath('child')));
  assert.equal((await readBoardDocument(io, 'parent')).board.blocks.length, 1);
});
