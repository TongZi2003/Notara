import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-skill';
import type {} from '@deepseek-ai/dsh-session-projection';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { TeachingManifestSchema, type TeachingChoice } from '@studyforge/contracts/teaching';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { continuationBrief } from './lesson-brief.ts';
import { providerToolSchemas } from '../tools/model-tool-schemas.ts';

export class TeachingCatalog {
  readonly defaultId: string;
  readonly choices: readonly TeachingChoice[];
  readonly base: string;
  private readonly bodies: Map<string, string>;
  constructor(directory: string) {
    const manifest = TeachingManifestSchema.parse(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')));
    this.defaultId = manifest.default;
    this.choices = manifest.choices.map(({ file: _file, ...choice }) => choice);
    this.base = readFileSync(join(directory, 'base.md'), 'utf8');
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
}

/** Only native claims determine whether this request processes receipts alone. */
export function installTeaching(host: Context, catalog: TeachingCatalog): void {
  // Some native composition plugins register local tools after spawn's inherited
  // filter. These teacher-only capabilities must remain absent for every helper.
  const helperForbidden = new Set(['subagent', 'delegate_search', 'delegate_problem', 'delegate_assistant', 'delegate_peer',
    'read_card', 'query_evidence', 'read_memory', 'search_memory', 'note_memory', 'revise_memory',
    'register_cards', 'update_card', 'note_method', 'revise_method', 'record_review',
    'propose_card', 'propose_review', 'propose_set', 'propose_plan', 'propose_route', 'propose_skeleton', 'propose_handoff', 'read_lesson', 'propose_lesson_settings',
    'read', 'write', 'edit', 'glob', 'grep', 'read_image', 'run_code']);
  const helper = (agent: Agent | undefined): boolean => !!agent && agent.session.header.origin === 'subagent'
    && (host.sessionProjections.snapshot(agent.session, ['agentPreset']).values.agentPreset ?? agent.session.header.agentPreset) === 'studyforge-learning';
  const claimed = new Map<Agent, { turn: number; receiptOnly: boolean }>();
  host.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const source = message.source;
    const receipt = source.kind === 'plugin' && source.plugin === 'studyforge' && source.form === 'notice';
    const previous = claimed.get(agent);
    claimed.set(agent, { turn, receiptOnly: receipt && (previous?.turn !== turn || previous.receiptOnly) });
  });
  host.on('agent/disposed', ({ agent }) => { claimed.delete(agent); });
  const owns = (agent: Agent | undefined): agent is Agent => !!agent
    && (host.sessionProjections.snapshot(agent.session, ['agentPreset']).values.agentPreset ?? agent.session.header.agentPreset) === 'studyforge-learning'
    && agent.session.header.origin !== 'subagent'
    && !!agent.session.header.cwd && realpathSync(agent.session.header.cwd) === host.studyforgeAccess.root;
  host.effect(() => host.systemPrompt.section({
    name: 'studyforge:teaching', order: 20000,
    text: ({ agent }) => {
      if (!owns(agent)) return '';
      const course = host.studyforgeCourseMetadata.read({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' }).data;
      return [catalog.base, catalog.body(course.teachingRef ?? catalog.defaultId),
        course.stance ? '本课重点：' + course.stance : '',
        course.temporaryInstructions ? '学生给本课的临时要求：\n' + course.temporaryInstructions : '',
        course.closure ? '这节课已经确认结束；可以继续讨论和更正，状态仍然结束。' : '',
        continuationBrief(host, { workspaceId: host.studyforgeAccess.workspaceId, sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' })?.text ?? '',
        '本课教学材料引用：' + JSON.stringify(course.lessonMaterials.materials),
      ].filter(Boolean).join('\n\n');
    },
  }));
  host.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next();
    // The receipt-only turn still sees no tool at all, and a helper keeps its
    // own filter; only the surviving list is projected for the provider.
    if (context.agent && claimed.get(context.agent)?.receiptOnly) return { ...result, tools: [] };
    const visible = helper(context.agent) ? result.tools.filter(tool => !helperForbidden.has(tool.name)) : result.tools;
    return { ...result, tools: providerToolSchemas(visible) };
  });
  host.effect(() => host.tools.guard(execution => {
    if (execution.agent && claimed.get(execution.agent)?.receiptOnly) return '这次仅说明系统保存结果，不执行新的工具动作。';
    if (helper(execution.agent) && helperForbidden.has(execution.name)) return '这次独立任务只读取材料和返回结果，不能读取学情、写入学习事实或继续委派。';
    if (execution.name === 'register_cards') {
      if (!owns(execution.agent)) return '普通批量登记只在诊断课或独立命题的宿主写入中使用。';
      const course = host.studyforgeCourseMetadata.read({ workspaceId: host.studyforgeAccess.workspaceId, sessionId: execution.agent.session.id, actor: 'teacher', purpose: 'learning' });
      if (course.data.teachingRef !== 'diagnose') return '常规新卡请先提案，由学生确认。';
    }
    return undefined;
  }));
  host.effect(() => host.skills.registerProvider(() => ({
    name: 'studyforge-teaching',
    async list(options) {
      if (options.signal?.aborted || !options.cwd || resolve(options.cwd) !== resolve(host.studyforgeAccess.root)) return [];
      return catalog.choices.map(choice => ({
        name: 'studyforge-' + choice.id, description: choice.description, provider: 'studyforge-teaching', source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true }, rank: 10, locator: choice.id,
      }));
    },
    async get(candidate, options) {
      if (options.signal?.aborted || typeof candidate.locator !== 'string' || !catalog.has(candidate.locator)) return undefined;
      return { name: candidate.name, description: candidate.description, provider: 'studyforge-teaching', source: 'bundled',
        invocation: candidate.invocation, content: catalog.base + '\n\n' + catalog.body(candidate.locator) };
    },
  })));
}
