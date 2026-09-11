import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-agent-presets';
import type {} from '@deepseek-ai/dsh-api-workspace-files';
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools';
import { ExecutionAccess, ExecutionBindingSchema, type ExecutionBinding } from '@studyforge/domain/access';
import { StudentFileSystem } from './filesystem.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeAccess: ExecutionAccess; } }

/** Adds product grants at native lookup and tool seams; Session remains the identity owner. */
export async function installExecutionAccess(ctx: Context, root: string, workspaceId: string): Promise<void> {
  const records = await ctx.studyforgeRecords.collection('binding', ExecutionBindingSchema);
  const access = new ExecutionAccess(root, workspaceId, records, async id => {
    const observation = await ctx.sessionQuery.observeSession(SessionId(id));
    try {
      return { sessionId: observation.header.id, cwd: observation.header.cwd,
        preset: observation.projections?.values.agentPreset ?? observation.header.agentPreset };
    } finally { observation[Symbol.dispose](); }
  });
  ctx.effect(() => ctx.reflect.provide('studyforgeAccess', access));
  ctx.effect(() => () => access.clear());
  ctx.plugin(StudentFileSystem, { cwd: access.root });
  ctx.effect(() => ctx.typert.lookups.configure('workspaceFileScope', async sessionId => {
    const binding = await access.forSession(sessionId);
    return { sessionId: SessionId(sessionId), workspaceRoot: access.scope(binding) };
  }));
  installToolAccess(ctx, access);
}

/** Native registry gates also cover direct API and PTC nested dispatch. */
export function installToolAccess(ctx: Context, access: ExecutionAccess): void {
  const executions = new WeakMap<ToolExecutionToken, ExecutionBinding>();
  ctx.on('tools/pre-execute', async (execution, next) => {
    if (!execution.agent) return { kind: 'deny', reason: '缺少本次会话绑定' };
    try { executions.set(execution.token, await access.forSession(execution.agent.session.id)); }
    catch { return { kind: 'deny', reason: '本次会话尚未绑定学习空间或作品' }; }
    return next();
  });
  ctx.tools.guard(execution => {
    const binding = executions.get(execution.token);
    if (!binding || !access.isCurrent(binding)) return '本次会话授权已变化，请重新读取';
    if (execution.name === 'run_code' || /bash|pwsh|shell|terminal/.test(execution.name)) return '本次用途未开放任意命令执行';
    if (execution.name === 'grep' || execution.name === 'glob') {
      const args = execution.arguments;
      if (!args || typeof args !== 'object' || Array.isArray(args)) return '搜索参数无效';
      const path = 'path' in args ? args.path : binding.cwd;
      if (typeof path !== 'string') return '搜索路径无效';
      try { access.assert(binding, access.path(binding, path)); }
      catch { return '请指定本次作品内或已授权材料的搜索路径'; }
    }
    return undefined;
  });
  ctx.on('tools/execute', (execution, next) => {
    const binding = executions.get(execution.token);
    if (!binding || !access.isCurrent(binding)) throw new Error('execution_binding_missing');
    return access.run(binding, next);
  });
}
