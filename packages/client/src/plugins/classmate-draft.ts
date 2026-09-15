import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { classmateMention } from '@studyforge/contracts/classroom';
import { z } from 'zod';
import { revealWorkspaceView } from '../classroom/workspace-layout.ts';

export const CLASSMATE_REFERENCE = 'notara-classmate';
const Mention = z.object({ sessionId: z.string(), id: z.string(), roleId: z.string(), name: z.string(), title: z.string() }).strict();
type Mention = z.infer<typeof Mention>;
export function registerClassmateDraft(ctx: Context): void {
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: CLASSMATE_REFERENCE, order: 5, showGroupTitle: false,
    async candidates(session, req) {
      const reply = await ctx.remote.notaraClassroomView.choices({ sessionId: String(session.sessionId) });
      if (!reply.ok || req.signal.aborted) return [];
      const query = req.query.toLocaleLowerCase();
      return reply.value.filter(room => room.enabled).flatMap(room => room.roles.filter(role => role.enabled && (role.name + role.purpose + room.title).toLocaleLowerCase().includes(query)).map(role => ({
        name: role.name, hint: room.title, description: role.purpose,
        value: JSON.stringify({ sessionId: String(session.sessionId), id: room.id, roleId: role.id, name: role.name, title: room.title } satisfies Mention),
      })));
    },
    onPick({ candidate }) { return { insert: { source: CLASSMATE_REFERENCE, ref: candidate.value!, label: candidate.name, clipboardText: '@' + candidate.name } }; },
    codec: {
      clipboardText: ref => { try { const value = Mention.parse(JSON.parse(ref)); return classmateMention(value.name, value.title); } catch { return '@同学'; } },
      async serialize(ref) {
        const value = Mention.parse(JSON.parse(ref));
        const reply = await ctx.remote.notaraClassroomView.choices({ sessionId: value.sessionId });
        const room = reply.ok ? reply.value.find(room => room.id === value.id && room.enabled) : undefined;
        const role = room?.roles.find(role => role.id === value.roleId && role.enabled);
        if (!room || !role) throw new Error('这位同学暂时不可用，请检查教室启用状态后重新点名。');
        return '\n' + classmateMention(role.name, room.title) + '\n';
      },
    },
  }));
}

/** Prepare the native draft; never submit, prompt, or create another conversation. */
export function insertClassmate(ctx: Context, input: Mention): boolean {
  const sessionId = input.sessionId as SessionId, scope = ctx.sessions.scope(sessionId);
  if (!scope || ctx.sessions.list.getSnapshot().current !== sessionId || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) return false;
  const composer = ctx.conversation.input.for(scope), state = composer.state.getSnapshot();
  if (state.phase !== 'plain') return false;
  const ref = JSON.stringify(input);
  if (state.occurrences.some(item => item.source === CLASSMATE_REFERENCE && item.ref === ref)) { revealWorkspaceView(input.sessionId, 'chat'); return true; }
  const end = state.draft.length - state.occurrences.reduce((sum, item) => sum + item.length - 1, 0);
  if (!composer.insertReference({ source: CLASSMATE_REFERENCE, ref, label: input.name, clipboardText: classmateMention(input.name, input.title) }, { start: end, end, draftRev: state.draftRev })) return false;
  revealWorkspaceView(input.sessionId, 'chat'); document.querySelector<HTMLElement>('[data-composer-input]')?.focus(); return true;
}
