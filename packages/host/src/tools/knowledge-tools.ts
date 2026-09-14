import { entityReferenceContent } from './entity-reference-output.ts';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { EntityRefSchema } from '@studyforge/contracts';
import { KnowledgeNoteSchema, KnowledgePatchSchema, KnowledgeViewSchema } from '@studyforge/contracts/knowledge';
import { toolSchema } from './tool-schema.ts';
import { observedVersion, teacherContext } from './learning-context.ts';

export function registerKnowledgeTools(host: Context): void {
  const readInput = z.object({ target: EntityRefSchema }).strict();
  const editInput = z.object({ target: EntityRefSchema, patch: KnowledgePatchSchema.omit({ links_remove: true }) }).strict();
  const output = { schema: toolSchema(KnowledgeViewSchema), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(KnowledgeViewSchema.parse(value)) }, ...entityReferenceContent(value)] };
  host.effect(() => host.tools.register({ name: 'read_method', description: '读知识：按search_learning中knowledge命中的target，读取私人知识或方法条目的正文、关系、公共教法来源和收录状态；关于学生的观察用read_memory。知识没有第二复习梯子。', parameters: toolSchema(readInput), output,
    async execute(args, execution) { return host.studyforgeKnowledgeService.read(await teacherContext(host, execution), readInput.parse(args).target); },
  }));
  host.effect(() => host.tools.register({ name: 'note_method', description: '记知识：直接保存尚未收录的知识或方法笔记；学生的能力/习惯/偏好归note_memory。title/body是唯一自由正文，可没有关联卡。公开教法来源须为实际已安装版本；保存成功只表示知识笔记已记下，要收录为锦囊再用propose_card(kind=method,target)确认同一条目。', parameters: toolSchema(KnowledgeNoteSchema), output,
    async execute(args, execution) { return host.studyforgeKnowledgeService.note(await teacherContext(host, execution), KnowledgeNoteSchema.parse(args)); },
  }));
  host.effect(() => host.tools.register({ name: 'revise_method', description: '改知识：先read_method，再沿同一知识target修改字段；关于学生的观察用revise_memory。Host绑定所读版本，body只有一份，links_add增量，删除关系由学生在编辑页操作，修改原因可选。', parameters: toolSchema(editInput), output,
    async execute(args, execution) {
      const input = editInput.parse(args), ctx = await teacherContext(host, execution);
      return host.studyforgeKnowledgeService.revise({ ...ctx, expectedVersion: await observedVersion(host, execution, input.target) }, input.target, input.patch);
    },
  }));
}
