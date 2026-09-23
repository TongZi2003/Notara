import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { patchSkillMenu } from '../../scripts/skill-menu-patch.ts';

const source = readFileSync(new URL('../../node_modules/@deepseek-ai/dsh-client-ui-skill/lib/client.js', import.meta.url), 'utf8');

test('the rc.2 Skill presentation patch is idempotent and refreshes renamed display metadata', () => {
  const first = patchSkillMenu(source, { 'notara-material-outline': '整理资料' }, ['notara-subject-math']);
  expect(patchSkillMenu(first, { 'notara-material-outline': '整理资料' }, ['notara-subject-math'])).toBe(first);
  const next = patchSkillMenu(first, { 'notara-material-outline': '书籍拆解与资料整理' });
  expect(next).not.toBe(first);
  expect(patchSkillMenu(next, { 'notara-material-outline': '书籍拆解与资料整理' })).toBe(next);
  expect(patchSkillMenu(next, { 'notara-material-outline': '整理资料' }, ['notara-subject-math'])).toBe(first);
});

test('an unrecognized upstream Skill module is refused without guessing a patch', () => {
  expect(() => patchSkillMenu(source + '\n/* unknown upstream change */\n', {})).toThrow(/Unknown rc\.2/);
});
