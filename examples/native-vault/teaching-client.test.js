import assert from 'node:assert/strict';
import test from 'node:test';

import { clearedPatch, parseSubjects, settingsDraft, settingsPatch } from './teaching-client.js';
import { lessonLogTarget, routeProjection, routeRoleOf, summaryTarget } from './routes-client.js';

const choices = [
  { id: 'socratic', title: '苏格拉底', description: '先问' },
  { id: 'feynman', title: '费曼', description: '先讲' },
  { id: 'lecture', title: '讲解式', description: '先结构' },
  { id: 'structural', title: '结构分析', description: '先条件' },
];
const settings = (extra = {}) => ({ revision: 2, teachingRef: 'socratic', learningGoal: null, temporaryInstructions: '', subjects: [], scriptPath: null, routePath: null, choices, ...extra });

test('科目 parses 顿号/逗号/空格 and never repeats a subject', () => {
  assert.deepEqual(parseSubjects('数学、物理'), ['数学', '物理']);
  assert.deepEqual(parseSubjects('数学, 物理;化学 生物'), ['数学', '物理', '化学', '生物']);
  assert.deepEqual(parseSubjects('数学、数学'), ['数学']);
  assert.deepEqual(parseSubjects('   '), []);
  assert.deepEqual(parseSubjects(undefined), []);
});

test('重新读取后原样保存不会写出任何字段', () => {
  const base = settings({ learningGoal: { title: '理解条件概率', dailyMinutes: 30 }, temporaryInstructions: '先让我试', subjects: ['数学'] });
  assert.deepEqual(settingsPatch(base, settingsDraft(base)), { patch: {}, error: '' });
});

test('保存只发送改动过的字段，清空与恢复默认都有明确表达', () => {
  const base = settings({ learningGoal: { title: '理解条件概率' }, temporaryInstructions: '慢一点', subjects: ['数学'] });
  const draft = settingsDraft(base);

  assert.deepEqual(settingsPatch(base, { ...draft, teachingRef: 'feynman' }), { patch: { teachingRef: 'feynman' }, error: '' });
  assert.deepEqual(settingsPatch(base, { ...draft, goalTitle: '' }), { patch: { learningGoal: null }, error: '' });
  assert.deepEqual(settingsPatch(base, { ...draft, instructions: '' }), { patch: { temporaryInstructions: '' }, error: '' });
  assert.deepEqual(settingsPatch(base, { ...draft, subjects: '' }), { patch: { subjects: [] }, error: '' });
  assert.deepEqual(settingsPatch(base, { ...draft, goalTitle: '理解条件概率', deadline: '2026-10-01', dailyMinutes: '45' }),
    { patch: { learningGoal: { title: '理解条件概率', deadline: '2026-10-01', dailyMinutes: 45 } }, error: '' });
  // 期限与时长属于学习目标，不能脱离标题独自存在。
  assert.equal(settingsPatch(settings(), { ...settingsDraft(settings()), deadline: '2026-10-01' }).patch, null);
  assert.match(settingsPatch(settings(), { ...settingsDraft(settings()), goalTitle: '导数', dailyMinutes: '1.5' }).error, /整数/);
  assert.match(settingsPatch(settings(), { ...settingsDraft(settings()), goalTitle: '导数', dailyMinutes: '2000' }).error, /1440/);
  assert.equal(settingsPatch(settings(), { ...settingsDraft(settings()), subjects: Array.from({ length: 13 }, (_, index) => `科目${index}`).join('、') }).patch, null);
});

test('老师人格留空用默认形象，只有真的改动才发送', () => {
  const base = settings({ persona: '你是一位严格的数学老师。' });
  assert.equal(settingsDraft(base).persona, '你是一位严格的数学老师。');
  assert.deepEqual(settingsPatch(base, settingsDraft(base)), { patch: {}, error: '' });
  // 空白就是默认形象，而不是一段看不见的自定义人格。
  assert.deepEqual(settingsPatch(base, { ...settingsDraft(base), persona: '   ' }), { patch: { persona: '' }, error: '' });
  assert.deepEqual(settingsPatch(base, { ...settingsDraft(base), persona: '  你是体育老师。 ' }), { patch: { persona: '你是体育老师。' }, error: '' });
  const tooLong = settingsPatch(base, { ...settingsDraft(base), persona: '字'.repeat(4001) });
  assert.equal(tooLong.patch, null);
  assert.match(tooLong.error, /4000/);
  const fresh = settings();
  assert.equal(settingsDraft(fresh).persona, '');
  assert.deepEqual(settingsPatch(fresh, settingsDraft(fresh)), { patch: {}, error: '' });
  // 升级前保存的草稿没有这一项：保存别的字段不会顺手清掉已保存的人格。
  assert.deepEqual(settingsPatch(base, { ...settingsDraft(base), persona: undefined }), { patch: {}, error: '' });
});

test('清空恢复 Host 默认，而不是伪造一个教法 id', () => {
  assert.deepEqual(clearedPatch(), { teachingRef: null, learningGoal: null, temporaryInstructions: '', subjects: [], persona: '' });
});

const routeNode = (id, extra = {}) => ({ id, title: `第 ${id} 课`, routePath: '路线/圆锥.md', routeRevision: 'rev-1', parent: null, scriptPath: null, sessionId: null, summary: null, ...extra });
const payload = (nodes = [], edges = [], routes = [{ path: '路线/圆锥.md', title: '圆锥曲线', revision: 'rev-1' }]) => ({ routes, nodes, edges });

