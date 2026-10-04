import { AsyncLocalStorage } from 'node:async_hooks';
import { appendTeachingEvent } from './teaching-state.js';

/** Pin a new worker's file sandbox before it is published or sends its first
 * request. Native delegation owns approvals (never) and the tool restriction.
 * AsyncLocalStorage keeps simultaneous spawns from sharing a permission plan. */
export function installWorkerPolicy(ctx) {
  const plans = new AsyncLocalStorage(), agents = ctx.get?.('agents');
  if (!agents) return { run: (plan, start) => {
    if (['read-only', 'workspace'].includes(plan.tools)) throw new Error('solver_sandbox_unavailable');
    return start();
  } };
  const original = agents.create;
  let active = true;
  const wrapped = function(options) {
    const plan = plans.getStore();
    if (!active || !plan || options?.meta?.origin !== 'subagent' || options?.parentAgent !== plan.parent) return original.call(this, options);
    const setup = options.setup;
    return original.call(this, {...options, setup: async (childCtx, child) => {
      const commit = await setup?.(childCtx, child);
      // New modes always narrow Full access to the workspace. A read-only
      // parent cannot delegate workspace writes through its worker settings.
      if (plan.mode) child.session.append('sandbox/mode', {mode: plan.mode});
      appendTeachingEvent(child.session, 'notara/worker-capabilities', {tools: plan.tools});
      if (plan.active) plan.active.childId = child.session.id;
      return commit;
    }});
  };
  agents.create = wrapped;
  ctx.effect(() => () => {active = false; if (agents.create === wrapped) agents.create = original;});
  return {run: (plan, start) => {
    const scoped = ['read-only', 'workspace'].includes(plan.tools);
    const parentMode = scoped ? ctx.get?.('sandboxPolicy')?.resolve({session: plan.parent.session})?.mode : undefined;
    if (scoped && !parentMode) throw new Error('solver_sandbox_unavailable');
    const mode = scoped ? plan.tools === 'workspace' && parentMode !== 'read-only' ? 'workspace-write' : 'read-only' : undefined;
    const tools = mode === 'read-only' && plan.tools === 'workspace' ? 'read-only' : plan.tools;
    return plans.run({...plan, mode, tools}, start);
  }};
}
