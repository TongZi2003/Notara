import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createHash } from 'node:crypto';
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ArtifactCreateSchema, ArtifactSaveSchema, type ArtifactCreate, type ArtifactView, type CreationRecordSchema, type CreationRecord } from '@studyforge/contracts/creation';
import type { RecordStore } from '@studyforge/domain/storage';
import { studentContext } from './learning-service.ts';
import { plannedSessionId } from './runtime/native-open.ts';
import { fileDigest, initializeProject, readProject, saveProjectFile } from './creation/project-store.ts';
import type { HostContext } from '@studyforge/contracts';
import { toolSchema } from './tools/tool-schema.ts';
import { teacherContext } from './tools/learning-context.ts';
import { ArtifactViewSchema } from '@studyforge/contracts/creation';
import type { ArtifactCheck, ArtifactInstallation } from '@studyforge/contracts/creation';
import { artifactCheck, installArtifact, setArtifactEnabled } from './creation/artifact-service.ts';
import { artifactEntry, ClassroomDocumentSchema } from '@studyforge/contracts/creation';
import { installClassroomAuthoring } from './creation/classroom-authoring.ts';
import { ClassroomTemplatesSchema } from '@studyforge/contracts/plugins';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeCreation: StudyForgeCreation; studyforgeCreationRecords: RecordStore<typeof CreationRecordSchema>; } }

export class StudyForgeCreation extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeCreation'); }
  @Remote('openCreator')
  async openCreator(input: { ref: string }): Promise<{ sessionId: string }> {
    const row = this.ctx.studyforgeCreationRecords.read(await studentContext(this.ctx), input.ref);
    const resolved = await this.ctx.sessionController.resolveAgent(SessionId(row.data.sessionId));
    if ('error' in resolved) throw new Error('creator_session_unavailable');
    const preset = this.ctx.sessionProjections.snapshot(resolved.agent.session, ['agentPreset']).values.agentPreset ?? resolved.agent.session.header.agentPreset;
    if (preset !== 'studyforge-creation') await this.ctx.agentPresets.select(resolved.agent, 'studyforge-creation');
    return { sessionId: row.data.sessionId };
  }
  @Remote('classroomTemplates')
  async classroomTemplates(): Promise<{ title: string; description: string; content: string }[]> {
    return this.ctx.studyforgePluginsManager.active().flatMap(({ ref, version }) => version.manifest.notara.worldbooks.flatMap(item => item.templates ? ClassroomTemplatesSchema.parse(JSON.parse(this.ctx.studyforgePluginsManager.body(ref, version.digest, item.templates))).map(preset => ({ title: preset.title, description: preset.description, content: JSON.stringify(preset.document, null, 2) })) : []));
  }
  @Remote('openTeacher')
  async openTeacher(): Promise<{ sessionId: string }> {
    const result = await this.ctx.sessionController.create({ workspaceId: this.ctx.studyforgeAccess.workspaceId as WorkspaceId, agentPreset: 'studyforge-learning' });
    return { sessionId: result.sessionId };
  }
  @Remote('check')
  async check(input: { ref: string }): Promise<ArtifactCheck> { return artifactCheck(this.ctx, input.ref); }
  @Remote('publishArtifact')
  async publishArtifact(input: { ref: string; digest: string; operationId: string; expectedVersion: number }): Promise<ArtifactInstallation> { return installArtifact(this.ctx, input); }
  @Remote('setEnabled')
  async setEnabled(input: { ref: string; expectedVersion: number; operationId: string; enabled: boolean }): Promise<ArtifactInstallation> { return setArtifactEnabled(this.ctx, input); }
  @Remote('list')
  async list(): Promise<ArtifactView[]> {
    const context = await studentContext(this.ctx);
    return this.ctx.studyforgeCreationRecords.list(context).map(record => readProject(this.ctx, record));
  }
  @Remote('read')
  async read(input: { ref: string }): Promise<ArtifactView> { return readProject(this.ctx, this.ctx.studyforgeCreationRecords.read(await studentContext(this.ctx), input.ref)); }
  @Remote('create')
  async create(input: ArtifactCreate): Promise<ArtifactView> {
    const data = ArtifactCreateSchema.parse(input), context = await studentContext(this.ctx, data.originSessionId);
    return this.createFor(context, data);
  }
  /** Internal writer preserves the actual requesting actor; not a public Remote. */
  async createFor(context: HostContext, data: ArtifactCreate): Promise<ArtifactView> {
    if (data.kind === 'classroom' && data.target) throw new Error('classroom_is_not_a_material');
    if (data.kind === 'classroom' && data.content !== undefined) ClassroomDocumentSchema.parse(JSON.parse(data.content));
    const id = createHash('sha256').update(context.workspaceId + ':' + data.operationId).digest('hex').slice(0, 24);
    const sessionId = SessionId(plannedSessionId(context.workspaceId, 'creator:' + data.operationId));
    const paths: string[] = [];
    for (const source of data.references) paths.push((await this.ctx.studyforgeMaterialService.resolve(context, { materialId: source.materialId, versionId: source.versionId })).absolutePath);
    const existing = this.ctx.studyforgeCreationRecords.list(context).some(row => row.ref === 'creation:' + id);
    if (data.target) {
      if (!data.target.ref.startsWith('material:')) throw new Error('creation_target_unsupported');
      const original = await this.ctx.studyforgeMaterialService.get(context, data.target.ref.slice('material:'.length));
      if (!existing && original.revision !== data.target.version) throw new Error('creation_target_conflict');
    }
    const record: CreationRecord = { name: 'work-' + id, sessionId, seedDigest: fileDigest(data.content ?? ''),
      initial: { title: data.title, kind: data.kind, description: data.description ?? '', subjects: data.subjects ?? [], entry: artifactEntry(data.kind) },
      references: data.references, ...(data.target ? { target: data.target } : {}), ...(data.originSessionId ? { originSessionId: data.originSessionId } : {}) };
    const saved = await this.ctx.studyforgeCreationRecords.create({ ...context, operationId: data.operationId }, id, record);
    initializeProject(this.ctx, record, data.content);
    await this.ctx.sessionController.create({ sessionId, workspaceId: context.workspaceId as WorkspaceId, agentPreset: 'studyforge-creation' });
    try { await this.ctx.studyforgeAccess.forSession(sessionId); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'creation_selection_required') throw error;
      await this.ctx.studyforgeAccess.selectCreation(sessionId, record.name, paths);
    }
    if (!saved.duplicate) await this.ctx.sessionController.rename({ sessionId, title: data.title });
    return readProject(this.ctx, saved);
  }
  @Remote('save')
  async save(input: { ref: string; path: 'manifest.json' | 'content.md' | 'index.html' | 'worldbook.json'; expectedDigest: string; content: string }): Promise<ArtifactView> {
    const data = ArtifactSaveSchema.parse(input);
    return saveProjectFile(this.ctx, await studentContext(this.ctx), data.ref, data.path, data.expectedDigest, data.content);
  }
}

