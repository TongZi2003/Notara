import { z } from 'zod';
import { EntityRefSchema, SessionIdSchema, TimestampSchema } from './core.ts';
import { LessonMaterialsSchema } from './lesson-materials.ts';
import { HandoffPinSchema } from './handoffs.ts';
import { DaySchema } from './reviews.ts';
import type { TokenUsageProjection, ContextPressureProjection, ContextBreakdownProjection } from '@deepseek-ai/dsh-token-meter/client';

/** Teaching additions only. Native Session owns title, input, history and activity. */
export const LearningGoalSchema = z.object({
  title: z.string().trim().min(1),
  deadline: DaySchema.optional(),
  dailyMinutes: z.number().int().positive().max(1440).optional(),
}).strict();
export type LearningGoal = z.infer<typeof LearningGoalSchema>;
/** The diagnostic lesson and exact confirmed summary that informed a route. */
export const LearningContextSchema = z.object({
  originSessionId: SessionIdSchema,
  diagnosis: HandoffPinSchema,
  goal: LearningGoalSchema,
  nodeId: z.string().min(1).optional(),
}).strict();
export type LearningContext = z.infer<typeof LearningContextSchema>;
export interface LearningPath {
  originSessionId: string;
  title: string;
  status: 'diagnosing' | 'planning' | 'learning' | 'complete';
  next?: { title: string; sessionId?: string; nodeId?: string; date?: string };
  lessons: { nodeId: string; title: string; sessionId?: string; date?: string; closed: boolean }[];
}
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
  /** Missing inherits the lesson's set; [] explicitly selects general teaching. */
  subjects: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  temporaryInstructions: z.string().optional(),
  stance: z.string().optional(),
  guided: z.boolean().optional(),
  learningGoal: LearningGoalSchema.optional(),
  learningContext: LearningContextSchema.optional(),
}).strict();
export type CourseMetadataData = z.infer<typeof CourseMetadataSchema>;
export const CoursePatchSchema = CourseMetadataSchema.pick({ lessonMaterials: true, learningSetRef: true, archived: true, teachingRef: true, subjects: true, temporaryInstructions: true, stance: true, guided: true, learningGoal: true }).partial().extend({ subjects: CourseMetadataSchema.shape.subjects.unwrap().nullable().optional() }).strict();
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
