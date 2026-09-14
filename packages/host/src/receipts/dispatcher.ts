import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm';
import { createHash } from 'node:crypto';
import type { HostContext } from '@studyforge/contracts';
import type { ReceiptOutbox, OutboxEntry } from '@studyforge/domain/receipt-outbox';
import type { ProposalService } from '@studyforge/domain/proposals';
import { entityReferenceContent } from '../tools/entity-reference-output.ts';

/** Persisted native inbox admission is the delivery boundary, not model consumption. */
export class ReceiptDispatcher {
  private tail: Promise<void> = Promise.resolve();
  constructor(host: Context, proposals: ProposalService, outbox: ReceiptOutbox) {
    this.host = host; this.proposals = proposals; this.outbox = outbox;
  }
  private readonly host: Context;
  private readonly proposals: ProposalService;
  private readonly outbox: ReceiptOutbox;
  async flush(context: HostContext): Promise<void> {
    const job = this.tail.then(async () => {
      const groups = new Map<string, OutboxEntry[]>();
      // Group by the actual student confirmation, including delivered members
      // so a retry after admission keeps exactly the same message identity.
      for (const entry of this.outbox.list(context)) {
        const key = JSON.stringify([entry.proposalRef, entry.receipt.confirmationId]);
        groups.set(key, [...(groups.get(key) ?? []), entry]);
      }
      for (const entries of groups.values()) {
        if (entries.every(entry => entry.receipt.deliveredAt !== undefined)) continue;
        const entry = entries[0]!;
        const proposal = this.proposals.read(context, entry.proposalRef);
        if (proposal.origin.kind !== 'native') continue;
        const sessionId = proposal.origin.sessionId;
        if (context.sessionId && context.sessionId !== sessionId) continue;
        await this.deliver({ ...context, sessionId, actor: 'system' }, entries);
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }
  private async deliver(context: HostContext, entries: readonly OutboxEntry[]): Promise<void> {
    const entry = entries[0]!;
    const sessionId = context.sessionId!;
    await this.host.studyforgeAccess.forSession(sessionId);
    const resolved = await this.host.sessionController.resolveAgent(SessionId(sessionId));
    if ('error' in resolved) throw new Error(resolved.error.code);
    const operation = entries.length === 1 ? entry.receipt.operationId : JSON.stringify([entry.proposalRef, entry.receipt.confirmationId]);
    const id = MessageId('sf-receipt-' + createHash('sha256').update(operation).digest('hex'));
    const observation = await this.host.sessionQuery.observeSession(SessionId(sessionId));
    let admitted: boolean;
    try {
      admitted = observation.events.some(event => event.type === 'user/message' ? event.data.id === id
        : event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === id));
    } finally { observation[Symbol.dispose](); }
    if (!admitted) {
      const summary = entries.length === 1 ? `已收好《${entry.receipt.title}》。`
        : `本次已一起保存 ${entries.length} 项：${entries.map(item => `《${item.receipt.title}》`).join('、')}。`;
      const message: UserMessage = { id, role: 'user', source: { kind: 'plugin', plugin: 'studyforge', form: 'notice', summary: summary.slice(0, 120) },
        content: [{ type: 'text', text: `【单据·结果】${summary}\n这是已经完成的系统回执，不是学生原话；不要重复执行本次写入，继续学生正在进行的任务。保存只确认本次结果，不授权更换任务或开始讲题、测验；原任务已完成就简短说明并等待下一步。` }, ...entityReferenceContent(entries.map(item=>({ref:item.receipt.target,version:item.receipt.revision,title:item.receipt.title})))] };
      resolved.agent.followup(message);
    }
    // If this flush fails, the receipt remains pending. Retry checks the same
    // native admission ID before sending; a crash never changes message identity.
    await this.host.sessions.flush(resolved.agent.session);
    await this.outbox.markDelivered({ ...context, operationId: 'deliver:' + operation }, entries.map(item => ({ proposalRef: item.proposalRef, itemId: item.itemId })));
  }
}
