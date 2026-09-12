/**
 * P5.3 持久确认的领域层（plan §P5.3，CONTRACTS.md §6）。
 *
 * 一份提案是一个原生记录：若干待确认项。propose 冻结原稿，学生的每一次 edit 只追加
 * 一版新稿（原稿与中间版本都留着），confirm 说的是"我看到的是第几版、摘要是什么、
 * 要写到哪个目标、基线是哪个"——对不上就是旧稿确认冲突，绝不把新摘要贴到旧稿上。
 *
 * 关键在提案记录与目标记录是两次独立提交，所以这里不假装它们原子，而是用一个三段式
 * 协议让效果可恢复：
 *   ① 执行之前先把 attempt（稳定 operationId + 冻结的 draft/digest）落进提案记录；
 *   ② 调注入的 executor 写目标对象；
 *   ③ 用 updateCurrent 把 receipt / failure 机械回填。
 * ①与②之间、②与③之间断电都会留下"效果可能已落盘"的项：那时编辑与取消都被拒绝
 * （commit 状态未知），重试沿用同一个 operationId——目标写者按 operation 重放，
 * 于是重试不再产生新效果，只是把已经落下的那次写回来。
 *
 * 执行者抛出的任何异常**默认都算 commit 未知**：目标可能保存成功之后才报错，所以这一版稿
 * 被锁住，只能同 op 重试。只有执行者显式抛 ProposalEffectRejected（它知道写根本没发生，
 * 例如目标写者在条件检查上直接拒绝）才允许改稿或取消。operation 由"提案 + 项 + draft
 * revision"派生：同一版稿重试是同一个 op，改出来的新稿是另一个 op，不会拿新稿去重放
 * 旧稿的成功指纹。
 *
 * 这里不重建 fs journal、不新增记录类型：存储仍是 P1 的 RecordStore（条件 update +
 * 机械 updateCurrent），workspace 仍只有一个写者。
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EntityRefSchema, MutationContextSchema, RevisionSchema } from '@studyforge/contracts';
import type { Digest, EntityRef, HostContext, MutationContext, Revision, VersionToken } from '@studyforge/contracts';
import {
  ProposalEditInputSchema, ProposalInputSchema, ProposalRecordSchema, ProposalSelectionSchema,
  canonicalProposalJson, effectTargetProblem,
} from '@studyforge/contracts/proposals';
import type {
  ProposalEffect, ProposalItem, ProposalRecord, ProposalSelection, ProposalInput, ProposalView,
} from '@studyforge/contracts/proposals';
import type { Saved } from '../storage/record-store.ts';
import { objectRef } from '../ids.ts';
import type { Clock } from '../clock.ts';

/** 提案记录的种类，也是它的 ref 前缀。 */
export const PROPOSAL_KIND = 'proposal';

/** 这一层需要的记录面；一个原生 RecordStore 就满足它。 */
export interface ProposalRecordStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<ProposalRecord>;
  list(ctx: HostContext): Saved<ProposalRecord>[];
  create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<ProposalRecord>>;
  update(ctx: MutationContext, ref: string, input: unknown, transform: (current: ProposalRecord) => unknown): Promise<Saved<ProposalRecord>>;
  /** 机械回填 attempt/receipt：对队列里的真实当前记录做 transform，重放不依赖当前 revision。 */
  updateCurrent(ctx: Omit<MutationContext, 'expectedVersion'>, ref: string, input: unknown, transform: (current: ProposalRecord) => unknown): Promise<Saved<ProposalRecord>>;
}

/** 交给执行者的冻结项：要做的这件事、写到哪、预期哪个基线、认哪一版稿。 */
export interface ProposalEffectItem {
  readonly proposalRef: string;
  readonly itemId: string;
  readonly draftRevision: number;
  readonly digest: Digest;
  readonly effect: ProposalEffect;
  readonly target: EntityRef | null;
  readonly baseline: VersionToken | null;
}

/** 一次真实写入的结果；receipt 直接由它落账。 */
export interface ProposalEffectResult {
  readonly target: EntityRef;
  readonly revision: Revision;
  readonly title: string;
}

/**
 * 注入的执行者：Host 把每个 kind 接到它真正的窄写者上（卡、知识、复习）。
 * `validate` 在提案落盘前跑一遍，`apply` 在确认后带着稳定 operationId 跑；
 * 两者看到的是同一份冻结项，所以校验通过的内容就是将要写的内容。
 */
