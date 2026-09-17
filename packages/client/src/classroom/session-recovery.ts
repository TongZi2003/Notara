import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types';
import type { SessionId } from '@deepseek-ai/dsh-session/types';

/** Same recency rule the native boot pass uses: newest Session wins, else the Workspace's own creation. */
function recentWorkspace(workspaces: readonly WorkspaceView[], sessions: Record<SessionId, { readonly updatedAt: number } | undefined>): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined, selectedTime = Number.NEGATIVE_INFINITY;
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY;
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId];
      if (session !== undefined) latest = Math.max(latest, session.updatedAt);
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt);
    if (selected === undefined || latest > selectedTime) { selected = workspace.workspaceId; selectedTime = latest; }
  }
  return selected;
}

/**
 * The native boot pass binds the most recent Workspace exactly once. In a
 * fresh instance the Host can register the classroom Workspace after that
 * pass already ran: no Session is selected and the composer stays inert on
 * "Choose workspace" forever. `openWorkspace` cannot fix it either — any
 * navigation begun while it connects silently aborts the open — so this
 * repeats the boot pass's own primitive (`connectWorkspace` then `open`)
 * while no Session has ever been bound in this lifetime. Once a Session was
 * current, an explicit New Session clear is the user's own state and is left
 * alone.
 */
export function registerSessionRecovery(ctx: Context): void {
  let bound = false, inflight = false, attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (timer !== undefined || bound) return;
    timer = setTimeout(() => { timer = undefined; recover(); }, 250);
  };
  const recover = (): void => {
    const sessions = ctx.sessions.list.getSnapshot();
    if (sessions.current !== undefined) { bound = true; return; }
    if (bound || inflight || sessions.phase !== 'ready') return;
    const workspaces = ctx.workspaces.list.getSnapshot();
    if (workspaces.phase !== 'ready') return;
    const target = recentWorkspace(workspaces.items, sessions.byId);
    if (target === undefined || attempts >= 24) return;
    attempts += 1;
    inflight = true;
    void ctx.uiWorkspace.connectWorkspace(target).then(sessionId => {
      inflight = false;
      if (ctx.sessions.list.getSnapshot().current === undefined) ctx.sessions.open(sessionId);
    }, () => {
      inflight = false;
      schedule();
    });
  };
  ctx.effect(() => {
    const offWorkspaces = ctx.workspaces.list.subscribe(recover);
    const offSessions = ctx.sessions.list.subscribe(recover);
    recover();
    return () => {
      offWorkspaces();
      offSessions();
      if (timer !== undefined) clearTimeout(timer);
    };
  });
}
