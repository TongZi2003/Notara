import { z } from 'zod';
import { DigestSchema, EntityRefSchema, SessionIdSchema, TimestampSchema } from './core.ts';

/**
 * P7.5 确认小结、课后原课与固定接续版本（plan §P7.5，CONTRACTS.md §7）。
 *
 * 一份 handoff 是**一次真实收课**留下的东西：老师自由写的正文，加上三样只由 Host 供的
 * 事实——这次小结写到的真实 native 输入截止点、当时系统真正持有的材料/写入/待确认清单、
 * 以及这节接续课当初收到的上一份 handoff 的确切版本。模型只写正文；截止点、快照与版本
 * 都不由它填。正文没有固定标题或段落结构。
 *
 * 一份 handoff 与它的关闭事实在同一次原生提交里写入，所以「小结保存了但课没关」或
 * 「课关了但没有小结」都不会出现。之后改正文生成的是同一记录的新不可变 revision：
 * 旧 revision 永远读得到，于是已经接过这一课的下一课仍固定在它当初收到的那个版本上，
 * 不会被追溯改绑。
 */

/** 一份 handoff 的确切版本；接续固定在这一对上，只读不重指。 */
export const HandoffPinSchema = z.object({ ref: EntityRefSchema, version: z.number().int().positive() }).strict();
export type HandoffPin = z.infer<typeof HandoffPinSchema>;

/** 这份小结写到的真实 native 输入截止点；Host 从原生日志取，模型不能填。 */
export const HandoffCutoffSchema = z.object({
  sessionId: SessionIdSchema,
  /** 截止点之后不再有计入本次小结的真实输入。 */
  sequence: z.number().int().nonnegative(),
  at: TimestampSchema,
}).strict();
export type HandoffCutoff = z.infer<typeof HandoffCutoffSchema>;

/** 系统在那次收课时真正持有的东西；与老师正文分开，Host 注入，模型不能填。 */
export const HandoffFactSchema = z.object({
  kind: z.enum(['material', 'saved', 'pending']),
  title: z.string().trim().min(1),
  target: EntityRefSchema.optional(),
}).strict();
export type HandoffFact = z.infer<typeof HandoffFactSchema>;

/** 老师写的部分：短标题加自由正文，不要求固定段落。 */
export const HandoffDraftSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().min(1),
}).strict();
export type HandoffDraft = z.infer<typeof HandoffDraftSchema>;

/** 收课之后更正正文：只换老师写的部分，截止点与系统快照不动。 */
export const HandoffCorrectionSchema = z.object({
  title: z.string().trim().min(1).optional(),
  body: z.string().min(1),
}).strict();
export type HandoffCorrection = z.infer<typeof HandoffCorrectionSchema>;

/** 一条保存下来的小结：老师正文 + 系统事实 + 这份课接续自哪个版本。 */
export const HandoffRecordSchema = HandoffDraftSchema.extend({
  sessionId: SessionIdSchema,
  cutoff: HandoffCutoffSchema,
  facts: z.array(HandoffFactSchema).default([]),
  /** 本课接续自的那份 handoff；不是接续课就没有这个键。 */
  continuation: HandoffPinSchema.optional(),
  /** 第一次真正写入的时刻；重放沿原事务恢复同一个值。 */
  createdAt: TimestampSchema,
}).strict();
export type HandoffRecord = z.infer<typeof HandoffRecordSchema>;

export const HandoffViewSchema = HandoffRecordSchema.extend({
  ref: EntityRefSchema,
  version: z.number().int().positive(),
}).strict();
export type HandoffView = z.infer<typeof HandoffViewSchema>;

/**
 * 这次关闭认的是学生确认过的那一版：提案里的哪一项、哪一版稿、什么摘要，以及执行它的
 * operation。领域层据此回读提案记录——没有真正落盘的 attempt 就写不进去，模型直写被拒。
 */
export const HandoffCloseConfirmationSchema = z.object({
  proposalRef: EntityRefSchema,
  itemId: z.string().min(1),
  draftRevision: z.number().int().positive(),
  digest: DigestSchema,
}).strict();
export type HandoffCloseConfirmation = z.infer<typeof HandoffCloseConfirmationSchema>;

/** 一次确认收课的完整输入：老师稿、Host 注入的事实与确认身份。 */
export const HandoffCloseInputSchema = z.object({
  draft: HandoffDraftSchema,
  cutoff: HandoffCutoffSchema,
  facts: z.array(HandoffFactSchema).default([]),
  /** 本课接续自的那份 handoff 版本，由 Host 按这节真实的接续关系注入。 */
  continuation: HandoffPinSchema.optional(),
  confirmation: HandoffCloseConfirmationSchema,
}).strict();
export type HandoffCloseInput = z.infer<typeof HandoffCloseInputSchema>;

/** 一次确认收课的结果：新小结的确切版本，以及它写下的关闭事实。 */
export const HandoffCloseResultSchema = z.object({
  handoff: z.object({ ref: EntityRefSchema, version: z.number().int().positive() }).strict(),
  closure: z.object({
    sessionId: SessionIdSchema,
    handoffRef: EntityRefSchema,
    handoffVersion: z.number().int().positive(),
    closedAt: TimestampSchema,
  }).strict(),
}).strict();
export type HandoffCloseResult = z.infer<typeof HandoffCloseResultSchema>;
