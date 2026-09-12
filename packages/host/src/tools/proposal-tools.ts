import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { EntityRefSchema } from '@studyforge/contracts';
import { CardContentSchema } from '@studyforge/contracts/cards';
import { ProposalViewSchema, type ProposalInput, type ProposalView } from '@studyforge/contracts/proposals';
import { toolSchema } from './tool-schema.ts';
import { observedVersion, teacherContext } from './learning-context.ts';

/** Native call identity is the proposal owner, so tool replay never recreates a
 * draft from changed targets, time, policy or the student's later edits. */
export async function existingProposal(host: Context, execution: ToolRunContext): Promise<ProposalView | undefined> {
  const context = await teacherContext(host, execution);
  const found = host.studyforgeProposalService.list(context).find(proposal => proposal.origin.kind === 'native'
    && proposal.origin.sessionId === context.sessionId && proposal.origin.callId === execution.callId);
  return found ? host.studyforgeProposalService.read(context, found.ref, 1) : undefined;
}
export async function proposeFromTool(host: Context, execution: ToolRunContext, input: Omit<ProposalInput, 'origin'>): Promise<ProposalView> {
  const context = await teacherContext(host, execution);
  return host.studyforgeProposalService.propose(context, { ...input, origin: { kind: 'native', sessionId: context.sessionId!, callId: execution.callId } });
}
export const proposalOutput = () => ({ schema: toolSchema(ProposalViewSchema), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(ProposalViewSchema.parse(value)) }] });

export function registerProposalTools(host: Context): void {
  const schema = z.discriminatedUnion('kind', [
    CardContentSchema.extend({ kind: z.literal('card') }).strict(),
    z.object({ kind: z.literal('method'), target: EntityRefSchema }).strict(),
  ]);
  host.effect(() => host.tools.register({ name: 'propose_card', description: '向学生提案保存普通卡，或收录已保存的私人知识为锦囊。kind=card时填写作者内容；kind=method时选择刚读过的同一知识target，不复制成普通卡。确认前尚未入库，不替学生确认。', parameters: toolSchema(schema), output: proposalOutput(),
    async execute(args, execution) {
      const input = schema.parse(args), prior = await existingProposal(host, execution);
      if (prior) return prior;
      if (input.kind === 'card') {
        const { kind: _kind, ...content } = input;
        return proposeFromTool(host, execution, { title: content.title, items: [{ target: null, baseline: null, effect: { kind: 'card-create', content } }] });
      }
      const ctx = await teacherContext(host, execution), baseline = await observedVersion(host, execution, input.target);
      const method = host.studyforgeKnowledgeService.read(ctx, input.target, baseline);
      return proposeFromTool(host, execution, { title: method.content.title, items: [{ target: input.target, baseline, effect: { kind: 'knowledge-collect' } }] });
    },
  }));
}
