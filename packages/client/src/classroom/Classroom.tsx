import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { LESSON_TAB_ID, LESSON_TAB_KIND, LessonPanel, type LessonPanelInjected } from './LessonPanel.tsx';
import { useEffect, useRef, useState } from 'react';
import { LessonSettingsModal } from './LessonSettings.tsx';
import { registerConversationProposals } from '../proposals/ConversationProposals.tsx';

/** The one native composition that owns learning surfaces; creation is not a lesson. */
const LEARNING_PRESET = 'studyforge-learning';

/**
 * Adds this client's lesson surfaces to the native Conversation: a header entry
 * that reveals the lesson page type, and the rightbar body that renders it.
 * The composer, transcript, queue, drafts and Session binding stay native.
 */
export function registerClassroom(ctx: Context): void {
  const initiallyOpened = new Set<string>();
  /** The preset value the native Session really carries; unknown stays unknown. */
  function presetOf(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
  function LessonEntry({ sessionId, useSessions }: PropsRuntime<'conversation.session.header.actions'>): React.JSX.Element | null {
    const selected = useSessions(state => state.current === sessionId);
    const preset = useSessions(state => {
      const value = state.byId[sessionId]?.projectionValues?.agentPreset;
      return typeof value === 'string' ? value : undefined;
    });
    useEffect(() => {
      if (!selected || preset !== LEARNING_PRESET || initiallyOpened.has(sessionId)) return;
      // On a phone the native rightbar covers the conversation. Keep the
      // lesson readable until the student explicitly opens 本课资料.
      if (window.matchMedia('(max-width: 900px)').matches) { initiallyOpened.add(sessionId); return; }
      let live = true;
      void (async () => {
        if (ctx.sessions.list.getSnapshot().current !== sessionId) return;
        // Restored navigation wins: a tab the student already had — a card, an
        // original, anything native — is left where it is. The default is the
        // lesson's own material map, and it is a page tab, never a raw document.
        const active = ctx.sidebarRight.active();
        if (active !== undefined && active.kind !== 'guide') { initiallyOpened.add(sessionId); return; }
        // The tab type and its seat finish mounting after Session selection; a
        // failed early open must not consume this default.
        for (let attempt = 0; attempt < 20; attempt++) {
          if (!live || ctx.sessions.list.getSnapshot().current !== sessionId) return;
          try { ctx.sidebarRight.openTab(LESSON_TAB_KIND); initiallyOpened.add(sessionId); return; }
          catch { await new Promise(resolve => setTimeout(resolve, 50)); }
        }
      })().catch(() => { /* The map stays reachable through the lesson's own entry. */ });
      return () => { live = false; };
    }, [sessionId, preset, selected]);
    // A creation session is not a lesson: no lesson entry, no learning outputs.
    // Unknown compositions stay hidden rather than offering a refused panel.
    if (preset !== LEARNING_PRESET) return null;
    return <button type="button" className="sf-lesson-entry" data-testid="open-lesson" onClick={() => { ctx.sidebarRight.openTab(LESSON_TAB_KIND); }}>本课资料</button>;
  }
  /**
   * 本课设置 lives beside the lesson's own name in the conversation heading.
   * The right column is then one container — the material map — and settings
   * never take a rail of their own.
   */
  function LessonSettingsEntry({ sessionId, useSessions }: PropsRuntime<'conversation.session.header.actions'>): React.JSX.Element | null {
    const preset = useSessions(state => presetOf(state.byId[sessionId]?.projectionValues?.agentPreset));
    const running = useSessions(state => state.byId[sessionId]?.running);
    const title = useSessions(state => state.byId[sessionId]?.title ?? '');
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    if (preset !== LEARNING_PRESET) return null;
    return <>
      <button type="button" className="sf-lesson-entry sf-lesson-entry-quiet" data-testid="open-lesson-settings" ref={trigger}
        onClick={() => { setOpen(true); }}>本课设置</button>
      {open && <LessonSettingsModal ctx={ctx} sessionId={sessionId} title={title || '自由学习'}
        readCourse={input => ctx.remote.studyforgeCourses.read(input)} refreshToken={running ?? false}
        onClose={() => { setOpen(false); trigger.current?.focus(); }} />}
    </>;
  }
  // One stable business face per plugin apply: the panel's effect depends on this
  // callback identity, so re-evaluating the inject factory must not refetch.
  const injected: LessonPanelInjected = {
    ctx,
    readCourse: input => ctx.remote.studyforgeCourses.read(input),
    host: {
      lessonResources: input => ctx.remote.studyforgeMaterials.lessonResources(input),
      materials: () => ctx.remote.studyforgeMaterials.list(),
      book: input => ctx.remote.studyforgeOrganization.book(input),
      card: input => ctx.remote.studyforgeLearning.card(input),
      cards: () => ctx.remote.studyforgeLearning.cards(),
      resolveForSession: input => ctx.remote.studyforgeMaterials.resolveForSession(input),
      bytes: ref => ctx.remote.studyforgeMaterials.bytes(ref),
      docxIndex: ref => ctx.remote.studyforgeMaterials.docxIndex(ref),
    },
  };
  ctx.effect(() => {
    let learning: boolean | undefined, dispose = (): void => {};
    const sync = (): void => {
      const state = ctx.sessions.list.getSnapshot();
      const next = !!state.current && state.byId[state.current]?.projectionValues?.agentPreset === LEARNING_PRESET;
      if (learning === next) return;
      learning = next;
      dispose();
      // With only Files in the native guide registry, reopening an empty rail
      // skips the guide entirely and seeds Files. This second entry restores
      // the lesson doorway; creation sessions retain their native file seed.
      dispose = ctx.sidebarRightTabs.register({
        id: LESSON_TAB_ID, kind: LESSON_TAB_KIND, title: () => '工作台',
        ...(next ? { guide: [{ order: -10, title: () => '本课工作台' }] } : {}),
      });
    };
    sync();
    const unsubscribe = ctx.sessions.list.subscribe(sync);
    return () => { unsubscribe(); dispose(); };
  }, 'studyforge: lesson tab type');
  function LessonGuide({ useTabInfo }: PropsRuntime<'sidebar.right.tab.guide'> & { matched: boolean }): React.JSX.Element {
    const info = useTabInfo();
    return <section className="sf-deck-reopen" data-testid="lesson-deck-reopen">
      <h2>本课工作台</h2><p>从关系图接着看，刚才打开的原文和卡片也会回来。</p>
      <button type="button" className="sf-quiet" onClick={() => { info.tab.actions.openTab(LESSON_TAB_KIND, { replaceTab: true }); }}>打开工作台 →</button>
    </section>;
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide', () => ctx.slots.register({
    name: 'sidebar.right.tab.guide', priority: -20,
    select: () => {
      const state = ctx.sessions.list.getSnapshot();
      return state.current && state.byId[state.current]?.projectionValues?.agentPreset === LEARNING_PRESET ? true : null;
    },
  }, LessonGuide)), 'studyforge: lesson deck recovery');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: LESSON_TAB_ID,
    inject: () => injected,
  }, LessonPanel)), 'studyforge: lesson tab body');
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'studyforge.lesson', order: 10 }, LessonEntry,
  )), 'studyforge: lesson header entry');
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'studyforge.lesson-settings', order: 11 }, LessonSettingsEntry,
  )), 'studyforge: lesson settings entry');
  registerConversationProposals(ctx);
}
