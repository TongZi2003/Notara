import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { EntityRefSchema } from '@studyforge/contracts';
import { CardContentSchema } from '@studyforge/contracts/cards';
import { ProposalViewSchema, type ProposalInput, type ProposalView } from '@studyforge/contracts/proposals';
import { toolSchema } from './tool-schema.ts';
import { observedVersion, teacherContext } from './learning-context.ts';
import { bindTaskCard } from '../teaching/book-task.ts';

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
    z.object({ kind: z.literal('cards'), title: z.string().trim().min(1), cards: z.array(CardContentSchema).min(1) }).strict(),
    z.object({ kind: z.literal('method'), target: EntityRefSchema }).strict(),
  ]);
  host.effect(() => host.tools.register({ name: 'propose_card', description: '向学生提案保存普通卡，或收录已保存的私人知识为锦囊。同批拆出的多张卡用kind=cards，填写批次标题title和cards数组，一次调用形成一份可勾选、一起批准的提案；不要逐卡调用。单张用kind=card填写作者内容；kind=method选择刚读过的同一知识target，不复制成普通卡。chapter填卡在唯一来源书内的层级语义路径，骨架缺的层确认时会顺带铸成outline节点；无来源或跨多本书的卡只能用read_skeleton返回过的既有路径，没有就省略。topic填卡在工作区知识地图(atlas)里的归属路径，不依赖来源书，多来源和无来源卡都能归图，缺的层同样顺带铸成outline节点；chapter管书内层级、topic管跨书主题，两者独立可同填。links填裸实体ref（card:/knowledge:/material:…），不是界面里的展示链接。sources填真实锚点：text/markdown/docx用文本锚点（字节级校验）；PDF精确摘录用{kind:pdftext,page}加quote（quote在页文本层里唯一定位，read_material可先读页文本再摘），整页指路用{kind:pdf,page}、front写清为什么值得看；不要猜rect几何坐标，人再拖框补精确范围。确认前尚未入库，不替学生确认。', parameters: toolSchema(schema), output: proposalOutput(),
    async execute(args, execution) {
      const input = schema.parse(args), prior = await existingProposal(host, execution);
      if (prior) return prior;
      if (input.kind === 'cards') {
        const context = await teacherContext(host, execution);
        const cards = [];
        for (const content of input.cards) cards.push(await bindTaskCard(host, execution, context, content));
        return proposeFromTool(host, execution, { title: input.title,
          items: cards.map(content => ({ target: null, baseline: null, effect: { kind: 'card-create', content } })) });
      }
      if (input.kind === 'card') {
        const { kind: _kind, ...content } = input;
        const bound = await bindTaskCard(host, execution, await teacherContext(host, execution), content);
        return proposeFromTool(host, execution, { title: bound.title, items: [{ target: null, baseline: null, effect: { kind: 'card-create', content: bound } }] });
      }
      const ctx = await teacherContext(host, execution), baseline = await observedVersion(host, execution, input.target);
      const method = host.studyforgeKnowledgeService.read(ctx, input.target, baseline);
      return proposeFromTool(host, execution, { title: method.content.title, items: [{ target: input.target, baseline, effect: { kind: 'knowledge-collect' } }] });
    },
  }));
}