export function installCreationContext(host: Context): void {
  installClassroomAuthoring(host);
  host.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next(), agent = context.agent;
    if (!agent || agent.session.header.origin === 'subagent') return result;
    const row = host.studyforgeCreationRecords.list({ workspaceId: host.studyforgeAccess.workspaceId, actor: 'system', purpose: 'creation' }).find(item => item.data.sessionId === agent.session.id);
    if (!row) return result;
    const binding = await host.studyforgeAccess.forSession(agent.session.id);
    if (binding.purpose !== 'creation') return result;
    return { ...result, sections: [...result.sections, { name: 'studyforge:creator', text: [
      '你是创作者，与用户共同制作学科教法、教学模式、任务技能、自包含HTML演示或教室。先理解作品目标，必要时头脑风暴，再共同编辑。',
      `本次作品目录：${binding.projectRoot}。先读 manifest.json；可编辑入口是 content.md、index.html或worldbook.json，其他作品和学习数据不在写入范围。`,
      'manifest字段：title、kind(subject/teaching/skill/html/markdown/classroom)、description、subjects数组、entry。HTML用index.html；教室用worldbook.json；其余用content.md。教室通过read_classroom_draft和save_classroom_draft编辑，成员、世界书、规则都在同一份草稿中。不得删除已有正文以规避要求。',
      '教法写具体教学步骤、观察依据、反馈方式、例外和结束条件；任务技能写目标、材料范围、真实工具和完成结果。HTML必须完整自包含，不访问网络或宿主数据。',
      `已授权参考原文路径：${JSON.stringify(binding.references)}。仅按需读取，与学生学情无关。`,
      '用户在编辑器修改的正是这些文件。每次修改先读当前文件，不覆盖用户新改动。完成后让用户在作品面板预览/安装；没有安装回执不声称已可用，不直接写学习事实或修改正在使用的旧版本。',
    ].join('\n\n') }] };
  });
  const input = ArtifactCreateSchema.omit({ operationId: true, originSessionId: true, target: true });
  host.effect(() => host.tools.register({ name: 'draft_artifact', description: '准备可共建的讲义、HTML演示或教学预设草稿。title/kind/content写作品本身，references只选真实已读资料；不安装、不改原文、不记录掌握。作品返回后学生可预览、编辑和保存。', parameters: toolSchema(input),
    output: { schema: toolSchema(ArtifactViewSchema), render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
    async execute(args, execution) {
      const context = await teacherContext(host, execution), parsed = input.parse(args);
      return host.studyforgeCreation.createFor(context, { ...parsed, operationId: context.operationId, originSessionId: context.sessionId! });
    },
  }));
}
