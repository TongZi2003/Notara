import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolSchema } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import { z } from 'zod';
import { toolSchema } from './tool-schema.ts';

/** Presentation only: the registry and its execution guards remain authoritative. */
export const CLASSROOM_CORE_TOOLS = ['load_tools', 'read_lesson', 'list_materials', 'read_material',
  'search_learning', 'list_cards', 'read_card', 'query_evidence'] as const;
const core = new Set<string>(CLASSROOM_CORE_TOOLS);
const unavailable = new Set(['write', 'edit', 'run_code']);
const loadInput = z.object({ names: z.array(z.string().trim().min(1)).min(1) }).strict();
const loadOutput = z.object({ loaded: z.array(z.string()), available: z.literal('next_step'), scope: z.literal('current_lesson') }).strict();

/** These are headings only, never permissions or a second parameter contract. */
const groups: readonly [string, readonly string[]][] = [
  ['资料与卡片', ['list_materials', 'read_material', 'preview_region', 'search_learning', 'read_content', 'cite_materials', 'list_cards', 'read_card', 'read_cards', 'propose_card', 'update_card', 'register_cards']],
  ['知识与方法', ['read_method', 'note_method', 'revise_method']],
  ['学情与学习记录', ['search_memory', 'read_memory', 'note_memory', 'revise_memory', 'query_evidence', 'propose_review', 'record_review']],
  ['课程与计划', ['note_learning_goal', 'list_sets', 'read_set', 'propose_set', 'list_plans', 'read_plan', 'propose_plan', 'read_route', 'propose_route', 'read_skeleton', 'propose_skeleton', 'read_lesson', 'propose_lesson_settings', 'read_handoff', 'propose_handoff']],
  ['委派与协作', ['delegate_search', 'delegate_assistant', 'delegate_peer', 'delegate_problem', 'subagent', 'send_message', 'interrupt_agent']],
  ['内容共建', ['draft_artifact', 'mark_thought', 'read_workbench', 'update_workbench']],
  ['其他阅读能力', ['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'skill']],
];

export function classroomToolCatalogue(tools: readonly ToolSchema[], diagnose: boolean): ToolSchema[] {
  return tools.filter(tool => !unavailable.has(tool.name) && (tool.name !== 'register_cards' || diagnose));
}

/** Rebuild from native accepted results, never from a student's text or a model's
 * proposed loader arguments. Old real calls retain their repair/followup tools.
 * Fork-inherited events are excluded by the caller, so a new lesson starts small. */
export function retainedTools(events: readonly SessionEvent[]): Set<string> {
  const loaded = new Set<string>();
  const loaders = new Set<string>();
  for (const event of events) {
    if (event.type === 'tool/call') {
      if (event.data.name === 'load_tools') loaders.add(event.data.callId);
      else loaded.add(event.data.name);
    }
    if (event.type !== 'tool/result') continue;
    for (const block of event.data.message.content) {
      if (block.type !== 'tool-result' || !loaders.delete(block.toolCallId) || block.isError) continue;
      const result = loadOutput.safeParse(event.data.meta);
      if (result.success) for (const name of result.data.loaded) loaded.add(name);
    }
  }
  // Starting a continuable task must keep its native followup controls at hand.
  if (loaded.has('subagent') || loaded.has('delegate_search')) {
    loaded.add('send_message'); loaded.add('interrupt_agent');
  }
  return loaded;
}

function retainedBy(agent: Agent): Set<string> {
  return retainedTools(agent.session.snapshotEvents().slice(agent.session.inheritedEventCount));
}

export function toolCatalogueText(tools: readonly ToolSchema[]): string {
  const headings = new Map(groups.flatMap(([heading, names]) => names.map(name => [name, heading] as const)));
  const rows = new Map<string, string[]>();
  for (const tool of tools) {
    const heading = headings.get(tool.name) ?? '其他能力';
    const summary = tool.description.split(/[。；\n]/u)[0]!.replace(/\s+/gu, ' ').trim();
    const row = `${tool.name} — ${Array.from(summary).slice(0, 90).join('')}`;
    const group = rows.get(heading) ?? []; group.push(row); rows.set(heading, group);
  }
  return [
    '# 按需取得工具',
    '当前请求的 tools 是已经加载的完整调用接口。下面只是待加载目录，不含参数。需要目录中的能力时，先调用 load_tools，names 填目录中的精确工具名；可以一次加载接下来要用的读取和修改工具。从下一步开始按真实 schema 调用，不要猜参数，也不要让学生代为加载。',
    '加载仅改变本课工具展示，不切换教法、不执行所选工具、不保存学习事实、不增加权限。已加载工具在本课跨轮保留；确认回执和后台回话不会卸载它们。新增与修订、提案与直接记档仍按各自合同处理。',
    ...[...rows].map(([heading, entries]) => `## ${heading}\n${entries.join('\n')}`),
    ...(tools.length === 0 ? ['目录中的工具已全部加载。'] : []),
  ].join('\n\n');
}

export function projectClassroomTools(assembly: PromptAssembly, tools: readonly ToolSchema[], loaded: ReadonlySet<string>): PromptAssembly {
  const shown = tools.filter(tool => core.has(tool.name) || loaded.has(tool.name));
  const deferred = tools.filter(tool => !core.has(tool.name) && !loaded.has(tool.name));
  return { ...assembly, tools: shown,
    sections: [...assembly.sections, { name: 'studyforge:tool-catalogue', text: toolCatalogueText(deferred) }] };
}

/** Exact-name loader. Loading is per lesson and derives from the same durable
 * tool result the model receives; a rejected or interrupted result loads nothing. */
export function installToolDisclosure(host: Context, owns: (agent: Agent | undefined) => agent is Agent):
  (assembly: PromptAssembly, agent: Agent | undefined) => PromptAssembly {
  const catalogue = (agent: Agent, tools = host.tools.schemas(agent)) => {
    const course = host.studyforgeCourseMetadata.read({ workspaceId: host.studyforgeAccess.workspaceId,
      sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' });
    const hasDocuments = host.studyforgePluginsManager.workbenches(agent.session.id).some(choice => host.studyforgePluginsManager.get(choice.pluginRef, choice.digest).manifest.notara.workbenches.some(item => item.id === choice.contributionId && item.document));
    return classroomToolCatalogue(tools, course.data.teachingRef === 'diagnose' || !!(course.data.guided && !course.data.learningContext && !course.data.closure)).filter(tool => hasDocuments || !['read_workbench','update_workbench'].includes(tool.name));
  };
  host.effect(() => host.tools.register({
    name: 'load_tools', description: '从本课工具目录加载指定工具的完整参数，下一步再按真实schema调用。一次可加载多个精确名称；本课跨轮保留。这里只加载接口，不执行所选工具，不改变教学预设、确认要求或权限。',
    parameters: toolSchema(loadInput),
    output: { schema: toolSchema(loadOutput),
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(loadOutput.parse(value)) }],
      presentationMeta: (_args, value) => loadOutput.parse(value),
    },
    async execute(args, execution) {
      if (!owns(execution.agent)) throw new Error('tool_loading_requires_main_classroom');
      const { names } = loadInput.parse(args);
      const available = new Set(catalogue(execution.agent).map(tool => tool.name));
      const missing = names.filter(name => !available.has(name));
      if (missing.length) throw new Error(`tool_not_in_catalogue: names=${JSON.stringify(missing)}；本次没有加载任何工具，请从本课目录选择精确名称。`);
      const loaded = new Set([...retainedBy(execution.agent), ...names]);
      if (loaded.has('subagent') || loaded.has('delegate_search')) {
        loaded.add('send_message'); loaded.add('interrupt_agent');
      }
      return loadOutput.parse({ loaded: [...loaded].filter(name => available.has(name)).sort(), available: 'next_step', scope: 'current_lesson' });
    },
  }));
  host.effect(() => host.tools.guard(execution => execution.name === 'load_tools' && !owns(execution.agent)
    ? '只有主课堂按需加载工具；独立帮手和制作会话保持各自的工具范围。' : undefined));
  return (assembly, agent) => owns(agent)
    ? projectClassroomTools(assembly, catalogue(agent, assembly.tools), retainedBy(agent))
    : { ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'load_tools') };
}
