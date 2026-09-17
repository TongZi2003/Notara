import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { ClassroomDefinitionSchema, ClassmateTaskInputSchema, classmateMention } from '../../packages/contracts/src/classroom.ts';
import { ProposalItemInputSchema, effectTargetProblem } from '../../packages/contracts/src/proposals.ts';
import { automaticRule, classroomRounds, mentionedClassmates } from '../../packages/host/src/plugins/classroom-policy.ts';
import { relationText } from '../../packages/host/src/plugins/classroom-runtime.ts';
import { selectWorldbookEntries } from '../../packages/host/src/plugins/worldbook-selection.ts';

const seed = ClassroomDefinitionSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/classroom-seed.json', import.meta.url), 'utf8')).classroom);
test('roles have distinct stable references and rules cannot name missing classmates', () => {
  expect(ClassroomDefinitionSchema.safeParse(seed).success).toBe(true);
  expect(ClassroomDefinitionSchema.safeParse({ ...seed, roles: [...seed.roles, seed.roles[0]] }).success).toBe(false);
  expect(ClassroomDefinitionSchema.safeParse({ ...seed, roles: seed.roles.slice(1) }).success).toBe(false);
  expect(ClassmateTaskInputSchema.safeParse({ id: 'room', roleId: 'critic', task: '核对推论', materials: [], destination: 'conversation' }).success).toBe(false);
  const task = ClassmateTaskInputSchema.parse({ id: 'room', roleId: 'critic', task: '核对推论', materials: [{ title: '原话', text: '内容' }], destination: 'conversation' });
  expect(task.routeOverride).toBeUndefined();
  expect(ClassroomDefinitionSchema.safeParse({ ...seed, roles: [{ ...seed.roles[0], route: { provider: 'studyforge-test', model: 'study-model-a' } }, ...seed.roles.slice(1)] }).success).toBe(true);
});
test('relations are situational role-play settings on real targets, never learning facts', () => {
  const peer = seed.roles.find(role => role.id === 'peer')!, critic = seed.roles.find(role => role.id === 'critic')!;
  const withRelations = (relations: unknown[]) => ({ ...seed, roles: seed.roles.map(role => role.id === 'peer' ? { ...role, relations } : role) });
  const doc = { ...seed, roles: seed.roles.map(role => role.id === 'peer' ? { ...role, relations: [
    { target: 'student', label: '同桌', intimacy: 55, note: '开学起坐在一起，会互借笔记。' },
    { target: 'critic', label: '前后桌', note: '讨论常互怼。' },
    { target: 'teacher', label: '课代表', intimacy: 30, note: '' },
  ] } : role) };
  expect(ClassroomDefinitionSchema.safeParse(doc).success).toBe(true);
  expect(ClassroomDefinitionSchema.safeParse(withRelations([{ target: 'peer', label: '自己', note: '' }])).success).toBe(false);
  expect(ClassroomDefinitionSchema.safeParse(withRelations([{ target: 'ghost', label: '幻影', note: '' }])).success).toBe(false);
  const text = relationText(doc.roles, doc.roles.find(role => role.id === 'peer')!);
  expect(text).toContain('对学生：同桌（亲密度 55）'); expect(text).toContain('对杠精同学：前后桌'); expect(text).toContain('对老师：课代表');
  const incoming = relationText(doc.roles, critic);
  expect(incoming).toContain('同桌 对你：前后桌'); expect(incoming).toContain('不涉及学习评价');
  expect(relationText(seed.roles, peer)).toBe('');
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

test('classmate-role proposal is an edit of the worldbook row and freezes a full valid role', () => {
  const role = seed.roles[0]!;
  const effect = { kind: 'classmate-role' as const, id: 'classroom-workbench', role };
  expect(effectTargetProblem(effect, null, null)).toContain('必须带上');
  expect(effectTargetProblem(effect, 'worldbook:abc', 2)).toBeNull();
  const item = ProposalItemInputSchema.parse({ effect, target: 'worldbook:abc', baseline: 2 });
  expect(item).toMatchObject({ target: 'worldbook:abc', baseline: 2 });
  expect(ProposalItemInputSchema.safeParse({ effect: { ...effect, role: { ...role, id: 'bad id' } }, target: 'worldbook:abc', baseline: 2 }).success).toBe(false);
});
