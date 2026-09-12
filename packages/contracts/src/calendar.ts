import { z } from 'zod';
import { EntityRefSchema, SessionIdSchema, TimestampSchema } from './core.ts';
import { DaySchema } from './reviews.ts';

/**
 * P6.5 calendar and daily report share one date projection (plan §P6.5,
 * CONTRACTS.md §11).
 *
 * There is exactly one query — one civil day in one IANA zone — and both the
 * calendar screen and the daily report present that same result. Nothing here
 * is a second ledger: an `ActivityItem` is a read-side projection of a real
 * time already kept by its owner (a review occurrence, a plan line, an opened
 * lesson, one real save), never a new row. The natural-day boundary follows the
 * zone, so it is never a fixed 24-hour offset and a late confirmation stays on
 * the day its own action really happened.
 */

/** A zone that really resolves; the day boundary is that zone's civil midnight. */
export const TimeZoneSchema = z.string().refine(value => {
  try { return !!value && !/^[+-]/.test(value) && !!new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); }
  catch { return false; }
}, 'invalid IANA time zone');
export type TimeZone = z.infer<typeof TimeZoneSchema>;

/** The one query calendar and daily report both answer. */
export const DateQuerySchema = z.object({ date: DaySchema, timeZone: TimeZoneSchema }).strict();
export type DateQuery = z.infer<typeof DateQuerySchema>;

/**
 * One real save operation, narrowed by the Host from its change rows. `kind` is
 * the target's own prefix (`card`/`knowledge`/`handoff`/…), never a UI label,
 * so a knowledge or handoff object is never dressed up as a card.
 */
export const DaySaveSchema = z.object({
  target: EntityRefSchema,
  kind: z.string().trim().min(1),
  title: z.string().trim().min(1),
  committedAt: TimestampSchema,
  sessionId: SessionIdSchema.optional(),
}).strict();
export type DaySave = z.infer<typeof DaySaveSchema>;

/** One projected calendar entry: `kind` is the owner's own word, `target` is the real object. */
export const ActivityItemSchema = z.object({
  kind: z.string().trim().min(1),
  title: z.string().trim().min(1),
  target: EntityRefSchema.optional(),
  sourceRefs: z.array(EntityRefSchema).default([]),
}).strict();
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const CalendarRelationSchema = z.enum(['past', 'today', 'future']);
export type CalendarRelation = z.infer<typeof CalendarRelationSchema>;

export const ScheduledCourseSchema = z.object({ target: EntityRefSchema, title: z.string().trim().min(1), opened: z.boolean().optional() }).strict();
export type ScheduledCourse = z.infer<typeof ScheduledCourseSchema>;

/**
 * One civil day, as the calendar and the daily report both read it. `asOf` is
 * the real query instant; `relation` follows the zone's own today, never the
 * Host's identity. `dueCount`/`overdueCount` count learned cards only — an
 * unlearned card or a knowledge object is never "due".
 */
export const CalendarDaySchema = z.object({
  date: DaySchema,
  timeZone: TimeZoneSchema,
  relation: CalendarRelationSchema,
  asOf: TimestampSchema,
  activity: z.array(ActivityItemSchema).default([]),
  dueCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  scheduledCourses: z.array(ScheduledCourseSchema).default([]),
}).strict();
export type CalendarDay = z.infer<typeof CalendarDaySchema>;

/** A closed civil-day range; the filter only changes what is visible. */
export const RoadmapDateFilterSchema = z.object({ from: DaySchema, to: DaySchema, timeZone: TimeZoneSchema }).strict()
  .refine(value => value.from <= value.to, 'range end precedes start');
export type RoadmapDateFilter = z.infer<typeof RoadmapDateFilterSchema>;

/** `matched` are the nodes inside the range; `context` are ancestors shown but not matched. */
export const RoadmapFilterResultSchema = z.object({
  matched: z.array(EntityRefSchema),
  context: z.array(EntityRefSchema),
}).strict();
export type RoadmapFilterResult = z.infer<typeof RoadmapFilterResultSchema>;

/**
 * The daily report's whole setting surface: whether it runs, in which zone, at
 * which local time, and when it last really generated. No default hour is
 * chosen for the student — `localTime` stays absent until they set one, and
 * enabling without a time is refused.
 */
export const DailyReportSettingsSchema = z.object({
  enabled: z.boolean(),
  timeZone: TimeZoneSchema,
  /** `HH:mm` local wall time; required once enabled. */
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  /** The last real successful generation: its civil day, zone and instant. */
  lastGenerated: z.object({ date: DaySchema, timeZone: TimeZoneSchema, at: TimestampSchema }).strict().optional(),
}).strict().refine(value => !value.enabled || value.localTime !== undefined, 'enabled daily report needs a local time');
export type DailyReportSettings = z.infer<typeof DailyReportSettingsSchema>;
export const DailyReportSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(), timeZone: TimeZoneSchema.optional(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
}).strict();
export type DailyReportSettingsPatch = z.infer<typeof DailyReportSettingsPatchSchema>;

/** The daily report is the shared day plus the instant it was rendered — nothing more. */
export const DailyReportSchema = z.object({ day: CalendarDaySchema, generatedAt: TimestampSchema }).strict();
export type DailyReport = z.infer<typeof DailyReportSchema>;
