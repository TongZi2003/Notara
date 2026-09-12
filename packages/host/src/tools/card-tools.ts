import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { EntityRefSchema } from '@studyforge/contracts';
import { CardContentSchema, CardPatchSchema, CardViewSchema, CardListInputSchema, CardListResultSchema,
  CardBatchReadInputSchema, CardBatchReadResultSchema } from '@studyforge/contracts/cards';
import { listCardSummaries } from '@studyforge/domain/cards';
import { civilDay } from '@studyforge/domain/read-day';
import { toolSchema } from './tool-schema.ts';
import { observedVersion, teacherContext } from './learning-context.ts';

export function registerCardTools(host: Context): void {
  host.effect(() => host.tools.register({ name: 'list_cards', description: '枚举真实普通卡，可按到期状态、标签、章节、原件或学习集筛选。今天复习什么用state=due（含逾期），未学卡不会混入。返回候选摘要，继续read_card或read_cards读正文后才可修改/评定；nextOffset用于翻页。读取不会记录学习。',
    parameters: toolSchema(CardListInputSchema),
    output: { schema: toolSchema(CardListResultSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(CardListResultSchema.parse(value)) }] },
    async execute(args, execution) {
      const input = CardListInputSchema.parse(args), ctx = await teacherContext(host, execution);
      return listCardSummaries(host.studyforgeCardRecords.list(ctx), input, civilDay(host.studyforgeClock.now(), host.studyforgeClock.timeZone),
        input.learningSetRef ? host.studyforgeSetService.list(ctx) : []);
    },
  }));
  host.effect(() => host.tools.register({ name: 'read_cards', description: '一次读取1至20张普通卡的完整正文、来源、笔记和学习记录，按targets顺序返回。引用来自list_cards或search_learning；任何目标读取失败则整次报错，不把缺失说成空卡。Host从成功结果绑定每张卡的真实版本，后续update_card/propose_review可直接使用；读取不表示学过。',
    parameters: toolSchema(CardBatchReadInputSchema),
    output: { schema: toolSchema(CardBatchReadResultSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(CardBatchReadResultSchema.parse(value)) }] },
    async execute(args, execution) {
      const input = CardBatchReadInputSchema.parse(args), ctx = await teacherContext(host, execution);
      return { cards: input.targets.map(target => host.studyforgeCardService.read(ctx, target)) };
    },
  }));
  const readInput = z.object({ target: EntityRefSchema }).strict();
  const editInput = z.object({ target: EntityRefSchema, patch: CardPatchSchema.omit({ links_remove: true }) }).strict();
  const output = { schema: toolSchema(CardViewSchema), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(CardViewSchema.parse(value)) }] };
  host.effect(() => host.tools.register({ name: 'read_card', description: '读取普通卡的当前正文、来源、作者笔记与独立学习记录。修改前先读；新建、打开、阅读不表示掌握。', parameters: toolSchema(readInput), output,
    async execute(args, execution) { return host.studyforgeCardService.read(await teacherContext(host, execution), readInput.parse(args).target); },
  }));
  host.effect(() => host.tools.register({ name: 'update_card', description: '修改刚用read_card/read_cards读过的既有卡；只传要改的作者字段，省略保留。关系只用links_add增量；删除错链请让学生在卡片编辑页操作，不能用替换列表绕过。reason可选。Host绑定读取时的版本，并发修改会要求重读，不清空学习记录。', parameters: toolSchema(editInput), output,
    async execute(args, execution) {
      const input = editInput.parse(args), ctx = await teacherContext(host, execution);
      const expectedVersion = await observedVersion(host, execution, input.target);
      return host.studyforgeCardService.edit({ ...ctx, expectedVersion }, input.target, input.patch);
    },
  }));
  const batchInput = z.object({ cards: z.array(CardContentSchema).min(1) }).strict();
  const batchOutput = z.object({ cards: z.array(CardViewSchema) }).strict();
  host.effect(() => host.tools.register({ name: 'register_cards', description: '诊断收尾或获准的独立命题产物登记：一批先全验，再由Host原子保存为未学普通卡。通常课堂新内容用propose_card让学生确认；保存不产生复习。', parameters: toolSchema(batchInput),
    output: { schema: toolSchema(batchOutput), render: (_args, value) => [{ type: 'text', text: JSON.stringify(batchOutput.parse(value)) }] },
    async execute(args, execution) {
      const input = batchInput.parse(args), ctx = await teacherContext(host, execution);
      const content = await Promise.all(input.cards.map(card => host.studyforgeCardService.check(ctx, card)));
      const plans = content.map((card, index) => {
        const operationId = ctx.operationId + ':' + index;
        const id = 'card_' + createHash('sha256').update(`${ctx.workspaceId}:${operationId}`).digest('hex').slice(0, 24);
        return host.studyforgeCardRecords.prepareCreate({ ...ctx, operationId }, id, { content: card, history: [] });
      });
      await host.studyforgeRecords.atomic(plans);
      return { cards: plans.map(plan => CardViewSchema.parse({ ref: plan.result.ref, version: plan.result.version, ...plan.result.data })) };
    },
  }));
}
