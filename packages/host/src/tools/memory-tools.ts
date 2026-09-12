import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { MemoryDraftSchema, MemoryViewSchema, MemorySearchInputSchema, MemorySearchResultSchema } from '@studyforge/contracts/memory';
import { EvidenceQuery } from '@studyforge/domain/evidence';
import { observeEvidence } from '../evidence-query.ts';
import { sourceEvidenceObjects } from '../runtime/context-envelope.ts';
import { teacherContext, observedVersion } from './learning-context.ts';
import { toolSchema } from './tool-schema.ts';

export function registerMemoryTools(host: Context): void {
  const output = { schema: toolSchema(MemoryViewSchema), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };
  host.effect(() => host.tools.register({
    name: 'read_memory', description: '读学生：按search_memory返回的真实target读取关于能力、习惯或偏好的学情和依据。知识方法正文用read_method。类别不是能力认证；修改前先读。',
    parameters: toolSchema(z.object({ target: z.string().min(1) }).strict()), output,
    async execute(args, execution) {
      const input = z.object({ target: z.string().min(1) }).strict().parse(args);
      return host.studyforgeMemoryService.read(await teacherContext(host, execution), input.target);
    },
  }));
  host.effect(() => host.tools.register({
    name: 'search_memory', description: '查学生：有明确学情目的时检索能力、习惯、偏好等观察。省略query或传空字符串即枚举，kinds可按类别列出；如仅列偏好用kinds=["preference"]。有nextOffset时保持筛选并传offset读下一页。返回摘要后read_memory精读。找知识内容用search_learning，不把空学情当没有学过。',
    parameters: toolSchema(MemorySearchInputSchema),
    output: { schema: toolSchema(MemorySearchResultSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, execution) { return host.studyforgeMemoryService.search(await teacherContext(host, execution), MemorySearchInputSchema.parse(args)); },
  }));
  async function cut(execution: ToolRunContext) {
    const context = await teacherContext(host, execution);
    const catalogue = new EvidenceQuery().catalogue(await observeEvidence(host, context.sessionId!, {
      resolveObjects: query => sourceEvidenceObjects(host, context, query.fragments ?? []),
    }));
    return { context, catalogue };
  }
  host.effect(() => host.tools.register({
    name: 'note_memory', description: '记学生：直接保存关于学生的一次真实观察（能力/习惯/偏好等），不用于知识内容。先query_evidence再选实际E引用，写清情境和不确定性；偏好须来自学生实际表达，知识归note_method。代码不因两次观察自动认证。',
    parameters: toolSchema(MemoryDraftSchema), output,
    async execute(args, execution) {
      const input = MemoryDraftSchema.parse(args), { context, catalogue } = await cut(execution);
      return host.studyforgeMemoryService.note(context, input, catalogue);
    },
  }));
  const revise = MemoryDraftSchema.extend({ target: z.string().min(1) }).strict();
  host.effect(() => host.tools.register({
    name: 'revise_memory', description: '更正同一学情target，保留先前措辞和依据。先read_memory，补读实际依据再提交；并发修改被拒时重读合并。',
    parameters: toolSchema(revise), output,
    async execute(args, execution) {
      const { target, ...draft } = revise.parse(args), { context, catalogue } = await cut(execution);
      const expectedVersion = await observedVersion(host, execution, target);
      return host.studyforgeMemoryService.revise({ ...context, expectedVersion }, target, draft, catalogue);
    },
  }));
}
