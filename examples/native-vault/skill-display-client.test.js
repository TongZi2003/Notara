import assert from 'node:assert/strict';
import test from 'node:test';
import { skillRowText, skillTitle } from './skill-display-client.js';

test('a Skill row names the skill by its menu title, never by its id', () => {
  assert.equal(skillTitle('notara-material-search'), '找卡片与资料');
  assert.equal(skillTitle('notara-socratic'), '苏格拉底');
  assert.equal(skillTitle('notara-set-recurrence-one-step'), '学习集里的技能');
  assert.equal(skillTitle('notara-global-circuits'), '学科技能');
  assert.equal(skillTitle(undefined), '教学技能');
  assert.equal(skillRowText({ argsRaw: '{"name":"notara-material-search"}' }), '读取技能：找卡片与资料');
  assert.equal(skillRowText({ kind: 'tool-result', call: { argsRaw: '{"name":"notara-socratic"}' } }), '读取技能：苏格拉底');
  assert.equal(skillRowText({ kind: 'tool-result', isError: true, call: { argsRaw: '{"name":"notara-x"}' } }), '没有读到技能：教学技能');
  assert.equal(skillRowText({ argsRaw: '{not json' }), '读取技能：教学技能');
});
