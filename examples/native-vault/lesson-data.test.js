import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findLearning } from './learning-data.js';
import { lessonLog, parseLessonSummaries, parseRoute, renderRoute, stableLessonSummaryId, upsertLessonSummary } from './lesson-data.js';
import { createVaultStore, parseMarkdownDocument, revisionFor } from './vault.js';

const SESSION_A = 'session-2026-09-21-a';
const SESSION_B = 'session-2026-09-21-b';
const SESSION_C = 'session-2026-09-23-c';

const documentOf = (path, content) => parseMarkdownDocument(path, content, revisionFor(content));

test('date-only log end includes that whole activity day, independently of the save time',()=>{
  const content=upsertLessonSummary('',{sessionId:SESSION_A,body:'实际课堂',startedAt:'2026-09-21T09:00:00.000Z',throughAt:'2026-09-21T10:00:00.000Z',savedAt:'2026-09-22T01:00:00.000Z',routePath:'路线/概率.md',nodeId:'lesson-a'});
  const result=lessonLog([documentOf('lesson_log/课堂.md',content)],{from:'2026-09-21',to:'2026-09-21'});
  assert.equal(result.total,1);
  assert.equal(result.hits[0].savedAt,'2026-09-22T01:00:00.000Z');
  assert.equal(result.hits[0].routePath,'路线/概率.md');
});

const TEMPLATES = resolve(fileURLToPath(new URL('templates/', import.meta.url)));

test('bundled templates stay readable by the flat frontmatter subset', async () => {
  for (const name of ['card.md', 'insight.md', 'learner-profile.md', 'lesson.md', 'route.md']) {
    const content = await readFile(resolve(TEMPLATES, name), 'utf8');
    // Seeding parses every bundled template with the flat Vault subset, so a
    // nested block here would break the whole template list.
    const document = parseMarkdownDocument(`_templates/${name}`, content, revisionFor(content));
    assert.equal(document.frontmatter.template, true, name);
    assert.ok(document.type, name);
  }

  const insight = parseMarkdownDocument('_templates/insight.md', await readFile(resolve(TEMPLATES, 'insight.md'), 'utf8'), 'rev');
  const profile = parseMarkdownDocument('_templates/learner-profile.md', await readFile(resolve(TEMPLATES, 'learner-profile.md'), 'utf8'), 'rev');
  assert.deepEqual(findLearning([insight, profile], {}).hits.map(hit => hit.type).sort(), ['insight', 'learner-profile']);
  assert.equal(findLearning([insight], { kind: 'insight' }).hits[0].recall, null, 'an empty template does not invent a recall condition');
  const filled = parseMarkdownDocument('锦囊/系数和.md', insight.content.replace('### 何时想起\n', '### 何时想起\n\n题目要求系数和时。\n'), 'filled');
  assert.match(findLearning([filled], { kind: 'insight' }).hits[0].recall, /题目要求系数和时/);

  const route = parseRoute(parseMarkdownDocument('_templates/route.md', await readFile(resolve(TEMPLATES, 'route.md'), 'utf8'), 'rev'));
  assert.deepEqual(route.nodes, []);
  assert.deepEqual(route.edges, []);
});

/** A route page in the shared flat format: `lessons` is one line of JSON. */
function routePage(lessons, body = '# 路线\n') {
  return ['---', 'type: route', 'title: 非法路线', `lessons: ${JSON.stringify(lessons)}`, '---', body].join('\n');
}

function summary(overrides = {}) {
  return {
    sessionId: SESSION_A,
    learningSetRef: '数学/圆锥曲线',
    subjects: ['数学'],
    startedAt: '2026-09-21T09:00:00+08:00',
    throughAt: '2026-09-21T09:40:00+08:00',
    cutoff: 'msg-42',
    title: '圆锥曲线选路',
    body: '## 实际问题\n\n求离心率。\n\n## 下次从这里继续\n\n先让学生自己判断是否需要参数方程。\n',
    ...overrides,
  };
}