test('路线课序只按本路线的 parent 投影，同 id 的其他路线不会借出连线', () => {
  const other = { ...routeNode('l1', { routePath: '路线/函数.md' }), parent: null };
  const second = { ...routeNode('l2', { routePath: '路线/函数.md' }), parent: 'l1' };
  const projection = routeProjection(payload([
    routeNode('l1'),
    { ...routeNode('l2'), parent: 'l1' },
    other,
    second,
  ], [{ source: 'l1', target: 'l2', kind: 'sequence' }]), '路线/圆锥.md');

  assert.deepEqual(projection.nodes.map(node => node.key), ['l1', 'l2']);
  assert.deepEqual(projection.edges, [{ source: 'l1', target: 'l2', kind: 'sequence' }]);
  assert.deepEqual(routeProjection(payload([other, second], [], [{ path: '路线/函数.md', title: '函数', revision: 'rev-1' }]), '路线/函数.md').edges, [{ source: 'l1', target: 'l2', kind: 'sequence' }]);
  // A route that declares no parent still uses the projection's own sequence edges.
  assert.deepEqual(routeProjection(payload([routeNode('l1'), routeNode('l2')], [{ source: 'l1', target: 'l2', kind: 'sequence' }]), '路线/圆锥.md').edges,
    [{ source: 'l1', target: 'l2', kind: 'sequence' }]);
  assert.deepEqual(routeProjection(payload(), '路线/不存在.md'), { nodes: [], edges: [] });
});

test('同一条路线里的重复 id 仍然各自可见，课序里的自环与悬空引用被丢弃', () => {
  const projection = routeProjection(payload([
    routeNode('l1'),
    routeNode('l1'),
    { ...routeNode('l2'), parent: 'l1' },
    { ...routeNode('l3'), parent: 'l3' },
    { ...routeNode('l4'), parent: 'l9' },
  ]), '路线/圆锥.md');

  assert.deepEqual(projection.nodes.map(node => node.key), ['l1', 'l1~1', 'l2', 'l3', 'l4']);
  assert.deepEqual(projection.edges, [{ source: 'l1', target: 'l2', kind: 'sequence' }]);
});

test('节点状态与小结定位来自真实绑定', () => {
  assert.equal(routeRoleOf(routeNode('l1')), 'lesson');
  assert.equal(routeRoleOf(routeNode('l1', { sessionId: 'session-1' })), 'opened');
  assert.equal(routeRoleOf(routeNode('l1', { sessionId: 'session-1', summary: { path: 'lesson_log/小结.md', anchor: 'ls-abc', title: '小结' } })), 'logged');
  assert.equal(summaryTarget({ path: 'lesson_log/小结.md', anchor: 'ls-ab c' }), 'lesson_log/小结.md#anchor=ls-ab%20c');
  assert.equal(summaryTarget({ path: '备课/第一课.md' }), '备课/第一课.md');
  assert.equal(summaryTarget(null), '');
  assert.equal(lessonLogTarget({ path: 'lesson_log/小结.md', anchor: 'ls-1' }), 'lesson_log/小结.md#anchor=ls-1');
  assert.equal(lessonLogTarget({}), '');
});

test('主线、补练与拓展互不冒充，先修与条件分支各自成立', () => {
  const projection = routeProjection(payload([
    routeNode('l1', { stage: '基础' }),
    { ...routeNode('l2'), parent: 'l1', stage: '基础', prerequisites: ['l1'] },
    { ...routeNode('l3'), parent: 'l2', stage: '函数' },
    { ...routeNode('r1'), parent:'l2', pathway: 'remedial', stage: '基础' },
    { ...routeNode('x1'), parent:'l3', pathway: 'extension' },
    { ...routeNode('b1'), prerequisites:['l1'], pathway: '没有这个分支' },
  ], [
    { source: 'l2', target: 'r1', kind: 'branch' },
    { source: 'l3', target: 'x1', kind: 'branch' },
    { source: 'l1', target: 'b1', kind: 'prerequisite' },
    { source: 'l1', target: 'l2', kind: 'prerequisite' },
  ]), '路线/圆锥.md');

  // 未知或缺失的 pathway 回到主线：旧页面不会因为缺字段变成分支。
  assert.deepEqual(projection.nodes.map(node => [node.key, node.pathway, node.stage]),
    [['l1', 'main', '基础'], ['l2', 'main', '基础'], ['l3', 'main', '函数'], ['r1', 'remedial', '基础'], ['x1', 'extension', ''], ['b1', 'main', '']]);
  assert.deepEqual(projection.nodes.map(node => node.hint),
    ['主线 · 阶段 基础', '主线 · 阶段 基础', '主线 · 阶段 函数', '条件补练 · 阶段 基础', '拓展', '主线']);
  // 课序、先修、条件分支是三种关系；同一个先修写两遍也只画一条。
  assert.deepEqual(projection.edges, [
    { source: 'l1', target: 'l2', kind: 'sequence' },
    { source: 'l2', target: 'l3', kind: 'sequence' },
    { source: 'l2', target: 'r1', kind: 'branch' },
    { source: 'l3', target: 'x1', kind: 'branch' },
    { source: 'l1', target: 'l2', kind: 'prerequisite' },
    { source: 'l1', target: 'b1', kind: 'prerequisite' },
  ]);
});
