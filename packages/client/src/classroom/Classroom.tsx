import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { LESSON_TAB_ID, LESSON_TAB_KIND, LessonPanel, type LessonPanelInjected } from './LessonPanel.tsx';

/** The one native composition that owns learning surfaces; creation is not a lesson. */
const LEARNING_PRESET = 'studyforge-learning';

/**
 * Adds this client's lesson surfaces to the native Conversation: a header entry
 * that reveals the lesson page type, and the rightbar body that renders it.
 * The composer, transcript, queue, drafts and Session binding stay native.
 */
export function registerClassroom(ctx: Context): void {
  function LessonEntry({ sessionId, useSessions }: PropsRuntime<'conversation.session.header.actions'>): React.JSX.Element | null {
    const preset = useSessions(state => {
      const value = state.byId[sessionId]?.projectionValues?.agentPreset;
      return typeof value === 'string' ? value : undefined;
    });
    // A creation session is not a lesson: no lesson entry, no learning outputs.
    // Unknown compositions stay hidden rather than offering a refused panel.
    if (preset !== LEARNING_PRESET) return null;
    return <button type="button" className="sf-lesson-entry" data-testid="open-lesson" onClick={() => { ctx.sidebarRight.openTab(LESSON_TAB_KIND); }}>本课</button>;
  }
  // One stable business face per plugin apply: the panel's effect depends on this
  // callback identity, so re-evaluating the inject factory must not refetch.
  const injected: LessonPanelInjected = {
    readCourse: input => ctx.remote.studyforgeCourses.read(input),
    readUsage: input => ctx.remote.studyforgeCourses.usage(input),
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