export interface ProposalExecutor {
  validate?(ctx: HostContext, item: ProposalEffectItem): Promise<void>;
  apply(ctx: MutationContext, item: ProposalEffectItem): Promise<ProposalEffectResult>;
}

/**
 * 执行者用它明确表示"这次确定没有写进目标"：例如窄写者在条件检查上直接拒绝，
 * 或者校验没过就返回了。写者保存之后才失败、超时、断线、进程被杀一律**不要**用它——
 * 那些是 commit 未知，必须让同一版稿锁住并同 op 重试，否则会丢掉已经落下的效果。
 */
export class ProposalEffectRejected extends Error {
  readonly code: string;
  /** 只是"这次没写成"：同 op 再试一次是否有意义，默认有。 */
  readonly retryable: boolean;
  constructor(code: string, retryable = true) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.name = 'ProposalEffectRejected';
  }
}

/** 被这一层的规则拒绝，带确切的原因。 */
export class ProposalError extends Error {
  readonly code: string;
  readonly problems: readonly string[];
  constructor(code: string, problems: readonly string[] = []) {
    super(problems[0] ?? code);
    this.code = code;
    this.problems = problems;
    this.name = 'ProposalError';
  }
}

export class ProposalService {
  private readonly records: ProposalRecordStore;
  private readonly clock: Clock;
  private readonly executor: ProposalExecutor;
  /** 提出提案的进程内串行点；不接受失败，见 `serial`。 */
  private tail: Promise<void> = Promise.resolve();

  constructor(records: ProposalRecordStore, clock: Clock, executor: ProposalExecutor) {
    this.records = records; this.clock = clock; this.executor = executor;
  }

  /**
   * 提出一份提案：逐项冻结目标、基线与原稿。id 是 workspace + operation 的纯函数，
   * 重试同一次提案只会找回同一条记录。整份提案先全验后写，验不过不留半条。
   *
   * 原稿的时间来自那次被接受的操作自己的版本，而不是"现在"：时钟走过之后重试同一次
   * 提案，重建出来的行必须与第一次逐字相同，存储才认得出这是重放（否则就是 record_exists）。
   * 提出本身也在进程内串行，两次同时进来的同名提案不会各读一次时钟。
   * @throws ProposalError `proposal_item_invalid`（新建却带 target/baseline，或反之），
   *   以及 executor 校验器自己的错误码。
   */
  async propose(ctx: MutationContext, input: unknown): Promise<ProposalView> {
    MutationContextSchema.parse(ctx);
    const proposal: ProposalInput = ProposalInputSchema.parse(input);
    const id = derive('prop_', `${ctx.workspaceId}:${ctx.operationId}`);
    const ref = objectRef(PROPOSAL_KIND, id);
    return this.serial(async () => {
      const existing = this.optional(ctx, ref), fresh = this.clock.now();
      const items: ProposalItem[] = [];
      for (const [index, item] of proposal.items.entries()) {
        const itemId = itemIdAt(index);
        const problem = effectTargetProblem(item.effect, item.target, item.baseline);
        if (problem !== null) throw new ProposalError('proposal_item_invalid', [`${itemId}: ${problem}`]);
        await this.executor.validate?.(ctx, freeze(ref, itemId, item.target, item.baseline, 1, item.effect));
        items.push({
          id: itemId, target: item.target, baseline: item.baseline, status: 'pending',
          drafts: [{
            revision: 1, digest: proposalEffectDigest(item.effect), effect: item.effect, authoredBy: ctx.actor,
            at: existing?.data.items[index]?.drafts[0]?.at ?? fresh,
          }],
        });
      }
      const record = ProposalRecordSchema.parse({ title: proposal.title, origin: proposal.origin, items });
      return toView(await this.records.create(withoutVersion(ctx), id, record));
    });
  }

