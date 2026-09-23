import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ROUTE_PATHWAYS, createRouteInVault, reviseRouteInVault, safeTitlePath } from './file-operations.js';
import { ROUTE_PATHWAYS as ROUTE_PATHWAYS_FROM_PROJECTION, parseRoute, renderRoute } from './lesson-data.js';
import { routeBriefText, routeOverviewText, routeStageText } from './route-plan.js';
import { createVaultStore } from './vault.js';

/** The real Vault store plus the two seams the Host IO adds: a revision check on
 * read and a source ref on write. Nothing here mocks the Markdown format. */
async function vault() {
  const root = await mkdtemp(join(tmpdir(), 'notara-route-'));
  const store = createVaultStore(root, undefined);
  const io = {
    async read(path, expectedRevision) {
      const document = await store.read(path);
      if (expectedRevision !== undefined && expectedRevision !== document.revision) throw new Error('vault_reference_stale');
      return { ...document, ref: `vault:${document.path}` };
    },
    readAsset: path => store.readAsset(path),
    async save(path, content, expectedRevision) {
      const saved = await store.save(path, content, expectedRevision ?? null);
      return { ...saved, ref: `vault:${saved.path}` };
    },
  };
  return { root, store, io };
}

const LESSON = '---\ntype: lesson\ntitle: 离心率\n---\n# 离心率\n';
const MATERIAL = '---\ntype: note\ntitle: 定义\n---\n# 定义\n';

