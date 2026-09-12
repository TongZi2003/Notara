import { z } from 'zod';
import { ActorSchema, DigestSchema, EntityRefSchema, RevisionSchema, SessionIdSchema, TimestampSchema, VersionTokenSchema } from './core.ts';
import type { Digest, EntityRef, VersionToken } from './core.ts';
import { CardContentSchema, CardPatchSchema } from './cards.ts';
import { ReviewHistorySchema } from './reviews.ts';
import { SetCreateSchema, SetPatchSchema } from './sets.ts';
import { RouteNodeInputSchema, RouteNodePatchSchema } from './routes.ts';
import { PlanContentSchema, PlanPatchSchema, SkeletonChangeSchema } from './plans.ts';
import { HandoffCorrectionSchema, HandoffCutoffSchema, HandoffDraftSchema, HandoffFactSchema, HandoffPinSchema } from './handoffs.ts';
import { CoursePatchSchema } from './courses.ts';

/**
 * P5.3 冻结目标、编辑版与持久确认（plan §P5.3，CONTRACTS.md §6）。
 *
 * 一份提案是一个原生记录：若干「待确认项」。每一项冻结三样东西——它要写的目标与
 * 它期望的基线、老师最初提出的原稿、学生此后每次编辑出的版本。原始版本只追加、
 * 不覆盖，所以「我看到的是这一版」可以被逐字核对：`digest` 由 canonical 内容算出，
 * 从不来自模型，也从不来自易变的当前 revision。
 *
 * 每项自己走 pending → applied / rejected / failed。成功项的 receipt 与该项存在
 * 同一个记录里，失败项保留 attempt（效果可能已经落盘）供同一 operation 重试。
 * 提案记录与目标记录是两次独立提交：这里只承诺「同一 operation 重放等于一次效果」，
 * 不声称跨对象原子。
 */

/**
 * 效果的种类。P6/P7 各自新增成员，而不是把 payload 放宽成自由 JSON。
 *
 * `card-create` 只带内容——新建的对象还没有身份，收据里的 target 由执行者给出；
 * 其余三种都在改一个已有对象，所以要的是身份与改动本身，目标与基线放在 item 上。
 * `review` 的 `mode`（advance/history_only/initialize）是执行时算出的结果，不是
 * 学生确认的内容，所以这里只冻结 ReviewHistory 去掉 mode 的部分。
 */
export const ProposalEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('card-create'), content: CardContentSchema }).strict(),
  z.object({ kind: z.literal('card-edit'), patch: CardPatchSchema }).strict(),
  z.object({ kind: z.literal('knowledge-collect') }).strict(),
  z.object({ kind: z.literal('review'), record: ReviewHistorySchema.omit({ mode: true }) }).strict(),
  z.object({ kind: z.literal('set-create'), content: SetCreateSchema }).strict(),
  z.object({ kind: z.literal('set-edit'), patch: SetPatchSchema }).strict(),
  z.object({ kind: z.literal('route-add'), content: RouteNodeInputSchema,
    parentItem: z.string().regex(/^item-\d+$/).optional(),
  }).strict(),
  z.object({ kind: z.literal('route-edit'), nodeId: z.string().min(1), patch: RouteNodePatchSchema }).strict(),
  z.object({ kind: z.literal('plan-create'), content: PlanContentSchema }).strict(),
  z.object({ kind: z.literal('plan-edit'), patch: PlanPatchSchema }).strict(),
  z.object({ kind: z.literal('skeleton-save'), materialId: z.string().min(1), change: SkeletonChangeSchema }).strict(),
  // P7.5. `handoff` closes a lesson from the teacher's free summary. The teacher
  // writes only `draft`; `cutoff`, `facts` and `continuation` are frozen by the
  // Host from the real log and the real stores BEFORE the student confirms, and
  // they ride in the same effect so the digest the student accepts covers exactly
  // the cutoff and facts that get saved — confirmation never re-reads "now" and
  // silently substitutes a newer list. `handoff-edit` corrects a saved summary in
  // place (a new immutable revision on the same ref).
  z.object({ kind: z.literal('handoff'), draft: HandoffDraftSchema, cutoff: HandoffCutoffSchema,
    facts: z.array(HandoffFactSchema).default([]), continuation: HandoffPinSchema.optional() }).strict(),
  z.object({ kind: z.literal('handoff-edit'), correction: HandoffCorrectionSchema }).strict(),
  z.object({ kind: z.literal('lesson-edit'), patch: CoursePatchSchema }).strict(),
]);
export type ProposalEffect = z.infer<typeof ProposalEffectSchema>;
export type ProposalKind = ProposalEffect['kind'];

/** 项的身份由提案与顺序决定（`item-1`…），不由模型发明；它是效果 operation 的一半。 */
export const ProposalItemIdSchema = z.string().regex(/^item-\d+$/);
export type ProposalItemId = z.infer<typeof ProposalItemIdSchema>;

export const ProposalItemStatusSchema = z.enum(['pending', 'applied', 'rejected', 'failed']);
export type ProposalItemStatus = z.infer<typeof ProposalItemStatusSchema>;