  /**
   * 学生改稿：只追加一版新稿，原稿不动，目标与基线不动。
   * 学生改稿要的是那一个确切 revision（token 必须是数字，digest 不是改稿的基线）。
   * 目标卡已经被人改过、旧基线确定写不进去时，可显式成对给出重读后的 target/baseline（窄 rebase）；
   * 不给出时沿用提案时绑定的那一对，领域层从不自己去读"最新"。
   * 新旧稿的判定交给存储：同一个 operation 的重放很可能是"上一次其实已经写成了、
   * 只是回复没回来"，那时它回那一版而不是冲突；真的换了 revision 才 `version_conflict`。
   * @throws ProposalError `proposal_expected_version_required` 没有精确基线、
   *   `proposal_item_closed` 已应用或被取消、`proposal_commit_unknown` 上一次执行的结果
   *   还不知道（已开跑而没回填，或执行者只是报错——效果可能已经落盘）、
   *   `proposal_item_kind_fixed` 换了一件事、`proposal_item_invalid` 重绑后的目标/基线
   *   与这件事不合（例如给新建版贴上了一个已有目标）。
   * @throws RecordError `version_conflict` 提案本身被别处改过。
   */
  async edit(ctx: MutationContext, ref: string, input: unknown): Promise<ProposalView> {
    MutationContextSchema.parse(ctx);
    if (typeof ctx.expectedVersion !== 'number') throw new ProposalError('proposal_expected_version_required');
    const change = ProposalEditInputSchema.parse(input);
    // 用调用方说的那一个 revision 生成新稿，不拿"现在读到的最新版"当基线：
    // 丢 ACK 的重试必须在存储里重放成原来那一版，只有真的过期才冲突。
    const item = itemOf(this.records.read(ctx, ref, ctx.expectedVersion).data, change.itemId);
    assertEditable(item);
    if (item.drafts[0]!.effect.kind !== change.effect.kind) throw new ProposalError('proposal_item_kind_fixed', [item.id]);
    // 窄 rebase：只有调用方显式成对给出时才换目标与基线，绝不自动取"最新"。
    const target = change.target === undefined ? item.target : change.target;
    const baseline = change.baseline === undefined ? item.baseline : change.baseline;
    const problem = effectTargetProblem(change.effect, target, baseline);
    if (problem !== null) throw new ProposalError('proposal_item_invalid', [`${item.id}: ${problem}`]);
    const draft = { revision: item.drafts.length + 1, digest: proposalEffectDigest(change.effect), effect: change.effect, authoredBy: ctx.actor, at: this.clock.now() };
    await this.executor.validate?.(ctx, freeze(ref, item.id, target, baseline, draft.revision, draft.effect));
    // 改稿把失败项带回 pending：那次失败属于被替换掉的旧稿，attempt 会按新稿重记。
    // 新稿的 operation 带自己的 draft revision，所以它绝不会重放旧稿的成功指纹。
    const edited: ProposalItem = { id: item.id, target, baseline, drafts: [...item.drafts, draft], status: 'pending' };
    return toView(await this.records.update(ctx, ref, change, row => withItem(row, edited)));
  }

  /**
   * 确认学生看到的那一版：先按所见 revision 条件落 attempt（执行前冻结），再逐项执行，
   * 最后回填真实 receipt / failure。已成功的项直接跳过，所以多按一次不会写第二遍。
   * @throws ProposalError `proposal_stale_confirmation`（摘要/目标/基线/记录版本对不上）、
   *   `proposal_item_missing`、`proposal_item_closed`、`proposal_operation_mismatch`。
   * @throws RecordError `version_conflict` 另一处同时确认/编辑（写队列只放一个通过）。
   */
  async confirm(ctx: MutationContext, ref: string, input: unknown): Promise<ProposalView> {
    MutationContextSchema.parse(ctx);
    const selection: ProposalSelection = ProposalSelectionSchema.parse(input);
    if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== selection.revision) throw new ProposalError('proposal_stale_confirmation', ['proposal-record']);
    const probe = this.records.read(ctx, ref);
    const chosen = selectItems(probe.data, selection, 'confirm');
    const attempts = chosen.map(item => ({
      itemId: item.id, operationId: stableEffectOperationId(ref, item.id, item.drafts.at(-1)!.revision),
    }));
    const at = this.clock.now();
    // ① 执行之前先落 attempt。
    await this.records.update({ ...ctx, expectedVersion: selection.revision }, ref,
      AttemptInputSchema.parse({ attempts }), row => withAttempts(ref, row, attempts, at, ctx));

