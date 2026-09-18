import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-skill';
import type {} from '@deepseek-ai/dsh-session-projection';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { TeachingManifestSchema, type TeachingChoice } from '@studyforge/contracts/teaching';
import { TOOL_FACADE_NAMES, resolveFacadeTool } from '@studyforge/contracts/tool-facades';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { continuationBrief } from './lesson-brief.ts';
import { providerToolSchemas } from '../tools/model-tool-schemas.ts';
import { bookTaskInstructions, currentBookTask } from './book-task.ts';
import { installToolDisclosure } from '../tools/tool-disclosure.ts';
import { guidedBrief, registerGuidedLearning } from './guided-learning.ts';
import { lessonSubjects, subjectBrief, pinSubjects } from './subject-context.ts';
import { studentContext } from '../learning-service.ts';
import { installTaskSkills, taskChoices, taskLabels } from './task-skills.ts';
import { activeArtifacts, installedBody } from '../creation/artifact-service.ts';
import { worldbookContext } from '../plugins/worldbook-context.ts';
import { teachingText, teachingResources, teachingResource, saveTeachingOverride, resetTeachingOverride } from './teaching-overrides.ts';

export function teachingBody(host: Context, id: string): string {
  if (!id.startsWith('creation:') && !id.startsWith('plugin:')) return teachingText(host, 'preset/' + id, host.studyforgeTeachingCatalog.body(id));
  const [ref, digest] = id.split('@');
  const resource = installedBody(host, ref!, digest!);
  if (resource.manifest.kind !== 'teaching') throw new Error('teaching_configuration_missing');
  return resource.body;
}

export const INTERACTION_MODES = ['socratic', 'feynman', 'lecture'];

export class TeachingCatalog {
  readonly defaultId: string;
  readonly choices: readonly TeachingChoice[];
  readonly base: string;
  readonly guided: string;
  private readonly bodies: Map<string, string>;
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
    const manifest = TeachingManifestSchema.parse(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')));
    this.defaultId = manifest.default;
    this.choices = manifest.choices.map(({ file: _file, ...choice }) => choice);
    this.base = readFileSync(join(directory, 'base.md'), 'utf8');
    this.guided = readFileSync(join(directory, 'guided-learning.md'), 'utf8');
    this.bodies = new Map(manifest.choices.map(choice => [choice.id, readFileSync(join(directory, 'presets', choice.file), 'utf8')]));
  }
  has(id: string): boolean { return this.bodies.has(id); }
  body(id: string): string {
    const text = this.bodies.get(id);
    if (text === undefined) throw new Error('teaching_configuration_missing');
    return text;
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context { studyforgeTeaching: StudyForgeTeaching; studyforgeTeachingCatalog: TeachingCatalog; }
}
export class StudyForgeTeaching extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeTeaching'); }
  @Remote('choices')
  async choices(): Promise<TeachingChoice[]> { return [...this.ctx.studyforgeTeachingCatalog.choices]; }
  @Remote('tasks')
  async tasks(): Promise<TeachingChoice[]> { return taskChoices(this.ctx); }
  @Remote('taskLabels')
  async taskLabels(): Promise<{ id: string; title: string }[]> { return taskLabels(this.ctx); }
  @Remote('modes')
  async modes(): Promise<TeachingChoice[]> { return [...this.ctx.studyforgeTeachingCatalog.choices.filter(choice => INTERACTION_MODES.includes(choice.id)), ...activeArtifacts(this.ctx).filter(item => item.manifest.kind === 'teaching').map(item => ({ id: item.ref + '@' + item.digest, title: item.manifest.title, description: item.manifest.description }))]; }
  @Remote('subjects')
  async subjects(input: { sessionId: string }): Promise<{ effective: string[]; inherited: boolean; choices: string[] }> {
    const context = await studentContext(this.ctx, input.sessionId);
    const course = this.ctx.studyforgeCourseMetadata.read(context).data;
    const effective = lessonSubjects(this.ctx, context, course);
    const sets = this.ctx.studyforgeSetService.list(context);
    return { effective, inherited: course.subjects === undefined, choices: [...new Set([...effective, ...sets.flatMap(set => set.subjects), ...activeArtifacts(this.ctx).filter(item => item.manifest.kind === 'subject').flatMap(item => item.manifest.subjects)])].sort() };
  }
  @Remote('resources')
  async resources(): Promise<import('@studyforge/contracts/teaching').TeachingNode[]> { return teachingResources(this.ctx); }
  @Remote('resource')
  async resource(input: { nodeId: string }): Promise<import('@studyforge/contracts/teaching').TeachingResource> { return teachingResource(this.ctx, input.nodeId); }
  @Remote('saveResource')
  async saveResource(input: { nodeId: string; body: string; expectedVersion: number; operationId: string }): Promise<import('@studyforge/contracts/teaching').TeachingResource> { return saveTeachingOverride(this.ctx, input); }
  @Remote('resetResource')
  async resetResource(input: { nodeId: string; expectedVersion: number; operationId: string }): Promise<import('@studyforge/contracts/teaching').TeachingResource> { return resetTeachingOverride(this.ctx, input); }
}

