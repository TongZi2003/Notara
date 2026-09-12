import { z } from 'zod';
import { EntityRefSchema } from './core.ts';
import { MaterialIdSchema } from './material-records.ts';
import { SourceAnchorSchema } from './materials.ts';
import { SkeletonPathSchema, SkeletonNodesSchema, type SkeletonNode } from './skeleton.ts';
import { DaySchema } from './reviews.ts';

export const BookPlanEntrySchema = z.object({ date: DaySchema, chapter: SkeletonPathSchema.optional(), sources: z.array(SourceAnchorSchema).min(1) }).strict();
export const CampaignDaySchema = z.object({ date: DaySchema, cards: z.array(EntityRefSchema) }).strict();
/**
 * One stored plan. The campaign branch keeps its exact stored shape while the
 * wire draft may omit what the teacher has no choice about yet:
 * `learningSetRef` defaults to `null`, `tags`/`cards`/`schedule` to `[]`, so an
 * author only has to name the plan, its quota and its window. `dailyCount` stays
 * explicit because it is the one number the teacher really chooses; it decides
 * how many cards a day picks when `schedule` is empty. A non-empty `schedule` is
 * the student's complete explicit itinerary and then `dailyCount` no longer
 * selects cards. Nothing here is a patch: `PlanPatchSchema` stays all-optional
 * with no defaults so an edit never silently resets what the student arranged.
 */
export const PlanContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('book'), title: z.string().trim().min(1), materialId: MaterialIdSchema, entries: z.array(BookPlanEntrySchema) }).strict(),
  z.object({ kind: z.literal('campaign'), title: z.string().trim().min(1), learningSetRef: EntityRefSchema.nullable().default(null),
    tags: z.array(z.string().min(1)).default([]), cards: z.array(EntityRefSchema).default([]),
    dailyCount: z.number().int().positive(), start: DaySchema, end: DaySchema, schedule: z.array(CampaignDaySchema).default([]),
  }).strict().refine(value => value.start <= value.end, 'campaign end precedes start'),
]);
export type PlanContent = z.infer<typeof PlanContentSchema>;
/** What a caller really sends when authoring: the omit-able wire draft. */
export type PlanContentDraft = z.input<typeof PlanContentSchema>;
export const PlanPatchSchema = z.object({ title: z.string().trim().min(1).optional(), entries: z.array(BookPlanEntrySchema).optional(),
  learningSetRef: EntityRefSchema.nullable().optional(), tags: z.array(z.string().min(1)).optional(), cards: z.array(EntityRefSchema).optional(),
  dailyCount: z.number().int().positive().optional(), start: DaySchema.optional(), end: DaySchema.optional(), schedule: z.array(CampaignDaySchema).optional(),
}).strict();
export type PlanPatch = z.infer<typeof PlanPatchSchema>;
export const PlanViewSchema = z.object({ ref: EntityRefSchema, version: z.number().int().positive(), content: PlanContentSchema }).strict();
export type PlanView = z.infer<typeof PlanViewSchema>;

export const SkeletonChangeSchema = z.object({
  nodes: SkeletonNodesSchema.default([]),
  replaceExisting: z.boolean().default(false),
  removePaths: z.array(SkeletonPathSchema).default([]),
  repath: z.array(z.object({ from: SkeletonPathSchema, to: SkeletonPathSchema }).strict()).default([]),
  detachDependents: z.boolean().default(false),
}).strict();
export type SkeletonChange = z.infer<typeof SkeletonChangeSchema>;
/** The wire draft of one skeleton change: every field above has a real default. */
export type SkeletonChangeDraft = z.input<typeof SkeletonChangeSchema>;
export interface SkeletonImpact { cards: string[]; plans: string[]; removedPaths: string[]; }
export interface SkeletonPreview { nodes: SkeletonNode[]; impact: SkeletonImpact; requiresDetach: boolean; }
