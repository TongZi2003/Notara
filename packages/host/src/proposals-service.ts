import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { EntityRefSchema, type HostContext } from '@studyforge/contracts';
import { ProposalEditInputSchema, ProposalSelectionSchema, type ProposalEditInput, type ProposalSelection, type ProposalView } from '@studyforge/contracts/proposals';
import type { ProposalService } from '@studyforge/domain/proposals';
import type { ReceiptOutbox } from '@studyforge/domain/receipt-outbox';
import type { ReceiptDispatcher } from './receipts/dispatcher.ts';
import { studentContext } from './learning-service.ts';

declare module '@deepseek-ai/cordis' { interface Context {
  studyforgeProposals: StudyForgeProposals; studyforgeProposalService: ProposalService;
  studyforgeReceiptOutbox: ReceiptOutbox; studyforgeReceiptDispatcher: ReceiptDispatcher;
} }
const DecisionSchema = z.object({ operationId: z.string().min(1), target: EntityRefSchema, selection: ProposalSelectionSchema }).strict();

export class StudyForgeProposals extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeProposals'); }
  private async context(target: string): Promise<HostContext> {
    const workspace = await studentContext(this.ctx), proposal = this.ctx.studyforgeProposalService.read(workspace, target);
    return studentContext(this.ctx, proposal.origin.kind === 'native' ? proposal.origin.sessionId : undefined);
  }
  @Remote('list')
  async list(input: { sessionId?: string }): Promise<ProposalView[]> {
    const parsed = z.object({ sessionId: z.string().optional() }).strict().parse(input), ctx = await studentContext(this.ctx, parsed.sessionId);
    return this.ctx.studyforgeProposalService.list(ctx).filter(view => !parsed.sessionId || view.origin.kind === 'native' && view.origin.sessionId === parsed.sessionId);
  }
  @Remote('read')
  async read(input: { target: string }): Promise<ProposalView> {
    const target = EntityRefSchema.parse(input.target);
    return this.ctx.studyforgeProposalService.read(await this.context(target), target);
  }
  @Remote('edit')
  async edit(input: { operationId: string; target: string; expectedVersion: number; edit: ProposalEditInput }): Promise<ProposalView> {
    const parsed = z.object({ operationId: z.string().min(1), target: EntityRefSchema, expectedVersion: z.number().int().positive(), edit: ProposalEditInputSchema }).strict().parse(input);
    return this.ctx.studyforgeProposalService.edit({ ...await this.context(parsed.target), operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.target, parsed.edit);
  }
  @Remote('confirm')
  async confirm(input: { operationId: string; target: string; selection: ProposalSelection }): Promise<ProposalView> {
    const parsed = DecisionSchema.parse(input), context = await this.context(parsed.target);
    await this.ctx.studyforgeProposalService.confirm({ ...context, operationId: parsed.operationId }, parsed.target, parsed.selection);
    // Saving and delivery have independent observable outcomes. Failed delivery
    // leaves receipt.deliveredAt absent and is retryable from this persisted item.
    try { await this.ctx.studyforgeReceiptDispatcher.flush(context); } catch { /* durable pending outbox */ }
    return this.ctx.studyforgeProposalService.read(context, parsed.target);
  }
  @Remote('reject')
  async reject(input: { operationId: string; target: string; selection: ProposalSelection }): Promise<ProposalView> {
    const parsed = DecisionSchema.parse(input);
    return this.ctx.studyforgeProposalService.reject({ ...await this.context(parsed.target), operationId: parsed.operationId }, parsed.target, parsed.selection);
  }
  @Remote('retryDelivery')
  async retryDelivery(input: { target: string }): Promise<ProposalView> {
    const target = EntityRefSchema.parse(input.target), context = await this.context(target);
    await this.ctx.studyforgeReceiptDispatcher.flush(context);
    return this.ctx.studyforgeProposalService.read(context, target);
  }
}
