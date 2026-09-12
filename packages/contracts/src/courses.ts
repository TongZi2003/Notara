import { z } from 'zod';
import { EntityRefSchema, SessionIdSchema, TimestampSchema } from './core.ts';
import { LessonMaterialsSchema } from './lesson-materials.ts';
import { HandoffPinSchema } from './handoffs.ts';
import type { TokenUsageProjection, ContextPressureProjection, ContextBreakdownProjection } from '@deepseek-ai/dsh-token-meter/client';

/** Teaching additions only. Native Session owns title, input, history and activity. */
/**
 * P7.5 closing fact: the confirmed summary this lesson closed with, and the exact
 * revision of it. `handoffVersion` is written by the confirmed close; a closure
 * saved before P7.5 has no version and stays readable, so the field is optional
 * rather than a migrated one.
 */
export const CourseClosureSchema = z.object({
  closedAt: TimestampSchema, handoffRef: EntityRefSchema, handoffVersion: z.number().int().positive().optional(),
}).strict();
export const CourseMetadataSchema = z.object({
  sessionId: SessionIdSchema,
  lessonMaterials: LessonMaterialsSchema,
  learningSetRef: EntityRefSchema.nullable(),
  archived: z.boolean(),
  closure: CourseClosureSchema.nullable(),
  /**
   * The handoff revision this lesson continued from, fixed when the lesson opened.
   * A later correction of that summary never re-points it: the lesson keeps the
   * version it really received. Absent on a lesson that continues nothing.
   */
  continuation: HandoffPinSchema.optional(),
  teachingRef: z.string().min(1).optional(),
  temporaryInstructions: z.string().optional(),
  stance: z.string().optional(),
}).strict();
export type CourseMetadataData = z.infer<typeof CourseMetadataSchema>;
export const CoursePatchSchema = CourseMetadataSchema.pick({ lessonMaterials: true, learningSetRef: true, archived: true, teachingRef: true, temporaryInstructions: true, stance: true }).partial().strict();
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
