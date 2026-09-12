/**
 * P6.5 calendar / daily report against the real storage medium (plan §P6.5,
 * CONTRACTS.md §11).
 *
 * Every input is real: cards and their review schedule live in the card record,
 * the review occurrence is written by the production `ReviewService`, plans and
 * the route are the real stored rows, and the "real save" rows are the change
 * rows the record store itself kept. Only the caller is scripted. The test pins
 * what this task exists for: one `readDay` answers both the calendar and the
 * report; a late confirmation stays on the day it really happened; unlearned
 * cards and knowledge never count as due; due rows are one per card; a date
 * filter only narrows what is visible; and the read writes nothing.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import { PlanContentSchema } from '../../packages/contracts/src/plans.ts';
import { RouteRecordSchema } from '../../packages/contracts/src/routes.ts';
import { CalendarDaySchema, DailyReportSettingsSchema } from '../../packages/contracts/src/calendar.ts';
import type { DaySave } from '../../packages/contracts/src/calendar.ts';
import type { HostContext, MutationContext } from '../../packages/contracts/src/execution.ts';
import type { Clock } from '../../packages/domain/src/clock.ts';
import { DAILY_REPORT_REF, DailyReportService, dueRun, zonedTimeToInstant, type DailyReportStore } from '../../packages/domain/src/organization/daily-report.ts';
import { CalendarProjection, readDay, filterRoadmap, routeNodeRef, type DayReaders } from '../../packages/domain/src/organization/read-day.ts';
import { ROUTE_ID, ROUTE_REF } from '../../packages/domain/src/organization/route-service.ts';
import { ReviewService } from '../../packages/domain/src/review/review-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

// A real clock moves between operations; a late confirmation must not move a fact.
let now = '2026-09-05T09:00:00+08:00';
const at = (instant: string): void => { now = instant; };
const clock: Clock = { timeZone: 'Asia/Shanghai', now: () => now };
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];

const HOST: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const READ: HostContext = { workspaceId: 'student-a', actor: 'student', purpose: 'learning' };
const CREATE = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'creation' as const };
const write = (operationId: string): MutationContext => ({ ...CREATE, operationId });
const learned = (operationId: string) => ({ ...HOST, operationId });
const MATERIAL = 'mat_' + 'a'.repeat(16);
const VERSION = 'ver_' + 'b'.repeat(16);
const anchor = { materialId: MATERIAL, versionId: VERSION, locator: { kind: 'text' as const, start: { line: 1, column: 0 }, end: { line: 1, column: 3 } } };

afterEach(async () => {
  now = '2026-09-05T09:00:00+08:00';
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

const kindOf = (target: string): string => target.slice(0, target.indexOf(':'));

async function open() {
  const dir = await mkdtemp(join(tmpdir(), 'sf-day-'));
  roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const cardStore = await owner.collection('card', CardRecordSchema);
  const planStore = await owner.collection('plan', PlanContentSchema);
  const routeStore = await owner.collection('route', RouteRecordSchema);
  const reportStore = await owner.collection('dailyreport', DailyReportSettingsSchema) as unknown as DailyReportStore;
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });

  // Real change rows, narrowed the way the Host does: one row per real save.
  const saves = {
    list: (ctx: HostContext): DaySave[] => cardStore.list(ctx).flatMap(card =>
      cardStore.changes(ctx, card.ref).map(change => ({
        target: change.target, kind: kindOf(change.target), title: card.data.content.title, committedAt: change.committedAt,
        ...(change.sessionId === undefined ? {} : { sessionId: change.sessionId }),
      }))),
  };
  const readers: DayReaders = {
    cards: { list: ctx => cardStore.list(ctx) },
    plans: { list: ctx => planStore.list(ctx).map(row => ({ ref: row.ref, version: row.version, content: row.data })) },
    route: {
      read: (ctx: HostContext) => {
        const saved = routeStore.read(ctx, ROUTE_REF);
        return { ref: saved.ref, version: saved.version, nodes: saved.data.nodes, layout: saved.data.layout };
      },
    },
    saves,
  };
  const projection = new CalendarProjection(readers, clock);
  const reports = new DailyReportService(reportStore, projection, clock);
  return { owner, cardStore, planStore, routeStore, reportStore, readers, projection, reports, saves };
}

const card = (title: string, review?: { lastAccessed: string; nextDue: string; reviewCount: number }) => ({
  content: { title, front: 'x' }, ...(review === undefined ? {} : { review }),
});

/** The fixture every projection test reads: unlearned A, due B, later C, overdue D, late-confirmed E. */
async function seed() {
  const fixture = await open();
  await fixture.cardStore.create(write('card-a'), 'card-a', card('A 未学'));
  await fixture.cardStore.create(write('card-b'), 'card-b', card('B 到期', { lastAccessed: '2026-09-05', nextDue: '2026-09-12', reviewCount: 3 }));
  await fixture.cardStore.create(write('card-c'), 'card-c', card('C 后日', { lastAccessed: '2026-09-05', nextDue: '2026-09-13', reviewCount: 1 }));
  await fixture.cardStore.create(write('card-over'), 'card-over', card('D 逾期', { lastAccessed: '2026-09-01', nextDue: '2026-09-11', reviewCount: 1 }));
  await fixture.cardStore.create(write('card-e'), 'card-e', card('E 晚确认'));
  await fixture.planStore.create(write('plan-book'), 'plan-book', {
    kind: 'book', title: '三角函数排课', materialId: MATERIAL, entries: [{ date: '2026-09-12', sources: [anchor] }],
  });
  await fixture.planStore.create(write('plan-campaign'), 'plan-campaign', {
    kind: 'campaign', title: '期末复习', learningSetRef: null, tags: [], cards: ['card:card-b'], dailyCount: 1,
    start: '2026-09-10', end: '2026-09-12', schedule: [{ date: '2026-09-10', cards: ['card:card-b'] }],
  });
  await fixture.routeStore.create(write('route-1'), ROUTE_ID, { nodes: [
    { id: 'p-root', title: '根', materials: { materials: [] } },
    { id: 'p-a', title: '课一', parent: 'p-root', materials: { materials: [] }, date: '2026-09-12' },
    { id: 'p-b', title: '课二', parent: 'p-root', materials: { materials: [] }, date: '2026-09-12' },
    { id: 'p-old', title: '上周课', parent: 'p-root', materials: { materials: [] }, date: '2026-09-01' },
    { id: 'p-open', title: '已开课', parent: 'p-root', materials: { materials: [] }, date: '2026-09-10',
      session: { sessionId: 's-open', openingKey: 'open_p-open', openedAt: '2026-09-10T02:00:00.000Z' } },
  ] });
  // A real review whose action was yesterday but which is confirmed only today.
  const review = new ReviewService(fixture.cardStore);
  at('2026-09-12T10:00:00+08:00');
  const occurrence = review.freeze(HOST, 'card:card-e', {
    id: 'occ-1', occurredAt: '2026-09-11T09:00:00+08:00', timeZone: 'Asia/Shanghai', order: null,
  });
  await review.record(learned('rev-1'), 'card:card-e', { occurrence, mark: '牢', channel: '课外', note: '', basis: [] });
  at('2026-09-12T20:00:00+08:00');
  return fixture;
}

