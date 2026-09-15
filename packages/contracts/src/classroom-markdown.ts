import { z } from 'zod';
import { MaterialIdSchema, MaterialVersionIdSchema } from './material-records.ts';
import { MaterialContextSchema } from './materials.ts';

export const ClassroomMarkdownCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().max(1_000_000),
  references: z.array(MaterialContextSchema).max(30).default([]),
}).strict();
export type ClassroomMarkdownCreate = z.infer<typeof ClassroomMarkdownCreateSchema>;

export const ClassroomMarkdownReadSchema = z.object({
  materialId: MaterialIdSchema,
  versionId: MaterialVersionIdSchema,
}).strict();
export type ClassroomMarkdownRead = z.infer<typeof ClassroomMarkdownReadSchema>;

export const ClassroomMarkdownUpdateSchema = ClassroomMarkdownReadSchema.extend({
  expectedVersion: z.number().int().positive(),
  content: z.string().max(1_000_000),
}).strict();
export type ClassroomMarkdownUpdate = z.infer<typeof ClassroomMarkdownUpdateSchema>;

export const ClassroomMarkdownViewSchema = z.object({
  ref: z.string().min(1), materialId: MaterialIdSchema, versionId: MaterialVersionIdSchema,
  revision: z.number().int().positive(), title: z.string().trim().min(1), content: z.string(),
  source: MaterialContextSchema, references: z.array(MaterialContextSchema).max(30).default([]),
}).strict();
export type ClassroomMarkdownView = z.infer<typeof ClassroomMarkdownViewSchema>;
