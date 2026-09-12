import type { Context } from '@deepseek-ai/cordis';
import { cardAddress } from '../materials/CardResource.tsx';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { LESSON_TAB_ID, LESSON_TAB_KIND, LessonPanel, type LessonPanelInjected } from './LessonPanel.tsx';
import { useEffect } from 'react';
import type { NativeResourceParams } from '../materials/native-preview-adapter.ts';

/** The one native composition that owns learning surfaces; creation is not a lesson. */
const LEARNING_PRESET = 'studyforge-learning';

/**
 * Adds this client's lesson surfaces to the native Conversation: a header entry
 * that reveals the lesson page type, and the rightbar body that renders it.
 * The composer, transcript, queue, drafts and Session binding stay native.
 */
export function registerClassroom(ctx: Context): void {
  const initiallyOpened = new Set<string>();
  function LessonEntry({ sessionId, useSessions }: PropsRuntime<'conversation.session.header.actions'>): React.JSX.Element | null {
    const selected = useSessions(state => state.current === sessionId);
    const preset = useSessions(state => {
      const value = state.byId[sessionId]?.projectionValues?.agentPreset;
      return typeof value === 'string' ? value : undefined;
    });
    useEffect(() => {
      if (!selected || preset !== LEARNING_PRESET || initiallyOpened.has(sessionId)) return;
      let live = true;
      void (async () => {
        const course = await ctx.remote.studyforgeCourses.read({ sessionId });
        if (!live || !course.ok || ctx.sessions.list.getSnapshot().current !== sessionId) return;
        const list = course.value.data.lessonMaterials;
        const material = list.materials[list.initialIndex ?? 0];
        if (!material) return;
        // Restored native tabs take precedence over the planned first preview.
        const active = ctx.sidebarRight.active();
        if (active && active.kind !== 'guide') { initiallyOpened.add(sessionId); return; }
        let open: () => void;
        if (material.kind === 'card') {
          open = () => ctx.sidebarRight.openResource(cardAddress(material.cardRef, material.cardVersion));
        } else {
          const result = await ctx.remote.studyforgeMaterials.resolveForSession({ sessionId, source: material.source });
          if (!live || !result.ok || ctx.sessions.list.getSnapshot().current !== sessionId) return;
          const params: NativeResourceParams = { studyforge: { source: material.source, version: result.value.version } };
          open = () => ctx.sidebarRight.openResource(result.value.address, { params });
        }
        // The native seat and the resource registrants finish mounting after
        // Session selection. A failed early open must not consume this preview.
        for (let attempt = 0; attempt < 20; attempt++) {
          if (!live || ctx.sessions.list.getSnapshot().current !== sessionId) return;
          try { open(); initiallyOpened.add(sessionId); return; }
          catch { await new Promise(resolve => setTimeout(resolve, 50)); }
        }
      })().catch(() => { /* The material stays available through the lesson's own list. */ });
      return () => { live = false; };
    }, [sessionId, preset, selected]);
    // A creation session is not a lesson: no lesson entry, no learning outputs.
    // Unknown compositions stay hidden rather than offering a refused panel.
    if (preset !== LEARNING_PRESET) return null;
    return <button type="button" className="sf-lesson-entry" data-testid="open-lesson" onClick={() => { ctx.sidebarRight.openTab(LESSON_TAB_KIND); }}>本课</button>;
  }
  // One stable business face per plugin apply: the panel's effect depends on this
  // callback identity, so re-evaluating the inject factory must not refetch.
  const injected: LessonPanelInjected = {
    ctx,
    readCourse: input => ctx.remote.studyforgeCourses.read(input),
    readUsage: input => ctx.remote.studyforgeCourses.usage(input),
    resources: {
      lessonResources: input => ctx.remote.studyforgeMaterials.lessonResources(input),
      openCard: target => { ctx.sidebarRight.openResource(cardAddress(target)); },
      resolveForSession: input => ctx.remote.studyforgeMaterials.resolveForSession(input),
      openAddress: async (address, params) => {
        // The column belongs to the lesson on stage; coming back to it is what
        // makes the address land in a real tab of that lesson.
        ctx.layout.selectPanel(null);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise(resolve => { setTimeout(resolve, 50); });
          // The native tab takes the position as its own navigation parameter;
          // a locator the native body cannot land on simply sends none.
          try { ctx.sidebarRight.openResource(address, params === undefined ? undefined : { params }); return; } catch { /* seat not drawn yet */ }
        }
        throw new Error('sidebar_right_unavailable');
      },
    },
  };
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: LESSON_TAB_ID, kind: LESSON_TAB_KIND, title: () => '本课',
  }), 'studyforge: lesson tab type');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: LESSON_TAB_ID,
    inject: () => injected,
  }, LessonPanel)), 'studyforge: lesson tab body');
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'studyforge.lesson', order: 10 }, LessonEntry,
  )), 'studyforge: lesson header entry');
}
