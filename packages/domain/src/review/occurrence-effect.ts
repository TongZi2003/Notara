import { LadderSchema, ReviewOccurrenceSchema, ReviewMarkSchema, ReviewScheduleSchema, type ReviewEffect, type ReviewHistory,
  type ReviewMark, type ReviewOccurrence, type ReviewSchedule } from '@studyforge/contracts/reviews';
import type { VersionToken } from '@studyforge/contracts';
import { addDays, scheduleStep } from './schedule-step.ts';

/** The local civil day of the original action, independent of confirmation time or DST hours. */
export function occurrenceDay(occurrence: ReviewOccurrence): string {
  ReviewOccurrenceSchema.parse(occurrence);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: occurrence.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(occurrence.occurredAt));
  const field = (type: string) => parts.find(part => part.type === type)!.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}
export interface OccurrenceState {
  schedule: ReviewSchedule | null;
  history: readonly ReviewHistory[];
  cardVersion: VersionToken;
  ladderVersion: VersionToken;
}
/** Late facts append history; only matching, newer evidence may replace the active schedule. */
export function occurrenceEffect(current: OccurrenceState, input: ReviewOccurrence, mark: ReviewMark, steps: readonly number[]): ReviewEffect {
  const occurrence = ReviewOccurrenceSchema.parse(input), ladder = LadderSchema.parse(steps);
  ReviewMarkSchema.parse(mark);
  const schedule = current.schedule === null ? null : ReviewScheduleSchema.parse(current.schedule);
  if (schedule === null && current.history.length) throw new Error('schedule_missing_with_review_history');
  const prior = current.history.find(entry => entry.occurrence.id === occurrence.id);
  if (prior) {
    if (prior.mark !== mark) throw new Error('same_occurrence_requires_correction');
    return { mode: 'duplicate', lastAccessed: schedule?.lastAccessed ?? null, nextDue: schedule?.nextDue ?? null, countDelta: 0 };
  }
  const countDelta = mark === '初' || mark === '涉' ? 0 : 1;
  const day = occurrenceDay(occurrence);
  const matching = current.cardVersion === occurrence.cardVersion && current.ladderVersion === occurrence.ladderVersion;
  if (schedule !== null) {
    const latest = current.history.findLast(entry => entry.mode !== 'history_only');
    let newer = day > schedule.lastAccessed;
    if (latest) {
      const a = Date.parse(occurrence.occurredAt), b = Date.parse(latest.occurrence.occurredAt);
      newer = a > b || (a === b && occurrence.order !== null && latest.occurrence.order !== null
        && occurrence.order.sessionId === latest.occurrence.order.sessionId && occurrence.order.sequence > latest.occurrence.order.sequence);
    }
    if (!matching || !newer) return { mode: 'history_only', lastAccessed: schedule.lastAccessed, nextDue: schedule.nextDue, countDelta };
  }
  if (schedule === null && !matching) return { mode: 'initialize', lastAccessed: day, nextDue: addDays(day, ladder[0]!), countDelta };
  const interval = scheduleStep(schedule?.lastAccessed ?? addDays(day, -1), schedule?.nextDue ?? day, day, mark, ladder);
  return { mode: 'advance', lastAccessed: day, nextDue: addDays(day, interval), countDelta };
}