const updatedBody = '## 实际问题\n\n求面积。\n\n## 下次从这里继续\n\n先画图。\n';

test('updates one stable block per session and keeps the script text untouched', () => {
  const script = '---\ntype: lesson\nstatus: draft\n---\n# 圆锥曲线剧本\n\n## 阶段一\n\n先讲定义。\n\n<!-- 学生自己加的备注 -->\n';

  const first = upsertLessonSummary(script, summary());
  assert.ok(first.startsWith(script), 'appending must not rewrite the existing script');
  const blocks = parseLessonSummaries(documentOf('课程/圆锥曲线.md', first));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, '课程/圆锥曲线.md');
  assert.equal(blocks[0].revision, revisionFor(first));
  assert.equal(blocks[0].kind, 'script');
  assert.equal(blocks[0].anchor, stableLessonSummaryId(SESSION_A));
  assert.equal(blocks[0].sessionId, SESSION_A);
  assert.equal(blocks[0].learningSetRef, '数学/圆锥曲线');
  assert.deepEqual(blocks[0].subjects, ['数学']);
  assert.equal(blocks[0].startedAt, '2026-09-21T09:00:00+08:00');
  assert.equal(blocks[0].throughAt, '2026-09-21T09:40:00+08:00');
  assert.equal(blocks[0].cutoff, 'msg-42');
  assert.equal(blocks[0].title, '圆锥曲线选路');
  assert.equal(blocks[0].continuation, '先让学生自己判断是否需要参数方程。');
  assert.match(blocks[0].body, /^## 实际问题$/m);

  const second = upsertLessonSummary(first, summary({ cutoff: 'msg-57', body: updatedBody }));
  assert.ok(second.startsWith(script));
  assert.equal(second.split('notara:lesson-summary').length - 1, 2, 'one begin and one end marker only');
  const updated = parseLessonSummaries(documentOf('课程/圆锥曲线.md', second));
  assert.equal(updated.length, 1);
  assert.equal(updated[0].cutoff, 'msg-57');
  assert.equal(updated[0].continuation, '先画图。');
  assert.ok(!second.includes('求离心率。'), 'the superseded cutoff body is replaced, not appended');

  const retry = upsertLessonSummary(second, summary({ cutoff: 'msg-57', body: updatedBody }));
  assert.equal(retry, second, 'retrying the same cutoff stays byte-identical');
});

test('appends a second block for another session and keeps the earlier summary', () => {
  const start = '---\ntype: lesson-summary\ntitle: 自由练习\n---\n# 自由练习\n';
  const first = upsertLessonSummary(start, summary());
  const second = upsertLessonSummary(first, summary({ sessionId: SESSION_B, subjects: ['物理'], learningSetRef: '物理/动量', cutoff: 'msg-9' }));

  assert.ok(second.startsWith(first));
  const blocks = parseLessonSummaries(documentOf('lesson_log/自由练习.md', second));
  assert.deepEqual(blocks.map(block => block.sessionId), [SESSION_A, SESSION_B]);
  assert.deepEqual(blocks.map(block => block.learningSetRef), ['数学/圆锥曲线', '物理/动量']);
  assert.deepEqual(blocks.map(block => block.kind), ['standalone', 'standalone']);
  assert.equal(blocks[0].anchor, stableLessonSummaryId(SESSION_A));
  assert.equal(blocks[1].anchor, stableLessonSummaryId(SESSION_B));
});