/** Dynamic teaching context and the existing role-specific tool boundaries. */
export function installTeaching(host: Context, catalog: TeachingCatalog): void {
  installTaskSkills(host, catalog.directory);
  registerGuidedLearning(host);
  // Some native composition plugins register local tools after spawn's inherited
  // filter. These teacher-only capabilities must remain absent for every helper.
  const helperForbidden = new Set(['read_workbench', 'update_workbench', 'read_workbench_activity', 'draft_artifact', 'create_markdown_material', 'read_markdown_material', 'update_markdown_material', 'import_uploaded_material', 'mark_thought', 'read_thoughtmap', 'advance_conversation_stage', 'summarize_stage', 'note_learning_goal', 'cite_materials', 'subagent', 'delegate_search', 'delegate_problem', 'delegate_assistant', 'delegate_peer',
    'list_model_routes',
    'read_card', 'read_cards', 'list_cards', 'query_evidence', 'read_memory', 'search_memory', 'note_memory', 'revise_memory',
    'register_cards', 'update_card', 'note_method', 'revise_method', 'record_review', 'read_math_scene','edit_math_scene','calculate_math','restore_math_scene',
    'propose_card', 'propose_review', 'propose_set', 'propose_plan', 'propose_route', 'propose_skeleton', 'propose_handoff', 'read_handoff', 'read_lesson', 'read_journey', 'propose_lesson_settings',
    'read_classroom', 'ask_classmate', 'continue_classmate', 'update_classroom_context', 'adjust_classroom_intimacy', 'propose_classmate',
    'read_teaching', 'propose_teaching',
    'read', 'write', 'edit', 'glob', 'grep', 'read_image', 'run_code']);
  const helper = (agent: Agent | undefined): boolean => !!agent && agent.session.header.origin === 'subagent'
    && (host.sessionProjections.snapshot(agent.session, ['agentPreset']).values.agentPreset ?? agent.session.header.agentPreset) === 'studyforge-learning';
  const owns = (agent: Agent | undefined): agent is Agent => !!agent
    && (host.sessionProjections.snapshot(agent.session, ['agentPreset']).values.agentPreset ?? agent.session.header.agentPreset) === 'studyforge-learning'
    && agent.session.header.origin !== 'subagent'
    && !!agent.session.header.cwd && realpathSync(agent.session.header.cwd) === host.studyforgeAccess.root;
  const disclose = installToolDisclosure(host, owns);
  const worldbook = worldbookContext(host);
  host.effect(() => host.systemPrompt.section({
    name: 'studyforge:teaching', order: 20000,
    text: ({ agent }) => {
      if (!owns(agent)) return '';
      const course = host.studyforgeCourseMetadata.read({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' }).data;
      const task = currentBookTask(agent.session.snapshotEvents());
      const existing = task ? host.studyforgeCardRecords.list({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' })
        .filter(row => row.data.content.sources.some(source => source.materialId === task.material.materialId)
          && (!task.nodePath || row.data.content.chapter === task.nodePath || row.data.content.chapter?.startsWith(task.nodePath + '/')))
        .map(row => ({ ref: row.ref, title: row.data.content.title, chapter: row.data.content.chapter ?? null })) : [];
      return [teachingText(host, 'base', catalog.base), teachingBody(host, task ? 'organize' : course.teachingRef ?? catalog.defaultId),
        subjectBrief(host, { workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' }, course),
        course.learningGoal ? `学习目标：${course.learningGoal.title}${[course.learningGoal.deadline ? `截止${course.learningGoal.deadline}` : '', course.learningGoal.dailyMinutes ? `每天${String(course.learningGoal.dailyMinutes)}分钟` : ''].filter(Boolean).join('，').replace(/^(.+)$/, '（$1）')}` : '',
        (() => {
          const scan = host.studyforgeMemoryService?.search({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' }, { query: '', limit: 40 });
          if (!scan || scan.hits.length === 0) return '';
          const rows = scan.hits.map(hit => `- [${hit.kind}] ${hit.title ?? Array.from(hit.snippet.text.replace(/\s+/gu, ' ').trim()).slice(0, 40).join('')}（${hit.ref}）`);
          return `本学生已有学情 ${String(scan.hits.length)}${scan.hasMore ? ' 条（其余用search_memory分页）' : ' 条'}；同一对象的再次观察用revise_memory并入对应target，不为同一件事另建新档：\n` + rows.join('\n');
        })(),
        (() => {
          const rows = host.studyforgeKnowledgeRecords?.list({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' }) ?? [];
          if (rows.length === 0) return '';
          const lines = rows.slice(0, 40).map(row => `- ${row.data.content.category ? `[${row.data.content.category}] ` : ''}${row.data.content.title}（${row.ref}）`);
          return `本学生已有方法与知识 ${String(rows.length)} 条${rows.length > 40 ? '（其余用search_learning枚举knowledge语料）' : ''}；正文用read_method精读，同一主题的增补用revise_method并入对应target，不另建新档：\n` + lines.join('\n');
        })(),
        '你是教学者。诊断当前困难、备课选材、规划路线、检验理解和整理学习记录都是你的基本职责；当前教学方式只决定怎样互动。按需要调用技能，不要求学生先切换诊断或规划身份。',
        !task && (course.guided || course.learningContext) ? teachingText(host, 'guided', catalog.guided) : '',
        !task ? guidedBrief(host, { workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' }) : '',
        task ? bookTaskInstructions(task) : '',
        task ? `目标范围现有 ${String(existing.length)} 张卡（这里只是清单，需修改时先read_card）：` + JSON.stringify(existing.slice(0, 20)) + (existing.length > 20 ? '\n其余用list_cards分页读取。' : '') : '',
        course.stance ? '本课重点：' + course.stance : '',
        course.temporaryInstructions ? '学生给本课的临时要求：\n' + course.temporaryInstructions : '',
        course.closure ? '这节课已经确认结束；可以继续讨论和更正，状态仍然结束。' : '',
        continuationBrief(host, { workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' })?.text ?? '',
        // The stage track is durable record, re-injected every turn so a
        // compacted conversation still knows which stage it is in.
        (() => {
          const frames = host.studyforgeThoughts.list({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' })
            .find(row => row.data.sessionId === agent.session.id)?.data.frames ?? [];
          const active = frames.find(frame => frame.status === 'active');
          if (frames.length === 0 || !active) return '';
          const line = frames.map((frame, index) => `${frame.id === active.id ? '▶' : ''}第${index + 1}阶段《${frame.title}》${frame.id === active.id ? '（进行中）' : ''}`).join('；');
          return `本课阶段路线：${line}。本阶段目标：${active.goal}`;
        })(),
        '本课教学材料引用：' + JSON.stringify(course.lessonMaterials.materials),
      ].filter(Boolean).join('\n\n');
    },
  }));
  host.on('system-prompt/assemble', async (_assembly, context, next) => {
    if (owns(context.agent)) {
      const binding = { workspaceId: host.studyforgeAccess.workspaceId, sessionId: context.agent.session.id, actor: 'teacher' as const, purpose: 'learning' as const };
      await pinSubjects(host, binding, host.studyforgeCourseMetadata.read(binding).data);
    }
    const result = await next();
    if (owns(context.agent)) {
      const background = await worldbook(context.agent);
      // Native snapshots mark the current user-role reference context. Their
      // history remains auditable; no extra student-authored message is created.
      if (background) result.contexts.push({ name: 'notara:worldbook', text: background });
      const classroom = await host.notaraClassroom?.prompt(context.agent);
      if (classroom) result.contexts.push({ name: 'notara:classroom', text: classroom });
      const activity = await host.studyforgeBoardActivity?.prompt({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: context.agent.session.id, actor: 'teacher', purpose: 'learning' }, context.agent.session.id);
      if (activity) result.contexts.push({ name: 'notara:board-activity', text: activity });
    }
    // A saved-result notice resumes the same teacher with the same tools.
    // Confirmation/idempotency belong to the writers, not a blanket tool ban
    // that contradicts the receipt's instruction to continue teaching.
    const visible = helper(context.agent) ? result.tools.filter(tool => !helperForbidden.has(tool.name) && !TOOL_FACADE_NAMES.has(tool.name)) : result.tools;
    const projected = disclose({ ...result, tools: visible }, context.agent);
    return { ...projected, tools: providerToolSchemas(projected.tools) };
  });
  host.effect(() => host.tools.guard(execution => {
    const gated = resolveFacadeTool(execution.name, execution.arguments) ?? execution.name;
    if (helper(execution.agent) && helperForbidden.has(gated)) return '这次独立任务只读取材料和返回结果，不能读取学情、写入学习事实或继续委派。';
    if (gated === 'register_cards') {
      if (!owns(execution.agent)) return '普通批量登记只在诊断课或独立命题的宿主写入中使用。';
      const course = host.studyforgeCourseMetadata.read({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: execution.agent.session.id, actor: 'teacher', purpose: 'learning' });
      if (course.data.teachingRef !== 'diagnose' && !(course.data.guided && !course.data.learningContext && !course.data.closure)) return '常规新卡请先提案，由学生确认。';
    }
    return undefined;
  }));
  host.effect(() => host.skills.registerProvider(() => ({
    name: 'studyforge-teaching',
    async list(options) {
      if (options.signal?.aborted || !options.cwd || realpathSync(options.cwd) !== host.studyforgeAccess.root) return [];
      return catalog.choices.map(choice => ({
        name: 'studyforge-' + choice.id, description: choice.description, provider: 'studyforge-teaching', source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true }, rank: 10, locator: choice.id,
      }));
    },
    async get(candidate, options) {
      if (options.signal?.aborted || typeof candidate.locator !== 'string' || !catalog.has(candidate.locator)) return undefined;
      return { name: candidate.name, description: candidate.description, provider: 'studyforge-teaching', source: 'bundled',
        invocation: candidate.invocation, content: teachingText(host, 'base', catalog.base) + '\n\n' + teachingText(host, 'preset/' + candidate.locator, catalog.body(candidate.locator)) };
    },
  })));
}
