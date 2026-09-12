import { z } from 'zod';
import { EntityRefSchema, RecordScopeSchema } from './core.ts';
import { AdoptedBasisSchema } from './evidence.ts';
import { LearningSearchSnippetSchema } from './learning-search.ts';

export const DEFAULT_MEMORY_KINDS = ['ability', 'habit', 'preference'] as const;
export const LearnerMemoryKindSchema = z.string().trim().min(1);
export type LearnerMemoryKind = z.infer<typeof LearnerMemoryKindSchema>;
/** Classification grants no permission or automatic certification. */
export const MemoryContentSchema = z.object({
  kind: LearnerMemoryKindSchema, title: z.string().min(1).optional(),
  scope: RecordScopeSchema.optional(), body: z.string().min(1),
}).strict();
export type MemoryContent = z.infer<typeof MemoryContentSchema>;
/** Model chooses supplied E aliases; the Host resolves identities, times and quotes. */
export const MemoryDraftSchema = MemoryContentSchema.extend({
  evidenceRefs: z.array(z.string().min(1)).min(1).describe('本轮依据目录中的真实E引用，不能捏造原话'),
});
export type MemoryDraft = z.infer<typeof MemoryDraftSchema>;
/** Bound content saved by the Host, after resolution of the selected E aliases. */
export const MemoryObservationSchema = MemoryContentSchema.extend({ basis: AdoptedBasisSchema.min(1) });
export type MemoryObservation = z.infer<typeof MemoryObservationSchema>;

/**
 * P7.1 the stored learner-memory row (plan §P7.1, SIMPLIFICATION A5).
 *
 * One record is one judgement about this student: the wording that is current
 * now plus every observation that was really adopted, append-only. `history`
 * keeps each earlier wording together with its own sources, so a correction
 * adds to the record instead of erasing why it changed; nothing here certifies
 * an inference, counts evidence, or carries a `verifiedAbility` verdict — how
 * strong a conclusion is belongs to the Skill, and a single real observation is
 * a legal row. Identity is the record, not the title: a same-named new note is a
 * new record.
 *
 * `sources` is written only by a student content edit that re-points the current
 * wording at a different source the record already adopted. Absent means the
 * newest observation's basis still speaks for the wording, which is what an
 * edit that keeps its sources leaves behind; the edit itself never becomes an
 * observation and never appends to `history`.
 */
export const MemoryRecordSchema = z.object({
  content: MemoryContentSchema,
  history: z.array(MemoryObservationSchema).min(1),
  sources: AdoptedBasisSchema.optional(),
}).strict();
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

/**
 * P7.2 one student edit of the wording the record currently shows.
 *
 * The student owns this wording, so the edit carries the whole new content and
 * needs no fresh evidence catalogue — it may be made with no lesson open at all.
 * `sources` is optional: omitted keeps what the record already adopted, and
 * present re-points the wording at sources drawn from this record's own history,
 * so an explicit choice is always a real older version and never a fabricated
 * one. Either way the edit changes `content` alone; it is not a new observation.
 */
export const MemoryEditInputSchema = z.object({
  content: MemoryContentSchema,
  sources: AdoptedBasisSchema.optional(),
}).strict();
export type MemoryEditInput = z.infer<typeof MemoryEditInputSchema>;

/**
 * Where the current wording came from vs. what earlier versions adopted. This is
 * a projection of `history`, never a second basis ledger: `current` is the newest
 * observation's sources, `prior` is what the versions before it adopted.
 */
export const MemoryBasisViewSchema = z.object({ current: AdoptedBasisSchema, prior: AdoptedBasisSchema }).strict();
export type MemoryBasisView = z.infer<typeof MemoryBasisViewSchema>;

/** One consistent read: the exact record revision plus the current/prior projection. */
export const MemoryViewSchema = z.object({
  ref: EntityRefSchema,
  revision: z.number().int().positive(),
  content: MemoryContentSchema,
  history: z.array(MemoryObservationSchema).min(1),
  basis: MemoryBasisViewSchema,
}).strict();
export type MemoryView = z.infer<typeof MemoryViewSchema>;

/**
 * A read-side scan of this workspace's own memory text. It never writes and
 * never ranks an inference: `kinds` only filters by the record's own category.
 */
export const MemorySearchInputSchema = z.object({
  query: z.string().default(''),
  kinds: z.array(LearnerMemoryKindSchema).optional(),
  limit: z.number().int().positive().max(100).optional(),
}).strict();
export type MemorySearchInput = z.input<typeof MemorySearchInputSchema>;

/** One real stored memory the query matched, with the exact field and offsets. */
export const MemorySearchHitSchema = z.object({
  ref: EntityRefSchema,
  revision: z.number().int().positive(),
  kind: LearnerMemoryKindSchema,
  title: z.string().min(1).nullable(),
  snippet: LearningSearchSnippetSchema,
}).strict();
export type MemorySearchHit = z.infer<typeof MemorySearchHitSchema>;

export const MemorySearchResultSchema = z.object({
  hits: z.array(MemorySearchHitSchema),
  /** True when the scan found more rows than `limit` returned. */
  hasMore: z.boolean(),
}).strict();
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;
