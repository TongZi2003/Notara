import { z } from 'zod';
import { EntityRefSchema } from './core.ts';
import { SourceAnchorSchema } from './materials.ts';
import { ReviewHistorySchema, ReviewScheduleSchema } from './reviews.ts';

/** All headings belong to the author; system review/rewrite history lives outside content. */
export const CardSectionSchema = z.object({ heading: z.string().min(1), body: z.string() }).strict();
export type CardSection = z.infer<typeof CardSectionSchema>;
/** Display kind only; it never expresses mastery and never creates a review row. */
export const CardPresentationSchema = z.enum(['problem', 'flashcard', 'insight', 'note']);
export type CardPresentation = z.infer<typeof CardPresentationSchema>;
export const CardContentSchema = z.object({
  title: z.string().trim().min(1).describe('卡片标题，描述内容'),
  presentation: CardPresentationSchema.default('note'),
  front: z.string().default('').describe('卡面；仅来源的卡允许为空'),
  sections: z.array(CardSectionSchema).default([]).describe('卡背的作者正文；标题没有系统含义'),
  notes: z.string().default(''),
  sources: z.array(SourceAnchorSchema).default([]),
  chapter: z.string().min(1).optional().describe('已有骨架语义路径；省略表示无挂点'),
  tags: z.array(z.string().trim().min(1)).default([]),
  links: z.array(EntityRefSchema).default([]).describe('建卡时选已有卡引用；教师修改时使用增量字段'),
}).strict();
export type CardContent = z.infer<typeof CardContentSchema>;

/**
 * P5.1 author-facing edit of one card.
 *
 * Every author field is optional and an omitted field is never rewritten: a
 * metadata edit cannot silently reset the text, the sources or the tags the
 * author (or the student) already had. Only two fields have an explicit "none"
 * form — `chapter: null` clears the book hook on purpose, and `front: ''`
 * clears the face. Relations move by increment alone, so a teacher's `links_add`
 * can never overwrite the links a student removed or added.
 */
export const CardPatchSchema = z.object({
  title: CardContentSchema.shape.title.optional(),
  presentation: CardPresentationSchema.optional(),
  front: z.string().optional(),
  sections: z.array(CardSectionSchema).optional(),
  notes: z.string().optional(),
  sources: z.array(SourceAnchorSchema).optional(),
  chapter: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  /** Incremental relations; a whole-list replacement would clobber the student's own edits. */
  links_add: z.array(EntityRefSchema).default([]),
  links_remove: z.array(EntityRefSchema).default([]),
  /** Optional, with no "delete needs a reason" hard gate; the real change is the stored revision pair. */
  reason: z.string().min(1).optional(),
}).strict();
export type CardPatch = z.infer<typeof CardPatchSchema>;

/**
 * P5.1 stored card row.
 *
 * The author's own text lives only in `content`, where a heading called 复习 or
 * 重写 is ordinary authored text. The system's review ledger is a separate field
 * written by the review service, so no reader ever guesses a boundary out of the
 * body again. A freshly created card has no `review`: being created is not being
 * reviewed.
 */
export const CardRecordSchema = z.object({
  content: CardContentSchema,
  history: z.array(ReviewHistorySchema).default([]),
  review: ReviewScheduleSchema.optional(),
}).strict();
export type CardRecord = z.infer<typeof CardRecordSchema>;

/** One consistent read of a card, either at its current or an exact older revision. */
export const CardViewSchema = z.object({
  ref: EntityRefSchema,
  version: z.number().int().positive(),
  content: CardContentSchema,
  history: z.array(ReviewHistorySchema),
  review: ReviewScheduleSchema.optional(),
}).strict();
export type CardView = z.infer<typeof CardViewSchema>;
