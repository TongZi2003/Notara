/**
 * P6.5 daily report: one stored setting plus the calendar's own day (plan §P6.5,
 * CONTRACTS.md §11).
 *
 * The daily report owns no facts and no second query. It is a thin, read-only
 * consumer of the single {@link CalendarProjection} day, wrapped with the instant
 * it was rendered; a report that cannot read the day throws instead of
 * presenting an empty one. Its only persisted state is the student's own
 * setting — enabled, zone, local time, and the last time it really generated —
 * in one native record. When that time arrives the Host's `ctx.timeout` calls
 * {@link DailyReportService.dueRun}; this module never registers a timer, never
 * authors a scheduler, and never triggers a model, a lesson close, a handoff or
 * a learning-record write.
 */
import { TimestampSchema, type HostContext, type MutationContext } from '@studyforge/contracts';
import { DaySchema } from '@studyforge/contracts/reviews';
import type { CalendarDay, DailyReport, DailyReportSettings, DateQuery } from '@studyforge/contracts/calendar';
import { DailyReportSettingsPatchSchema as SettingsPatchSchema, type DailyReportSettingsPatch } from '@studyforge/contracts/calendar';
export type { DailyReportSettingsPatch } from '@studyforge/contracts/calendar';
import { isValidIanaTimeZone, type Clock } from '../clock.ts';
import { RecordError, type Saved } from '../storage/record-store.ts';
import { civilDay } from './read-day.ts';

/** The record kind and the one row the daily report setting lives in. Kind must
 * satisfy both the native collection and `objectRef` grammars, so it is one word. */
export const DAILY_REPORT_KIND = 'dailyreport';
export const DAILY_REPORT_ID = 'settings';
export const DAILY_REPORT_REF = `${DAILY_REPORT_KIND}:${DAILY_REPORT_ID}`;

/** The record surface this service needs; one native `RecordStore` satisfies it. */
export interface DailyReportStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<DailyReportSettings>;
  create(ctx: MutationContext, id: string, input: unknown, fingerprintInput?: unknown): Promise<Saved<DailyReportSettings>>;
  updateCurrent(ctx: Omit<MutationContext, 'expectedVersion'>, ref: string, input: unknown,
    transform: (current: DailyReportSettings) => unknown): Promise<Saved<DailyReportSettings>>;
}

/** The one real day reader; a `CalendarProjection` is the production one. */
export interface DayQueryReader { readDay(ctx: HostContext, query: DateQuery): CalendarDay | Promise<CalendarDay>; }

const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DailyReportService {
  private readonly records: DailyReportStore;
  private readonly days: DayQueryReader;
  private readonly clock: Clock;
  constructor(records: DailyReportStore, days: DayQueryReader, clock: Clock) {
    this.records = records; this.days = days; this.clock = clock;
  }

  /** The student's setting, or the honest default (off, this Host's zone, no hour chosen). */
  readSettings(ctx: HostContext): DailyReportSettings {
    try { return this.records.read(ctx, DAILY_REPORT_REF).data; }
    catch (error) {
      if (codeOf(error) !== 'record_missing') throw error;
      return { enabled: false, timeZone: this.clock.timeZone };
    }
  }

  /**
   * Apply one confirmed setting change. `localTime: null` clears the hour;
   * enabling without a concrete hour is refused rather than defaulted.
   *
   * Validation and merging happen against the row this write really finds,
   * inside the native queue — never against a snapshot read outside it — so a
   * concurrent change to a field this patch does not name is preserved, and an
   * explicit `localTime: null` really removes the stored hour instead of
   * leaving the old one behind.
   * @throws RecordError `daily_report_time_required` / `daily_report_time_zone_invalid` /
   *   `daily_report_time_invalid`.
   */
  async configure(ctx: MutationContext, patch: unknown): Promise<DailyReportSettings> {
    const change = SettingsPatchSchema.parse(patch);
    return this.write(ctx, change, current => mergeSettings(current, change));
  }

  /** The same day the calendar shows, wrapped with the instant it was rendered. Never a second query. */
  async readReport(ctx: HostContext, query: DateQuery): Promise<DailyReport> {
    return { day: await this.days.readDay(ctx, query), generatedAt: this.clock.now() };
  }

  /** Record one real successful generation; a failed run never reaches this. */
  async markGenerated(ctx: MutationContext, query: DateQuery): Promise<DailyReportSettings> {
    const date = DaySchema.parse(query.date);
    if (!isValidIanaTimeZone(query.timeZone)) throw new RecordError('daily_report_time_zone_invalid');
    const at = this.clock.now();
    return this.write(ctx, { generated: { date, timeZone: query.timeZone } }, current => ({
      ...current, lastGenerated: { date, timeZone: query.timeZone, at },
    }));
  }

  private async write(ctx: MutationContext, input: unknown, transform: (current: DailyReportSettings) => DailyReportSettings): Promise<DailyReportSettings> {
    const { expectedVersion: _ignored, ...derived } = ctx;
    const existing = this.optional(ctx);
    if (existing === undefined) {
      const next = transform({ enabled: false, timeZone: this.clock.timeZone });
      return (await this.records.create(derived, DAILY_REPORT_ID, next, input)).data;
    }
    return (await this.records.updateCurrent(derived, DAILY_REPORT_REF, input, current => transform(current))).data;
  }

  private optional(ctx: HostContext): Saved<DailyReportSettings> | undefined {
    try { return this.records.read(ctx, DAILY_REPORT_REF); }
    catch (error) { if (codeOf(error) === 'record_missing') return undefined; throw error; }
  }
}

