import type { Context } from '@deepseek-ai/cordis';
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import { deriveTurnTokenUsage, type TurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client';
import type {} from '@deepseek-ai/dsh-token-meter';
import type { CourseUsage } from '@studyforge/contracts/courses';

/** Add coverage information to the native full-log fold; do not recount tokens from a UI window. */
export async function nativeCourseUsage(ctx: Context, sessionId: string): Promise<CourseUsage> {
  const observation = await ctx.sessionQuery.observeSession(SessionId(sessionId));
  try {
    const measured: TurnTokenUsage[] = [];
    let current: SessionEvent[] | undefined, completedTurns = 0;
    for (const event of observation.events) {
      if (event.type === 'turn/start') current = [];
      current?.push(event);
      if (event.type === 'turn/end' && current) {
        completedTurns += 1;
        const usage = deriveTurnTokenUsage(current);
        if (usage) measured.push(usage);
        current = undefined;
      }
    }
    const exact = completedTurns > 0 && measured.length === completedTurns;
    const values = observation.projections?.values;
    return {
      totals: completedTurns > 0 ? values?.tokenUsage ?? null : null,
      context: values?.contextPressure ?? null, breakdown: values?.contextBreakdown ?? null,
      completedTurns, measuredTurns: measured.length, exact,
      cacheReadReported: exact && measured.every(usage => usage.cacheReadTokens !== undefined),
      cacheWriteReported: exact && measured.every(usage => usage.cacheWriteTokens !== undefined),
    };
  } finally { observation[Symbol.dispose](); }
}
