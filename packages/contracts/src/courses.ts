import { z } from 'zod';
import { EntityRefSchema, SessionIdSchema, TimestampSchema } from './core.ts';
import { LessonMaterialsSchema } from './lesson-materials.ts';
import type { TokenUsageProjection, ContextPressureProjection, ContextBreakdownProjection } from '@deepseek-ai/dsh-token-meter/client';

/** Teaching additions only. Native Session owns title, input, history and activity. */
export const CourseClosureSchema = z.object({ closedAt: TimestampSchema, handoffRef: EntityRefSchema }).strict();
export const CourseMetadataSchema = z.object({
  sessionId: SessionIdSchema,
  lessonMaterials: LessonMaterialsSchema,
  learningSetRef: EntityRefSchema.nullable(),
  archived: z.boolean(),
  closure: CourseClosureSchema.nullable(),
}).strict();
export type CourseMetadataData = z.infer<typeof CourseMetadataSchema>;
export const CoursePatchSchema = CourseMetadataSchema.pick({ lessonMaterials: true, learningSetRef: true, archived: true }).partial().strict();
export type CoursePatch = z.infer<typeof CoursePatchSchema>;
export type CourseClosure = z.infer<typeof CourseClosureSchema>;
export const CourseViewSchema = z.object({ version: z.number().int().nonnegative(), data: CourseMetadataSchema }).strict();
export type CourseView = z.infer<typeof CourseViewSchema>;
/** UI mutation shape; no model tool accepts identity or version authority. */
export const CourseUpdateSchema = z.object({
  sessionId: SessionIdSchema, operationId: z.string().min(1), expectedVersion: z.number().int().nonnegative(), patch: CoursePatchSchema,
}).strict();
export type CourseUpdate = z.infer<typeof CourseUpdateSchema>;

/** Native totals and native estimates stay separate; coverage never invents missing buckets. */
export interface CourseUsage {
  totals: TokenUsageProjection | null;
  context: ContextPressureProjection | null;
  breakdown: ContextBreakdownProjection | null;
  completedTurns: number;
  measuredTurns: number;
  exact: boolean;
  cacheReadReported: boolean;
  cacheWriteReported: boolean;
}
