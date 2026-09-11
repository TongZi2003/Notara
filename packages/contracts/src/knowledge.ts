import { z } from 'zod';
import { EntityRefSchema, RecordScopeSchema } from './core.ts';

/** Same knowledge identity before and after collection; never a second reviewable card. */
export const KnowledgeContentSchema = z.object({
  title: z.string().trim().min(1), body: z.string().min(1).describe('共同知识的唯一自由正文'),
  scope: RecordScopeSchema.optional(), category: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]), links: z.array(EntityRefSchema).default([]),
}).strict();
export type KnowledgeContent = z.infer<typeof KnowledgeContentSchema>;
