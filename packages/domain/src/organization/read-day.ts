/**
 * P6.5 one read-only civil-day projection, shared by the calendar and the daily
 * report (plan §P6.5, CONTRACTS.md §11).
 *
 * There is exactly one answer to "what happened on this day": the calendar
 * screen and the daily report call the same function, so they can never drift.
 * Every input is a real one already kept by its owner — learned cards with their
 * own review schedule, review occurrences, plan lines, the route and its real
 * native session bindings, and the change rows a real save left behind. Nothing
 * here writes, starts a model call, closes a lesson or keeps a second activity
 * ledger; a read that fails throws instead of presenting an empty day.
 *
 * Three properties matter and are enforced here rather than by convention:
 *  - a review occurrence is placed on the civil day of its own `occurredAt` in
 *    its own frozen zone, never the day it was confirmed, so a late fact lands
 *    on the day it really happened;
 *  - due/overdue count learned cards only (`review` present). An unlearned card
 *    waits in the deck and a knowledge object never enters the due数 at all;
 *  - the classroom a row really belongs to stays the one `session:` ref inside
 *    its existing `sourceRefs` — the convention the calendar already reads. A
 *    record with no classroom keeps none, and none is ever inferred.
 *
 * The projection is pure over records the store already schema-validated; the
 * DTO shape (`CalendarDaySchema`) is validated at the Host boundary and by the
 * integration test against the same source schema.
 */
import { TimestampSchema, type HostContext } from '@studyforge/contracts';
import { DaySchema } from '@studyforge/contracts/reviews';
import type { CardRecord } from '@studyforge/contracts/cards';
import type { PlanView } from '@studyforge/contracts/plans';
import type { SetView } from '@studyforge/contracts/sets';
import { selectCardRows } from '../cards/card-service.ts';
import type { RouteView } from '@studyforge/contracts/routes';
import type { ActivityItem, CalendarDay, DateQuery, DaySave, RoadmapDateFilter, RoadmapFilterResult } from '@studyforge/contracts/calendar';
import { isValidIanaTimeZone, type Clock } from '../clock.ts';
import { objectRef } from '../ids.ts';
import { occurrenceDay } from '../review/occurrence-effect.ts';
import { RecordError, type Saved } from '../storage/record-store.ts';
import { ROUTE_KIND } from './route-service.ts';

/** The real inputs one day is projected from; each is the production reader's own output. */
export interface DayInputs {
  readonly cards: readonly Saved<CardRecord>[];
  readonly plans: readonly PlanView[];
  readonly route: RouteView;
  readonly saves: readonly DaySave[];
  readonly sets?: readonly SetView[];
}

/** The four read sides; real `RecordStore`/`PlanService`/`RouteService` satisfy them. */
export interface DayCardReader { list(ctx: HostContext): readonly Saved<CardRecord>[]; }
export interface DayPlanReader { list(ctx: HostContext): readonly PlanView[]; }
export interface DayRouteReader { read(ctx: HostContext): RouteView; }
export interface DaySaveReader { list(ctx: HostContext): readonly DaySave[]; }
export interface DayReaders {
  readonly cards: DayCardReader;
  readonly plans: DayPlanReader;
  readonly route: DayRouteReader;
  readonly saves: DaySaveReader;
  readonly sets?: { list(ctx: HostContext): readonly SetView[] };
}

/** The route node's own target: the planned lesson, not the whole axis. */
export function routeNodeRef(nodeId: string): string { return objectRef(ROUTE_KIND, nodeId); }

