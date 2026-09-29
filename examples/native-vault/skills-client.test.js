import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_SKILLS, createSkillsStore, inheritChoices, lineDiff, selectedSkill, skillGroups, skillKey, skillStatusLabel } from './skills-client.js';

test('a revision is shown as the lines it keeps, adds and removes', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nc\nd'), [
    { type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'same', text: 'c' }, { type: 'add', text: 'd' },
  ]);
  assert.deepEqual(lineDiff('', 'x'), [{ type: 'add', text: 'x' }], 'an empty text has no lines');
  assert.deepEqual(lineDiff('same', 'same'), [{ type: 'same', text: 'same' }]);
});

test('very long texts fall back to showing the whole revision instead of a slow diff', () => {
  const long = Array.from({ length: 3000 }, (_, index) => `line ${index}`).join('\n');
  const rows = lineDiff(long, `${long}\nextra`);
  assert.equal(rows[0].type, 'fallback');
});

test('status labels and inheritance choices read the list the Host returned', () => {
  assert.equal(skillStatusLabel({ status: 'draft' }), '草稿');
  assert.equal(skillStatusLabel({ status: 'active' }), '启用中');
  assert.equal(skillStatusLabel({ status: 'active', pending: {} }), '启用中 · 有待确认修订');
  assert.equal(skillStatusLabel({ error: 'skill_title_invalid' }), '格式有误');
  const sets = [
    { workspaceId: 'a', title: '高二数学', skills: [{ id: 'conic', title: '解析几何要点', status: 'active' }, { id: 'broken', error: 'skill_title_invalid' }] },
    { workspaceId: 'b', title: '高三数学', skills: [{ id: 'series', title: '数列要点', status: 'draft' }] },
  ];
  assert.deepEqual(inheritChoices(sets, 'b'), [{ value: 'a/conic', label: '高二数学 · 解析几何要点', fromWorkspaceId: 'a', id: 'conic' }]);
  assert.deepEqual(inheritChoices(sets, 'a'), [{ value: 'b/series', label: '高三数学 · 数列要点', fromWorkspaceId: 'b', id: 'series' }]);
  // A skill the target set already has is not offered again.
  sets[1].skills.push({ id: 'conic', title: '解析几何要点', status: 'draft' });
  assert.deepEqual(inheritChoices(sets, 'b'), []);
});

test('the overview row lists its required facts and marks what is still a placeholder', async () => {
  const { overviewFacts, skillStatusLabel: label } = await import('./skills-client.js');
  const row = { id: 'learning-set', status: 'draft', overview: { subjects: ['数学', '物理'], coverage: '待填写', level: '高二', goal: '高考', deadline: '2027-06', incomplete: ['coverage'] } };
  assert.equal(label(row), '草稿 · 待补全');
  assert.equal(overviewFacts(row.overview), '科目：数学、物理 · 学什么：待填写 · 学段或水平：高二 · 目标：高考 · 期限：2027-06');
  assert.equal(label({ ...row, overview: { ...row.overview, incomplete: [] } }), '草稿');
});

test('built-in skills are listed read-only by their menu titles', () => {
  assert.ok(BUILTIN_SKILLS.length >= 20);
  assert.ok(BUILTIN_SKILLS.some(item => item.title === '板书'));
  for (const item of BUILTIN_SKILLS) { assert.ok(item.title && item.description); assert.equal(item.id.startsWith('notara-'), false); }
});

test('skill keys name one skill in one layer', () => {
  assert.equal(skillKey({ scope: 'set', id: 'learning-set' }, 'w1'), 'set:w1:learning-set');
  assert.equal(skillKey({ scope: 'global', id: 'math' }), 'global:math');
  assert.equal(skillKey({ builtin: true, id: 'board' }), 'builtin:board');
});

test('the skills store loads once for panel and page, and an action replaces the data', async () => {
  let loads = 0;
  const store = createSkillsStore(async () => { loads++; return { ok: true, value: { global: { skills: [] }, sets: [] } }; });
  await Promise.all([store.refresh(), store.refresh()]);
  assert.equal(loads, 1, 'concurrent readers share one load');
  assert.deepEqual(store.getSnapshot().data, { global: { skills: [] }, sets: [] });
  await store.act(async () => ({ ok: false, error: { message: '技能暂时读不出来，请稍后再试。' } }));
  assert.equal(store.getSnapshot().error, '技能暂时读不出来，请稍后再试。');
  assert.equal(loads, 2, 'a failed action reloads the list');
  store.select('global:math');
  assert.equal(store.getSnapshot().selected, 'global:math');
});

test('panel and page pick the same skill, falling back to the first one when the choice is gone', () => {
  const data = { sets: [{ workspaceId: 'w', title: '概率', skills: [{ id: 'learning-set', title: '学习集梗概', status: 'active' }, { id: 'pie', title: '画饼分类', status: 'draft' }] }], global: { skills: [] } };
  const groups = skillGroups(data, 'w');
  assert.equal(selectedSkill(groups, 'set:w:pie').row.title, '画饼分类');
  assert.equal(selectedSkill(groups, 'set:w:gone').row.key, groups[0].rows[0].key);
  assert.equal(selectedSkill(groups, '').row.key, groups[0].rows[0].key);
  assert.equal(selectedSkill([], 'set:w:pie'), undefined);
});
