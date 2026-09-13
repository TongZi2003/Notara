import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm';
import { createHash } from 'node:crypto';
import type { HostContext } from '@studyforge/contracts';
import type { ReceiptOutbox, OutboxEntry } from '@studyforge/domain/receipt-outbox';
import type { ProposalService } from '@studyforge/domain/proposals';

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
      for (const entry of this.outbox.pending(context)) {
        const proposal = this.proposals.read(context, entry.proposalRef);
        if (proposal.origin.kind !== 'native') continue;
        const sessionId = proposal.origin.sessionId;
        if (context.sessionId && context.sessionId !== sessionId) continue;
        await this.deliver({ ...context, sessionId, actor: 'system' }, entry);
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }
  private async deliver(context: HostContext, entry: OutboxEntry): Promise<void> {
    const sessionId = context.sessionId!;
    await this.host.studyforgeAccess.forSession(sessionId);
    const resolved = await this.host.sessionController.resolveAgent(SessionId(sessionId));
    if ('error' in resolved) throw new Error(resolved.error.code);
    const id = MessageId('sf-receipt-' + createHash('sha256').update(entry.receipt.operationId).digest('hex'));
    const observation = await this.host.sessionQuery.observeSession(SessionId(sessionId));
    let admitted: boolean;
    try {
      admitted = observation.events.some(event => event.type === 'user/message' ? event.data.id === id
        : event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === id));
    } finally { observation[Symbol.dispose](); }
    if (!admitted) {
      const summary = `已收好《${entry.receipt.title}》。`;
      const message: UserMessage = { id, role: 'user', source: { kind: 'plugin', plugin: 'studyforge', form: 'notice', summary: summary.slice(0, 120) },
        content: [{ type: 'text', text: `【单据·结果】${summary}\n这是已经完成的系统回执，不是学生原话；不要重复执行本次写入，继续学生正在进行的任务。保存只确认本次结果，不授权更换任务或开始讲题、测验；原任务已完成就简短说明并等待下一步。` }] };
      resolved.agent.followup(message);
    }
    // If this flush fails, the receipt remains pending. Retry checks the same
    // native admission ID before sending; a crash never changes message identity.
    await this.host.sessions.flush(resolved.agent.session);
    await this.outbox.markDelivered({ ...context, operationId: 'deliver:' + entry.receipt.operationId }, [{ proposalRef: entry.proposalRef, itemId: entry.itemId }]);
  }
}