    const current = this.records.read(ctx, ref);
    const outcomes: z.output<typeof OutcomeInputSchema>['outcomes'] = [];
    for (const item of current.data.items) {
      const attempt = attempts.find(entry => entry.itemId === item.id);
      if (!attempt) continue;
      // 成功项不重复；被取消的项不再执行。
      if (item.status === 'applied' || item.status === 'rejected') continue;
      const draft = item.drafts.at(-1)!;
      const operationId = stableEffectOperationId(ref, item.id, draft.revision);
      if (item.attempt !== undefined && item.attempt.operationId !== operationId) throw new ProposalError('proposal_operation_mismatch', [item.id]);
      const frozen = freeze(ref, item.id, item.target, item.baseline, draft.revision, draft.effect);
      try {
        // ② 写入目标对象；同一个 operationId 重试由目标写者自己重放。
        const result = await this.executor.apply(effectContext(ctx, operationId, frozen), frozen);
        outcomes.push({ itemId: item.id, operationId, status: 'applied', target: result.target, revision: result.revision, title: result.title });
      } catch (error) {
        // 默认按 commit 未知处理：目标可能保存成功之后才报错。只有执行者显式拒绝才是"确定没写"。
        const rejected = error instanceof ProposalEffectRejected;
        outcomes.push({
          itemId: item.id, operationId, status: 'failed', code: errorCode(error),
          retryable: rejected ? error.retryable : isRetryable(error), commit: rejected ? 'none' : 'unknown',
        });
      }
    }
    if (outcomes.length === 0) return toView(current);
    // ③ 机械回填：只认这一版还冻结着 attempt 的项。
    const outcomeInput = OutcomeInputSchema.parse({ confirmationId: ctx.operationId, outcomes });
    // 回填是确认动作之后的第②步，用派生 op：记录里既留下这次确认，又不会和①同 op 打架。
    const backfill = { ...withoutVersion(ctx), operationId: ctx.operationId + OUTCOME_SUFFIX };
    return toView(await this.records.updateCurrent(backfill, ref, outcomeInput, row => withOutcomes(row, outcomeInput, this.clock.now())));
  }

  /**
   * 取消还没执行完的项：只有从没执行过、或执行者确定没写成的项（`commit: 'none'`）能取消。
   * 已经开跑却没有结果、或默认异常留下的项都算 commit 未知——那可能已经落盘，先同 op 重试。
   * 已应用的事实不被撤销。
   * @throws ProposalError `proposal_stale_confirmation`、`proposal_item_closed`、`proposal_commit_unknown`。
   */
  async reject(ctx: MutationContext, ref: string, input: unknown): Promise<ProposalView> {
    MutationContextSchema.parse(ctx);
    const selection: ProposalSelection = ProposalSelectionSchema.parse(input);
    if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== selection.revision) throw new ProposalError('proposal_stale_confirmation', ['proposal-record']);
    const probe = this.records.read(ctx, ref);
    const chosen = selectItems(probe.data, selection, 'reject');
    const decision = RejectionInputSchema.parse({
      items: chosen.map(item => ({ itemId: item.id, draft: item.drafts.at(-1)!.revision, digest: item.drafts.at(-1)!.digest })),
    });
    return toView(await this.records.update({ ...ctx, expectedVersion: selection.revision }, ref,
      decision, row => withRejection(row, decision, this.clock.now())));
  }

  /** 提出提案在进程内串行：两次同时进来的同名提案不会各自读一次时钟再撞上。 */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 记录还不存在时返回 undefined；其余错误照旧抛。 */
  private optional(ctx: HostContext, ref: string): Saved<ProposalRecord> | undefined {
    try {
      return this.records.read(ctx, ref);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'record_missing') return undefined;
      throw error;
    }
  }

  /** 一个一致读，可以是当前版本或某个确切的历史版本。 */
  read(ctx: HostContext, ref: string, revision?: number): ProposalView {
    return toView(this.records.read(ctx, ref, revision));
  }

  /** 这个 workspace 里的全部提案。 */
  list(ctx: HostContext): ProposalView[] {
    return this.records.list(ctx).map(toView);
  }
}

/** 一版稿件的摘要：只由 canonical 内容决定，展示与写者因此认的是同一版。 */
export function proposalEffectDigest(effect: ProposalEffect): Digest {
  return 'sha256:' + createHash('sha256').update(canonicalProposalJson(effect)).digest('hex');
}

/**
 * 效果 operation 从提案、项与这一版稿派生：同一版稿重试、重启都得到同一个 op
 * （"失败后换 op"在这层不可能），学生改出新稿则得到另一个 op，绝不重放旧稿的指纹。
 */
export function stableEffectOperationId(proposalRef: string, itemId: string, draftRevision: number): string {
  return `${proposalRef}:${itemId}:v${draftRevision}`;
}

/** 项的身份由它在提案里的顺序决定，模型不发明 id。 */
function itemIdAt(index: number): string {
  return `item-${index + 1}`;
}

function freeze(ref: string, itemId: string, target: EntityRef | null, baseline: VersionToken | null, draftRevision: number, effect: ProposalEffect): ProposalEffectItem {
  return { proposalRef: ref, itemId, draftRevision, digest: proposalEffectDigest(effect), effect, target, baseline };
}

