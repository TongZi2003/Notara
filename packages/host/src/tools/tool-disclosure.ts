import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolSchema } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import { z } from 'zod';
import { TOOL_FACADE_NAMES } from '@studyforge/contracts/tool-facades';
import { toolSchema } from './tool-schema.ts';
import { rejected } from './learning-context.ts';
import { facadeMethodText } from './tool-facades.ts';

/** Presentation only: the registry and its execution guards remain authoritative.
 * The classroom wire is constant — facade verbs plus the builtin capability set —
 * so the tools array never changes mid-lesson and the request prefix stays cached.
 * Every wrapped tool remains registered and callable under its exact name. */
export const CLASSROOM_WIRE_TOOLS = [...TOOL_FACADE_NAMES,
  'read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'skill',
  'subagent', 'send_message', 'interrupt_agent', 'list_subagent_models'] as const;
const wire = new Set<string>(CLASSROOM_WIRE_TOOLS);
const unavailable = new Set(['write', 'edit', 'run_code']);
const loadInput = z.object({ names: z.array(z.string().trim().min(1)).min(1) }).strict();
const loadOutput = z.object({ loaded: z.array(z.string()), available: z.literal('next_step'), scope: z.literal('current_lesson') }).strict();

export function classroomToolCatalogue(tools: readonly ToolSchema[], diagnose: boolean): ToolSchema[] {
  return tools.filter(tool => !unavailable.has(tool.name) && (tool.name !== 'register_cards' || diagnose));
}

/** Kept for the compatibility loader and for history consumers that still see
 * old-style load_tools calls in replayed sessions. */
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
  if (loaded.has('subagent') || loaded.has('delegate_search')) {
    loaded.add('send_message'); loaded.add('interrupt_agent');
  }
  return loaded;
}

function retainedBy(agent: Agent): Set<string> {
  return retainedTools(agent.session.snapshotEvents().slice(agent.session.inheritedEventCount));
}

/** Constant-wire projector: facade verbs + builtins on every request, plus one
 * static method-reference section. Tool presence no longer scales with the
 * number of installed boards or plugins. */
export function installToolDisclosure(host: Context, owns: (agent: Agent | undefined) => agent is Agent):
  (assembly: PromptAssembly, agent: Agent | undefined) => PromptAssembly {
  const catalogue = (agent: Agent, tools = host.tools.schemas(agent)) => {
    const course = host.studyforgeCourseMetadata.read({ workspaceId: host.studyforgeAccess.workspaceId,
      sessionId: agent.session.id, actor: 'teacher', purpose: 'learning' });
    const hasDocuments = host.studyforgePluginsManager.workbenches(agent.session.id).some(choice => host.studyforgePluginsManager.get(choice.pluginRef, choice.digest).manifest.notara.workbenches.some(item => item.id === choice.contributionId && item.document));
    const hasMath = host.studyforgePluginsManager.workbenches(agent.session.id).some(choice=>host.studyforgePluginsManager.get(choice.pluginRef,choice.digest).manifest.notara.workbenches.some(item=>item.id===choice.contributionId&&item.document?.kind==='math'));
    return classroomToolCatalogue(tools, course.data.teachingRef === 'diagnose' || !!(course.data.guided && !course.data.learningContext && !course.data.closure)).filter(tool => (hasDocuments || !['read_workbench','update_workbench'].includes(tool.name))&&(hasMath||!['read_math_scene','edit_math_scene','calculate_math','restore_math_scene'].includes(tool.name)));
  };
  host.effect(() => host.tools.register({
    name: 'load_tools', description: '兼容旧会话的工具加载器：本课全部能力已常驻，本调用只回执清单、不再改变工具展示。',
    parameters: toolSchema(loadInput),
    output: { schema: toolSchema(loadOutput),
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(loadOutput.parse(value)) }],
      presentationMeta: (_args, value) => loadOutput.parse(value),
    },
    async execute(args, execution) {
      if (!owns(execution.agent)) throw rejected('只能在主课堂会话中加载工具，子代理不能加载');
      const { names } = loadInput.parse(args);
      const available = new Set(catalogue(execution.agent).map(tool => tool.name));
      const missing = names.filter(name => !available.has(name));
      if (missing.length) throw rejected(`names=${JSON.stringify(missing)}不在本课工具目录中；本次没有加载任何工具，请从目录选择精确名称`);
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
    ? { ...assembly,
        tools: assembly.tools.filter(tool => wire.has(tool.name)),
        sections: [...assembly.sections, { name: 'studyforge:tool-methods', text: facadeMethodText(host) }] }
    : { ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'load_tools' && !TOOL_FACADE_NAMES.has(tool.name)) };
}