/** The civil day of one real instant in one zone; the day boundary follows the zone. */
export function civilDay(instant: string, timeZone: string): string {
  if (!isValidIanaTimeZone(timeZone)) throw new RecordError('day_time_zone_invalid');
  const at = new Date(TimestampSchema.parse(instant));
  if (!Number.isFinite(at.getTime())) throw new RecordError('day_instant_invalid');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const field = (type: string): string => parts.find(part => part.type === type)!.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

/**
 * Project one civil day from real inputs, without writing anything.
 * @throws RecordError `day_time_zone_invalid` / `day_instant_invalid` for a bad query.
 */
export function readDay(query: DateQuery, asOf: string, inputs: DayInputs): CalendarDay {
  const date = DaySchema.parse(query.date);
  if (!isValidIanaTimeZone(query.timeZone)) throw new RecordError('day_time_zone_invalid');
  const at = TimestampSchema.parse(asOf);
  const today = civilDay(at, query.timeZone);
  const relation: CalendarDay['relation'] = date < today ? 'past' : date > today ? 'future' : 'today';

  const activity: ActivityItem[] = [];
  const seen = new Set<string>();
  const push = (item: ActivityItem): void => {
    // The classroom is part of a row's identity: the same card really recorded
    // by two lessons on one day stays two rows, while one lesson's repeated
    // save of one object still collapses to one.
    const key = `${item.kind}\u0000${item.target ?? item.title}\u0000${classroomOf(item)}`;
    if (seen.has(key)) return;
    seen.add(key);
    activity.push(item);
  };

  // A review lands on the day of its own action, in the zone it was frozen in,
  // and keeps the classroom that really recorded it. Every occurrence of that
  // day is read on its own — never the first one found — so one card recorded
  // by two lessons stays two rows, and an 课外 record names no classroom.
  for (const card of [...inputs.cards].sort(byRef)) {
    for (const entry of card.data.history) {
      if (occurrenceDay(entry.occurrence) !== date) continue;
      push({ kind: 'review', title: card.data.content.title, target: card.ref,
        sourceRefs: [card.ref, ...sessionRef(entry.occurrence.order?.sessionId)] });
    }
  }

  // Real save operations: an object this day really wrote, in its own zone day,
  // carrying the classroom that wrote it whenever the store's own change row
  // named one. Every kind, not just a course row.
  for (const save of [...inputs.saves].sort(byTarget)) {
    if (civilDay(save.committedAt, query.timeZone) !== date) continue;
    push({ kind: save.kind, title: save.title, target: save.target, sourceRefs: saveRefs(save) });
  }

  // Original arrangements: the plan line this day was scheduled for.
  for (const plan of [...inputs.plans].sort(byRef)) {
    const content = plan.content;
    if (content.kind === 'book') {
      if (content.entries.some(entry => entry.date === date)) push({ kind: 'plan', title: content.title, target: plan.ref, sourceRefs: [plan.ref] });
      continue;
    }
    if (date < content.start || date > content.end) continue;
    if (content.schedule.length > 0) {
      // An explicit schedule is the complete arrangement, even when a day is
      // empty or exceeds the free-choice quota. Never auto-fill its gaps.
      const scheduled = content.schedule.find(day => day.date === date);
      if (scheduled) push({ kind: 'plan', title: content.title, target: plan.ref, sourceRefs: [plan.ref, ...scheduled.cards] });
      continue;
    }
    // With no explicit schedule, select at most dailyCount learned due cards
    // from the real pool. Past free-choice candidates cannot be reconstructed
    // from today's schedule; keep the original arrangement without inventing them.
    const candidates = relation === 'past' ? [] : selectCardRows(inputs.cards, {
      state: 'due', tags: content.tags,
      ...(content.learningSetRef ? { learningSetRef: content.learningSetRef } : {}),
    }, date, inputs.sets).filter(card => content.cards.length === 0 || content.cards.includes(card.ref)).slice(0, content.dailyCount);
    push({ kind: 'plan', title: content.title, target: plan.ref, sourceRefs: [plan.ref, ...candidates.map(card => card.ref)] });
  }

  // A lesson that really opened carries its native binding's own time and the
  // one native session it really opened.
  for (const node of [...inputs.route.nodes].sort(byNodeId)) {
    if (node.session === undefined) continue;
    if (civilDay(node.session.openedAt, query.timeZone) !== date) continue;
    const target = routeNodeRef(node.id);
    push({ kind: 'course', title: node.title, target, sourceRefs: [target, ...sessionRef(node.session.sessionId)] });
  }

  // Due/overdue: learned cards only, one row per card. Due is that same day,
  // overdue is strictly before it, so the two never double-count one card.
  const learned = inputs.cards.filter(card => card.data.review !== undefined);
  const due = new Set(learned.filter(card => card.data.review!.nextDue === date).map(card => card.ref));
  const overdue = new Set(learned.filter(card => card.data.review!.nextDue < date).map(card => card.ref));

  // Keep the original arrangement even after opening on another day. Opening is
  // a separate activity and must not erase what this date was arranged to hold.
  const scheduledCourses = [...inputs.route.nodes]
    .filter(node => node.date === date)
    .sort(byNodeId)
    .map(node => ({ target: routeNodeRef(node.id), title: node.title, ...(node.session ? { opened: true } : {}) }));

  return { date, timeZone: query.timeZone, relation, asOf: at, activity, dueCount: due.size, overdueCount: overdue.size, scheduledCourses };
}

/**
 * Narrow the roadmap to a date range without changing it. `matched` are the
 * nodes whose own date is inside the range; `context` are the ancestors shown to
 * keep the tree readable, and an ancestor is never counted as a match. A null
 * range is the cleared view: every node matches and the graph is exactly the
 * stored one (this function only reads, so mounts, inheritance and layout can
 * never move).
 */
export function filterRoadmap(route: RouteView, filter: RoadmapDateFilter | null): RoadmapFilterResult {
  const ref = (id: string): string => routeNodeRef(id);
  if (filter === null) return { matched: route.nodes.map(node => ref(node.id)), context: [] };
  const inside = new Set(route.nodes.filter(node => node.date !== undefined && node.date >= filter.from && node.date <= filter.to).map(node => node.id));
  const context = new Set<string>();
  for (const id of inside) {
    const seen = new Set<string>([id]);
    let parent = route.nodes.find(node => node.id === id)?.parent;
    while (parent !== undefined && !seen.has(parent)) {
      seen.add(parent);
      if (!inside.has(parent)) context.add(ref(parent));
      parent = route.nodes.find(node => node.id === parent)?.parent;
    }
  }
  return { matched: route.nodes.filter(node => inside.has(node.id)).map(node => ref(node.id)), context: [...context] };
}

/**
 * The injected-read port the Host wires to the real services. One `readDay`
 * answers both the calendar and the daily report; `filterRoadmap` only narrows
 * what is visible.
 */
export class CalendarProjection {
  private readonly readers: DayReaders;
  private readonly clock: Clock;
  constructor(readers: DayReaders, clock: Clock) { this.readers = readers; this.clock = clock; }

  /** One real read of the day; a failing reader throws rather than reporting an empty day. */
  readDay(ctx: HostContext, query: DateQuery): CalendarDay {
    return readDay(query, this.clock.now(), {
      cards: this.readers.cards.list(ctx),
      plans: this.readers.plans.list(ctx),
      route: this.readers.route.read(ctx),
      saves: this.readers.saves.list(ctx),
      ...(this.readers.sets ? { sets: this.readers.sets.list(ctx) } : {}),
    });
  }

  /** A cleared range is the whole stored tree again; nothing is rewritten either way. */
  filterRoadmap(ctx: HostContext, filter: RoadmapDateFilter | null): RoadmapFilterResult {
    return filterRoadmap(this.readers.route.read(ctx), filter);
  }
}

/** The classroom a projected row came from: the one `session:` ref its own refs carry. */
function classroomOf(item: ActivityItem): string {
  return item.sourceRefs.find(ref => ref.startsWith('session:')) ?? '';
}

/** The one classroom ref a record really names; an action outside a lesson names none. */
function sessionRef(sessionId: string | undefined): readonly string[] {
  return sessionId === undefined ? [] : ['session:' + sessionId];
}

/** One save's own refs: the object written plus the classroom that wrote it, listed once. */
function saveRefs(save: DaySave): string[] {
  const session = sessionRef(save.sessionId);
  return session.length === 0 || session[0] === save.target ? [save.target] : [save.target, ...session];
}

/** Same-layer order is by identity, so a projection never depends on store iteration order. */
function byRef(left: { readonly ref: string }, right: { readonly ref: string }): number {
  return left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0;
}
function byTarget(left: DaySave, right: DaySave): number {
  return left.target < right.target ? -1 : left.target > right.target ? 1 : 0;
}
function byNodeId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
