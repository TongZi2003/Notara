import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { EntityRefSchema } from '@studyforge/contracts';
import { KnowledgeNoteSchema, KnowledgePatchSchema, KnowledgeViewSchema } from '@studyforge/contracts/knowledge';
import { toolSchema } from './tool-schema.ts';
import { observedVersion, teacherContext } from './learning-context.ts';

export function registerKnowledgeTools(host: Context): void {
  const readInput = z.object({ target: EntityRefSchema }).strict();
  const editInput = z.object({ target: EntityRefSchema, patch: KnowledgePatchSchema.omit({ links_remove: true }) }).strict();
  const output = { schema: toolSchema(KnowledgeViewSchema), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(KnowledgeViewSchema.parse(value)) }] };
  host.effect(() => host.tools.register({ name: 'read_method', description: '读取同一私人知识条目的唯一正文、关系、公共教法来源和收录状态。知识没有第二复习梯子。', parameters: toolSchema(readInput), output,
    async execute(args, execution) { return host.studyforgeKnowledgeService.read(await teacherContext(host, execution), readInput.parse(args).target); },
  }));
  host.effect(() => host.tools.register({ name: 'note_method', description: '保存尚未收录的私人知识。title/body是唯一自由正文；可以没有关联卡。公开教法来源须为实际已安装版本。要收录为锦囊，再向学生提案确认同一条目。', parameters: toolSchema(KnowledgeNoteSchema), output,
    async execute(args, execution) { return host.studyforgeKnowledgeService.note(await teacherContext(host, execution), KnowledgeNoteSchema.parse(args)); },
  }));
  host.effect(() => host.tools.register({ name: 'revise_method', description: '沿同一知识身份改写刚读过的条目，只传修改字段；Host绑定所读版本。body只有一份，links_add增量，修改原因可选。', parameters: toolSchema(editInput), output,
    async execute(args, execution) {
      const input = editInput.parse(args), ctx = await teacherContext(host, execution);
      return host.studyforgeKnowledgeService.revise({ ...ctx, expectedVersion: await observedVersion(host, execution, input.target) }, input.target, input.patch);
    },
  }));
}