/**
 * Whether the configured local time has arrived for the current civil day and
 * has not generated yet. Pure, so the Host's timer only has to ask — the
 * `ctx.timeout` lease owns unload and this module owns no scheduler.
 * @returns the exact query to read, or null when nothing is due.
 */
export function dueRun(settings: DailyReportSettings, asOf: string): DateQuery | null {
  if (!settings.enabled || settings.localTime === undefined) return null;
  if (!isValidIanaTimeZone(settings.timeZone)) throw new RecordError('daily_report_time_zone_invalid');
  const at = TimestampSchema.parse(asOf);
  const date = civilDay(at, settings.timeZone);
  const scheduled = zonedTimeToInstant(date, settings.localTime, settings.timeZone);
  if (Date.parse(at) < Date.parse(scheduled)) return null;
  if (settings.lastGenerated !== undefined && settings.lastGenerated.timeZone === settings.timeZone && settings.lastGenerated.date === date) return null;
  return { date, timeZone: settings.timeZone };
}

/**
 * The real instant of one local wall time in one zone. Two offset passes settle
 * a daylight-saving change, so the day boundary is the zone's own, never a
 * fixed 24-hour arithmetic.
 */
export function zonedTimeToInstant(date: string, localTime: string, timeZone: string): string {
  const day = DaySchema.parse(date);
  if (!LOCAL_TIME.test(localTime)) throw new RecordError('daily_report_time_invalid');
  if (!isValidIanaTimeZone(timeZone)) throw new RecordError('daily_report_time_zone_invalid');
  const [year, month, dayOfMonth] = day.split('-').map(Number) as [number, number, number];
  const [hour, minute] = localTime.split(':').map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, dayOfMonth, hour, minute, 0, 0);
  let instant = wall - offsetMs(wall, timeZone);
  instant = wall - offsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/** The zone's offset at one instant, read back from the zone itself. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(instant));
  const field = (type: string): number => Number(parts.find(part => part.type === type)!.value);
  return Date.UTC(field('year'), field('month') - 1, field('day'), field('hour') % 24, field('minute'), field('second')) - instant;
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/**
 * One confirmed patch applied to the exact current row. An omitted field keeps
 * what it had; `localTime: null` is the explicit clear, so the key is removed
 * rather than left holding the previous hour. Only the fields this patch really
 * names move, which is what keeps a concurrent edit to another field intact.
 */
function mergeSettings(current: DailyReportSettings, change: DailyReportSettingsPatch): DailyReportSettings {
  const timeZone = change.timeZone ?? current.timeZone;
  if (!isValidIanaTimeZone(timeZone)) throw new RecordError('daily_report_time_zone_invalid');
  const enabled = change.enabled ?? current.enabled;
  const localTime = 'localTime' in change ? change.localTime ?? undefined : current.localTime;
  if (localTime !== undefined && !LOCAL_TIME.test(localTime)) throw new RecordError('daily_report_time_invalid');
  if (enabled && localTime === undefined) throw new RecordError('daily_report_time_required');
  const next: DailyReportSettings = { ...current, enabled, timeZone };
  if (localTime === undefined) delete next.localTime; else next.localTime = localTime;
  return next;
}
