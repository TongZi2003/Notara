import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock, FileBlock } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { mediaTypeForFileName } from '@studyforge/domain/materials';
import { AttachmentId } from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-attachment';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { MaterialReadSchema, ReadMaterialInputSchema } from '@studyforge/contracts/material-read';
import { readMaterial } from '@studyforge/domain/material-read';
import { toolSchema } from './tool-schema.ts';
import { sourceUseMeta } from './source-use-tools.ts';
import { entityReferenceContent } from './entity-reference-output.ts';
import { readFile } from 'node:fs/promises';
import { ClassroomMarkdownCreateSchema, ClassroomMarkdownReadSchema, ClassroomMarkdownUpdateSchema, ClassroomMarkdownViewSchema, type ClassroomMarkdownView } from '@studyforge/contracts/classroom-markdown';
import { MaterialIdSchema, MaterialVersionIdSchema } from '@studyforge/contracts/material-records';
import { teacherContext, rejected } from './learning-context.ts';

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
  return [...content, ...entityReferenceContent(parsed.reading)];
}

/** Read tools use the actual native calling Session and attachment capability. */
export function registerMaterialTools(ctx: Context): void {
  const listInput = z.object({ query: z.string().optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(50).default(20) }).strict();
  const listOutput = z.object({ materials: z.array(z.object({ materialId: z.string(), versionId: z.string(), title: z.string(), mediaType: z.string() }).strict()), hasMore: z.boolean(), nextOffset: z.number().int().nonnegative().optional() }).strict();
  ctx.effect(() => ctx.tools.register({
    name: 'list_materials', description: '查找本人已经导入的资料，取得可用于read_material的真实固定版本引用。导入和浏览不表示已经学习。',
    parameters: toolSchema(listInput), output: { schema: toolSchema(listOutput), render: (_args, value) => [{ type: 'text', text: JSON.stringify(listOutput.parse(value)) }, ...entityReferenceContent(value)] },
    async execute(args, execution) {
      const input = listInput.parse(args);
      const binding = execution.agent && await ctx.studyforgeAccess.forSession(execution.agent.session.id);
      if (!binding) throw rejected('本课没有资料访问绑定，无法检索资料库');
      const context = { sessionId: binding.sessionId, workspaceId: binding.workspaceId, purpose: binding.purpose, actor: 'teacher' as const };
      const matches = [];
      for (const item of await ctx.studyforgeMaterialService.list(context)) {
        if (input.query && !item.title.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) continue;
        const source = { materialId: item.materialId, versionId: item.currentVersion.versionId };
        const resolved = await ctx.studyforgeMaterialService.resolve(context, source);
        if (!ctx.studyforgeAccess.permits(binding, resolved.absolutePath)) continue;
        matches.push({ ...source, title: item.title, mediaType: item.currentVersion.mediaType });
        if (matches.length > input.offset + input.limit) break;
      }
      const hasMore = matches.length > input.offset + input.limit;
      return { materials: matches.slice(input.offset, input.offset + input.limit), hasMore, ...(hasMore ? { nextOffset: input.offset + input.limit } : {}) };
    },
  }));
  for (const name of ['read_material', 'preview_region'] as const) {
    ctx.effect(() => ctx.tools.register({
      name,
      description: name === 'preview_region' ? '查看已导入原件指定区域的真实图像。source 必须含固定版本、PDF物理页或图片及rect；返回原生图片附件与实际位置。' : '读取已导入资料的固定版本及位置。PDF按物理页返回图像，kind=pdftext按页文本层返回真实文字（locator可只给page、由quote在页内唯一定位）；扫描件不虚构文字。Markdown按原文行列，DOCX按稳定段落。无locator时只读首个可读范围。',
      parameters: toolSchema(ReadMaterialInputSchema),
      output: { schema: toolSchema(ValueSchema), render, presentationMeta: (_args, value) => {
        const reading = ValueSchema.parse(value).reading;
        return sourceUseMeta({ kind: 'studyforge-source-use', use: 'read', sources: [reading.source], ...(reading.pageCount ? { pageCount: reading.pageCount } : {}) });
      } },
      async execute(args: unknown, execution: ToolRunContext) {
        const { source } = ReadMaterialInputSchema.parse(args);
        const binding = execution.agent && await ctx.studyforgeAccess.forSession(execution.agent.session.id);
        if (!binding) throw rejected('本课没有资料访问绑定，无法读取资料');
        if (name === 'preview_region' && !(source.locator && (source.locator.kind === 'pdf' || source.locator.kind === 'image') && source.locator.rect)) throw rejected('preview_region需要带PDF物理页或图片的locator和rect区域');
        const context = { sessionId: binding.sessionId, workspaceId: binding.workspaceId, purpose: binding.purpose, actor: 'teacher' as const };
        const resolved = await ctx.studyforgeMaterialService.resolve(context, { materialId: source.materialId, versionId: source.versionId });
        ctx.studyforgeAccess.assert(binding, resolved.absolutePath);
        execution.signal.throwIfAborted();
        const { image, ...reading } = await readMaterial(ctx.studyforgeMaterialService, context, source);
        execution.signal.throwIfAborted();
        if (!image) return { reading };
        const config = execution.agent?.session.requestHeader()?.config;
        const provider = config?.provider ?? execution.agent?.options.provider, model = config?.model ?? execution.agent?.options.model;
        if (!provider || !model) throw rejected('无法确认当前模型是否支持图像，请先选择模型');
        if (!(await ctx.llm.resolveModelInfo(provider, model, execution.signal)).inputModalities?.includes('image')) throw rejected('当前模型不支持图像，请切换到支持图像的模型后读取');
        const attachment = await ctx.attachments.saveImage({ mediaType: 'image/png', data: Buffer.from(image.base64, 'base64'), name: reading.title + '.png' });
        return { reading, attachment };
      },
    }));
  }
  const markdownOutput = { schema: toolSchema(ClassroomMarkdownViewSchema), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(ClassroomMarkdownViewSchema.parse(value as ClassroomMarkdownView)) }] };
  const readMarkdown = async (hostContext: Awaited<ReturnType<typeof teacherContext>>, materialId: string, versionId: string): Promise<ClassroomMarkdownView> => {
    const view = await ctx.studyforgeMaterialService.get(hostContext, MaterialIdSchema.parse(materialId));
    const version = view.versions.find(item => item.versionId === MaterialVersionIdSchema.parse(versionId));
    if (!version) throw rejected('该资料没有这个固定版本，先用list_materials或read_material确认versionId');
    if (version.mediaType !== 'text/markdown') throw rejected('这份资料没有Markdown版本，请改用read_material按原格式读取');
    const resolved = await ctx.studyforgeMaterialService.resolve(hostContext, { materialId: view.materialId, versionId: version.versionId });
    const revision = view.versions.findIndex(item => item.versionId === version.versionId) + 1;
    return ClassroomMarkdownViewSchema.parse({ ref: 'material:' + view.materialId, materialId: view.materialId, versionId: version.versionId, revision, title: view.title, content: await readFile(resolved.absolutePath, 'utf8'), source: { materialId: view.materialId, versionId: version.versionId }, references: version.sources ?? [] });
  };
  ctx.effect(() => ctx.tools.register({ name: 'create_markdown_material', description: '在当前课堂资料空间创建一份 Markdown 讲义或教材章节。只保存明确请求的内容；返回真实资料身份和版本。保存不表示掌握，也不创建创作者会话。', parameters: toolSchema(ClassroomMarkdownCreateSchema), output: markdownOutput,
    async execute(args, execution) {
      const input = ClassroomMarkdownCreateSchema.parse(args), context = await teacherContext(ctx, execution);
      const fileName = (input.title.replace(/[\\/:*?"<>|]/gu, '-').trim().slice(0, 120) || '课堂讲义') + '.md';
      const saved = await ctx.studyforgeMaterialService.import({ ...context }, { title: input.title, fileName, mediaType: 'text/markdown', bytes: new TextEncoder().encode(input.content), ...(input.references.length ? { sources: input.references } : {}) });
      return { ref: 'material:' + saved.materialId, materialId: saved.materialId, versionId: saved.currentVersion.versionId, revision: saved.revision, title: saved.title, content: input.content, source: { materialId: saved.materialId, versionId: saved.currentVersion.versionId }, references: input.references };
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'read_markdown_material', description: '读取一份已经保存的 Markdown 讲义或教材章节的固定版本。先读取再修改；返回实际正文、版本和资料身份，不返回本地路径。', parameters: toolSchema(ClassroomMarkdownReadSchema), output: markdownOutput,
    async execute(args, execution) {
      const input = ClassroomMarkdownReadSchema.parse(args);
      return readMarkdown(await teacherContext(ctx, execution), input.materialId, input.versionId);
    },
  }));
  const uploadInput = z.object({ name: z.string().trim().min(1).max(400).describe('消息里显示的文件名（含扩展名）'),
    title: z.string().trim().min(1).max(200).optional() }).strict();
  const uploadOutput = z.object({ materialId: z.string(), versionId: z.string(), revision: z.number().int().positive(),
    title: z.string(), fileName: z.string(), mediaType: z.string() }).strict();
  ctx.effect(() => ctx.tools.register({ name: 'import_uploaded_material',
    description: '把学生在本课消息里上传过的文件收进资料库，返回真实资料身份和固定版本。name填消息中显示的文件名；只能收本课会话真实出现过的附件，收不存在的文件会失败。收好后资料属于全空间资料库；挂进本课资料栏或学习集再走对应提案。',
    parameters: toolSchema(uploadInput),
    output: { schema: toolSchema(uploadOutput), render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(uploadOutput.parse(value)) }, ...entityReferenceContent(value)] },
    async execute(args, execution) {
      const input = uploadInput.parse(args), context = await teacherContext(ctx, execution);
      const observation = await ctx.sessionQuery.observeSession(SessionId(context.sessionId!));
      try {
        const uploaded = observation.events.flatMap(event => event.type === 'user/message'
          ? event.data.content.filter((block): block is FileBlock => block.type === 'file').map(block => block.attachment) : []);
        const ref = uploaded.findLast(item => item.name === input.name || ctx.attachments.fileHostPath(item) === input.name);
        if (!ref) throw rejected('这份文件没有出现在本课消息里；请学生先上传');
        const mediaType = mediaTypeForFileName(ref.name);
        if (!mediaType) throw rejected('这个文件格式资料库还不收；支持 PDF、Word、图片、Markdown、网页和纯文本');
        const chunks: Uint8Array[] = [];
        for await (const chunk of ctx.attachments.readFileStream(ref, execution.signal)) chunks.push(chunk);
        const saved = await ctx.studyforgeMaterialService.import({ ...context }, { title: input.title ?? ref.name.replace(/\.[^.]+$/u, ''), fileName: ref.name, mediaType, bytes: new Uint8Array(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))) });
        return { materialId: saved.materialId, versionId: saved.currentVersion.versionId, revision: saved.revision, title: saved.title, fileName: ref.name, mediaType };
      } finally { observation[Symbol.dispose](); }
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'update_markdown_material', description: '把当前课堂生成的 Markdown 追加为同一份资料的新版本。必须带read_markdown_material返回的真实资料身份、固定版本和revision；冲突时保留旧版本并要求重新读取，不会覆盖学生编辑。', parameters: toolSchema(ClassroomMarkdownUpdateSchema), output: markdownOutput,
    async execute(args, execution) {
      const input = ClassroomMarkdownUpdateSchema.parse(args), context = await teacherContext(ctx, execution), before = await readMarkdown(context, input.materialId, input.versionId);
      if (before.revision !== input.expectedVersion || before.versionId !== input.versionId) throw rejected('资料在你读取后已有新版本；重新read_markdown_material取得最新versionId和revision后再提交');
      const saved = await ctx.studyforgeMaterialService.createVersion({ ...context, expectedVersion: input.expectedVersion }, { materialId: before.materialId, title: before.title, fileName: before.title.replace(/[\\/:*?"<>|]/gu, '-').trim().slice(0, 120) + '.md', mediaType: 'text/markdown', bytes: new TextEncoder().encode(input.content), ...(before.references.length ? { sources: before.references } : {}) });
      return { ref: 'material:' + saved.materialId, materialId: saved.materialId, versionId: saved.currentVersion.versionId, revision: saved.revision, title: saved.title, content: input.content, source: { materialId: saved.materialId, versionId: saved.currentVersion.versionId }, references: before.references };
    },
  }));
}
