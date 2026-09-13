import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';
import { z } from 'zod';
import { SourceAnchorSchema, type SourceAnchor } from '@studyforge/contracts/materials';
import { ContentReadSchema, SourceUseSchema } from '@studyforge/contracts/content-history';
import { sourceContains } from '@studyforge/domain/source-relations';
import { teacherContext } from './learning-context.ts';
import { toolSchema } from './tool-schema.ts';
import { contentHistory } from '../materials/content-history.ts';

export function sourceUseMeta(value: unknown) { return z.json().parse(JSON.parse(JSON.stringify(SourceUseSchema.parse(value)))); }

export async function assertRefinedReads(host: Context, execution: ToolRunContext, sources: readonly SourceAnchor[]): Promise<void> {
  if (!sources.length) return;
  const ctx = await teacherContext(host, execution), observed = await host.sessionQuery.observeSession(SessionId(ctx.sessionId!));
  try {
    const cutoff = observed.events.findIndex(event => event.type === 'tool/call' && event.data.callId === execution.callId);
    if (cutoff < 0) throw new Error('缺少调用位置，请重新读取原文。');
    const reads = observed.events.slice(0, cutoff).flatMap(event => {
      if (event.type !== 'tool/result' || event.data.message.content.some(block => block.isError)) return [];
      const item = SourceUseSchema.safeParse(event.data.meta);
      return item.success && item.data.use === 'read' && !item.data.target ? item.data.sources : [];
    });
    if (sources.some(source => !reads.some(read => sourceContains(read, source)))) throw new Error('标记refined之前，请由你自己read_material读取完整的细化范围；仅目录用outline。');
  } finally { observed[Symbol.dispose](); }
}

export function registerSourceUseTools(host: Context): void {
  const readInput = z.object({ target: z.string().min(1), version: z.number().int().positive().optional(),
    includeActivity: z.boolean().default(false).describe('需要避开重复材料或理解这张卡的使用情况时打开，只返回该卡实际学习/复习记录和课堂引用；不会读取整份学情。'),
    activityOffset: z.number().int().nonnegative().default(0).describe('局部历史分页，每页20条；有hasMore时加20继续。'),
  }).strict();
  host.effect(() => host.tools.register({ name: 'read_content',
    description: '精读search_learning命中的card或knowledge正文、固定版本、出处和联系。includeActivity=true时可按需查看当前卡片的学习/复习事实及课堂使用，不返回整份学情或其他卡记录；browsing=not_recorded表示单纯浏览未记账，不能说从未访问。可沿links精读。读取不会创建卡、记档或绑定修改版本；修改或评定仍用read_card/read_method。',
    parameters: toolSchema(readInput), output: { schema: toolSchema(ContentReadSchema),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => {
        const item = ContentReadSchema.parse(value);
        return sourceUseMeta({ kind: 'studyforge-source-use', use: 'read', target: item.ref, version: item.version, sources: item.kind === 'card' ? item.content.sources : [] });
      },
    },
    async execute(args, execution) {
      const input = readInput.parse(args), ctx = await teacherContext(host, execution);
      if (input.target.startsWith('card:')) {
        const item = host.studyforgeCardService.read(ctx, input.target, input.version);
        const { notes: _notes, ...content } = item.content;
        if (!input.includeActivity) return { kind: 'card', ref: item.ref, version: item.version, content };
        const history = await contentHistory(host, ctx, { target: item.ref, ...(input.version ? { version: input.version } : {}) });
        const start = input.activityOffset, end = start + 20;
        return { kind: 'card', ref: item.ref, version: item.version, content, activity: {
          reviews: [...item.history].reverse().slice(start, end), ...(item.review ? { schedule: item.review } : {}),
          classrooms: history.classrooms.slice(start, end).map(lesson => ({ title: lesson.title, sessionId: lesson.sessionId, occurredAt: lesson.occurredAt,
            uses: [...new Set(lesson.occurrences.map(row => row.use))] })),
          hasMoreReviews: item.history.length > end, hasMoreClassrooms: history.classrooms.length > end,
          unavailableClassrooms: history.unavailable, browsing: 'not_recorded',
        } };
      }
      if (input.target.startsWith('knowledge:')) {
        const item = host.studyforgeKnowledgeService.read(ctx, input.target, input.version);
        return { kind: 'knowledge', ref: item.ref, version: item.version, content: item.content, publicSources: item.publicSources };
      }
      throw new Error('请选择实际检索到的card或knowledge引用。');
    },
  }));
  const citeInput = z.object({ sources: z.array(SourceAnchorSchema).max(30).default([]), target: z.string().min(1).optional() }).strict()
    .refine(value => value.sources.length > 0 || !!value.target, '选择实际采用的原文片段或卡片');
  host.effect(() => host.tools.register({ name: 'cite_materials',
    description: '把本课真正采用的片段或既有卡片挂回课堂。先由你自己read_material/preview_region或read_content核对，sources只选实际读过范围，target选读过的卡/知识。scout候选须你复读后才能采用；Host固定真实版本。采用不等于讲完、学会或复习记档，也不会复制卡片。',
    parameters: toolSchema(citeInput), output: { schema: toolSchema(SourceUseSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => sourceUseMeta(value) },
    async execute(args, execution) {
      const input = citeInput.parse(args), ctx = await teacherContext(host, execution);
      const observation = await host.sessionQuery.observeSession(SessionId(ctx.sessionId!));
      try {
        const cutoff = observation.events.findIndex(event => event.type === 'tool/call' && event.data.callId === execution.callId);
        if (cutoff < 0) throw new Error('缺少本次调用位置，请重新读取后采用。');
        const reads = observation.events.slice(0, cutoff).flatMap(event => {
          if (event.type !== 'tool/result' || event.data.message.content.some(block => block.isError)) return [];
          const parsed = SourceUseSchema.safeParse(event.data.meta);
          return parsed.success && parsed.data.use === 'read' ? [parsed.data] : [];
        });
        const originals = reads.filter(read => !read.target).flatMap(read => read.sources);
        for (const source of input.sources) {
          if (!originals.some(read => sourceContains(read, source))) throw new Error('这个片段还没有由你完整读取，请先read_material核对实际范围。');
          await host.studyforgeMaterialService.resolve(ctx, { materialId: source.materialId, versionId: source.versionId });
        }
        const card = input.target ? reads.findLast(read => read.target === input.target) : undefined;
        if (input.target && !card) throw new Error('请先read_content精读要采用的卡片或知识。');
        return SourceUseSchema.parse({ kind: 'studyforge-source-use', use: 'cited', sources: input.sources,
          ...(card ? { target: card.target, version: card.version } : {}) });
      } finally { observation[Symbol.dispose](); }
    },
  }));
}
