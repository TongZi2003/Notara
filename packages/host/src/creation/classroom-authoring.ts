import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { z } from 'zod';
import { ClassroomDocumentSchema } from '@studyforge/contracts/creation';
import { toolSchema } from '../tools/tool-schema.ts';
import { readProject, saveProjectFile } from './project-store.ts';
import { creationInstallation } from './package-publication.ts';
import { pluginSkillId } from '../plugins/plugin-manager.ts';
import { rejected } from '../tools/learning-context.ts';

const names = new Set(['read_classroom_draft', 'save_classroom_draft']);
/** The native creator session owns the target. Neither ids nor paths are model inputs. */
export function installClassroomAuthoring(host: Context): void {
  const record = (agent: Agent | undefined) => agent && agent.session.header.origin !== 'subagent'
    ? host.studyforgeCreationRecords.list(host.studyforgePluginsManager.context()).find(row => row.data.sessionId === agent.session.id && row.data.initial.kind === 'classroom') : undefined;
  const target = async (agent: Agent | undefined) => {
    const row = record(agent);
    if (!row || !agent || (await host.studyforgeAccess.forSession(agent.session.id)).purpose !== 'creation') throw rejected('只有创作会话可以修改自己的教室草稿');
    return row;
  };
  const skills = () => host.studyforgePluginsManager.active().flatMap(({ ref, version }) => version.manifest.notara.skills.filter(item => item.scope === 'creation').map(item => ({ ref, version, item })));
  const output = { schema: toolSchema(z.object({ json: z.string() })), render: (_args: unknown, value: { json: string }) => [{ type: 'text' as const, text: value.json }] };
  const view = (row: NonNullable<ReturnType<typeof record>>) => {
    const project = readProject(host, row), file = project.files.find(item => item.path === 'worldbook.json');
    if (project.manifest?.kind !== 'classroom' || !file) throw rejected('这个作品没有教室草稿，只有kind=classroom的作品可编辑');
    return { project, file };
  };
  const result = (row: NonNullable<ReturnType<typeof record>>) => {
    const { project, file } = view(row);
    const installation = creationInstallation(host, project.ref);
    return { json: JSON.stringify({ ref: project.ref, digest: file.digest, document: ClassroomDocumentSchema.parse(JSON.parse(file.body)), saved: true, installed: installation?.enabled === true && installation.digest === project.digest, installation }) };
  };
  host.effect(() => host.tools.register({ name: 'read_classroom_draft', description: '读取当前创作者作品的教室草稿：成员、世界书和触发规则。系统绑定当前作品；修改前必须读取。', parameters: toolSchema(z.object({}).strict()), output,
    async execute(_args, execution) { return result(await target(execution.agent)); },
  }));
  host.effect(() => host.tools.register({ name: 'save_classroom_draft', description: '完整保存当前教室草稿，与面板编辑同一份内容。先read_classroom_draft；document是完整替换，空数组明确清空，保留未要求修改的内容。成员和规则id沿用读取值，新成员用简短唯一英文键。角色只根据老师供料回应；规则仅安排候选。保存不安装，不调用同学，不改正在运行的任务。', parameters: toolSchema(z.object({ document: ClassroomDocumentSchema }).strict()), output,
    async execute(args, execution) {
      const row = await target(execution.agent), data = z.object({ document: ClassroomDocumentSchema }).strict().parse(args);
      const observation = await host.sessionQuery.observeSession(SessionId(execution.agent!.session.id));
      let expected: string | undefined;
      try {
        const calls = new Map<string, string>();
        for (const event of observation.events) {
          if (event.type === 'tool/call') { if (event.data.callId === execution.callId) break; calls.set(event.data.callId, event.data.name); }
          if (event.type !== 'tool/result') continue;
          const block = event.data.message.content[0];
          if (block.isError || !names.has(calls.get(block.toolCallId) ?? '')) continue;
          for (const content of block.content) if (content.type === 'text') {
            try { const value = JSON.parse(content.text); if (value.ref === row.ref && typeof value.digest === 'string') expected = value.digest; } catch { /* Not a successful structured read. */ }
          }
        }
      } finally { observation[Symbol.dispose](); }
      if (!expected) throw rejected('先read_classroom_draft读取当前教室草稿再保存');
      view(row);
      saveProjectFile(host, { ...host.studyforgePluginsManager.context(), actor: 'teacher', purpose: 'creation', sessionId: row.data.sessionId }, row.ref, 'worldbook.json', expected, JSON.stringify(data.document, null, 2) + '\n');
      return result(row);
    },
  }));
  host.effect(() => host.tools.guard(execution => names.has(execution.name) && !record(execution.agent) ? '只有当前教室的创作者会话可以编辑这份草稿。' : undefined));
  host.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next(), row = record(context.agent);
    if (!row) return { ...result, tools: result.tools.filter(tool => !names.has(tool.name)) };
    const workflow = skills().map(({ ref, version, item }) => host.studyforgePluginsManager.body(ref, version.digest, item.entry)).join('\n\n');
    return { ...result, sections: [...result.sections, ...(workflow ? [{ name: 'notara:classroom-authoring', text: workflow }] : [])] };
  });
  host.on('agent/created', ({ agent }) => {
    if (!record(agent)) return;
    agent.ctx.plugin({ inject: ['skills'], apply: scope => { scope.effect(() => scope.skills.registerProvider(control => {
    const dispose = host.studyforgePluginsManager.subscribe(control.invalidate); control.signal.addEventListener('abort', dispose, { once: true });
    return { name: 'notara-creator',
      async list(options) {
        if (options.signal?.aborted) return [];
        return skills().map(({ ref, version, item }) => ({ name: pluginSkillId(ref, version.digest, item.id), description: item.description, locator: item.id, provider: 'notara-creator', source: 'workspace', invocation: { userInvocable: true, modelInvocable: true }, rank: 20 }));
      },
      async get(candidate) {
        const selected = skills().find(({ ref, version, item }) => pluginSkillId(ref, version.digest, item.id) === candidate.name);
        if (!selected) return undefined;
        return { name: candidate.name, description: candidate.description, provider: 'notara-creator', source: 'workspace', invocation: candidate.invocation, content: host.studyforgePluginsManager.body(selected.ref, selected.version.digest, selected.item.entry) };
      },
    };
    })); } });
  });
}
