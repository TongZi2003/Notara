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
    name: 'read_memory', description: '按实际target读取学情、采用的真实原话和先前依据。类别不是能力认证；修改前先读。',
    parameters: toolSchema(z.object({ target: z.string().min(1) }).strict()), output,
    async execute(args, execution) {
      const input = z.object({ target: z.string().min(1) }).strict().parse(args);
      return host.studyforgeMemoryService.read(await teacherContext(host, execution), input.target);
    },
  }));
  host.effect(() => host.tools.register({
    name: 'search_memory', description: '有明确学情目的时按需检索本人的各科学情；找知识笔记请用search_learning，不把空学情当没有学过。',
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
    name: 'note_memory', description: '保存一次真实观察。先query_evidence再选实际E引用，写清情境和不确定性；偏好须来自学生实际表达，知识归note_method。代码不因两次观察自动认证。',
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
