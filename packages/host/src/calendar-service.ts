import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/cordis-plugin-timer';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { resolve } from 'node:path';
import type { HostContext, ObjectChange } from '@studyforge/contracts';
import { DateQuerySchema, CalendarDaySchema, DailyReportSettingsPatchSchema, RoadmapDateFilterSchema,
  type CalendarDay, type DateQuery, type DaySave, type DailyReport, type DailyReportSettings, type DailyReportSettingsPatch,
  type RoadmapDateFilter, type RoadmapFilterResult } from '@studyforge/contracts/calendar';
import { readDay, civilDay, filterRoadmap } from '@studyforge/domain/read-day';
import { DailyReportService, dueRun } from '@studyforge/domain/daily-report';
import { observeEvidence } from './evidence-query.ts';
import { studentContext } from './learning-service.ts';

export interface ChangeReader {
  kind: string;
  list(ctx: HostContext): readonly { ref: string; version: number; data: unknown }[];
  changes(ctx: HostContext, target: string): readonly ObjectChange[];
}
/** One async read gathers native participation and feeds the shared pure day projection. */
export class NativeCalendar {
  private readonly host: Context;
  private readonly changes: readonly ChangeReader[];
  constructor(host: Context, changes: readonly ChangeReader[]) { this.host = host; this.changes = changes; }
  async readDay(context: HostContext, query: DateQuery): Promise<CalendarDay> {
    const host = this.host, input = DateQuerySchema.parse(query), saves: DaySave[] = [];
    for (const source of this.changes) for (const row of source.list(context)) {
      const content = row.data as { title?: string; name?: string; content?: { title?: string } };
      const labels: Record<string, string> = { skeleton: '目录调整', memory: '学情更正', handoff: '课堂小结', course: '本课设置' };
      const title = content.content?.title ?? content.title ?? content.name ?? labels[source.kind] ?? '学习记录';
      for (const change of source.changes(context, row.ref)) saves.push({
        target: row.ref, kind: source.kind, title, committedAt: change.committedAt,
        ...(change.sessionId ? { sessionId: change.sessionId } : {}),
      });
    }
    const native = await host.sessionController.list({}, AbortSignal.timeout(20_000));
    for (const session of native.items) {
      if (session.origin === 'subagent' || session.blank || resolve(session.cwd ?? '') !== resolve(host.studyforgeAccess.root)) continue;
      if (session.projections?.values.agentPreset !== 'studyforge-learning') continue;
      const observed = await observeEvidence(host, session.sessionId);
      const action = observed.messages.find(message => message.role === 'student' && message.text.trim() !== '' && civilDay(message.occurredAt, input.timeZone) === input.date);
      if (!action) continue;
      const title = session.projections?.values.title;
      saves.push({ target: 'session:' + session.sessionId, kind: 'participation', title: typeof title === 'string' && title ? title : '一节课',
        committedAt: action.occurredAt, sessionId: session.sessionId });
    }
    return CalendarDaySchema.parse(readDay(input, host.studyforgeClock.now(), {
      cards: host.studyforgeCardRecords.list(context), plans: host.studyforgePlanService.list(context),
      route: host.studyforgeRouteService.read(context), saves,
    }));
  }
}
declare module '@deepseek-ai/cordis' { interface Context {
  studyforgeCalendar: StudyForgeCalendar; studyforgeCalendarReader: NativeCalendar; studyforgeDailyReports: DailyReportService;
} }
export class StudyForgeCalendar extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeCalendar'); }
  @Remote('day')
  async day(query: DateQuery): Promise<CalendarDay> { return this.ctx.studyforgeCalendarReader.readDay(await studentContext(this.ctx), DateQuerySchema.parse(query)); }
  @Remote('report')
  async report(query: DateQuery): Promise<DailyReport> { return this.ctx.studyforgeDailyReports.readReport(await studentContext(this.ctx), DateQuerySchema.parse(query)); }
  @Remote('settings')
  async settings(): Promise<DailyReportSettings> { return this.ctx.studyforgeDailyReports.readSettings(await studentContext(this.ctx)); }
  @Remote('configure')
  async configure(input: { operationId: string; patch: DailyReportSettingsPatch }): Promise<DailyReportSettings> {
    const parsed = z.object({ operationId: z.string().min(1), patch: DailyReportSettingsPatchSchema }).strict().parse(input);
    return this.ctx.studyforgeDailyReports.configure({ ...await studentContext(this.ctx), operationId: parsed.operationId }, parsed.patch);
  }
  @Remote('roadmap')
  async roadmap(input: { filter: RoadmapDateFilter | null }): Promise<RoadmapFilterResult> {
    const filter = RoadmapDateFilterSchema.nullable().parse(input.filter);
    return filterRoadmap(this.ctx.studyforgeRouteService.read(await studentContext(this.ctx)), filter);
  }
}
/** Native Cordis timer; clock-triggered report reads never call a model or close a lesson. */
export function installDailyReportTimer(host: Context): void {
  let disposed = false;
  host.effect(() => () => { disposed = true; });
  const tick = async (): Promise<void> => {
    const context: HostContext = { workspaceId: host.studyforgeAccess.workspaceId, purpose: 'learning', actor: 'system' };
    try {
      const query = dueRun(host.studyforgeDailyReports.readSettings(context), host.studyforgeClock.now());
      if (query) {
        await host.studyforgeDailyReports.readReport(context, query);
        if (!disposed) await host.studyforgeDailyReports.markGenerated({ ...context, operationId: 'daily-report:' + query.timeZone + ':' + query.date }, query);
      }
    } catch { /* A failed read leaves lastGenerated unchanged; the next timer may retry. */ }
    finally { if (!disposed) host.timeout(() => { void tick(); }, 30_000); }
  };
  host.timeout(() => { void tick(); }, 0);
}
