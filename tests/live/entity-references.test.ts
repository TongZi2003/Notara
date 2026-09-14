import { expect } from 'vitest';
import { liveTest, createLesson, turn, value, assistantText } from '../fixtures/live-classroom.ts';
import type { CardView } from '@studyforge/contracts/cards';
import { parseEntityHref, type ResolvedEntityReference } from '@studyforge/contracts/entity-reference';

liveTest('自然查题后返回真实行内引用，点击解析不产生学习记录', async classroom => {
  const card = value(await classroom.client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: 'live-reference-card', content: { title: '分式函数的定义域', front: '求函数 y=1/(x-2) 的定义域。', tags: ['定义域'] },
  } }));
  const sessionId = await createLesson(classroom);
  const reply = await turn(classroom, sessionId, '帮我在已有资料里找一道练习定义域的题，说明为什么适合；先别讲答案，也不用记学习结果。');
  const refs = [...assistantText(reply.events).matchAll(/\]\((#studyforge\/reference\/[A-Za-z0-9_-]+)\)/g)].flatMap(match => {
    const reference = parseEntityHref(match[1]!); return reference ? [reference] : [];
  });
  expect(refs).toContainEqual({ kind: 'card', ref: card.ref, version: card.version });
  for (const reference of refs) expect(value(await classroom.client.rpc<ResolvedEntityReference>('studyforgeLibrary/resolveReference', { input: { sessionId, reference } })).reference).toEqual(reference);
  expect(value(await classroom.client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } })).version).toBe(card.version);
});
