/**
 * P7.5 小结的读写（plan §P7.5，CONTRACTS.md §7）。
 *
 * 一份 handoff 是老师自由正文加上只由 Host 供的两样事实：这次小结写到的真实 native
 * 输入截止点、以及当时系统真正持有的材料/写入/待确认清单。模型写不出 ID、时间、截止点
 * 或清单；它只写正文。正文改一次就是同一记录的一个新不可变 revision，旧 revision 永远
 * 读得到，所以已经接过这一课的下一课仍固定在它当初收到的那一版。
 *
 * 这里的记录身份由接受的操作派生（`workspaceId:operationId`），所以同一个操作怎么重试
 * 都是同一份小结；第一次真正写入的时间与截止点被冻结在记录里，重试复用它们而不是再取
 * 一次时钟——移动时钟的重试不会变成第二次写入，也不会报 operation_conflict。
 */
import { createHash } from 'node:crypto';
import type { HostContext, MutationContext } from '@studyforge/contracts';
import type { HandoffCloseInput, HandoffCorrection, HandoffPin, HandoffRecord, HandoffView } from '@studyforge/contracts/handoffs';
import { objectRef } from '../ids.ts';
import type { Clock } from '../clock.ts';
import { RecordError, type PreparedRecordChange, type Saved } from '../storage/record-store.ts';

/** The record kind one saved summary lives under; P7 owns the same kind. */
export const HANDOFF_KIND = 'handoff';

/** The record surface this service needs; one native `RecordStore` satisfies it. */
export interface HandoffStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<HandoffRecord>;
  list(ctx: HostContext): Saved<HandoffRecord>[];
  create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<HandoffRecord>>;
  update(ctx: MutationContext, ref: string, input: unknown, transform: (current: HandoffRecord) => unknown): Promise<Saved<HandoffRecord>>;
  prepareCreate(ctx: MutationContext, id: string, input: unknown): PreparedRecordChange<HandoffRecord>;
}

export class HandoffService {
  private readonly records: HandoffStore;
  private readonly clock: Clock;
  constructor(records: HandoffStore, clock: Clock) { this.records = records; this.clock = clock; }

  /** The record id one accepted close operation writes; a retry restores the same one. */
  idFor(ctx: MutationContext): string {
    return 'h_' + createHash('sha256').update(`${ctx.workspaceId}:${ctx.operationId}`).digest('hex').slice(0, 24);
  }

  /** The ref one accepted close operation writes. */
  refFor(ctx: MutationContext): string { return objectRef(HANDOFF_KIND, this.idFor(ctx)); }

  /**
   * The exact record one close writes. A retry reuses what the first attempt
   * really froze, so a moved clock, a re-derived cutoff or a re-read fact list
   * can never turn one confirm into a second summary.
   */
  frozen(ctx: MutationContext, input: HandoffCloseInput): HandoffRecord {
    const existing = this.optional(ctx, this.refFor(ctx));
    if (existing !== undefined) return existing.data;
    return {
      sessionId: requiredSession(ctx),
      title: input.draft.title,
      body: input.draft.body,
      cutoff: input.cutoff,
      facts: [...(input.facts ?? [])],
      ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
      createdAt: this.clock.now(),
    };
  }

  /**
   * Prepare — but do not publish — the summary so the confirmed close can put it
   * and its closing fact in one native update.
   */
  prepareClose(ctx: MutationContext, input: HandoffCloseInput): { readonly change: PreparedRecordChange<HandoffRecord>; readonly ref: string; readonly record: HandoffRecord } {
    const id = this.idFor(ctx), record = this.frozen(ctx, input);
    return { change: this.records.prepareCreate(ctx, id, record), ref: objectRef(HANDOFF_KIND, id), record };
  }

  /** One exact read, current or at a named older revision. */
  read(ctx: HostContext, ref: string, revision?: number): HandoffView { return viewOf(this.records.read(ctx, ref, revision)); }

  /** Every summary this workspace holds, ordered by identity. */
  list(ctx: HostContext): HandoffView[] { return this.records.list(ctx).sort(byRef).map(viewOf); }

  /** The exact revision one lesson continued from; a later correction never moves it. */
  readPinned(ctx: HostContext, pin: HandoffPin): HandoffView {
    const view = this.read(ctx, pin.ref, pin.version);
    if (view.version !== pin.version) throw new RecordError('handoff_pin_missing');
    return view;
  }

  /**
   * Correct the teacher's own words: a new immutable revision of the same record.
   * The cutoff, the system facts and the continuation stay exactly as frozen; the
   * older revision remains readable for every lesson that already received it.
   * @throws RecordError `handoff_expected_version_required`, `version_conflict`,
   *   `record_missing`.
   */
  async correct(ctx: MutationContext, ref: string, correction: HandoffCorrection): Promise<HandoffView> {
    if (ctx.expectedVersion === undefined) throw new RecordError('handoff_expected_version_required');
    const saved = await this.records.update(ctx, ref, correction, row => ({
      ...row, title: correction.title ?? row.title, body: correction.body,
    }));
    return viewOf(saved);
  }

  private optional(ctx: HostContext, ref: string): Saved<HandoffRecord> | undefined {
    try { return this.records.read(ctx, ref); }
    // The workspace's own reads report `record_missing`; a test may hold this
    // service and its store as two module instances, so match the code, not the
    // class identity (the same idiom skeleton/material/route services use).
    catch (error) { if (codeOf(error) === 'record_missing') return undefined; throw error; }
  }
}

function viewOf(saved: Saved<HandoffRecord>): HandoffView {
  return { ref: saved.ref, version: saved.version, ...saved.data };
}

function requiredSession(ctx: HostContext): string {
  if (ctx.purpose !== 'learning' || !ctx.sessionId) throw new RecordError('learning_session_required');
  return ctx.sessionId;
}

function byRef(left: { readonly ref: string }, right: { readonly ref: string }): number {
  return left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0;
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