/** 一版稿件：原稿是 drafts[0]，学生的每一次编辑再追加一版，任何一版都不被改写。 */
export const ProposalDraftSchema = z.object({
  revision: z.number().int().positive(),
  digest: DigestSchema,
  effect: ProposalEffectSchema,
  authoredBy: ActorSchema,
  at: TimestampSchema,
}).strict();
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;

/**
 * 执行前就落盘的这次尝试：它属于哪一版稿件、用哪个 operation 执行。
 * `operationId` 是从提案、项与这一版稿（含 revision）派生的稳定值，所以同一版稿怎么重试
 * 都是同一个 op，改稿之后则是另一个 op——不会拿新稿去重放旧成功指纹。
 * `draft`/`digest` 让回填结果时能核对"这一版还是被执行的那一版"。
 */
export const ProposalAttemptSchema = z.object({
  operationId: z.string().min(1), draft: z.number().int().positive(), digest: DigestSchema,
  at: TimestampSchema, actor: ActorSchema, sessionId: SessionIdSchema.optional(),
}).strict();
export type ProposalAttempt = z.infer<typeof ProposalAttemptSchema>;

/**
 * 一次真实写入的回执：写到了哪个对象、落在哪个 revision、那时它叫什么。它与项存在
 * 同一个记录里；`deliveredAt` 只表示 outbox 已经把这张回执投递出去，不表示学生读过。
 */
export const ProposalReceiptSchema = z.object({
  confirmationId: z.string().min(1), operationId: z.string().min(1), at: TimestampSchema,
  target: EntityRefSchema, revision: RevisionSchema, title: z.string().min(1),
  deliveredAt: TimestampSchema.optional(),
}).strict();
export type ProposalReceipt = z.infer<typeof ProposalReceiptSchema>;

/**
 * 一次失败，以及"这次到底写没写进去"。默认异常只是执行者报错，不代表目标没保存——
 * `commit: 'unknown'` 说明效果可能已经落盘，这一版稿因此被锁住：不能改稿、不能取消，
 * 只能拿同一个 operation 再执行一次，让目标写者自己重放。只有执行者明确说"确定没写"
 * （`commit: 'none'`，见领域的 ProposalEffectRejected）才允许换稿或取消。
 */
export const ProposalFailureSchema = z.object({
  code: z.string().min(1), at: TimestampSchema, retryable: z.boolean(),
  commit: z.enum(['none', 'unknown']),
}).strict();
export type ProposalFailure = z.infer<typeof ProposalFailureSchema>;

/**
 * 提案从哪来：优先引用稳定的 native 记录——哪个会话里的哪次工具调用。`callId` 是
 * 原生工具调用的身份（不是会话里的 messageId，原生两者不同）；Host 只产生 native
 * 提案，native 记录不足以事后恢复时才退化为 snapshot，那时冻结的 drafts 就是全部原稿。
 */
export const ProposalOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('native'), sessionId: SessionIdSchema, callId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('snapshot') }).strict(),
]);
export type ProposalOrigin = z.infer<typeof ProposalOriginSchema>;

/**
 * 新建写的是一个还不存在的对象，所以没有 target、也没有基线；改已有对象则两者都必须有。
 * 返回一句可读的问题（没有问题时返回 null），让契约层与领域层共用同一条判断。
 */
export function effectTargetProblem(effect: ProposalEffect, target: EntityRef | null, baseline: VersionToken | null): string | null {
  if (['card-create', 'set-create', 'route-add', 'plan-create', 'handoff'].includes(effect.kind)) return target === null && baseline === null ? null : '新建的对象还没有身份，不能带 target 或 baseline';
  return target !== null && baseline !== null ? null : effect.kind + ' 必须带上它要改的目标与基线';
}

const ProposalItemFields = z.object({
  id: ProposalItemIdSchema,
  /** 要写的对象；只有新建版为 null。 */
  target: EntityRefSchema.nullable(),
  /** 提案时看到的目标版本；只有新建版为 null。 */
  baseline: VersionTokenSchema.nullable(),
  drafts: z.array(ProposalDraftSchema).min(1),
  status: ProposalItemStatusSchema,
  attempt: ProposalAttemptSchema.optional(),
  receipt: ProposalReceiptSchema.optional(),
  failure: ProposalFailureSchema.optional(),
}).strict();

