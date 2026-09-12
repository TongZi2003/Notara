import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CardRecordSchema, CardViewSchema, type CardRecord, type CardView } from '@studyforge/contracts/cards';
import { AdoptedBasisSchema, type HostContext, type MutationContext } from '@studyforge/contracts';
import { DEFAULT_LADDER, LadderSchema, ReviewOccurrenceSchema, ReviewMarkSchema, ReviewChannelSchema,
  type ReviewOccurrence, type ReviewEffect } from '@studyforge/contracts/reviews';
import type { RecordStore } from '../storage/record-store.ts';
import { RecordError } from '../storage/record-store.ts';
import { occurrenceEffect } from './occurrence-effect.ts';
import { addDays, daysBetween } from './schedule-step.ts';

const ReviewInputSchema = z.object({ occurrence: ReviewOccurrenceSchema, mark: ReviewMarkSchema, channel: ReviewChannelSchema,
  note: z.string(), basis: AdoptedBasisSchema }).strict();
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
export interface ReviewResult { card: CardView; mode: ReviewEffect['mode']; }
export interface ReviewLadder { steps: readonly number[]; version: string; }
export type LadderReader = (ctx: HostContext, ref: string) => ReviewLadder;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => JSON.stringify(key) + ':' + canonical(child)).join(',') + '}';
  return JSON.stringify(value);
}
export function reviewDigest(value: unknown): string { return 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex'); }
export function cardBaseline(record: CardRecord): string { return reviewDigest(CardRecordSchema.parse(record)); }
const defaultLadder = (): ReviewLadder => ({ steps: DEFAULT_LADDER, version: reviewDigest(DEFAULT_LADDER) });

/** One native record publication owns both the schedule and occurrence history. */
export class ReviewService {
  constructor(privateRecords: RecordStore<typeof CardRecordSchema>, ladder: LadderReader = defaultLadder) {
    this.records = privateRecords; this.ladder = ladder;
  }
  private readonly records: RecordStore<typeof CardRecordSchema>;
  private readonly ladder: LadderReader;

  /** The Host supplies a real action identity/time/order, never confirmation time. */
  freeze(ctx: HostContext, ref: string, action: Pick<ReviewOccurrence, 'id' | 'occurredAt' | 'timeZone' | 'order'>): ReviewOccurrence {
    const card = this.records.read(ctx, ref), ladder = this.ladder(ctx, ref);
    LadderSchema.parse(ladder.steps);
    return ReviewOccurrenceSchema.parse({ ...action, cardVersion: cardBaseline(card.data), ladderVersion: ladder.version });
  }

  async record(ctx: Omit<MutationContext, 'expectedVersion'>, ref: string, draft: ReviewInput): Promise<ReviewResult> {
    if (ctx.purpose !== 'learning') throw new RecordError('review_learning_purpose_required');
    const input = ReviewInputSchema.parse(draft);
    if (ctx.actor === 'student' && input.channel !== '课外') throw new RecordError('review_channel_forbidden');
    if (ctx.actor === 'teacher' && input.channel === '课外') throw new RecordError('review_channel_forbidden');
    const saved = await this.records.updateCurrent(ctx, ref, input, row => {
      const prior = row.history.find(entry => entry.occurrence.id === input.occurrence.id);
      if (prior) {
        const { mode: _mode, ...fact } = prior;
        if (canonical(fact) !== canonical(input)) throw new RecordError('same_occurrence_requires_correction');
        return row;
      }
      const ladder = this.ladder(ctx, ref);
      const effect = occurrenceEffect({ schedule: row.review ?? null, history: row.history, cardVersion: cardBaseline(row), ladderVersion: ladder.version }, input.occurrence, input.mark, ladder.steps);
      if (effect.mode === 'duplicate') return row;
      if (!effect.lastAccessed || !effect.nextDue) throw new RecordError('review_schedule_missing');
      return { ...row, review: { lastAccessed: effect.lastAccessed, nextDue: effect.nextDue, reviewCount: (row.review?.reviewCount ?? 0) + effect.countDelta },
        history: [...row.history, { ...input, mode: effect.mode }] };
    });
    const card = CardViewSchema.parse({ ref: saved.ref, version: saved.version, ...saved.data });
    const original = saved.data.history.find(entry => entry.occurrence.id === input.occurrence.id);
    if (!original) throw new RecordError('review_history_missing');
    // A record operation replay returns the original result version. A new
    // operation naming the same occurrence is a no-op and does not add history.
    const own = this.records.changes(ctx, ref).find(change => change.operationId === ctx.operationId);
    return { card, mode: saved.duplicate || !own ? 'duplicate' : original.mode };
  }

  /** Refit policy after an explicit ladder edit. This creates no occurrence. */
  async refit(ctx: Omit<MutationContext, 'expectedVersion'>, ref: string, steps: readonly number[]): Promise<CardView> {
    const ladder = LadderSchema.parse(steps);
    const saved = await this.records.updateCurrent(ctx, ref, { refit: ladder }, row => {
      if (!row.review) return row;
      const interval = daysBetween(row.review.lastAccessed, row.review.nextDue);
      const next = ladder.findLast(value => value <= interval) ?? ladder[0]!;
      return { ...row, review: { ...row.review, nextDue: addDays(row.review.lastAccessed, next) } };
    });
    return CardViewSchema.parse({ ref: saved.ref, version: saved.version, ...saved.data });
  }
}