const kinds = (day: { activity: readonly { kind: string }[] }): string[] => day.activity.map(item => item.kind);

test('readDay 聚合真实活动与原安排，未学卡与知识不计 due，已学卡按当日去重', async () => {
  const fixture = await seed();
  const today = fixture.projection.readDay(READ, { date: '2026-09-12', timeZone: 'Asia/Shanghai' });
  expect(CalendarDaySchema.parse(today)).toEqual(today);
  expect(today.relation).toBe('today');
  expect(today.asOf).toBe('2026-09-12T20:00:00+08:00');
  // B is due exactly today; C is later; A was never learned; D is overdue but not due today.
  expect(today.dueCount).toBe(1);
  expect(today.overdueCount).toBe(1);
  // Two planned lessons today, read from the route's own dates.
  expect(today.scheduledCourses).toEqual([{ target: routeNodeRef('p-a'), title: '课一' }, { target: routeNodeRef('p-b'), title: '课二' }]);
  expect(kinds(today)).toContain('plan');
  expect(today.activity.filter(item => item.kind === 'card').map(item => item.title)).toEqual(['E 晚确认']);
  expect(fixture.projection.readDay(READ, { date: '2026-09-12', timeZone: 'Asia/Shanghai' }).activity.some(item => item.kind === 'review')).toBe(false);

  // The past day really opened a lesson, and its own card count is that day's, not today's.
  const past = fixture.projection.readDay(READ, { date: '2026-09-10', timeZone: 'Asia/Shanghai' });
  expect(past.relation).toBe('past');
  expect(past.activity.map(item => item.kind).sort()).toEqual(['course', 'plan']);
  expect(past.activity.find(item => item.kind === 'course')).toMatchObject({ title: '已开课', target: routeNodeRef('p-open') });
  // Opening a lesson records activity without erasing its original arrangement.
  expect(past.scheduledCourses).toEqual([{ target: routeNodeRef('p-open'), title: '已开课', opened: true }]);

  // The future shows the current schedule's prediction and the arranged lessons.
  const future = fixture.projection.readDay(READ, { date: '2026-09-13', timeZone: 'Asia/Shanghai' });
  expect(future.relation).toBe('future');
  expect(future.dueCount).toBe(1); // C falls due on its own day
  expect(future.scheduledCourses).toEqual([]);
});

