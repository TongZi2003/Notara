import { DaySchema, LadderSchema, ReviewMarkSchema, type ReviewMark } from '@studyforge/contracts/reviews';

export function daysBetween(first: string, second: string): number {
  return (Date.parse(DaySchema.parse(second) + 'T00:00:00Z') - Date.parse(DaySchema.parse(first) + 'T00:00:00Z')) / 86_400_000;
}
export function addDays(day: string, count: number): string {
  const value = new Date(Date.parse(DaySchema.parse(day) + 'T00:00:00Z') + count * 86_400_000);
  if (!Number.isFinite(value.getTime())) throw new Error('review_date_out_of_range');
  return DaySchema.parse(value.toISOString().slice(0, 10));
}

/** Same arithmetic as B@3831987 review_evidence.schedule_step, over civil days. */
export function scheduleStep(lastAccessed: string, nextDue: string, day: string, mark: ReviewMark, steps: readonly number[]): number {
  const ladder = LadderSchema.parse(steps); ReviewMarkSchema.parse(mark);
  const level = (days: number): number => { let index = 0; for (let i = 0; i < ladder.length; i++) if (ladder[i]! <= Math.max(1, days)) index = i; return index; };
  const interval = Math.max(1, daysBetween(lastAccessed, nextDue)), actual = daysBetween(lastAccessed, day);
  const current = level(interval);
  if (mark === '牢' && actual >= interval) return Math.max(ladder[Math.min(current + 1, ladder.length - 1)]!, ladder[Math.min(level(actual) + 1, ladder.length - 1)]!);
  if (mark === '牢' || mark === '糊' || mark === '涉') return ladder[current]!;
  return ladder[0]!;
}