test('rejects forged, duplicated, truncated and injected machine blocks', () => {
  const script = '---\ntype: lesson\n---\n# 剧本\n';
  const valid = upsertLessonSummary(script, summary());
  const blockStart = valid.indexOf('<!-- notara:lesson-summary');
  assert.ok(blockStart > 0);

  const forged = valid.replace(stableLessonSummaryId(SESSION_A), 'ls-0000000000000000');
  assert.throws(() => parseLessonSummaries(documentOf('课程/剧本.md', forged)), /lesson_summary_anchor_mismatch/);

  const duplicated = `${valid}\n${valid.slice(blockStart)}`;
  assert.throws(() => parseLessonSummaries(documentOf('课程/剧本.md', duplicated)), /lesson_summary_duplicate_block/);

  const truncated = valid.slice(0, valid.indexOf('<!-- notara:lesson-summary:end -->'));
  assert.throws(() => parseLessonSummaries(documentOf('课程/剧本.md', truncated)), /lesson_summary_block_truncated/);

  const stray = `${script}\n<!-- notara:lesson-summary:end -->\n`;
  assert.throws(() => parseLessonSummaries(documentOf('课程/剧本.md', stray)), /lesson_summary_marker_stray/);

  assert.throws(
    () => upsertLessonSummary(script, summary({ body: '正文。\n\n<!-- notara:lesson-summary:end -->\n' })),
    /lesson_summary_body_invalid/,
  );
  assert.throws(() => upsertLessonSummary(script, summary({ sessionId: '' })), /lesson_summary_meta_invalid/);
  assert.throws(() => upsertLessonSummary(script, summary({ subjects: ['数学', ''] })), /lesson_summary_meta_invalid/);
  assert.throws(() => upsertLessonSummary(script, summary({ title: '伪造 --> 结束' })), /lesson_summary_meta_invalid/);
});

test('lesson_log unifies script blocks and standalone summaries with real activity filters', () => {
  const script = upsertLessonSummary(
    upsertLessonSummary('---\ntype: lesson\n---\n# 剧本\n', summary()),
    summary({ sessionId: SESSION_B, subjects: ['物理'], learningSetRef: '物理/动量', startedAt: '2026-09-22T14:00:00+08:00', throughAt: '2026-09-22T14:30:00+08:00', cutoff: 'msg-9', title: '动量', body: '## 实际问题\n\n冲量。\n\n## 下次从这里继续\n\n复习冲量。\n' }),
  );
  const standalone = upsertLessonSummary('---\ntype: lesson-summary\ntitle: 自由练习\n---\n# 自由练习\n', summary({ sessionId: SESSION_C, subjects: [], learningSetRef: '数学/圆锥曲线', startedAt: '2026-09-23T10:00:00+08:00', throughAt: '2026-09-23T10:20:00+08:00', cutoff: 'msg-1', title: '自由练习', body: '## 下次从这里继续\n\n继续做综合题。\n' }));
  const documents = [documentOf('课程/剧本.md', script), documentOf('lesson_log/自由练习.md', standalone)];

  const all = lessonLog(documents, {});
  assert.equal(all.total, 3);
  assert.equal(all.nextOffset, null);
  assert.deepEqual(all.hits.map(hit => hit.sessionId), [SESSION_C, SESSION_B, SESSION_A]);
  assert.deepEqual(all.hits.map(hit => hit.kind), ['standalone', 'script', 'script']);
  assert.equal(all.hits[0].path, 'lesson_log/自由练习.md');
  assert.deepEqual(all.hits[0].subjects, [], 'an unlabeled class appears in the all-subject view without a fabricated subject');
  assert.equal(all.hits[0].continuation, '继续做综合题。');
  assert.equal(all.hits[2].path, '课程/剧本.md');
  assert.equal(all.hits[2].anchor, stableLessonSummaryId(SESSION_A));
  assert.equal(all.hits[2].continuation, '先让学生自己判断是否需要参数方程。');

  assert.deepEqual(lessonLog(documents, { subject: '数学' }).hits.map(hit => hit.sessionId), [SESSION_A]);
  assert.deepEqual(lessonLog(documents, { subject: '物理' }).hits.map(hit => hit.sessionId), [SESSION_B]);
  assert.deepEqual(lessonLog(documents, { learningSetRef: '数学/圆锥曲线' }).hits.map(hit => hit.sessionId), [SESSION_C, SESSION_A]);
  assert.deepEqual(
    lessonLog(documents, { from: '2026-09-22T00:00:00+08:00', to: '2026-09-22T23:59:59+08:00' }).hits.map(hit => hit.sessionId),
    [SESSION_B],
    'activity range filtering keeps the classes that really happened inside it',
  );
  assert.deepEqual(lessonLog(documents, { query: '冲量' }).hits.map(hit => hit.sessionId), [SESSION_B]);

  const page = lessonLog(documents, { limit: 2 });
  assert.equal(page.total, 3);
  assert.equal(page.hits.length, 2);
  assert.equal(page.nextOffset, 2);
  assert.equal(lessonLog(documents, { offset: 2, limit: 2 }).nextOffset, null);
  assert.throws(() => lessonLog(documents, { limit: -1 }), /lesson_request_invalid/);
});