test('free campaigns select actual due cards within the daily quota without rewriting their learning history', async () => {
  const fixture = await seed();
  const plan = await fixture.planStore.create(write('free-campaign'), 'free-campaign', {
    kind: 'campaign', title: '每日复习', learningSetRef: null, tags: [],
    cards: ['card:card-a', 'card:card-b', 'card:card-over'], dailyCount: 1,
    start: '2026-09-10', end: '2026-09-14', schedule: [],
  });
  const before = fixture.cardStore.list(READ);
  const today = fixture.projection.readDay(READ, { date: '2026-09-12', timeZone: 'Asia/Shanghai' });
  expect(today.activity.find(item => item.target === plan.ref)?.sourceRefs).toEqual([plan.ref, 'card:card-over']);
  expect(fixture.projection.readDay(READ, { date: '2026-09-09', timeZone: 'Asia/Shanghai' }).activity.some(item => item.target === plan.ref)).toBe(false);
  // Historical free-choice candidates were not stored; the projection must not invent them.
  expect(fixture.projection.readDay(READ, { date: '2026-09-10', timeZone: 'Asia/Shanghai' }).activity.find(item => item.target === plan.ref)?.sourceRefs).toEqual([plan.ref]);
  expect(fixture.cardStore.list(READ)).toEqual(before);
});

test('explicit campaign days override the quota and unscheduled days are not silently filled', async () => {
  const fixture = await seed();
  const plan = await fixture.planStore.create(write('explicit-campaign'), 'explicit-campaign', {
    kind: 'campaign', title: '手排复习', learningSetRef: null, tags: [], cards: [], dailyCount: 1,
    start: '2026-09-12', end: '2026-09-14', schedule: [{ date: '2026-09-12', cards: ['card:card-b', 'card:card-over'] }],
  });
  expect(fixture.projection.readDay(READ, { date: '2026-09-12', timeZone: 'Asia/Shanghai' }).activity.find(item => item.target === plan.ref)?.sourceRefs)
    .toEqual([plan.ref, 'card:card-b', 'card:card-over']);
  expect(fixture.projection.readDay(READ, { date: '2026-09-13', timeZone: 'Asia/Shanghai' }).activity.some(item => item.target === plan.ref)).toBe(false);
});

test('晚确认的复习按 occurredAt 落在旧日，不增加今天的复习数', async () => {
  const fixture = await seed();
  const yesterday = fixture.projection.readDay(READ, { date: '2026-09-11', timeZone: 'Asia/Shanghai' });
  expect(yesterday.activity.filter(item => item.kind === 'review').map(item => item.title)).toEqual(['E 晚确认']);
  // D's own due date is that day, so it is due then and not yet overdue.
  expect(yesterday.dueCount).toBe(1);
  expect(yesterday.overdueCount).toBe(0);
  // The card really saved today, so the save is today's activity — the review is not.
  const today = fixture.projection.readDay(READ, { date: '2026-09-12', timeZone: 'Asia/Shanghai' });
  expect(today.activity.filter(item => item.kind === 'review')).toEqual([]);
  const history = fixture.cardStore.read(READ, 'card:card-e').data.history;
  expect(history).toHaveLength(1);
  expect(history[0]!.occurrence.occurredAt).toBe('2026-09-11T09:00:00+08:00');
});

