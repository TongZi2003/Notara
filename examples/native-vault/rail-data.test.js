import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAN_VIEWS, RAIL_SECTIONS, VAULT_VIEWS, boardCollapse, filterByTitle, folderLessons, lessonGroups, railSectionOf } from './rail-data.js';

test('rail sections and views', () => {
  assert.deepEqual(RAIL_SECTIONS.map(item => item.label), ['首页', '计划', 'Vault', '技能']);
  assert.deepEqual(PLAN_VIEWS.map(([, label]) => label), ['日历', '路线', '复习', '定时任务']);
  assert.deepEqual(VAULT_VIEWS.map(([, label]) => label), ['文件', '卡片', '图谱']);
  assert.equal(railSectionOf('lesson'), 'home');
  assert.equal(railSectionOf('plan'), 'plan');
});

test('lessons group into today and earlier; a running lesson is today', () => {
  const now = new Date('2026-09-27T12:00:00+08:00');
  const rows = [
    { id: 'a', title: '条件概率', updatedAt: Date.parse('2026-09-27T09:00:00+08:00') },
    { id: 'b', title: '传球', updatedAt: Date.parse('2026-09-26T21:00:00+08:00') },
    { id: 'c', title: '贝叶斯', updatedAt: Date.parse('2026-09-20T09:00:00+08:00'), running: true },
  ];
  assert.deepEqual(lessonGroups(rows, now, 'Asia/Shanghai').map(group => [group.label, group.rows.map(row => row.id)]), [['今天', ['a', 'c']], ['更早', ['b']]]);
  assert.deepEqual(lessonGroups([], now, 'Asia/Shanghai'), []);
});

test('title filter ignores case and surrounding blanks', () => {
  const rows = [{ title: '条件概率' }, { title: 'Bayes 公式' }, { title: '' }];
  assert.deepEqual(filterByTitle(rows, '  bayes ').map(row => row.title), ['Bayes 公式']);
  assert.equal(filterByTitle(rows, '').length, 3);
});

test('a virtual folder with no title is safely omitted from title-filtered results', () => {
  const result = folderLessons([{ id: 'lesson', title: '课堂' }], {
    groups: [{ id: 'folder' }], members: [{ sessionId: 'lesson', groupId: 'folder' }],
  }, 'missing');
  assert.deepEqual(result, { folders: [], ungrouped: [] });
});

test('the board folds the panel and unfolds it only if it was folded for the board', () => {
  let state = { auto: false, pending: null }, step;
  step = boardCollapse(state, { type: 'board', focused: true, collapsed: false, narrow: false });
  assert.equal(step.toggle, true); state = step.state;
  state = boardCollapse(state, { type: 'collapsed', collapsed: true }).state;
  step = boardCollapse(state, { type: 'board', focused: false, collapsed: true, narrow: false });
  assert.equal(step.toggle, true, 'back from the board: unfold'); state = boardCollapse(step.state, { type: 'collapsed', collapsed: false }).state;
  assert.deepEqual(state, { auto: false, pending: null });
  // The student opens the panel on the board: leaving the board keeps it open.
  state = boardCollapse({ auto: false, pending: null }, { type: 'board', focused: true, collapsed: false, narrow: false }).state;
  state = boardCollapse(state, { type: 'collapsed', collapsed: true }).state;
  state = boardCollapse(state, { type: 'collapsed', collapsed: false }).state;
  assert.equal(boardCollapse(state, { type: 'board', focused: false, collapsed: false, narrow: false }).toggle, false);
  // Already folded by the student, or on a narrow screen: nothing to do.
  assert.equal(boardCollapse({ auto: false, pending: null }, { type: 'board', focused: true, collapsed: true, narrow: false }).toggle, false);
  assert.equal(boardCollapse({ auto: false, pending: null }, { type: 'board', focused: true, collapsed: false, narrow: true }).toggle, false);
});