function itemInvariants(item: z.output<typeof ProposalItemFields>, ctx: z.RefinementCtx): void {
  const original = item.drafts[0]!;
  const problem = effectTargetProblem(original.effect, item.target, item.baseline);
  if (problem !== null) ctx.addIssue({ code: 'custom', path: ['target'], message: problem });
  item.drafts.forEach((draft, index) => {
    if (draft.revision !== index + 1) ctx.addIssue({ code: 'custom', path: ['drafts', index, 'revision'], message: '草稿版本只从 1 起追加，不覆盖旧版' });
    if (draft.effect.kind !== original.effect.kind) ctx.addIssue({ code: 'custom', path: ['drafts', index, 'effect', 'kind'], message: '一项永远不改它要做的那件事' });
  });
  if (item.status === 'applied' && (item.receipt === undefined || item.attempt === undefined)) ctx.addIssue({ code: 'custom', path: ['status'], message: '已应用的项保留它执行过的 attempt 与产生的 receipt' });
  if (item.status === 'failed' && (item.failure === undefined || item.attempt === undefined)) ctx.addIssue({ code: 'custom', path: ['status'], message: '失败的项保留 attempt 与失败原因' });
  if (item.status === 'pending' && (item.receipt !== undefined || item.failure !== undefined)) ctx.addIssue({ code: 'custom', path: ['status'], message: '未完成的项没有 receipt，也没有失败记录' });
  if (item.status === 'rejected' && item.receipt !== undefined) ctx.addIssue({ code: 'custom', path: ['status'], message: '被取消的项不会产生 receipt' });
}

export const ProposalItemSchema = ProposalItemFields.superRefine(itemInvariants);
export type ProposalItem = z.infer<typeof ProposalItemSchema>;

export const ProposalRecordSchema = z.object({
  title: z.string().trim().min(1),
  origin: ProposalOriginSchema,
  items: z.array(ProposalItemSchema).min(1),
}).strict().superRefine((row, ctx) => {
  const ids = row.items.map(item => item.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['items'], message: '重复的 item id' });
});
export type ProposalRecord = z.infer<typeof ProposalRecordSchema>;

/** 一个一致读：当前项加上展示与写者共用的两版 canonical 内容。 */
export const ProposalItemViewSchema = ProposalItemFields.extend({
  original: ProposalDraftSchema, draft: ProposalDraftSchema,
}).strict().superRefine(itemInvariants);
export type ProposalItemView = z.infer<typeof ProposalItemViewSchema>;
export const ProposalViewSchema = z.object({
  ref: EntityRefSchema, version: z.number().int().positive(),
  title: z.string().min(1), origin: ProposalOriginSchema, items: z.array(ProposalItemViewSchema).min(1),
}).strict();
export type ProposalView = z.infer<typeof ProposalViewSchema>;

/** 老师（或 Host 工具）提出的内容：没有 id、没有 digest、没有状态、没有时间戳。 */
export const ProposalItemInputSchema = z.object({
  effect: ProposalEffectSchema,
  target: EntityRefSchema.nullable().default(null),
  baseline: VersionTokenSchema.nullable().default(null),
}).strict();
export type ProposalItemInput = z.infer<typeof ProposalItemInputSchema>;
export const ProposalInputSchema = z.object({
  title: z.string().trim().min(1),
  origin: ProposalOriginSchema,
  items: z.array(ProposalItemInputSchema).min(1),
}).strict();
export type ProposalInput = z.infer<typeof ProposalInputSchema>;

/**
 * 编辑：默认只换内容，目标与基线保持提案时绑定的那一对。
 *
 * 目标卡已经被人改过、旧基线确定写不进去时，Host 重读目标后可以**显式**把新的一对贴上来
 * （窄 rebase）：`target` 与 `baseline` 必须成对出现，缺一个就是坏输入。这里既不自动取
 * "最新"，也不复制目标的正文——要合并什么由调用方写进 `effect`；重绑本身只是把这一项改成
 * 要写新看到的那个版本。只有从没执行过、或执行者确定没写成的项才允许重绑（领域层判定）。
 */
export const ProposalEditInputSchema = z.object({
  itemId: ProposalItemIdSchema,
  effect: ProposalEffectSchema,
  target: EntityRefSchema.nullable().optional(),
  baseline: VersionTokenSchema.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.target === undefined) !== (value.baseline === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['baseline'], message: '重绑目标与基线必须成对给出' });
  }
});
export type ProposalEditInput = z.infer<typeof ProposalEditInputSchema>;

/** 学生在界面上看到的这一版：记录版本 + 每一项的 draft/digest/target/baseline。 */
export const ProposalSelectionItemSchema = z.object({
  itemId: ProposalItemIdSchema,
  draft: z.number().int().positive(),
  digest: DigestSchema,
  target: EntityRefSchema.nullable(),
  baseline: VersionTokenSchema.nullable(),
}).strict();
export type ProposalSelectionItem = z.infer<typeof ProposalSelectionItemSchema>;
export const ProposalSelectionSchema = z.object({
  revision: z.number().int().positive(),
  items: z.array(ProposalSelectionItemSchema).min(1),
}).strict();
export type ProposalSelection = z.infer<typeof ProposalSelectionSchema>;

/** 展示与写者共用的 canonical 内容：键序固定、空白不参与比较。 */
export function canonicalProposalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalProposalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value as Record<string, unknown>).sort()
      .map(key => JSON.stringify(key) + ':' + canonicalProposalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

/*
 * 摘要本身（`sha256:<hex>`）由领域层的 proposalEffectDigest 从这段 canonical 文本算出，
 * 不放在 schema 包里：这个包是给前端也读的，不该拖进 node:crypto。契约只固定
 * 「哪些字节参与摘要」——展示与写者因此看到同一版内容。
 */
