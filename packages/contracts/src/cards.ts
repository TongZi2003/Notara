import { z } from 'zod';
import { EntityRefSchema } from './core.ts';
import { SourceAnchorSchema } from './materials.ts';
import { DaySchema, ReviewHistorySchema, ReviewScheduleSchema } from './reviews.ts';
import { MaterialIdSchema } from './material-records.ts';

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
  chapter: z.string().min(1).optional().describe('本卡在唯一来源书内的层级语义路径；骨架没有该层时由本次写入顺带铸成outline节点，省略表示无挂点'),
  topic: z.string().min(1).optional().describe('本卡在工作区知识地图(atlas)里的归属路径，与chapter平行但不受单书限制：多来源卡与无来源卡都可声明；地图没有该层时由本次写入顺带铸成outline节点，省略表示不归图'),
  tags: z.array(z.string().trim().min(1)).default([]),
  links: z.array(EntityRefSchema).default([]).describe('建卡时选已有实体引用，填裸ref如card:/knowledge:/material:；教师修改时使用增量字段'),
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
 * can never overwrite the links a student removed or added. `topic` follows
 * `chapter` semantics: `null` clears the map hook, omission never touches it.
 */
export const CardPatchSchema = z.object({
  title: CardContentSchema.shape.title.optional(),
  presentation: CardPresentationSchema.optional(),
  front: z.string().optional(),
  sections: z.array(CardSectionSchema).optional(),
  notes: z.string().optional(),
  sources: z.array(SourceAnchorSchema).optional(),
  chapter: z.string().min(1).nullable().optional(),
  topic: z.string().min(1).nullable().optional(),
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

/** Discovery summaries are not a content read or a learning observation. */
export const CardListInputSchema = z.object({
  state: z.enum(['all', 'due', 'upcoming', 'unlearned']).default('all').describe('due=今天到期或已逾期，upcoming=已学但尚未到期；今天由Host时区确定'),
  tags: z.array(z.string().trim().min(1)).default([]).describe('必须同时包含这些已有标签；空数组不限制'),
  chapter: z.string().trim().min(1).optional().describe('已有骨架路径，匹配本章及其下级，如数学/函数'),
  topic: z.string().trim().min(1).optional().describe('已有知识地图(atlas)路径，匹配该层及其下级——跨书聚合，不限来源资料'),
  materialId: MaterialIdSchema.optional().describe('只列来源包含这份原件的卡，引用来自list_materials'),
  learningSetRef: EntityRefSchema.optional().describe('只列该集的显式成员及其资料派生的卡，引用来自list_sets；省略查整个学习空间'),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0).describe('下一页用上次返回的nextOffset；筛选条件保持不变，期间数据变化时从0重读'),
}).strict();
export type CardListInput = z.input<typeof CardListInputSchema>;
export const CardListResultSchema = z.object({
  date: DaySchema,
  cards: z.array(z.object({
    ref: EntityRefSchema, version: z.number().int().positive(), title: z.string(), tags: z.array(z.string()), chapter: z.string().nullable(), topic: z.string().nullable(),
    state: z.enum(['due', 'upcoming', 'unlearned']), nextDue: DaySchema.nullable(),
  }).strict()),
  nextOffset: z.number().int().nonnegative().nullable(),
}).strict();
export type CardListResult = z.infer<typeof CardListResultSchema>;

export const CardBatchReadInputSchema = z.object({
  targets: z.array(EntityRefSchema).min(1).max(20).refine(values => new Set(values).size === values.length, 'targets不能重复')
    .describe('list_cards或search_learning返回的实际card引用；1至20个且不重复'),
}).strict();
export const CardBatchReadResultSchema = z.object({ cards: z.array(CardViewSchema).min(1).max(20) }).strict();
