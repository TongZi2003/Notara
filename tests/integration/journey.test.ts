/**
 * read_journey 的真实装配：两节已收课的课加一节刚开的课落在一份总览里——
 * 每课的小结正文与系统事实、路线已开/未开节点、卡片复习态势、学情与方法清单。
 * 本测试还钉住两条边界：读取是投影，结束后路线与小结的版本一动不动； facade
 * open(method=journey) 与直呼 read_journey 给出同一份视图。
 */
import { afterEach, expect, test } from 'vitest';
import type { JourneyView } from '../../packages/contracts/src/journey.ts';
import type { RouteView } from '../../packages/contracts/src/routes.ts';
import type { CourseView } from '../../packages/contracts/src/courses.ts';
import type { HandoffView } from '../../packages/contracts/src/handoffs.ts';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { toolSession, value } from '../fixtures/tool-session.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });

test('read_journey reads every past lesson result so the next one continues seamlessly', async () => {
  runtime = await startIsolated({ testModel: true });
  const first = await toolSession(runtime);

  // Lesson one closes with a real handoff, then plans a two-node route.
  await first.call('propose_handoff', { kind: 'close', title: '第一课小结', body: '学会了分数加法；约分还不稳。' });
  await first.confirm('第一课小结');
  await first.call('propose_route', { action: 'add', nodes: [{ title: '分数乘法' }, { title: '分数除法', parentIndex: 0 }] });
  await first.confirm('接下来的课程');
  const route = value(await first.client.rpc<RouteView>('studyforgeOrganization/route', {}));

  // Lesson two opens from the first node, leaves a card, one observation and one
  // method note, then closes with its own handoff.
  const opened = value(await first.client.rpc<{ sessionId: string }>('studyforgeOrganization/openPlannedLesson', { input: { operationId: 'open-1', nodeId: route.nodes[0]!.id } }));
  const second = await toolSession(runtime, opened.sessionId);
  await second.call('propose_card', { kind: 'card', title: '分数乘法口诀', front: 'a/b·c/d = ac/bd' });
  await second.confirm('分数乘法口诀');
  expect((await second.call('note_memory', { kind: 'habit', title: '做题跳步', body: '连乘时跳过约分直接算分子分母。' })).failed).toBe(false);
  expect((await second.call('note_method', { title: '先约分再乘', body: '交叉约分后再乘，数字小不易错。' })).failed).toBe(false);
  await second.call('propose_handoff', { kind: 'close', title: '第二课小结', body: '乘法口诀能用，跳步习惯记下了。' });
  await second.confirm('第二课小结');
  const secondClosed = value(await second.client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId: second.sessionId } }));

  // Lesson three continues from the pinned summary of lesson two, then closes;
  // the current lesson itself stays an open, unclosed entry.
  const third = value(await second.client.rpc<{ sessionId: string }>('studyforgeHandoffs/openContinuation', {
    input: { operationId: 'continue-1', ref: secondClosed.data.closure!.handoffRef, version: secondClosed.data.closure!.handoffVersion! },
  }));
  const current = await toolSession(runtime, third.sessionId);
  await current.call('propose_handoff', { kind: 'close', title: '第三课小结', body: '除法引到倒数。' });
  await current.confirm('第三课小结');
  const fresh = await toolSession(runtime);

  // Reading twice mutates nothing: the route row and every pinned handoff keep
  // the exact versions they had before the read.
  const routeBefore = value(await fresh.client.rpc<RouteView>('studyforgeOrganization/route', {}));
  const handoffBefore = value(await fresh.client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { ref: secondClosed.data.closure!.handoffRef } }));
  const view = JSON.parse((await fresh.call('read_journey', {})).text) as JourneyView;
  const closedIds = [first.sessionId, second.sessionId, current.sessionId];
  expect(view.lessons.filter(lesson => lesson.closed).map(lesson => lesson.sessionId)).toEqual(closedIds);
  expect(view.lessons[0]!.handoff).toMatchObject({ ref: expect.stringMatching(/^handoff:/), title: '第一课小结' });
  expect('body' in view.lessons[0]!.handoff!).toBe(false);
  // Progressive disclosure: the index locates the record, an explicit ref read
  // returns its full body.
  const drilled = JSON.parse((await fresh.call('open', { method: 'handoff', input: { ref: view.lessons[0]!.handoff!.ref } })).text) as HandoffView;
  expect(drilled.body).toContain('分数加法');
  // Lesson three was opened through the continuation pin; its handoff names the
  // exact frozen revision it continued from.
  expect(view.lessons[2]!.handoff!.continuedFrom).toEqual({ ref: secondClosed.data.closure!.handoffRef, version: secondClosed.data.closure!.handoffVersion });
  // The lesson being read from is itself a real, still-open experience.
  const open = view.lessons.filter(lesson => !lesson.closed);
  expect(open.map(lesson => lesson.sessionId)).toContain(fresh.sessionId);

  expect(view.route!.nodes).toEqual([
    { nodeId: route.nodes[0]!.id, title: '分数乘法', opened: true, sessionId: opened.sessionId },
    { nodeId: route.nodes[1]!.id, title: '分数除法', opened: false },
  ]);
  expect(view.cards.total).toBe(1);
  expect(view.cards.unlearned).toBe(1);
  expect(view.memory.total).toBe(1);
  expect(view.memory.items[0]).toMatchObject({ kind: 'habit', title: '做题跳步' });
  expect(view.knowledge.items.map(item => item.title)).toContain('先约分再乘');

  // The facade call returns the same view; reading twice writes nothing.
  const viaFacade = JSON.parse((await fresh.call('open', { method: 'journey', input: {} })).text) as JourneyView;
  expect(viaFacade.lessons.map(lesson => lesson.sessionId)).toEqual(view.lessons.map(lesson => lesson.sessionId));
  const routeAfter = value(await fresh.client.rpc<RouteView>('studyforgeOrganization/route', {}));
  expect(routeAfter.version).toBe(routeBefore.version);
  const handoffAfter = value(await fresh.client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { ref: secondClosed.data.closure!.handoffRef } }));
  expect(handoffAfter.version).toBe(handoffBefore.version);
}, 120_000);
