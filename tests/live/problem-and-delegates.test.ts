/** A real independent child authors structured output; the Host registers its card. */
import { expect } from 'vitest';
import { liveTest, createLesson, turn, cards, calledTools, toolResults,
  nativeEvents, subagentAddress, value } from '../fixtures/live-classroom.ts';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';

liveTest('独立命题子任务 → structured_output → Host登记同一未学卡', async classroom => {
  const sessionId = await createLesson(classroom);
  const before = new Set((await cards(classroom)).map(card => card.ref));
  const delegated = await turn(classroom, sessionId,
    '请委托命题帮手独立出一道高中函数定义域的基础题，题量为一道。用 delegate_problem，只交目标和题目约束；让帮手提交结构化题面与参考解，由系统直接登记。你不要转抄成新卡。');
  expect(calledTools(delegated.events)).toContain('delegate_problem');
  expect(calledTools(delegated.events)).not.toContain('propose_card');
  const children = value(await classroom.client.rpc<SessionListValue>('session/list', { _request: {} })).items
    .filter(child => child.origin === 'subagent' && child.parentSessionId === sessionId);
  expect(children).toHaveLength(1);
  const child = await nativeEvents(classroom, await subagentAddress(classroom, sessionId, children[0]!.sessionId));
  expect(calledTools(child)).toContain('structured_output');
  const written = (await cards(classroom)).filter(card => !before.has(card.ref));
  expect(written).toHaveLength(1);
  const card = written[0]!;
  expect(card.content.front.trim()).not.toBe('');
  expect(card.content.sections.map(section => section.body).join('\n').trim()).not.toBe('');
  expect(card.review).toBeUndefined();
  expect(card.history).toEqual([]);
  // The parent receives the actual registered identity; no second main-model copy.
  expect(toolResults(delegated.events).join('\n')).toContain(card.ref);
});
