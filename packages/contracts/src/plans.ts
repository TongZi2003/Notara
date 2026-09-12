import { z } from 'zod';
import { EntityRefSchema } from './core.ts';
import { MaterialIdSchema } from './material-records.ts';
import { SourceAnchorSchema } from './materials.ts';
import { SkeletonPathSchema, SkeletonNodesSchema, type SkeletonNode } from './skeleton.ts';
import { DaySchema } from './reviews.ts';

export const BookPlanEntrySchema = z.object({ date: DaySchema, chapter: SkeletonPathSchema.optional(), sources: z.array(SourceAnchorSchema).min(1) }).strict();
export const CampaignDaySchema = z.object({ date: DaySchema, cards: z.array(EntityRefSchema) }).strict();
export const PlanContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('book'), title: z.string().trim().min(1), materialId: MaterialIdSchema, entries: z.array(BookPlanEntrySchema) }).strict(),
  z.object({ kind: z.literal('campaign'), title: z.string().trim().min(1), learningSetRef: EntityRefSchema.nullable(), tags: z.array(z.string().min(1)),
    cards: z.array(EntityRefSchema), dailyCount: z.number().int().positive(), start: DaySchema, end: DaySchema,
    schedule: z.array(CampaignDaySchema),
  }).strict().refine(value => value.start <= value.end, 'campaign end precedes start'),
]);
export type PlanContent = z.infer<typeof PlanContentSchema>;
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
