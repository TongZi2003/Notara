import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { Storage } from '@deepseek-ai/dsh-storage';
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json';
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { NotaraSessionGroups } from './session-groups-runtime.js';
import { NotaraVaultRemote } from './index.js';
import { folderLessons } from './rail-data.js';

async function world(t, root) {
  root ??= await mkdtemp(join(tmpdir(), 'notara-session-groups-'));
  const ctx = new Context(), storage = new Storage(ctx), backend = new JsonStorageBackend(root);
  storage.backend.register('json', backend);
  const facility = new DomainFacility(ctx, { backend: 'json' });
  ctx.reflect.provide('storageDomain', facility);
  const workspaces = [{ id: 'math', path: join(root, 'math'), sessionIds: ['lesson-a', 'lesson-b'] }, { id: 'physics', path: join(root, 'physics'), sessionIds: ['lesson-c'] }];
  ctx.reflect.provide('workspaceRegistry', { get: id => workspaces.find(workspace => workspace.id === id) });
  const runtime = new NotaraSessionGroups(ctx), remote = new NotaraVaultRemote(ctx);
  t.after(async () => { await runtime.close(); await facility.closeAll(); await backend.close(); await rm(root, { recursive: true, force: true }); });
  const mutate = (revision, patch, workspaceId = 'math') => remote.mutateSessionGroups({ workspaceId, expectedRevision: revision, patch });
  return { ctx, runtime, remote, workspaces, root, mutate, backend, facility };
}

test('folders persist through reopening and only change list metadata, including dissolution', async t => {
  const w = await world(t), original = JSON.stringify(w.workspaces);
  assert.deepEqual(await w.remote.sessionGroups({ workspaceId: 'math' }), { workspaceId: 'math', revision: 0, groups: [], members: [] });
  const created = await w.mutate(0, { kind: 'create', title: ' 数学基础 ' }), id = created.groups[0].id;
  assert.equal(created.groups[0].title, '数学基础');
  await w.mutate(1, { kind: 'move', sessionId: 'lesson-a', groupId: id });
  await w.mutate(2, { kind: 'move', sessionId: 'lesson-b', groupId: id });
  const renamed = await w.mutate(3, { kind: 'rename', groupId: id, title: '高等数学' });
  assert.deepEqual(renamed.members, [{ sessionId: 'lesson-a', groupId: id }, { sessionId: 'lesson-b', groupId: id }]);
  assert.equal(JSON.stringify(w.workspaces), original, 'classification never mutates native membership or cwd');
  assert.deepEqual((await w.remote.sessionGroups({ workspaceId: 'physics' })).groups, []);

  await w.runtime.close();
  await w.facility.closeAll(); await w.backend.close();
  const reopened = await world(t, w.root);
  // A new Context, facility and backend reload the committed JSON just like a new Host.
  assert.deepEqual(await reopened.runtime.list({ workspaceId: 'math' }), renamed);
  const removed = await reopened.runtime.mutate({ workspaceId: 'math', expectedRevision: 4, patch: { kind: 'move', sessionId: 'lesson-a', groupId: null } });
  assert.deepEqual(removed.members, [{ sessionId: 'lesson-b', groupId: id }]);
  const dissolved = await reopened.runtime.mutate({ workspaceId: 'math', expectedRevision: 5, patch: { kind: 'dissolve', groupId: id } });
  assert.deepEqual(dissolved, { workspaceId: 'math', revision: 6, groups: [], members: [] });
  const persisted = JSON.parse(await readFile(join(w.root, 'notara_session_groups.json'), 'utf8'));
  assert.ok(JSON.stringify(persisted).includes('"revision":6'), 'successful reply corresponds to an actual JSON commit');
  assert.equal(JSON.stringify(w.workspaces), original);
  await reopened.runtime.close(); await reopened.facility.closeAll(); await reopened.backend.close();
});

test('concurrent stale edits and invalid moves are rejected without losing folder contents', async t => {
  const w = await world(t);
  const state = await w.mutate(0, { kind: 'create', title: '数学' }), id = state.groups[0].id;
  const results = await Promise.allSettled([
    w.mutate(1, { kind: 'move', sessionId: 'lesson-a', groupId: id }),
    w.mutate(1, { kind: 'move', sessionId: 'lesson-b', groupId: id }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /session_groups_conflict/);
  const latest = await w.runtime.list({ workspaceId: 'math' });
  assert.equal(latest.members.length, 1);
  for (const patch of [
    { kind: 'move', sessionId: 'lesson-c', groupId: id },
    { kind: 'move', sessionId: 'missing', groupId: id },
    { kind: 'rename', groupId: 'missing', title: '别的' },
    { kind: 'create', title: '数学' },
    { kind: 'create', title: '\u0000' },
    { kind: 'create', title: '合法', path: '../outside' },
    { kind: 'create', title: '合法', parentGroupId: id },
  ]) await assert.rejects(w.mutate(2, patch), /session_groups_/);
  await assert.rejects(w.remote.mutateSessionGroups({ workspaceId: 'math', expectedRevision: 2, patch: { kind: 'create', title: '新组' }, path: '../outside' }), /vault_input_invalid/);
  await assert.rejects(w.remote.sessionGroups({ workspaceId: 'missing' }), /session_groups_workspace_missing/);
  assert.deepEqual(await w.runtime.list({ workspaceId: 'math' }), latest);
  await w.mutate(2, { kind: 'move', sessionId: 'lesson-b', groupId: id });
  assert.equal((await w.runtime.list({ workspaceId: 'math' })).revision, 3);
});

test('folder projections preserve native rows, filter stale IDs and search folded folder contents', () => {
  const rows = [{ id: 'a', title: '极限入门' }, { id: 'b', title: '函数定义域' }, { id: 'c', title: '未分类' }];
  const state = { groups: [{ id: 'calculus', title: '高等数学' }, { id: 'empty', title: '空分组' }], members: [{ sessionId: 'a', groupId: 'calculus' }, { sessionId: 'b', groupId: 'calculus' }, { sessionId: 'foreign', groupId: 'calculus' }] };
  const grouped = folderLessons(rows, state);
  assert.deepEqual(grouped.folders[0].rows, rows.slice(0, 2));
  assert.equal(grouped.folders[0].rows[0], rows[0], 'native identity and state are retained');
  assert.deepEqual(grouped.ungrouped, [rows[2]]);
  assert.deepEqual(grouped.folders[1].rows, []);
  assert.deepEqual(folderLessons(rows, state, ' 定义域 ').folders[0].rows, [rows[1]]);
  assert.deepEqual(folderLessons(rows, state, '高等数学').folders[0].rows, rows.slice(0, 2));
  assert.deepEqual(folderLessons(rows, state, '没有命中'), { folders: [], ungrouped: [] });
});
