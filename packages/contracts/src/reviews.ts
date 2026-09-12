import { z } from 'zod';
import { TimestampSchema, VersionTokenSchema } from './core.ts';
import { AdoptedBasisSchema } from './evidence.ts';

export const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'invalid calendar day');
export const LadderSchema = z.array(z.number().int().positive()).min(1).refine(values => values[0] === 1 && values.every((value, index) => index === 0 || value > values[index - 1]!), 'ladder must start at 1 and strictly increase');
export const DEFAULT_LADDER = [1, 3, 7, 14, 30, 60, 120] as const;
export const ReviewMarkSchema = z.enum(['忘', '糊', '牢', '涉', '初']);
export type ReviewMark = z.infer<typeof ReviewMarkSchema>;
export const ReviewChannelSchema = z.enum(['课内', '顺带', '课外']);
export type ReviewChannel = z.infer<typeof ReviewChannelSchema>;
/** Host-bound occurrence and frozen baselines; these are never model-authored fields. */
export const ReviewOccurrenceSchema = z.object({
  id: z.string().min(1), occurredAt: TimestampSchema,
  timeZone: z.string().refine(value => {
    try { return !!value && !/^[+-]/.test(value) && !!new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); } catch { return false; }
  }, 'invalid IANA time zone'),
  order: z.object({ sessionId: z.string().min(1), sequence: z.number().int().nonnegative() }).strict().nullable(),
  cardVersion: VersionTokenSchema, ladderVersion: VersionTokenSchema,
}).strict();
export type ReviewOccurrence = z.infer<typeof ReviewOccurrenceSchema>;
export const ReviewScheduleSchema = z.object({ lastAccessed: DaySchema, nextDue: DaySchema, reviewCount: z.number().int().nonnegative() }).strict()
  .refine(value => value.nextDue > value.lastAccessed, 'review due date must follow last access');
export type ReviewSchedule = z.infer<typeof ReviewScheduleSchema>;
export const ReviewHistorySchema = z.object({
  occurrence: ReviewOccurrenceSchema, mark: ReviewMarkSchema, channel: ReviewChannelSchema,
  note: z.string(), basis: AdoptedBasisSchema,
  mode: z.enum(['advance', 'history_only', 'initialize']),
}).strict();
export type ReviewHistory = z.infer<typeof ReviewHistorySchema>;
export interface ReviewEffect {
  mode: 'advance' | 'history_only' | 'initialize' | 'duplicate';
  lastAccessed: string | null;
  nextDue: string | null;
  countDelta: 0 | 1;
}