test('日期筛选只改可见结果：祖先算上下文不算命中，清除恢复原图且不写任何关系', async () => {
  const fixture = await seed();
  const before = fixture.routeStore.read(READ, ROUTE_REF).data;
  const route = { ref: ROUTE_REF, version: fixture.routeStore.read(READ, ROUTE_REF).version, nodes: before.nodes, layout: before.layout };

  const filtered = fixture.projection.filterRoadmap(READ, { from: '2026-09-12', to: '2026-09-12', timeZone: 'Asia/Shanghai' });
  expect(filtered.matched).toEqual([routeNodeRef('p-a'), routeNodeRef('p-b')]);
  expect(filtered.context).toEqual([routeNodeRef('p-root')]);
  // An ancestor is context, never a match, and an out-of-range sibling is simply absent.
  expect(filtered.matched).not.toContain(routeNodeRef('p-root'));
  expect(filtered.matched).not.toContain(routeNodeRef('p-old'));

  const cleared = fixture.projection.filterRoadmap(READ, null);
  expect(cleared).toEqual({ matched: ['p-root', 'p-a', 'p-b', 'p-old', 'p-open'].map(routeNodeRef), context: [] });
  // Pure narrowing: mounts, dates and inheritance are byte-for-byte the stored row.
  expect(fixture.routeStore.read(READ, ROUTE_REF).data).toEqual(before);
  expect(filterRoadmap(route, null).matched).toEqual(cleared.matched);
});

test('日历与日报同一份 readDay；配置/定时/重放只动设置行，不写学习事实', async () => {
  const fixture = await seed();
  // The honest default: off, this Host's zone, and no hour chosen for the student.
  expect(fixture.reports.readSettings(READ)).toEqual({ enabled: false, timeZone: 'Asia/Shanghai' });
  await expect(fixture.reports.configure(write('cfg-0'), { enabled: true })).rejects.toMatchObject({ code: 'daily_report_time_required' });

  const settings = await fixture.reports.configure(write('cfg-1'), { enabled: true, localTime: '21:00' });
  expect(settings).toEqual({ enabled: true, timeZone: 'Asia/Shanghai', localTime: '21:00' });
  // One minute before vs at the configured local time.
  expect(dueRun(settings, '2026-09-12T20:59:00+08:00')).toBeNull();
  expect(dueRun(settings, '2026-09-12T21:00:00+08:00')).toEqual({ date: '2026-09-12', timeZone: 'Asia/Shanghai' });

  const query = { date: '2026-09-12', timeZone: 'Asia/Shanghai' };
  const day = fixture.projection.readDay(READ, query);
  // The report is the same day plus the instant it was rendered, never a second query.
  expect((await fixture.reports.readReport(READ, query)).day).toEqual(day);

  // A repeat callback after a real success does not generate again, and no learning fact moves.
  const cardsBefore = fixture.cardStore.list(READ);
  const routeBefore = fixture.routeStore.read(READ, ROUTE_REF);
  at('2026-09-12T21:05:00+08:00');
  await fixture.reports.markGenerated(learned('gen-1'), { date: '2026-09-12', timeZone: 'Asia/Shanghai' });
  expect(dueRun(fixture.reports.readSettings(READ), '2026-09-12T21:06:00+08:00')).toBeNull();
  expect(fixture.cardStore.list(READ)).toEqual(cardsBefore);
  expect(fixture.routeStore.read(READ, ROUTE_REF)).toEqual(routeBefore);

  // Disabling stops it; another zone asks its own local hour.
  expect(dueRun(await fixture.reports.configure(write('cfg-2'), { enabled: false }), '2026-09-12T21:07:00+08:00')).toBeNull();
  const newYork = await fixture.reports.configure(write('cfg-3'), { enabled: true, timeZone: 'America/New_York', localTime: '21:00' });
  expect(dueRun(newYork, '2026-09-12T20:00:00-04:00')).toBeNull();
  expect(dueRun(newYork, '2026-09-12T21:00:00-04:00')).toEqual({ date: '2026-09-12', timeZone: 'America/New_York' });
  // The same wall time resolves to the zone's own offset, across a DST change.
  expect(zonedTimeToInstant('2026-09-12', '21:00', 'America/New_York')).toBe('2026-09-13T01:00:00.000Z');
  expect(zonedTimeToInstant('2026-11-01', '21:00', 'America/New_York')).toBe('2026-11-02T02:00:00.000Z');
  // Marking a day does not make midnight roll into the next day.
  expect(zonedTimeToInstant('2026-09-12', '00:00', 'Asia/Shanghai')).toBe('2026-09-11T16:00:00.000Z');
});

