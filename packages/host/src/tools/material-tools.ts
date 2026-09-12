import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { AttachmentId } from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-attachment';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { MaterialReadSchema, ReadMaterialInputSchema } from '@studyforge/contracts/material-read';
import { readMaterial } from '@studyforge/domain/material-read';
import { toolSchema } from './tool-schema.ts';

// This tool's output keeps an immutable native attachment reference, never a
// base64 copy of the rendered image in its textual result.
const AttachmentSchema = z.object({
  attachmentId: z.string().min(1), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive(),
  name: z.string().optional(), originalDimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
}).strict();
const ValueSchema = z.object({ reading: MaterialReadSchema.omit({ image: true }), attachment: AttachmentSchema.optional() }).strict();
function render(_args: unknown, value: unknown): ContentBlock[] {
  const parsed = ValueSchema.parse(value);
  const content: ContentBlock[] = [{ type: 'text', text: JSON.stringify(parsed.reading) }];
  if (parsed.attachment) {
    const { attachmentId, name, originalDimensions, ...rest } = parsed.attachment;
    content.push({ type: 'image', attachment: { ...rest, attachmentId: AttachmentId(attachmentId),
      ...(name !== undefined ? { name } : {}), ...(originalDimensions !== undefined ? { originalDimensions } : {}) } });
  }
  return content;
}

/** Read tools use the actual native calling Session and attachment capability. */
export function registerMaterialTools(ctx: Context): void {
  const listInput = z.object({ query: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }).strict();
  const listOutput = z.object({ materials: z.array(z.object({ materialId: z.string(), versionId: z.string(), title: z.string(), mediaType: z.string() }).strict()), hasMore: z.boolean() }).strict();
  ctx.effect(() => ctx.tools.register({
    name: 'list_materials', description: '查找本人已经导入的资料，取得可用于read_material的真实固定版本引用。导入和浏览不表示已经学习。',
    parameters: toolSchema(listInput), output: { schema: toolSchema(listOutput), render: (_args, value) => [{ type: 'text', text: JSON.stringify(listOutput.parse(value)) }] },
    async execute(args, execution) {
      const input = listInput.parse(args);
      const binding = execution.agent && await ctx.studyforgeAccess.forSession(execution.agent.session.id);
      if (!binding) throw new Error('material_session_missing');
      const context = { sessionId: binding.sessionId, workspaceId: binding.workspaceId, purpose: binding.purpose, actor: 'teacher' as const };
      const matches = [];
      for (const item of await ctx.studyforgeMaterialService.list(context)) {
        if (input.query && !item.title.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) continue;
        const source = { materialId: item.materialId, versionId: item.currentVersion.versionId };
        const resolved = await ctx.studyforgeMaterialService.resolve(context, source);
        if (!ctx.studyforgeAccess.permits(binding, resolved.absolutePath)) continue;
        matches.push({ ...source, title: item.title, mediaType: item.currentVersion.mediaType });
        if (matches.length > input.limit) break;
      }
      return { materials: matches.slice(0, input.limit), hasMore: matches.length > input.limit };
    },
  }));
  for (const name of ['read_material', 'preview_region'] as const) {
    ctx.effect(() => ctx.tools.register({
      name,
      description: name === 'preview_region' ? '查看已导入原件指定区域的真实图像。source 必须含固定版本、PDF物理页或图片及rect；返回原生图片附件与实际位置。' : '读取已导入资料的固定版本及位置。PDF按物理页返回图像；扫描件不虚构文字。Markdown按原文行列，DOCX按稳定段落。无locator时只读首个可读范围。',
      parameters: toolSchema(ReadMaterialInputSchema),
      output: { schema: toolSchema(ValueSchema), render },
      async execute(args: unknown, execution: ToolRunContext) {
        const { source } = ReadMaterialInputSchema.parse(args);
        const binding = execution.agent && await ctx.studyforgeAccess.forSession(execution.agent.session.id);
        if (!binding) throw new Error('material_session_missing');
        if (name === 'preview_region' && !(source.locator && (source.locator.kind === 'pdf' || source.locator.kind === 'image') && source.locator.rect)) throw new Error('preview_region_requires_rect');
        const context = { sessionId: binding.sessionId, workspaceId: binding.workspaceId, purpose: binding.purpose, actor: 'teacher' as const };
        const resolved = await ctx.studyforgeMaterialService.resolve(context, { materialId: source.materialId, versionId: source.versionId });
        ctx.studyforgeAccess.assert(binding, resolved.absolutePath);
        execution.signal.throwIfAborted();
        const { image, ...reading } = await readMaterial(ctx.studyforgeMaterialService, context, source);
        execution.signal.throwIfAborted();
        if (!image) return { reading };
        const config = execution.agent?.session.requestHeader()?.config;
        const provider = config?.provider ?? execution.agent?.options.provider, model = config?.model ?? execution.agent?.options.model;
        if (!provider || !model) throw new Error('无法确认当前模型是否支持图像，请先选择模型。');
        if (!(await ctx.llm.resolveModelInfo(provider, model, execution.signal)).inputModalities?.includes('image')) throw new Error('当前模型不支持图像，请切换到支持图像的模型后读取。');
        const attachment = await ctx.attachments.saveImage({ mediaType: 'image/png', data: Buffer.from(image.base64, 'base64'), name: reading.title + '.png' });
        return { reading, attachment };
      },
    }));
  }
}
