/**
 * P6.1 learning-set contract (plan §P6.1, CONTRACTS.md §5).
 *
 * A learning set is organisation, not authorisation: it decides what a
 * bookshelf groups together and which review ladder its cards fall back to. It
 * never narrows what this student may read — a card that belongs to no set is
 * visible everywhere, exactly like B's "不属于任何集的卡处处可见".
 *
 * The set id is the record identity and is derived from the accepted operation,
 * so renaming a set changes a display field and nothing else: members, derived
 * ownership and every card's ladder still point at the same id.
 */
import { z } from 'zod';
import { EntityRefSchema, TimestampSchema } from './core.ts';
import { MaterialIdSchema } from './material-records.ts';
import { LadderSchema } from './reviews.ts';

/** B `set_store.LADDER_MIN/LADDER_MAX`: a policy ladder is 2–12 strictly increasing steps starting at 1. */
export const SET_LADDER_MIN = 2;
export const SET_LADDER_MAX = 12;

/** The one ladder rule, with the set-policy length bound on top of it. */
export const SetLadderSchema = LadderSchema.refine(
  ladder => ladder.length >= SET_LADDER_MIN && ladder.length <= SET_LADDER_MAX,
  { message: `梯子要 ${String(SET_LADDER_MIN)}–${String(SET_LADDER_MAX)} 项` },
);
export type SetLadder = z.infer<typeof SetLadderSchema>;

/** One set: name is display text, `ladder` null means "this set has no policy of its own". */
export const SetRecordSchema = z.object({
  name: z.string().trim().min(1).max(120).refine(name => !/[\r\n]/.test(name), { message: '学习集名要单行' }),
  subjects: z.array(z.string().trim().min(1)).default([]),
  ladder: SetLadderSchema.nullable().default(null),
  /**
   * The originals this set groups: a book imported/packed into it. A source
   * carries a material version, never a set, so the set is the one place that
   * names which originals belong to it — there is no separate material→set
   * ledger. Only `materials`/`members` here decide derived ownership.
   */
  materials: z.array(MaterialIdSchema).default([]),
  /** Explicit members. Derived ownership comes from the sources a card really carries. */
  members: z.array(EntityRefSchema).default([]),
  createdAt: TimestampSchema,
}).strict();
export type SetRecord = z.infer<typeof SetRecordSchema>;

export const SetCreateSchema = z.object({
  name: SetRecordSchema.shape.name,
  subjects: z.array(z.string().trim().min(1)).default([]),
  ladder: SetLadderSchema.nullable().default(null),
  materials: z.array(MaterialIdSchema).default([]),
  /** A set may be born holding real cards ("把这些错题放进期末复习"), not only grown later. */
  members: z.array(EntityRefSchema).default([]),
}).strict();
export type SetCreate = z.infer<typeof SetCreateSchema>;
/**
 * What a caller really sends for a creation. The output type above fills the
 * defaults (no subjects, no ladder, no originals yet), so the wire draft stays
 * the schema *input*: a Remote boundary may not invent its own local DTO, and
 * the domain still parses every draft itself.
 */
export type SetCreateDraft = z.input<typeof SetCreateSchema>;

/**
 * One author-facing set edit. Omitted fields keep what is stored, membership
 * moves by increment, and `ladder: null` is the explicit "no policy of my own"
 * form (it falls back to the default ladder, it does not delete history).
 */
export const SetPatchSchema = z.object({
  name: SetRecordSchema.shape.name.optional(),
  subjects: z.array(z.string().trim().min(1)).optional(),
  ladder: SetLadderSchema.nullable().optional(),
  materials_add: z.array(MaterialIdSchema).default([]),
  materials_remove: z.array(MaterialIdSchema).default([]),
  members_add: z.array(EntityRefSchema).default([]),
  members_remove: z.array(EntityRefSchema).default([]),
  reason: z.string().min(1).optional(),
}).strict();
export type SetPatch = z.infer<typeof SetPatchSchema>;
/** The wire draft of an edit: an omitted field keeps what is stored. */
export type SetPatchDraft = z.input<typeof SetPatchSchema>;

/** One consistent read of a set. */
export const SetViewSchema = z.object({
  ref: EntityRefSchema,
  version: z.number().int().positive(),
  name: z.string().min(1),
  subjects: z.array(z.string().min(1)),
  ladder: SetLadderSchema.nullable(),
  materials: z.array(MaterialIdSchema),
  members: z.array(EntityRefSchema),
  createdAt: TimestampSchema,
}).strict();
export type SetView = z.infer<typeof SetViewSchema>;