/** 执行者拿到的上下文：workspace/actor/session 仍来自 Host，operation 与基线由这里给。 */
function effectContext(ctx: MutationContext, operationId: string, item: ProposalEffectItem): MutationContext {
  const { expectedVersion: _ignored, ...rest } = ctx;
  return {
    ...rest, operationId,
    ...(item.baseline === null ? {} : { expectedVersion: item.baseline }),
  };
}

function withoutVersion(ctx: MutationContext): Omit<MutationContext, 'expectedVersion'> {
  const { expectedVersion: _ignored, ...rest } = ctx;
  return rest;
}

function itemOf(row: ProposalRecord, itemId: string): ProposalItem {
  const item = row.items.find(entry => entry.id === itemId);
  if (item === undefined) throw new ProposalError('proposal_item_missing', [itemId]);
  return item;
}

/**
 * 只有"从没执行过"或"执行者确定没写"的项才允许改稿与取消。默认异常、以及执行到一半断电，
 * 留下的都是 commit 未知：效果可能已经在目标里了，换稿或取消都会丢掉它，所以只能同 op 重试。
 */
function assertOpenForChange(item: ProposalItem): void {
  if (item.status === 'applied' || item.status === 'rejected') throw new ProposalError('proposal_item_closed', [item.id]);
  if (item.status === 'pending') {
    if (item.attempt !== undefined) throw new ProposalError('proposal_commit_unknown', [item.id]);
    return;
  }
  if (item.failure?.commit !== 'none') throw new ProposalError('proposal_commit_unknown', [item.id]);
}

function assertEditable(item: ProposalItem): void {
  assertOpenForChange(item);
}

/**
 * 只接受"学生看到的那一版"：记录版本 + 每一项的 draft/digest/target/baseline 都要对上。
 * confirm 允许已经成功的项（跳过即不重复），reject 只接受还没落地的项。
 */
function selectItems(row: ProposalRecord, selection: ProposalSelection, mode: 'confirm' | 'reject'): ProposalItem[] {
  return selection.items.map(selected => {
    const item = row.items.find(entry => entry.id === selected.itemId);
    if (item === undefined) throw new ProposalError('proposal_item_missing', [selected.itemId]);
    const draft = item.drafts.at(-1)!;
    if (draft.revision !== selected.draft || draft.digest !== selected.digest
      || item.target !== selected.target || item.baseline !== selected.baseline) {
      throw new ProposalError('proposal_stale_confirmation', [selected.itemId]);
    }
    if (mode === 'confirm') {
      if (item.status === 'rejected') throw new ProposalError('proposal_item_closed', [selected.itemId]);
      return item;
    }
    assertOpenForChange(item);
    return item;
  });
}

/** 只换一项，其余项（以及整个记录的其他字段）原样保留。 */
function withItem(row: ProposalRecord, item: ProposalItem): ProposalRecord {
  return { ...row, items: row.items.map(entry => entry.id === item.id ? item : entry) };
}

/**
 * 执行前冻结 attempt。已有 attempt 的项保持原样——重试沿用同一个 op 与同一版稿，
 * 换上别的 op 或别的稿都会在这里被拒绝。
 */
function withAttempts(
  ref: string,
  row: ProposalRecord,
  attempts: z.output<typeof AttemptInputSchema>['attempts'],
  at: string,
  ctx: MutationContext,
): ProposalRecord {
  return {
    ...row,
    items: row.items.map(item => {
      const attempt = attempts.find(entry => entry.itemId === item.id);
      if (attempt === undefined || item.status === 'applied' || item.status === 'rejected') return item;
      if (item.attempt !== undefined) {
        if (item.attempt.operationId !== attempt.operationId) throw new ProposalError('proposal_operation_mismatch', [item.id]);
        return item;
      }
      const draft = item.drafts.at(-1)!;
      // 冻结的是"这一版稿 + 这一版稿的 op"：对不上说明选择与记录已经不是同一版。
      if (attempt.operationId !== stableEffectOperationId(ref, item.id, draft.revision)) throw new ProposalError('proposal_stale_confirmation', [item.id]);
      return {
        ...item,
        attempt: {
          operationId: attempt.operationId, draft: draft.revision, digest: draft.digest, at, actor: ctx.actor,
          ...(ctx.sessionId === undefined ? {} : { sessionId: ctx.sessionId }),
        },
      };
    }),
  };
}

