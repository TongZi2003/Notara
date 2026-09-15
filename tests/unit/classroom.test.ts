import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { ClassroomDefinitionSchema, ClassmateTaskInputSchema, classmateMention } from '../../packages/contracts/src/classroom.ts';
import { automaticRule, classroomRounds, mentionedClassmates } from '../../packages/host/src/plugins/classroom-policy.ts';
import { selectWorldbookEntries } from '../../packages/host/src/plugins/worldbook-selection.ts';

const seed = ClassroomDefinitionSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/classroom-seed.json', import.meta.url), 'utf8')).classroom);
test('roles have distinct stable references and rules cannot name missing classmates', () => {
  expect(ClassroomDefinitionSchema.safeParse(seed).success).toBe(true);
  expect(ClassroomDefinitionSchema.safeParse({ ...seed, roles: [...seed.roles, seed.roles[0]] }).success).toBe(false);
  expect(ClassroomDefinitionSchema.safeParse({ ...seed, roles: seed.roles.slice(1) }).success).toBe(false);
  expect(ClassmateTaskInputSchema.safeParse({ id: 'room', roleId: 'critic', task: '核对推论', materials: [], destination: 'conversation' }).success).toBe(false);
  const task = ClassmateTaskInputSchema.parse({ id: 'room', roleId: 'critic', task: '核对推论', materials: [{ title: '原话', text: '内容' }], destination: 'conversation' });
  expect(task.route).toBe('default');
  expect(ClassroomDefinitionSchema.safeParse({ ...seed, roles: [{ ...seed.roles[0], route: { default: { provider: 'studyforge-test', model: 'study-model-a' }, escalation: { provider: 'studyforge-test', model: 'study-model-b', maxTokens: 8000 } } }, ...seed.roles.slice(1)] }).success).toBe(true);
});
test('only completed genuine teaching turns count, including after a fork boundary', () => {
  const events: unknown[] = [], push = (type: string, data: unknown) => events.push({ type, data, seq: events.length, time: events.length });
  const turn = (index: number, source: string, reason: string) => { push('turn/start', { turn: index }); push('user/message', { role: 'user', source: { kind: source }, content: [{ type: 'text', text: '本轮原话' }] }); push('turn/end', { turn: index, reason: { kind: reason } }); };
  turn(1, 'user', 'completed'); turn(2, 'plugin', 'completed'); turn(3, 'subagent-settled', 'completed'); turn(4, 'user', 'aborted');
  expect(classroomRounds(events as SessionEvent[]).map(round => round.turn)).toEqual([1]);
  push('session/end-seed', { inherited: true }); turn(5, 'user', 'completed');
  expect(classroomRounds(events as SessionEvent[]).map(round => round.turn)).toEqual([5]);
  expect(classroomRounds(events as SessionEvent[], events.length - 1)).toEqual([]);
});
test('typed or staged mentions resolve existing active classmates, and disabled participants do not auto-run', () => {
  expect(mentionedClassmates(classmateMention('杠精同学', seed.title), seed)).toEqual(['critic']);
  expect(mentionedClassmates('@同桌 请帮我看看', seed)).toEqual(['peer']);
  expect(mentionedClassmates('普通课堂消息', seed)).toEqual([]);
  expect(automaticRule(seed, 'round', 2)).toBeUndefined();
  expect(automaticRule(seed, 'round', 3)?.id).toBe('check_reasoning');
  expect(automaticRule({ ...seed, roles: seed.roles.map(role => ({ ...role, enabled: false })) }, 'round', 3)).toBeUndefined();
});
test('context lifespan retains only appropriate history and separates teaching instructions from sources', () => {
  const entry = { title: '条件', content: '先核对假设', keywords: ['假设'], enabled: true, always: false };
  const books = [{ title: '课堂', entries: [{ ...entry, scope: 'turn' as const }, { ...entry, title: '阶段', scope: 'stage' as const }, { ...entry, title: '本课', scope: 'lesson' as const, kind: 'instruction' as const }] }];
  const selected = selectWorldbookEntries(books, '继续', { stage: '刚才的假设', lesson: '之前的假设' });
  expect(selected.entries.map(entry => entry.title)).toEqual(['阶段', '本课']);
  expect(selected.text).toContain('教学约定'); expect(selected.text).toContain('参考背景');
  expect(selectWorldbookEntries(books, '继续', { stage: '', lesson: '之前的假设' }).entries.map(entry => entry.title)).toEqual(['本课']);
});