test('读取失败如实抛出，不把不可用写成零活动', async () => {
  const fixture = await seed();
  const boom = new Error('ledger_unavailable');
  const broken = new CalendarProjection(
    { ...fixture.readers, cards: { list: () => { throw boom; } } }, clock);
  expect(() => broken.readDay(READ, { date: '2026-09-12', timeZone: 'Asia/Shanghai' })).toThrow('ledger_unavailable');
  const brokenReport = new DailyReportService(fixture.reportStore, { readDay: () => { throw boom; } }, clock);
  await expect(brokenReport.readReport(READ, { date: '2026-09-12', timeZone: 'Asia/Shanghai' })).rejects.toThrow('ledger_unavailable');
  // A bad zone is refused, not silently treated as UTC.
  expect(() => readDay({ date: '2026-09-12', timeZone: 'Not/AZone' }, now, { cards: [], plans: [], route: { ref: ROUTE_REF, version: 0, nodes: [], layout: [] }, saves: [] }))
    .toThrow(/day_time_zone_invalid/);
});

test('清掉本地时间真的删除字段，启用状态不允许没有钟点', async () => {
  const fixture = await seed();
  await fixture.reports.configure(write('cfg-1'), { enabled: true, localTime: '21:00' });
  // The hour is still required while the report is enabled.
  await expect(fixture.reports.configure(write('cfg-2'), { localTime: null }))
    .rejects.toMatchObject({ code: 'daily_report_time_required' });
  const off = await fixture.reports.configure(write('cfg-3'), { enabled: false, localTime: null });
  expect(off).toEqual({ enabled: false, timeZone: 'Asia/Shanghai' });
  expect('localTime' in off).toBe(false);
  // The stored row really dropped the key instead of keeping the old hour.
  expect(Object.prototype.hasOwnProperty.call(fixture.reportStore.read(READ, DAILY_REPORT_REF).data, 'localTime')).toBe(false);
  expect(dueRun(off, '2026-09-12T21:00:00+08:00')).toBeNull();
});

test('本次配置只合并自己点名的字段，并发写别的字段不被覆盖', async () => {
  const fixture = await seed();
  await fixture.reports.configure(write('cfg-1'), { enabled: true, localTime: '21:00' });
  // Force the exact window: another writer lands its change after the caller's
  // snapshot but before this queued write. Only the store is wrapped — it still
  // delegates every call to the real record store; the order is scripted.
  let raced = false;
  const racing: DailyReportStore = {
    workspaceId: fixture.reportStore.workspaceId,
    read: (ctx, ref, revision) => fixture.reportStore.read(ctx, ref, revision),
    create: (ctx, id, input) => fixture.reportStore.create(ctx, id, input),
    updateCurrent: async (ctx, ref, input, transform) => {
      if (!raced) {
        raced = true;
        await fixture.reportStore.updateCurrent(write('concurrent'), DAILY_REPORT_REF, { concurrent: true },
          row => ({ ...row, lastGenerated: { date: '2026-09-11', timeZone: 'Asia/Shanghai', at: '2026-09-11T21:00:00+08:00' } }));
      }
      return fixture.reportStore.updateCurrent(ctx, ref, input, transform);
    },
  };
  const reports = new DailyReportService(racing, fixture.projection, clock);
  await reports.configure(write('cfg-2'), { enabled: false });
  const after = fixture.reports.readSettings(READ);
  expect(after.enabled).toBe(false);
  expect(after.localTime).toBe('21:00'); // named by neither patch, so it stays
  expect(after.lastGenerated).toMatchObject({ date: '2026-09-11', timeZone: 'Asia/Shanghai' });
});
