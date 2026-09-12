/**
 * P5.3 回执 outbox（plan §P5.3）。
 *
 * 回执不存在别的地方：一个项什么时候真的写成了，receipt 就落在那个项自己身上
 * （target / revision / 当时的标题 / 是哪次确认）。outbox 只是它的读侧投影——
 * 没写成的项不会出现在这里，所以界面上不会先看到"已记录"再等真实写入。
 *
 * 投递是一次手工交接：Host 读 pending、把回执发到原课，然后回来盖章。这里只记
 * `deliveredAt`（这张回执已经交出去了），不造"学生已消费/已读"的 ACK——那是观测
 * 不到的，原生投递的 exactly-once 由 Host 自己核。
 */
import { z } from 'zod';
import { MutationContextSchema } from '@studyforge/contracts';
import type { HostContext, MutationContext } from '@studyforge/contracts';
import type { ProposalReceipt, ProposalRecord } from '@studyforge/contracts/proposals';
import type { Clock } from '../clock.ts';
import { ProposalError, type ProposalRecordStore } from './proposal-service.ts';

/** 一张已经写成的回执，和它属于哪份提案的哪一项。 */
export interface OutboxEntry {
  readonly proposalRef: string;
  readonly itemId: string;
  readonly receipt: ProposalReceipt;
}

/** 投递时按提案分组：同一份提案一次更新，不逐项各写一遍。 */
export interface OutboxTarget {
  readonly proposalRef: string;
  readonly itemId: string;
}

export class ReceiptOutbox {
  private readonly records: ProposalRecordStore;
  private readonly clock: Clock;

  constructor(records: ProposalRecordStore, clock: Clock) {
    this.records = records; this.clock = clock;
  }

  /** 全部真实回执（含已投递），按提案与项的顺序。 */
  list(ctx: HostContext): OutboxEntry[] {
    return this.records.list(ctx).flatMap(saved => entriesOf(saved.ref, saved.data));
  }

  /** 还没交出去的那些。 */
  pending(ctx: HostContext): OutboxEntry[] {
    return this.list(ctx).filter(entry => entry.receipt.deliveredAt === undefined);
  }

  /**
   * 给已经真正投递出去的回执盖章，返回这一次新盖的数量。
   * @throws ProposalError `proposal_receipt_missing`：项还没有真实回执（不能凭空投递）。
   */
  async markDelivered(ctx: MutationContext, targets: readonly OutboxTarget[]): Promise<number> {
    MutationContextSchema.parse(ctx);
    const groups = new Map<string, string[]>();
    for (const target of targets) {
      const itemIds = groups.get(target.proposalRef) ?? [];
      if (!itemIds.includes(target.itemId)) itemIds.push(target.itemId);
      groups.set(target.proposalRef, itemIds);
    }
    let marked = 0;
    for (const [ref, itemIds] of groups) {
      const input = DeliveryInputSchema.parse({ delivered: itemIds.map(itemId => ({ itemId })) });
      const at = this.clock.now(), counted = { value: 0 };
      await this.records.updateCurrent(withoutVersion(ctx), ref, input, row => withDelivery(row, input, at, counted));
      marked += counted.value;
    }
    return marked;
  }
}

function entriesOf(proposalRef: string, row: ProposalRecord): OutboxEntry[] {
  return row.items.flatMap(item => item.receipt === undefined ? [] : [{ proposalRef, itemId: item.id, receipt: item.receipt }]);
}

/** 只翻还没投递的那几张，已投递的保持它第一次的时间。 */
function withDelivery(row: ProposalRecord, input: z.output<typeof DeliveryInputSchema>, at: string, counted: { value: number }): ProposalRecord {
  return {
    ...row,
    items: row.items.map(item => {
      if (!input.delivered.some(entry => entry.itemId === item.id)) return item;
      const receipt = item.receipt;
      if (receipt === undefined) throw new ProposalError('proposal_receipt_missing', [item.id]);
      if (receipt.deliveredAt !== undefined) return item;
      counted.value += 1;
      return { ...item, receipt: { ...receipt, deliveredAt: at } };
    }),
  };
}

function withoutVersion(ctx: MutationContext): Omit<MutationContext, 'expectedVersion'> {
  const { expectedVersion: _ignored, ...rest } = ctx;
  return rest;
}

/** 只进 fingerprint 的机械输入：投递的是哪几项，不带时间戳与当前 revision。 */
const DeliveryInputSchema = z.object({
  delivered: z.array(z.object({ itemId: z.string().min(1) }).strict()).min(1),
}).strict();
