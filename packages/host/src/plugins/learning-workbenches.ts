import type { Context } from '@deepseek-ai/cordis';
import type { HostContext, MutationContext } from '@studyforge/contracts';
import { PluginDocumentSchema, PluginLinkSchema, type PluginDocument, type PluginDocumentRecordSchema, type PluginDocumentView, type PluginLink } from '@studyforge/contracts/plugin-learning';
import type { RecordStore } from '@studyforge/domain/storage';
import { packageId } from './plugin-manager.ts';
import { z } from 'zod';
import { toolSchema } from '../tools/tool-schema.ts';
import { teacherContext } from '../tools/learning-context.ts';
import {readMaterial} from '@studyforge/domain/material-read';
import { canonicalPath } from '@studyforge/domain/access';
import { MathProjectionSchema, applyMathEdits, type MathProjection, type MathEdit } from '@studyforge/contracts/math-workbench';
import { registerMathTools } from './math-tools.ts';
import { mathDimension } from '@studyforge/contracts/math-scene';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeLearningWorkbenches: LearningWorkbenches } }
export class LearningWorkbenches {
  private readonly projections = new Map<string,{at:number;projection:MathProjection}>();
  readonly host: Context; readonly records: RecordStore<typeof PluginDocumentRecordSchema>;
  constructor(host: Context, records: RecordStore<typeof PluginDocumentRecordSchema>) { this.host = host; this.records = records; }
  async authorize(sessionId: string, id: string, permission: string, digest?: string) {
    const content = await this.host.studyforgePluginsManager.openWorkbench(sessionId, id);
    if (!content.permissions.includes(permission) || digest && content.digest !== digest) throw new Error('plugin_permission_denied');
    return content;
  }
  async read(context: HostContext, id: string): Promise<PluginDocumentView> {
    const content = await this.authorize(context.sessionId!, id, 'document');
    const key = packageId(context.sessionId + ':' + id + ':' + content.digest), row = this.records.list(context).find(row => row.ref === 'plugindocument:' + key);
    if (row) return { revision: row.version, document: row.data.document };
    const version = this.host.studyforgePluginsManager.get(content.pluginRef, content.digest), contribution = version.manifest.notara.workbenches.find(c => c.id === content.contributionId)!;
    return { revision: 0, document: PluginDocumentSchema.parse(JSON.parse(this.host.studyforgePluginsManager.body(content.pluginRef, content.digest, contribution.document!.seed))) };
  }
  async write(context: MutationContext, id: string, input: PluginDocument): Promise<PluginDocumentView> {
    const content = await this.authorize(context.sessionId!, id, 'document');
    const document = PluginDocumentSchema.parse(input); if (document.kind !== content.documentKind) throw new Error('plugin_document_kind_mismatch');
    for (const link of documentLinks(document)) Object.assign(link, await this.link(context, link));
    const key = packageId(context.sessionId + ':' + id + ':' + content.digest), data = { sessionId: context.sessionId!, id, digest: content.digest, document };
    const saved = context.expectedVersion === 0 ? await this.records.create(context, key, data) : await this.records.update(context, 'plugindocument:' + key, data, () => data);
    return { revision: saved.version, document: saved.data.document };
  }
  async inspectMath(context:HostContext,id:string) {
    const row=await this.read(context,id);if(row.document.kind!=='math')throw new Error('math_workbench_required');
    const content=await this.authorize(context.sessionId!,id,'document');
    const key=packageId(context.sessionId+':'+id+':'+content.digest), saved=this.projections.get(key);
    const fresh=!!saved&&saved.projection.revision===row.revision&&Date.now()-saved.at<15000;
    const history=row.revision?this.records.changes(context,'plugindocument:'+key).slice(-12).map(c=>({revision:c.afterRevision,previous:c.beforeRevision??0,actor:c.actor})):[];
    return {...row,rendering:fresh?'current' as const:'unavailable' as const,projection:fresh?saved!.projection:null,history};
  }
  async publishMath(context:HostContext,id:string,input:MathProjection):Promise<void> {
    const projection=MathProjectionSchema.parse(input),row=await this.read(context,id);
    if(row.document.kind!=='math'||projection.revision!==row.revision)throw new Error('math_projection_stale');
    const names=row.document.objects.map(o=>o.name);
    if(projection.objects.length!==names.length||new Set(projection.objects.map(o=>o.name)).size!==names.length||projection.objects.some(o=>!names.includes(o.name)))throw new Error('math_projection_objects_mismatch');
    for(const entry of projection.objects){
      const object=row.document.objects.find(o=>o.name===entry.name)!;
      const point=['point','glider','midpoint','intersection','point3d','midpoint3d'].includes(object.kind);
      if(entry.coordinates&&(!point||entry.coordinates.length!==mathDimension(object))||point&&entry.state==='defined'&&!entry.coordinates||entry.state!=='defined'&&(entry.coordinates||Object.keys(entry.values).length))throw new Error('math_projection_shape_mismatch');
    }
    const content=await this.authorize(context.sessionId!,id,'document'),key=packageId(context.sessionId+':'+id+':'+content.digest);
    for(const [other,value] of this.projections)if(Date.now()-value.at>60000)this.projections.delete(other);
    this.projections.set(key,{at:Date.now(),projection});
  }
  async editMath(context:MutationContext,id:string,edits:MathEdit[]):Promise<PluginDocumentView> {
    // Transform the requested base revision so retrying an operation stays idempotent.
    const row=await this.mathRevision(context,id,z.number().int().nonnegative().parse(context.expectedVersion));
    return this.write(context,id,applyMathEdits(row,edits));
  }
  async mathRevision(context:HostContext,id:string,revision:number) {
    const content=await this.authorize(context.sessionId!,id,'document');
    const contribution=this.host.studyforgePluginsManager.get(content.pluginRef,content.digest).manifest.notara.workbenches.find(c=>c.id===content.contributionId)!;
    const doc=revision===0?PluginDocumentSchema.parse(JSON.parse(this.host.studyforgePluginsManager.body(content.pluginRef,content.digest,contribution.document!.seed))):this.records.read(context,'plugindocument:'+packageId(context.sessionId+':'+id+':'+content.digest),revision).data.document;
    if(doc.kind!=='math')throw new Error('math_workbench_required');return doc;
  }
  async link(context: HostContext, input: PluginLink): Promise<PluginLink> {
    const link = PluginLinkSchema.parse(input);
    if (link.kind === 'source') { const material = await this.host.studyforgeMaterialService.resolve(context, {materialId:link.source.materialId,versionId:link.source.versionId}); if(link.source.locator)await readMaterial(this.host.studyforgeMaterialService,context,link.source);return { ...link, title: material.version.title }; }
    if (link.kind === 'card') { const card = this.host.studyforgeCardService.read(context, link.ref, link.version); return { ...link, title: card.content.title }; }
    const bound = await this.host.studyforgeAccess.forSession(link.sessionId); if (bound.workspaceId !== context.workspaceId || bound.purpose !== 'learning') throw new Error('lesson_unavailable');
    const native = await this.host.sessionController.list({}, AbortSignal.timeout(10000));
    const lesson = native.items.find(row => String(row.sessionId) === link.sessionId && row.origin !== 'subagent');
    if (!lesson) throw new Error('lesson_unavailable');
    return { ...link, title: String(lesson.projections?.values.title ?? '课堂').slice(0,240) };
  }
  async sources(context: HostContext, query: string): Promise<PluginLink[]> {
    const materials = await this.host.studyforgeMaterialService.list(context), needle = query.toLocaleLowerCase();
    const links: PluginLink[] = [
      ...materials.map(row => ({ kind: 'source' as const, title: row.title, source: { materialId: row.materialId, versionId: row.currentVersion.versionId } })),
      ...this.host.studyforgeCardRecords.list(context).map(row => ({ kind: 'card' as const, title: row.data.content.title, ref: row.ref, version: row.version })),
    ];
    const native = await this.host.sessionController.list({}, AbortSignal.timeout(10000));
    for (const row of native.items) if (row.projections?.values.agentPreset === 'studyforge-learning' && row.origin !== 'subagent' && row.cwd && canonicalPath(row.cwd, this.host.studyforgeAccess.root) === this.host.studyforgeAccess.root) links.push({ kind: 'lesson', title: String(row.projections?.values.title ?? '课堂').slice(0,240), sessionId: String(row.sessionId) });
    return balancedSources(links.filter(link => link.title.toLocaleLowerCase().includes(needle)));
  }
}
export function balancedSources(links: PluginLink[]): PluginLink[] {
  const groups = ['source','card','lesson'].map(kind => links.filter(link => link.kind === kind)), result: PluginLink[] = [];
  for (let index = 0; result.length < 60 && groups.some(group => index < group.length); index++) for (const group of groups) if (group[index] && result.length < 60) result.push(group[index]!);
  return result;
}
export function documentLinks(doc: PluginDocument): PluginLink[] {
  if (doc.kind === 'blackboard') return doc.blocks.flatMap(b => b.links);
  if (doc.kind === 'evidence') return doc.entries.flatMap(e => e.links);
  if (doc.kind === 'atlas') return doc.events.flatMap(e => e.links);
  return doc.kind === 'clinic' || doc.kind === 'math' ? doc.links : [];
}
export function registerWorkbenchTools(host: Context): void {
  registerMathTools(host);
  const read = z.object({ id: z.string().optional() }).strict();
  const write = z.object({ id: z.string(), expectedVersion: z.number().int().nonnegative(), documentJson: z.string().max(60000) }).strict();
  const output = { schema: { type: 'object' as const, properties: { json: { type: 'string' as const } }, required: ['json'], additionalProperties: false as const }, render: (_args: unknown, value: { json: string }) => [{ type: 'text' as const, text: value.json }] };
  host.effect(() => host.tools.register({ name: 'read_workbench', description: '读取已安装的课堂工作台。无id返回有工作文档的可用工作台id；有id返回当前revision、document和完整文档schema。工作文档是备课和讨论草稿，不是学生学情。', parameters: toolSchema(read), output,
    async execute(args, execution) { const context = await teacherContext(host, execution), input = read.parse(args);
      if (execution.agent?.session.header.origin === 'subagent') throw new Error('main_teacher_required');
      if (input.id) return { json: JSON.stringify({ id: input.id, ...await host.studyforgeLearningWorkbenches.read(context, input.id), schema: z.toJSONSchema(PluginDocumentSchema) }) };
      const choices = host.studyforgePluginsManager.workbenches(context.sessionId), rows = [];
      for (const choice of choices) { const contribution = host.studyforgePluginsManager.get(choice.pluginRef,choice.digest).manifest.notara.workbenches.find(row => row.id === choice.contributionId); if (contribution?.document) rows.push({ id: choice.id, title: choice.title, kind: contribution.document.kind }); }
      return { json: JSON.stringify({ workbenches: rows }) };
    },
  }));
  host.effect(() => host.tools.register({ name: 'update_workbench', description: '更新课堂工作文档，包括数学场景、黑板、错解、史料、地图和模拟。先read_workbench，沿原id/revision修改其document；documentJson是完整document，形状以返回schema为准。数学场景的表达式只支持数学运算及常用函数，显式写乘号，参数和对象name是可读引用名称；保留学生参数、视区、观察与未改对象。页面会自动同步；不写卡片、不记掌握。', parameters: toolSchema(write), output,
    async execute(args, execution) { const context = await teacherContext(host, execution), input = write.parse(args);
      if (execution.agent?.session.header.origin === 'subagent') throw new Error('main_teacher_required');
      return { json: JSON.stringify(await host.studyforgeLearningWorkbenches.write({ ...context, expectedVersion: input.expectedVersion }, input.id, PluginDocumentSchema.parse(JSON.parse(input.documentJson)))) };
    },
  }));
}