test('createRouteInVault generates node ids, keeps briefs in the page body and refuses unknown fields', async () => {
  const { root, store, io } = await vault();
  try {
    await store.save('资料/定义.md', MATERIAL, null);
    await store.save('备课/离心率.md', LESSON, null);

    const created = await createRouteInVault(io, {
      title: '圆锥曲线',
      overview: '# 圆锥曲线\n\n先定义，再例题。',
      lessons: [
        { title: '定义', materials: ['资料/定义.md'], scriptPath: '备课/离心率.md', brief: '讲清定义。' },
        { title: '离心率', parentIndex: 0, prerequisiteIndexes: [0], pathway: 'remedial', stage: '补练', brief: '补练离心率。' },
      ],
    });
    assert.equal(created.path, '路线/圆锥曲线.md');
    assert.equal(created.nodes.length, 2);
    assert.match(created.nodes[0].id, /^[0-9a-f-]{36}$/);
    assert.equal(created.nodes[1].parent, created.nodes[0].id);
    assert.deepEqual(created.nodes.map(node => node.pathway), ['main', 'remedial']);

    const saved = await io.read(created.path);
    const route = parseRoute(saved);
    assert.equal(route.overview, '# 圆锥曲线\n\n先定义，再例题。');
    assert.deepEqual(route.nodes.map(node => node.brief), ['讲清定义。', '补练离心率。']);
    assert.deepEqual(route.nodes.map(node => node.stage), ['', '补练']);
    assert.equal(route.nodes[0].scriptPath, '备课/离心率.md');
    assert.deepEqual(route.edges, [
      { source: created.nodes[0].id, target: created.nodes[1].id, kind: 'branch' },
      { source: created.nodes[0].id, target: created.nodes[1].id, kind: 'prerequisite' },
    ]);
    const lessons = JSON.parse(saved.content.match(/^lessons: (.*)$/m)[1]);
    assert.deepEqual(lessons.map(node => Object.hasOwn(node, 'brief')), [false, false], 'the brief is never duplicated into frontmatter');

    await assert.rejects(() => createRouteInVault(io, { title: '未知字段', nodes: [], lessons: [{ title: '甲' }] }), /lesson_route_field_unknown/);
    await assert.rejects(() => createRouteInVault(io, { title: '未知节点字段', lessons: [{ title: '甲', weight: 1 }] }), /lesson_route_field_unknown/);
    await assert.rejects(() => createRouteInVault(io, { title: '越界父节点', lessons: [{ title: '甲', parentIndex: 3 }] }), /lesson_route_parent_invalid/);
    await assert.rejects(() => createRouteInVault(io, { title: '无父分支', lessons: [{ title: '甲' }, { title: '乙', pathway: 'extension' }] }), /lesson_route_parent_invalid/);
    await assert.rejects(() => createRouteInVault(io, { title: '过度路径', lessons: [{ title: '甲', materials: ['../外部.md'] }] }), /vault_path_invalid/);
    await assert.rejects(() => createRouteInVault(io, { title: '缺少材料', lessons: [{ title: '甲', materials: ['资料/没有.md'] }] }), /vault_file_not_found/);
    await assert.rejects(() => createRouteInVault(io, { title: '错误剧本', lessons: [{ title: '甲', scriptPath: '资料/定义.md' }] }), /lesson_script_required/);
    await assert.rejects(() => createRouteInVault(io, { title: '过长总述', overview: 'a'.repeat(24001), lessons: [{ title: '甲' }] }), /lesson_route_overview_invalid/);
    await assert.rejects(() => createRouteInVault(io, { title: '过长正文', lessons: [{ title: '甲', brief: 'a'.repeat(12001) }] }), /lesson_route_brief_invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a main lesson continues the main chain instead of the remedial detour', async () => {
  const { root, io } = await vault();
  try {
    const created = await createRouteInVault(io, {
      title: '链',
      lessons: [{ title: '甲' }, { title: '补练', pathway: 'remedial', parentIndex: 0 }, { title: '乙' }],
    });
    assert.equal(created.nodes[1].parent, created.nodes[0].id);
    assert.equal(created.nodes[2].parent, created.nodes[0].id, 'the default parent is the previous main node');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reviseRouteInVault writes once with a Host-stamped log and reports a no-op revision', async () => {
  const { root, io } = await vault();
  try {
    const created = await createRouteInVault(io, {
      title: '圆锥曲线',
      overview: '# 圆锥曲线\n\n概览。',
      lessons: [{ title: '定义', brief: '先讲定义。' }],
    });
    const first = await io.read(created.path);
    const nodeId = created.nodes[0].id;

    const noop = await reviseRouteInVault(io, { path: created.path, expectedRevision: first.revision, reason: '没有实际变化' }, { today: '2026-09-22' });
    assert.equal(noop.saved, false);
    assert.deepEqual(noop.changed, []);
    assert.deepEqual(noop.added, []);
    const untouched = await io.read(created.path);
    assert.equal(untouched.revision, first.revision);
    assert.ok(!untouched.content.includes('notara:route-log'), 'no change means no fabricated log');

    const revised = await reviseRouteInVault(io, {
      path: created.path,
      expectedRevision: first.revision,
      reason: '补上补练分支',
      overview: '# 圆锥曲线\n\n先定义，再做补练。',
      updates: [{ nodeId, stage: '入门', title: '定义与方程' }],
      additions: [{ title: '补练', pathway: 'remedial', parentId: nodeId, prerequisiteIds: [nodeId], brief: '补练离心率。' }],
    }, { today: '2026-09-22' });
    assert.equal(revised.saved, true);
    assert.equal(revised.nodes.length, 2);
    assert.equal(revised.nodes[1].parent, nodeId);
    assert.deepEqual(revised.changed, [{ nodeId, title: '定义与方程', fields: ['title', 'stage'] }]);
    assert.deepEqual(revised.added, [{ nodeId: revised.nodes[1].id, title: '补练', fields: ['title', 'pathway', 'parentId', 'prerequisiteIds', 'brief'] }]);

    const updated = await io.read(created.path);
    const route = parseRoute(updated);
    assert.equal(route.overview, '# 圆锥曲线\n\n先定义，再做补练。');
    assert.deepEqual(route.nodes.map(node => node.title), ['定义与方程', '补练']);
    assert.deepEqual(route.nodes.map(node => node.brief), ['先讲定义。', '补练离心率。']);
    assert.deepEqual(route.nodes.map(node => node.stage), ['入门', '']);
    assert.equal(route.nodes[0].id, nodeId, 'a revision never rewrites a node identity');
    assert.deepEqual(route.edges.map(edge => edge.kind), ['branch', 'prerequisite']);

    const log = updated.content.match(/<!-- notara:route-log -->\n([\s\S]*?)\n<!-- notara:route-log:end -->/);
    assert.ok(log, 'the change log is a marked block in the route page');
    assert.match(log[1], /^- 2026-09-22 · 原因：补上补练分支 · 影响：圆锥曲线（课程总述）、定义与方程、补练$/m, 'the log includes the changed overview as well as every changed node');
    assert.ok(!updated.content.includes('课堂小结'), 'a route revision never touches a classroom log');

    // Repeating the same revision is a no-op, and the log never becomes the overview.
    const again = await reviseRouteInVault(io, { path: created.path, expectedRevision: updated.revision, reason: '重复提交', updates: [{ nodeId, stage: '入门' }] }, { today: '2026-09-23' });
    assert.equal(again.saved, false);
    const after = await io.read(created.path);
    assert.equal(after.revision, updated.revision);
    assert.equal(after.content, updated.content);
    assert.equal(parseRoute(after).overview, '# 圆锥曲线\n\n先定义，再做补练。');

    await assert.rejects(() => reviseRouteInVault(io, { path: created.path, expectedRevision: first.revision, reason: '旧版本' }, { today: '2026-09-22' }), /vault_reference_stale/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a bound node and its scheduled date survive a revision that adds the new goal', async () => {
  const { root, io } = await vault();
  try {
    const created = await createRouteInVault(io, { title: '圆锥曲线', lessons: [{ title: '第一课', brief: '先讲定义。' }] });
    const nodeId = created.nodes[0].id;
    const opened = await io.read(created.path);
    // This is exactly what opening and scheduling a lesson writes back.
    const bound = renderRoute({ title: '圆锥曲线', nodes: parseRoute(opened).nodes.map(node => ({ ...node, sessionId: 'session-a', scheduledOn: '2026-09-25' })) }, opened.content);
    await io.save(created.path, bound, opened.revision);

    const boundDoc = await io.read(created.path);
    await assert.rejects(
      () => reviseRouteInVault(io, { path: created.path, expectedRevision: boundDoc.revision, reason: '改已开课节点', updates: [{ nodeId, title: '改名' }] }, { today: '2026-09-22' }),
      /lesson_route_node_bound/,
    );
    assert.equal((await io.read(created.path)).content, boundDoc.content, 'a refused revision writes nothing');

    const added = await reviseRouteInVault(io, { path: created.path, expectedRevision: boundDoc.revision, reason: '新目标另开一节', additions: [{ title: '第二课', brief: '新内容。' }] }, { today: '2026-09-22' });
    assert.equal(added.saved, true);
    const route = parseRoute(await io.read(created.path));
    assert.equal(route.nodes[0].sessionId, 'session-a');
    assert.equal(route.nodes[0].scheduledOn, '2026-09-25');
    assert.equal(route.nodes[0].brief, '先讲定义。');
    assert.equal(route.nodes[1].parent, nodeId);
    assert.equal(route.nodes[1].brief, '新内容。');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a partly invalid revision is refused before anything is written', async () => {
  const { root, io } = await vault();
  try {
    const created = await createRouteInVault(io, { title: '圆锥曲线', lessons: [{ title: '第一课', brief: '先讲定义。' }] });
    const nodeId = created.nodes[0].id;
    const before = await io.read(created.path);
    const attempt = (args, pattern) => assert.rejects(() => reviseRouteInVault(io, args, { today: '2026-09-22' }), pattern).then(async () => {
      assert.equal((await io.read(created.path)).content, before.content);
    });

    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', summary: '未知字段' }, /lesson_route_field_unknown/);
    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', updates: [{ nodeId, content: '未知字段' }] }, /lesson_route_field_unknown/);
    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', additions: [{ title: '乙', nodeId: '模型编的 id' }] }, /lesson_route_field_unknown/);
    await attempt({ path: created.path, expectedRevision: before.revision, reason: '  ' }, /lesson_route_reason_invalid/);
    await attempt({ path: created.path, reason: 'x' }, /lesson_route_revision_required/);
    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', updates: [{ nodeId: '不存在', title: '甲' }] }, /lesson_route_node_missing/);
    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', additions: [{ title: '乙', parentId: '不存在' }] }, /lesson_route_missing_parent/);
    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', additions: [{ title: '乙', pathway: 'remedial' }] }, /lesson_route_parent_invalid/);
    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', additions: [{ title: '丙', prerequisiteIds: ['不存在'] }] }, /lesson_route_prerequisite_missing/);
    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', additions: [{ title: '丁', scriptPath: '备课/没有.md' }] }, /vault_file_not_found/);
    // The valid update and the invalid addition arrive in one request: the
    // valid half must not be written on its own.
    await attempt({ path: created.path, expectedRevision: before.revision, reason: 'x', updates: [{ nodeId, title: '改名' }], additions: [{ title: '戊', scriptPath: '备课/没有.md' }] }, /vault_file_not_found/);
    assert.equal(parseRoute(await io.read(created.path)).nodes[0].title, '第一课');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('safeTitlePath stays the single file-name rule for route pages', () => {
  assert.equal(safeTitlePath('  圆锥曲线  '), '圆锥曲线');
  assert.equal(safeTitlePath('高二/圆锥:曲线'), '高二-圆锥-曲线');
  assert.throws(() => safeTitlePath(''), /vault_title_invalid/);
});

test('the pathway vocabulary and the node budgets are one frozen contract', () => {
  assert.ok(Array.isArray(ROUTE_PATHWAYS), 'the CLI calls .includes on a plain frozen array');
  assert.ok(Object.isFrozen(ROUTE_PATHWAYS));
  assert.deepEqual([...ROUTE_PATHWAYS], ['main', 'remedial', 'extension']);
  assert.equal(ROUTE_PATHWAYS.includes('remedial'), true);
  assert.equal(ROUTE_PATHWAYS.includes('extra'), false);
  assert.equal(ROUTE_PATHWAYS_FROM_PROJECTION, ROUTE_PATHWAYS, 'the projection and the write entry point share one list');

  assert.equal(routeOverviewText('a'.repeat(24000)).length, 24000);
  assert.throws(() => routeOverviewText('a'.repeat(24001)), /lesson_route_overview_invalid/);
  assert.equal(routeBriefText('b'.repeat(12000)).length, 12000);
  assert.throws(() => routeBriefText('b'.repeat(12001)), /lesson_route_brief_invalid/);
  assert.equal(routeStageText('阶段'.repeat(60)).length, 120);
  assert.throws(() => routeStageText('阶段'.repeat(61)), /lesson_route_stage_invalid/);
});
