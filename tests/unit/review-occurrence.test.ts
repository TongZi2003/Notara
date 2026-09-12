import { expect, test } from 'vitest';
import { DEFAULT_LADDER, type ReviewHistory, type ReviewOccurrence } from '../../packages/contracts/src/reviews.ts';
import { occurrenceDay, occurrenceEffect, type OccurrenceState } from '../../packages/domain/src/review/occurrence-effect.ts';
import { scheduleStep } from '../../packages/domain/src/review/schedule-step.ts';

// Expected values are frozen from B@3831987 review_evidence.schedule_step,
// independently of this implementation (3-day early/due/10-day-late examples).
test.each([
  ['2026-09-02', '牢', 3], ['2026-09-04', '牢', 7], ['2026-09-11', '牢', 14],
  ['2026-09-11', '糊', 3], ['2026-09-11', '涉', 3], ['2026-09-11', '忘', 1], ['2026-09-11', '初', 1],
] as const)('3-day ladder on %s with %s schedules %i days', (day, mark, expected) => {
  expect(scheduleStep('2026-09-01', '2026-09-04', day, mark, DEFAULT_LADDER)).toBe(expected);
});
test('the last ladder rung stays capped and malformed ladders are refused', () => {
  expect(scheduleStep('2026-01-01', '2026-05-01', '2026-09-01', '牢', DEFAULT_LADDER)).toBe(120);
  for (const ladder of [[], [2, 4], [1, 3, 3], [1, 7, 3]]) expect(() => scheduleStep('2026-09-01', '2026-09-04', '2026-09-04', '牢', ladder)).toThrow();
});
const occurrence = (patch: Partial<ReviewOccurrence> = {}): ReviewOccurrence => ({
  id: 'answer-b', occurredAt: '2026-09-04T01:00:00Z', timeZone: 'Asia/Shanghai',
  order: { sessionId: 'lesson', sequence: 20 }, cardVersion: 4, ladderVersion: 'ladder-a', ...patch,
});
const entry = (evidence: ReviewOccurrence, mark: ReviewHistory['mark'] = '牢', mode: ReviewHistory['mode'] = 'advance'): ReviewHistory => ({ occurrence: evidence, mark, channel: '课内', note: '独立写出', basis: [], mode });
const active = (): OccurrenceState => ({
  schedule: { lastAccessed: '2026-09-01', nextDue: '2026-09-04', reviewCount: 2 }, cardVersion: 4, ladderVersion: 'ladder-a',
  history: [entry(occurrence({ id: 'answer-a', occurredAt: '2026-09-01T01:00:00Z', order: { sessionId: 'lesson', sequence: 10 } }))],
});

test('a matching new occurrence advances at its original day, with no confirmation date input', () => {
  expect(occurrenceEffect(active(), occurrence(), '牢', DEFAULT_LADDER)).toEqual({ mode: 'advance', lastAccessed: '2026-09-04', nextDue: '2026-09-11', countDelta: 1 });
});
test.each(['card', 'ladder', 'older'] as const)('%s mismatch adds history without changing the newer due date', cause => {
  const current = active();
  if (cause === 'card') current.cardVersion = 5;
  if (cause === 'ladder') current.ladderVersion = 'ladder-b';
  const fact = cause === 'older' ? occurrence({ occurredAt: '2026-08-30T01:00:00Z' }) : occurrence();
  expect(occurrenceEffect(current, fact, '忘', DEFAULT_LADDER)).toEqual({ mode: 'history_only', lastAccessed: '2026-09-01', nextDue: '2026-09-04', countDelta: 1 });
});
test.each(['初', '涉'] as const)('%s records without increasing review count', mark => {
  expect(occurrenceEffect(active(), occurrence(), mark, DEFAULT_LADDER).countDelta).toBe(0);
});
test('replaying an occurrence is one effect, while regrading it requires an explicit correction', () => {
  const current = active(); current.history = [...current.history, entry(occurrence(), '糊', 'history_only')];
  expect(occurrenceEffect(current, occurrence(), '糊', DEFAULT_LADDER)).toEqual({ mode: 'duplicate', lastAccessed: '2026-09-01', nextDue: '2026-09-04', countDelta: 0 });
  expect(() => occurrenceEffect(current, occurrence(), '牢', DEFAULT_LADDER)).toThrow('same_occurrence_requires_correction');
});
test('first study initializes conservatively after a content change, and creation alone has no schedule', () => {
  const current: OccurrenceState = { schedule: null, history: [], cardVersion: 5, ladderVersion: 'ladder-a' };
  expect(occurrenceEffect(current, occurrence(), '牢', DEFAULT_LADDER)).toEqual({ mode: 'initialize', lastAccessed: '2026-09-04', nextDue: '2026-09-05', countDelta: 1 });
  expect(current.schedule).toBeNull(); // Projection has not written any fact.
  current.cardVersion = 4;
  expect(occurrenceEffect(current, occurrence(), '牢', DEFAULT_LADDER)).toEqual({ mode: 'advance', lastAccessed: '2026-09-04', nextDue: '2026-09-07', countDelta: 1 });
});
test('same-time order is usable only within the same native Session', () => {
  const current = active();
  const sameTime = '2026-09-01T01:00:00Z';
  expect(occurrenceEffect(current, occurrence({ occurredAt: sameTime, order: { sessionId: 'lesson', sequence: 11 } }), '牢', DEFAULT_LADDER).mode).toBe('advance');
  for (const order of [null, { sessionId: 'another', sequence: 99 }, { sessionId: 'lesson', sequence: 9 }]) {
    expect(occurrenceEffect(current, occurrence({ occurredAt: sameTime, order }), '牢', DEFAULT_LADDER).mode).toBe('history_only');
  }
  // A state with no comparable occurrence never guesses same-day ordering.
  current.history = [];
  expect(occurrenceEffect(current, occurrence({ occurredAt: '2026-09-01T23:00:00+08:00' }), '牢', DEFAULT_LADDER).mode).toBe('history_only');
});
test.each([
  ['2026-03-08T06:50:00Z', 'America/New_York', '2026-03-08', '2026-03-09'],
  ['2026-11-01T06:30:00Z', 'America/New_York', '2026-11-01', '2026-11-02'],
  ['2026-09-01T23:30:00Z', 'Asia/Shanghai', '2026-09-02', '2026-09-03'],
  ['2026-09-30T23:30:00Z', 'UTC', '2026-09-30', '2026-10-01'],
])('civil dates across timezone/DST: %s in %s', (occurredAt, timeZone, day, due) => {
  const fact = occurrence({ occurredAt, timeZone });
  expect(occurrenceDay(fact)).toBe(day);
  expect(occurrenceEffect({ schedule: null, history: [], cardVersion: 4, ladderVersion: 'ladder-a' }, fact, '初', DEFAULT_LADDER)).toMatchObject({ lastAccessed: day, nextDue: due, countDelta: 0 });
});
