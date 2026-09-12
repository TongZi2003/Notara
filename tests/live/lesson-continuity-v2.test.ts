/**
 * P7 scenario: confirmed close → the closed lesson still accepts a real
 * post-close student turn → the same civil day shows both the summary and the
 * participation → a new lesson is opened from that exact frozen revision and
 * is taught from it.
 *
 * All reads are product Remotes plus the native log; the continuation lesson's
 * prepared prompt must carry the frozen brief.
 */
import { expect } from 'vitest';
import {
  liveTest, createLesson, turn, readCourse, preparedSystemPrompt, nativeEvents, until, proposals, confirmItems, value,
} from '../fixtures/live-classroom.ts';
import type { CalendarDay, DailyReport } from '@studyforge/contracts/calendar';
import type { HandoffView } from '@studyforge/contracts/handoffs';
import type { ProposalView } from '@studyforge/contracts/proposals';

const ZONE = 'Asia/Shanghai';

function localDay(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const field = (type: string): string => parts.find(part => part.type === type)!.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function handoffItem(proposal: ProposalView) {
  const item = proposal.items.find(candidate => candidate.draft.effect.kind === 'handoff');
  if (item === undefined) return undefined;
  return { itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline };
}

liveTest('收课确认 → 原课课后输入 → 同日日历日报 → 固定版接续课', async classroom => {
  const sessionId = await createLesson(classroom);
  await turn(classroom, sessionId, '我在做 y=1/(x-2) 的定义域：分母不能为零，所以 x 不等于 2。请检查我这一步。');
  await turn(classroom, sessionId,
    '今天先到这。用 propose_handoff 给我一份收课小结，把今天真正讲过的判断顺序写进去，等我确认。');
  const proposed = await until(classroom, 'handoff proposal did not appear', async () => {
    for (const proposal of await proposals(classroom, sessionId)) {
      const item = handoffItem(proposal);
      if (item !== undefined) return { proposal, item };
    }
    return undefined;
  });
  const confirmed = await confirmItems(classroom, proposed.proposal, [proposed.item]);
  const applied = confirmed.items.find(item => item.id === proposed.item.itemId);
  expect(applied?.status, classroom.runtime.log()).toBe('applied');
  const ref = applied?.receipt?.target;
  const version = applied?.receipt?.revision;
  expect(ref).toBeTruthy();
  expect(version).toBeTruthy();
  expect((await readCourse(classroom, sessionId)).data.closure, classroom.runtime.log()).not.toBeNull();

  // The closed lesson is still a real conversation: a post-close turn is accepted.
  await turn(classroom, sessionId, '我再自己说一句：判断顺序我大概记住了，下次先写定义域。');
  const closureAfter = (await readCourse(classroom, sessionId)).data.closure;
  expect(closureAfter?.handoffVersion).toBe(version);
  // Nothing auto-closed again and no second summary appeared by itself.
  expect((await proposals(classroom, sessionId)).some(proposal => proposal.items.some(item => item.status === 'pending' && item.draft.effect.kind === 'handoff'))).toBe(false);

  // One civil day answers the summary and the participation with one projection.
  const date = localDay();
  const day = value(await classroom.client.rpc<CalendarDay>('studyforgeCalendar/day', { query: { date, timeZone: ZONE } }));
  const report = value(await classroom.client.rpc<DailyReport>('studyforgeCalendar/report', { query: { date, timeZone: ZONE } }));
  expect(day.activity.some(item => item.kind === 'handoff' && item.target === ref)).toBe(true);
  expect(day.activity.some(item => item.kind === 'participation' && item.sourceRefs.includes('session:' + sessionId))).toBe(true);
  expect(report.day.activity).toEqual(day.activity);

  // The next lesson is opened from exactly this revision and taught from it.
  const next = value(await classroom.client.rpc<{ sessionId: string }>('studyforgeHandoffs/openContinuation', {
    input: { operationId: 'live-continuation', ref, version },
  }));
  expect(next.sessionId).not.toBe(sessionId);
  const pinned = value(await classroom.client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId: next.sessionId } }));
  expect(pinned.ref).toBe(ref);
  expect(pinned.version).toBe(version);

  await turn(classroom, next.sessionId, '接着上一节，我先自己把判断过程写一遍。');
  const nextPrompt = preparedSystemPrompt(await nativeEvents(classroom, { kind: 'session', sessionId: next.sessionId }));
  expect(nextPrompt, classroom.runtime.log()).toContain('上一课的小结');
  expect(nextPrompt).toContain(String(pinned.title));
  expect(nextPrompt).toContain(pinned.body);
});
