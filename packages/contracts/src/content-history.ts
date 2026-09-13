import { z } from 'zod';
import { MaterialContextSchema, SourceAnchorSchema, type MaterialContext, type SourceAnchor } from './materials.ts';
import { CardContentSchema } from './cards.ts';
import { KnowledgeContentSchema, PublicTeachingRefSchema } from './knowledge.ts';
import { ReviewHistorySchema, ReviewScheduleSchema } from './reviews.ts';

export const CardActivitySchema = z.object({
  reviews: z.array(ReviewHistorySchema), schedule: ReviewScheduleSchema.optional(),
  classrooms: z.array(z.object({ title: z.string(), sessionId: z.string(), occurredAt: z.string(), uses: z.array(z.string()) }).strict()),
  hasMoreReviews: z.boolean(), hasMoreClassrooms: z.boolean(), unavailableClassrooms: z.number().int().nonnegative(),
  browsing: z.literal('not_recorded'),
}).strict();

/** Content first, with an explicit optional projection of this card's own activity. */
export const ContentReadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('card'), ref: z.string(), version: z.number().int().positive(), content: CardContentSchema.omit({ notes: true }), activity: CardActivitySchema.optional() }).strict(),
  z.object({ kind: z.literal('knowledge'), ref: z.string(), version: z.number().int().positive(), content: KnowledgeContentSchema, publicSources: z.array(PublicTeachingRefSchema) }).strict(),
]);
export const SourceUseSchema = z.object({
  kind: z.literal('studyforge-source-use'), use: z.enum(['read', 'cited']),
  sources: z.array(SourceAnchorSchema), pageCount: z.number().int().positive().optional(),
  target: z.string().optional(), version: z.number().int().positive().optional(),
}).strict();
export const ContentHistoryQuerySchema = z.object({ source: MaterialContextSchema.optional(), target: z.string().optional(), version: z.number().int().positive().optional() }).strict()
  .refine(value => !!value.source !== !!value.target, '选择一个原文位置或卡片');
export type ContentHistoryQuery = z.infer<typeof ContentHistoryQuerySchema>;
export interface ContentOccurrence {
  use: 'declared' | 'read' | 'cited' | 'message' | 'output' | 'practice' | 'planned';
  source?: MaterialContext;
  target?: string;
  version?: number;
  messageId?: string;
  sequence?: number;
  turn?: number;
  via?: string;
  detail?: string;
}
export interface ContentClassroom {
  sessionId: string; title: string; occurredAt: string; archived: boolean;
  occurrences: ContentOccurrence[];
}
export interface ContentHistory {
  classrooms: ContentClassroom[];
  preparation: { sessionId: string; title: string; sources: SourceAnchor[] }[];
  coverage: { located: SourceAnchor[]; refined: SourceAnchor[]; outline: SourceAnchor[]; unrefined: SourceAnchor[]; pageCount?: number };
  planned: { nodeId: string; title: string; date?: string }[];
  unavailable: number;
}
