import type { Context } from '@deepseek-ai/cordis';
import type { ConversationSessionHeaderSlotProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types';
import { useEffect, useSyncExternalStore, type ComponentType } from 'react';

type Location = { sessionId: string; sequence?: number; turn?: number };
let pending: Location | undefined;
const listeners = new Set<() => void>();
const notify = (): void => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export async function openContentClassroom(ctx: Context, location: Location): Promise<void> {
  await ctx.sessions.refresh();
  ctx.sessions.open(location.sessionId as SessionId); ctx.layout.selectPanel(null);
  pending = location; notify();
}
/** Reuse the native header's own View action and store, including from Trace. */
export function registerContentNavigation(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => {
    const original = ctx.slots.entriesOfSlot('conversation.session.header')[0];
    if (!original) return () => {};
    function Header(props: ConversationSessionHeaderSlotProps): React.JSX.Element | null {
      const location = useSyncExternalStore(subscribe, () => pending);
      useEffect(() => {
        if (!location || location.sessionId !== props.sessionId) return;
        let live = true;
        props.selectView('chat');
        void (async () => {
          if (location.sequence !== undefined) await ctx.sessions.binding(props.sessionId)?.session.loadThrough(location.sequence as SessionSeq);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!live || ctx.sessions.list.getSnapshot().current !== props.sessionId) return;
            if (location.turn !== undefined) document.querySelector<HTMLElement>(`[data-chat-turn="${location.turn}"]`)?.scrollIntoView({ block: 'center' });
            if (pending === location) { pending = undefined; notify(); }
          }));
        })();
        return () => { live = false; };
      }, [location, props.sessionId]);
      return null;
    }
    // An invisible child shares the native header's store and injected action;
    // it neither replaces the header nor redeclares its owned child slots.
    const registry = ctx.slots as unknown as { register(options: object, component: ComponentType<ConversationSessionHeaderSlotProps>): () => void };
    return registry.register({ name: 'conversation.session.header.actions', id: 'studyforge.content-navigation',
      inject: original.inject, store: original.store }, Header);
  }));
}