test('lesson_log keeps one entry per real class and reports unreadable records', () => {
  const script = upsertLessonSummary('---\ntype: lesson\n---\n# 剧本\n', summary());
  const copy = upsertLessonSummary('---\ntype: lesson-summary\n---\n# 副本\n', summary());
  const deduped = lessonLog([documentOf('课程/剧本.md', script), documentOf('lesson_log/副本.md', copy)], {});
  assert.equal(deduped.total, 1);
  assert.equal(deduped.hits[0].path, '课程/剧本.md');

  const broken = script.slice(0, script.indexOf('<!-- notara:lesson-summary:end -->'));
  const result = lessonLog([documentOf('课程/剧本.md', script), documentOf('课程/损坏.md', broken)], {});
  assert.equal(result.total, 1);
  assert.deepEqual(result.skipped, [{ path: '课程/损坏.md', reason: 'lesson_summary_block_truncated' }]);
});

test('parses route nodes, rejects illegal parents and only emits sequence edges', () => {
  const content = renderRoute({ title: '圆锥曲线路线', nodes: [
    { id: 'n1', title: '定义与方程', materials: ['资料/定义.md'] },
    { id: 'n2', title: '离心率', parent: 'n1', materials: [], scriptPath: '课程/离心率剧本.md', sessionId: 'session-x' },
  ] });
  // The node list is one line of JSON, so the page is an ordinary Vault page.
  assert.match(content, /^lessons: \[\{"id":"n1"/m);
  const route = parseRoute(documentOf('路线/圆锥曲线.md', content));
  assert.equal(route.path, '路线/圆锥曲线.md');
  assert.equal(route.revision, revisionFor(content));
  assert.equal(route.title, '圆锥曲线路线');
  assert.deepEqual(route.nodes.map(node => node.id), ['n1', 'n2']);
  assert.deepEqual(route.nodes[0].materials, ['资料/定义.md']);
  assert.deepEqual(route.nodes[0].parent, null);
  assert.equal(route.nodes[1].scriptPath, '课程/离心率剧本.md');
  assert.equal(route.nodes[1].sessionId, 'session-x');
  assert.deepEqual(route.edges, [{ source: 'n1', target: 'n2', kind: 'sequence' }]);

  const node = (id, parent) => ({ id, title: id, materials: [], ...(parent ? { parent } : {}) });
  assert.throws(() => parseRoute(documentOf('路线/环.md', routePage([node('a', 'b'), node('b', 'a')]))), /lesson_route_cycle/);
  assert.throws(() => parseRoute(documentOf('路线/悬空.md', routePage([node('a', 'nope')]))), /lesson_route_missing_parent/);
  assert.throws(() => parseRoute(documentOf('路线/自环.md', routePage([node('a', 'a')]))), /lesson_route_self_parent/);
  assert.throws(() => parseRoute(documentOf('路线/对象.md', routePage(node('a')))), /lesson_route_lessons_invalid/);
  assert.throws(() => parseRoute(documentOf('路线/重复.md', routePage([node('a'), node('a')]))), /lesson_route_duplicate_node/);
  assert.throws(() => parseRoute(documentOf('路线/路径.md', routePage([{ id: 'a', title: 'A', materials: ['/绝对/路径.md'] }]))), /lesson_route_lessons_invalid/);
  assert.throws(() => parseRoute(documentOf('路线/类型.md', ['---', 'type: lesson', '---', '# 不是路线', ''].join('\n'))), /lesson_route_type_required/);
  assert.throws(() => parseRoute({ path: '路线/空.md', revision: 'r' }), /lesson_route_document_invalid/);
  assert.throws(() => parseRoute({ path: '路线/无属性.md', revision: 'r', frontmatter: {}, links: [] }), /lesson_route_type_required/);

  // A hand-written multi-line block sequence stays outside the shared subset:
  // it is reported instead of being partially indexed.
  assert.throws(() => documentOf('路线/块.md', ['---', 'type: route', 'lessons:', '  - id: n1', '---', '# 块', ''].join('\n')), /vault_frontmatter_invalid/);
});

test('renders accurate route metadata and keeps the existing free body', () => {
  const previous = ['---', 'type: route', 'status: draft', 'tags: [圆锥曲线]', `lessons: ${JSON.stringify([{ id: 'old', title: '旧课', materials: [] }])}`, '---', '# 旧路线', '', '## 目标', '', '- [ ] 老师手写目标', '', '## 备注', '', '老师手写。', ''].join('\n');
  const rendered = renderRoute({ title: '新路线', nodes: [{ id: 'n1', title: '第一课', materials: [] }] }, previous);

  assert.ok(rendered.startsWith('---\n'));
  assert.match(rendered, /^type: route$/m);
  assert.match(rendered, /^title: 新路线$/m);
  assert.match(rendered, /^status: draft$/m);
  assert.match(rendered, /^tags: \[圆锥曲线\]$/m);
  assert.match(rendered, /^lessons: \[\{"id":"n1"/m);
  assert.ok(!rendered.includes('旧课'), 'the previous node list is replaced');
  assert.ok(rendered.includes('老师手写目标'));
  assert.ok(rendered.includes('老师手写。'));

  const parsed = parseRoute(documentOf('路线/新.md', rendered));
  assert.equal(parsed.title, '新路线');
  assert.deepEqual(parsed.nodes.map(item => item.title), ['第一课']);
  assert.deepEqual(parsed.nodes.map(item => item.id), ['n1']);

  const fresh = parseRoute(documentOf('路线/新空.md', renderRoute({ title: '新空路线', nodes: [] })));
  assert.equal(fresh.nodes.length, 0);
  assert.equal(fresh.edges.length, 0);
  assert.match(renderRoute({ title: '新空路线', nodes: [] }), /^# 新空路线$/m);
  assert.throws(() => renderRoute({ title: '', nodes: [] }), /lesson_route_title_required/);
  assert.throws(() => renderRoute({ title: '环', nodes: [{ id: 'a', title: 'A', parent: 'b' }] }), /lesson_route_missing_parent/);
  // A previous page the shared reader rejects is reported, never half-rewritten.
  assert.throws(() => renderRoute({ title: '坏页面', nodes: [] }, ['---', 'lessons:', '  - id: n1', '---', '# 坏', ''].join('\n')), /vault_frontmatter_invalid/);
});

test('a real Vault holding route and summary files keeps list, read, graph and save working', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-data-store-'));
  try {
    const store = createVaultStore(root, undefined);
    const routeContent = renderRoute({ title: '圆锥曲线路线', nodes: [
      { id: 'n1', title: '定义与方程', materials: ['资料/定义.md'] },
      { id: 'n2', title: '离心率', parent: 'n1', materials: [], scriptPath: '课程/离心率剧本.md' },
    ] });
    await store.save('路线/圆锥曲线.md', routeContent, null);
    await store.save('课程/离心率剧本.md', upsertLessonSummary('---\ntype: lesson\n---\n# 剧本\n', summary()), null);

    const listing = await store.list();
    assert.deepEqual(listing.files.map(file => file.path), ['课程/离心率剧本.md', '路线/圆锥曲线.md']);
    assert.ok(listing.tree, 'the tree projection still builds');

    const saved = await store.read('路线/圆锥曲线.md');
    assert.deepEqual(parseRoute(saved).nodes.map(node => node.id), ['n1', 'n2']);
    assert.equal(parseLessonSummaries(await store.read('课程/离心率剧本.md')).length, 1);
    assert.ok((await store.graph()).nodes.some(node => node.path === '路线/圆锥曲线.md'));
    assert.ok((await store.search('离心率')).some(hit => hit.path === '路线/圆锥曲线.md'), 'the page is searchable like any other document');

    const grown = renderRoute({ title: '圆锥曲线路线', nodes: [
      ...parseRoute(saved).nodes,
      { id: 'n3', title: '综合题', parent: 'n2', materials: [] },
    ] }, routeContent);
    const updated = await store.save('路线/圆锥曲线.md', grown, saved.revision);
    assert.deepEqual(parseRoute(updated).nodes.map(node => node.id), ['n1', 'n2', 'n3']);
    assert.equal((await store.list()).files.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* --------------------------------------------------- route blocks and stages */

/** The one-line `lessons` list a route page really stores, parsed back. */
function storedLessons(content) {
  const match = content.match(/^lessons: (.*)$/m);
  assert.ok(match, 'a written route page always declares its node list');
  return JSON.parse(match[1]);
}

function blockFor(content, id) {
  const marker = `<!-- notara:route-node ${JSON.stringify(id)} -->`;
  const start = content.indexOf(marker);
  if (start < 0) return '';
  return content.slice(start, content.indexOf('<!-- notara:route-node:end -->', start));
}

test('a node brief lives in its own page block and never in frontmatter', () => {
  const content = renderRoute({ title: '圆锥曲线路线', overview: '# 圆锥曲线路线\n\n先定义，再例题。', nodes: [
    { id: 'n1', title: '定义', materials: [], stage: '入门', brief: '讲清定义。' },
    { id: 'n2', title: '离心率', parent: 'n1', materials: [], pathway: 'remedial', prerequisites: ['n1'], brief: '补练离心率。' },
  ] });

  const route = parseRoute(documentOf('路线/圆锥曲线.md', content));
  assert.equal(route.overview, '# 圆锥曲线路线\n\n先定义，再例题。');
  assert.deepEqual(route.nodes.map(node => node.brief), ['讲清定义。', '补练离心率。']);
  assert.deepEqual(route.nodes.map(node => node.stage), ['入门', '']);
  assert.deepEqual(route.nodes.map(node => node.pathway), ['main', 'remedial']);
  assert.deepEqual(route.nodes.map(node => node.prerequisites), [[], ['n1']]);
  assert.deepEqual(route.edges, [
    { source: 'n1', target: 'n2', kind: 'branch' },
    { source: 'n1', target: 'n2', kind: 'prerequisite' },
  ]);

  const lessons = storedLessons(content);
  assert.deepEqual(lessons.map(node => Object.hasOwn(node, 'brief')), [false, false], 'the brief is not duplicated into frontmatter');
  assert.equal(lessons[1].pathway, 'remedial');
  assert.equal(lessons[0].stage, '入门');
  assert.ok(!('pathway' in lessons[0]), 'the default pathway is not written');
  assert.ok(!('stage' in lessons[1]));
  assert.match(content, /<!-- notara:route-node "n1" -->/);
  assert.ok(blockFor(content, 'n1').includes('讲清定义。'));
  assert.ok(blockFor(content, 'n2').includes('补练离心率。'));
});

test('reorder, schedule and class binding keep every brief on its own node', () => {
  const first = renderRoute({ title: '圆锥曲线路线', overview: '# 路线\n\n概览。', nodes: [
    { id: 'n1', title: '定义', materials: [], brief: '讲清定义。' },
    { id: 'n2', title: '离心率', parent: 'n1', materials: [], brief: '补练离心率。' },
  ] });
  const route = parseRoute(documentOf('路线/圆锥曲线.md', first));

  // Navigation order may change without relocating authored Markdown prose.
  const reordered = renderRoute({ title: '圆锥曲线路线', nodes: [...route.nodes].reverse() }, first);
  assert.ok(reordered.indexOf('<!-- notara:route-node "n1" -->') < reordered.indexOf('<!-- notara:route-node "n2" -->'));
  assert.deepEqual(parseRoute(documentOf('路线/圆锥曲线.md',reordered)).nodes.map(node=>node.id),['n2','n1']);
  assert.ok(blockFor(reordered, 'n1').includes('讲清定义。'));
  assert.ok(blockFor(reordered, 'n2').includes('补练离心率。'));

  // Scheduling and class binding are frontmatter fields; the body only gains them back.
  const bound = renderRoute({ title: '圆锥曲线路线', nodes: route.nodes.map(node => node.id === 'n1' ? { ...node, sessionId: 'session-a', scheduledOn: '2026-09-25' } : node) }, first);
  const parsed = parseRoute(documentOf('路线/圆锥曲线.md', bound));
  assert.deepEqual(parsed.nodes.map(node => node.brief), ['讲清定义。', '补练离心率。']);
  assert.equal(parsed.nodes[0].sessionId, 'session-a');
  assert.equal(parsed.nodes[0].scheduledOn, '2026-09-25');
  assert.equal(parsed.overview, '# 路线\n\n概览。');
  assert.equal(renderRoute({ title: '圆锥曲线路线', nodes: parsed.nodes }, bound), bound, 're-rendering a written page is byte-stable');
});

test('metadata-only writes preserve omitted briefs and the position of free prose between blocks', () => {
  const first=renderRoute({title:'路线',overview:'# 路线',nodes:[{id:'a',title:'第一课',materials:[],brief:'第一课规划。'},{id:'b',title:'第二课',parent:'a',materials:[],brief:'第二课规划。'}]});
  const before=first.replace('<!-- notara:route-node "b" -->','第二课前的手写旁注。\n\n<!-- notara:route-node "b" -->');
  const nodes=storedLessons(before).map(node=>node.id==='a'?{...node,scheduledOn:'2026-10-01'}:node);
  const saved=renderRoute({title:'路线',nodes},before);
  assert.deepEqual(parseRoute(documentOf('路线/课.md',saved)).nodes.map(node=>node.brief),['第一课规划。','第二课规划。']);
  assert.ok(saved.indexOf('第一课规划。')<saved.indexOf('第二课前的手写旁注。'));
  assert.ok(saved.indexOf('第二课前的手写旁注。')<saved.indexOf('<!-- notara:route-node "b" -->'));
});

test('route revisions retain the complete existing change log', () => {
  const nodes=[{id:'a',title:'第一课',materials:[],brief:'规划。'}];
  let content=renderRoute({title:'路线',nodes});
  for(let index=1;index<=25;index++)content=renderRoute({title:'路线',nodes,logEntry:`- 2026-09-22 · 修改 ${index}`},content);
  assert.match(content,/- 2026-09-22 · 修改 1\n/);
  assert.match(content,/- 2026-09-22 · 修改 25\n/);
  assert.equal((content.match(/· 修改 /g)??[]).length,25);
});

test('a pre-block route page stays readable and keeps its free text untouched', () => {
  const legacy = routePage([{ id: 'n1', title: '旧课', materials: [] }], '# 旧路线\n\n## 目标\n\n- [ ] 老师手写目标\n');
  const route = parseRoute(documentOf('路线/旧.md', legacy));
  assert.equal(route.overview, '# 旧路线\n\n## 目标\n\n- [ ] 老师手写目标');
  assert.equal(route.nodes[0].brief, '');
  assert.equal(route.nodes[0].pathway, 'main');
  assert.deepEqual(route.nodes[0].prerequisites, []);

  const kept = renderRoute({ title: '旧路线', nodes: route.nodes }, legacy);
  assert.ok(kept.includes('- [ ] 老师手写目标'));
  assert.ok(!kept.includes('notara:route-node'), 'a node without a brief gets no empty block');
});

test('route blocks are read strictly and unknown node attributes are refused', () => {
  const page = (body, lessons = []) => routePage(lessons, body);
  assert.throws(() => parseRoute(documentOf('路线/未知.md', routePage([{ id: 'a', title: 'A', color: 'red' }]))), /lesson_route_node_unknown_field/);
  assert.throws(() => parseRoute(documentOf('路线/正文.md', routePage([{ id: 'a', title: 'A', brief: '不该在属性里' }]))), /lesson_route_brief_location/);
  assert.throws(() => parseRoute(documentOf('路线/截断.md', page('<!-- notara:route-node "a" -->\n## A\n'))), /lesson_route_block_truncated/);
  assert.throws(() => parseRoute(documentOf('路线/残留.md', page('<!-- notara:route-node:end -->\n'))), /lesson_route_marker_stray/);
  assert.throws(() => parseRoute(documentOf('路线/坏标记.md', page('<!-- notara:route-node n1 -->\n## A\n<!-- notara:route-node:end -->\n'))), /lesson_route_marker_stray/);
  const duplicated = ['<!-- notara:route-node "a" -->', '## A', '<!-- notara:route-node:end -->', '', '<!-- notara:route-node "a" -->', '## A', '<!-- notara:route-node:end -->', ''].join('\n');
  assert.throws(() => parseRoute(documentOf('路线/重复块.md', page(duplicated))), /lesson_route_duplicate_block/);
  assert.throws(() => renderRoute({ title: '坏块', nodes: [{ id: 'a', title: 'A' }], logEntry: 'x' }, ['---', 'type: route', 'title: 坏块', 'lessons: []', '---', '<!-- notara:route-log -->', ''].join('\n')), /lesson_route_block_truncated/);

  // A block the node list does not know is not projected, but it is never
  // dropped from the page either.
  const orphan = page(['# 路线', '', '<!-- notara:route-node "other" -->', '## 别的', '', '老师手写。', '', '<!-- notara:route-node:end -->', ''].join('\n'), [{ id: 'a', title: 'A' }]);
  const kept = renderRoute({ title: '路线', nodes: parseRoute(documentOf('路线/孤儿块.md', orphan)).nodes }, orphan);
  assert.ok(kept.includes('老师手写。'));
  assert.ok(kept.includes('<!-- notara:route-node "other" -->'));
});

test('prerequisites are a real, acyclic teaching order instead of a second parent', () => {
  const node = (id, extra = {}) => ({ id, title: id, materials: [], ...extra });
  assert.throws(() => parseRoute(documentOf('路线/缺先修.md', routePage([node('a', { prerequisites: ['nope'] })]))), /lesson_route_prerequisite_missing/);
  assert.throws(() => parseRoute(documentOf('路线/自先修.md', routePage([node('a', { prerequisites: ['a'] })]))), /lesson_route_prerequisite_invalid/);
  assert.throws(() => parseRoute(documentOf('路线/重复先修.md', routePage([node('a'), node('b', { prerequisites: ['a', 'a'] })]))), /lesson_route_prerequisite_invalid/);
  assert.throws(() => parseRoute(documentOf('路线/合并环.md', routePage([node('a', { prerequisites: ['b'] }), node('b', { parent: 'a' })]))), /lesson_route_cycle/);
  assert.throws(() => parseRoute(documentOf('路线/孤立支线.md', routePage([node('a', { pathway: 'remedial' })]))), /lesson_route_parent_invalid/);
  assert.throws(() => parseRoute(documentOf('路线/未知名.md', routePage([node('a', { pathway: 'extra' })]))), /lesson_route_pathway_invalid/);

  // Declaring the same relation as both a branch and a prerequisite is legal:
  // the lesson leaves its parent and may not be taught before it.
  const route = parseRoute(documentOf('路线/合法.md', routePage([
    node('a'),
    node('b', { parent: 'a', pathway: 'extension', prerequisites: ['a'] }),
  ])));
  assert.deepEqual(route.edges.map(edge => edge.kind), ['branch', 'prerequisite']);
});