/**
 * 回填真实结果。只认这一版仍冻结着同一 attempt 的项：学生改过稿、或这一项已经被取消，
 * 都在这里变成冲突，而不是把收据悄悄贴到别的版本上。
 */
function withOutcomes(row: ProposalRecord, input: z.output<typeof OutcomeInputSchema>, at: string): ProposalRecord {
  return {
    ...row,
    items: row.items.map(item => {
      const outcome = input.outcomes.find(entry => entry.itemId === item.id);
      if (outcome === undefined) return item;
      if (item.status === 'applied') {
        if (item.receipt?.operationId !== outcome.operationId) throw new ProposalError('proposal_receipt_conflict', [item.id]);
        return item;
      }
      if (item.status === 'rejected') throw new ProposalError('proposal_item_closed', [item.id]);
      const draft = item.drafts.at(-1)!;
      if (item.attempt === undefined || item.attempt.operationId !== outcome.operationId
        || item.attempt.draft !== draft.revision || item.attempt.digest !== draft.digest) {
        throw new ProposalError('proposal_attempt_missing', [item.id]);
      }
      if (outcome.status === 'failed') {
        return { ...item, status: 'failed', failure: { code: outcome.code, at, retryable: outcome.retryable, commit: outcome.commit } };
      }
      return {
        ...item, status: 'applied',
        receipt: {
          confirmationId: input.confirmationId, operationId: outcome.operationId, at,
          target: outcome.target, revision: outcome.revision, title: outcome.title,
        },
      };
    }),
  };
}

/** 取消：只动这一版仍冻结着的、还没落地的项；已应用的事实不在这里被碰到。 */
function withRejection(row: ProposalRecord, input: z.output<typeof RejectionInputSchema>, at: string): ProposalRecord {
  return {
    ...row,
    items: row.items.map(item => {
      const decision = input.items.find(entry => entry.itemId === item.id);
      if (decision === undefined) return item;
      const draft = item.drafts.at(-1)!;
      if (draft.revision !== decision.draft || draft.digest !== decision.digest) throw new ProposalError('proposal_stale_confirmation', [item.id]);
      assertOpenForChange(item);
      return { ...item, status: 'rejected' };
    }),
  };
}

/** 只把冻结的东西读出来给展示看；摘要对不上说明记录被改坏了，不猜。 */
function toView(saved: Saved<ProposalRecord>): ProposalView {
  for (const item of saved.data.items) {
    for (const draft of item.drafts) {
      if (draft.digest !== proposalEffectDigest(draft.effect)) throw new ProposalError('proposal_corrupt', [item.id]);
    }
  }
  return {
    ref: saved.ref, version: saved.version, title: saved.data.title, origin: saved.data.origin,
    items: saved.data.items.map(item => ({ ...item, original: item.drafts[0]!, draft: item.drafts.at(-1)! })),
  };
}

/** 一次效果失败的读法：写者自己的错误码保留，重试默认安全（同 op 重放）。 */
function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return error instanceof Error && error.name !== '' ? error.name : 'proposal_effect_failed';
}

function isRetryable(error: unknown): boolean {
  return !(typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === false);
}

/** 一次确认的第二步（回执回填）在记录里的 operation 后缀。 */
const OUTCOME_SUFFIX = ':outcome';

/** 记录 id 是 workspace + operation 的纯函数：重试找回同一条提案。 */
function derive(prefix: string, seed: string): string {
  return prefix + createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

/** 只进 fingerprint 的机械输入：没有时间戳、没有易变的当前 revision。 */
const AttemptInputSchema = z.object({
  attempts: z.array(z.object({ itemId: z.string().min(1), operationId: z.string().min(1) }).strict()).min(1),
}).strict();

const OutcomeInputSchema = z.object({
  confirmationId: z.string().min(1),
  outcomes: z.array(z.discriminatedUnion('status', [
    z.object({
      itemId: z.string().min(1), operationId: z.string().min(1), status: z.literal('applied'),
      target: EntityRefSchema, revision: RevisionSchema, title: z.string().min(1),
    }).strict(),
    z.object({
      itemId: z.string().min(1), operationId: z.string().min(1), status: z.literal('failed'),
      code: z.string().min(1), retryable: z.boolean(), commit: z.enum(['none', 'unknown']),
    }).strict(),
  ])).min(1),
}).strict();

const RejectionInputSchema = z.object({
  items: z.array(z.object({ itemId: z.string().min(1), draft: z.number().int().positive(), digest: z.string().min(1) }).strict()).min(1),
}).strict();
