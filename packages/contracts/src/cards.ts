import { z } from 'zod';
import { EntityRefSchema } from './core.ts';
import { SourceAnchorSchema } from './materials.ts';

/** All headings belong to the author; system review/rewrite history lives outside content. */
export const CardSectionSchema = z.object({ heading: z.string().min(1), body: z.string() }).strict();
export type CardSection = z.infer<typeof CardSectionSchema>;
export const CardContentSchema = z.object({
  title: z.string().trim().min(1).describe('卡片标题，描述内容'),
  presentation: z.enum(['problem', 'flashcard', 'insight', 'note']).default('note'),
  front: z.string().default('').describe('卡面；仅来源的卡允许为空'),
  sections: z.array(CardSectionSchema).default([]).describe('卡背的作者正文；标题没有系统含义'),
  notes: z.string().default(''),
  sources: z.array(SourceAnchorSchema).default([]),
  chapter: z.string().min(1).optional().describe('已有骨架语义路径；省略表示无挂点'),
  tags: z.array(z.string().trim().min(1)).default([]),
  links: z.array(EntityRefSchema).default([]).describe('建卡时选已有卡引用；教师修改时使用增量字段'),
}).strict();
export type CardContent = z.infer<typeof CardContentSchema>;
