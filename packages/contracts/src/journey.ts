/**
 * read_journey 的返回合同：本工作区全部学习经历的一份有界总览。
 *
 * 经历不是一个新记录，而是对既有不可变记录的只读聚合——每节课的小结索引（指针与
 * 当时系统事实清单）、路线的已开/未开节点、卡片复习态势、学情与方法笔记的清单指针。
 * 聚合只派生视图，不制造记录；条目全部用真实 sessionId 与 ref/版本指路，正文与细节
 * 按需渐进披露，由专门读工具按 ref 精读。
 */
import { z } from 'zod';
import { EntityRefSchema, SessionIdSchema, TimestampSchema } from './core.ts';
import { HandoffPinSchema } from './handoffs.ts';
import { LearnerMemoryKindSchema } from './memory.ts';

/**
 * 一节课收课小结的索引条目：指针与事实清单，不含正文。
 * 正文按需渐进披露——open(method=handoff, input={ref,version}) 读全文；
 * 接续课钉住的旧版本同样按 pin 指到确切 revision。
 */
export const JourneyHandoffSchema = z.object({
  ref: EntityRefSchema,
  /** 本视图读到的当前版本；更正过的小结以最新版指路。 */
  version: z.number().int().positive(),
  title: z.string().trim().min(1),
  /** 本课接续自哪一份小结的哪个版本；第一课没有。 */
  continuedFrom: HandoffPinSchema.optional(),
  materials: z.array(z.string()).default([]),
  saved: z.array(z.object({ title: z.string(), target: EntityRefSchema.optional() }).strict()).default([]),
  pending: z.array(z.string()).default([]),
}).strict();
export type JourneyHandoff = z.infer<typeof JourneyHandoffSchema>;

/** 一节课在历程里的位置；closed=false 表示开过但没有收课小结（进行中或被放弃）。 */
export const JourneyLessonSchema = z.object({
  sessionId: SessionIdSchema,
  title: z.string().min(1),
  /** 收课时间；未收课的课没有可断言的时间。 */
  closedAt: TimestampSchema.optional(),
  closed: z.boolean(),
  handoff: JourneyHandoffSchema.optional(),
}).strict();
export type JourneyLesson = z.infer<typeof JourneyLessonSchema>;

/** 路线节点的进度投影：opened 的节点带真实 session 绑定，未开的只有标题。 */
export const JourneyNodeSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string().trim().min(1),
  opened: z.boolean(),
  sessionId: z.string().min(1).optional(),
}).strict();
export type JourneyNode = z.infer<typeof JourneyNodeSchema>;

/** 卡片复习态势的计数视图；明细用 list_cards/search_learning 按状态精读。 */
export const JourneyCardsSchema = z.object({
  total: z.number().int().nonnegative(),
  unlearned: z.number().int().nonnegative(),
  due: z.number().int().nonnegative(),
  upcoming: z.number().int().nonnegative(),
}).strict();
export type JourneyCards = z.infer<typeof JourneyCardsSchema>;

export const JourneyMemoryItemSchema = z.object({
  ref: EntityRefSchema,
  kind: LearnerMemoryKindSchema,
  title: z.string().min(1).nullable(),
}).strict();

export const JourneyKnowledgeItemSchema = z.object({
  ref: EntityRefSchema,
  title: z.string().min(1),
}).strict();

export const JourneyViewSchema = z.object({
  /** 全部课按收课时间排序；未收课的课排在最后。超出上限时保留最近的，earlierLessons 记略去的节数。 */
  lessons: z.array(JourneyLessonSchema),
  earlierLessons: z.number().int().nonnegative(),
  /** 当前路线的节点进度；路线从未写过时为 null。 */
  route: z.object({ nodes: z.array(JourneyNodeSchema) }).strict().nullable(),
  cards: JourneyCardsSchema,
  memory: z.object({
    total: z.number().int().nonnegative(),
    items: z.array(JourneyMemoryItemSchema),
    omitted: z.number().int().nonnegative(),
  }).strict(),
  knowledge: z.object({
    total: z.number().int().nonnegative(),
    items: z.array(JourneyKnowledgeItemSchema),
    omitted: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type JourneyView = z.infer<typeof JourneyViewSchema>;
