import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots';
import { useState } from 'react';
import { LessonResources, type LessonResourcesFace } from '../materials/LessonResources.tsx';
import { LearningObject } from './LearningObject.tsx';
import type { Context } from '@deepseek-ai/cordis';

/** This client's tab implementation identity; the body registers under it. */
export const LESSON_TAB_ID = '@studyforge/dsh-client/lesson';
/** The page type `openTab` names; the tab is recorded at `sidebar://<kind>`. */
export const LESSON_TAB_KIND = 'studyforge-lesson';

/**
 * The lesson tab's own reads.
 *
 * The pane starts with the lesson's material map. Everything about the lesson (its settings,
 * learning profile, outputs, closeout and usage) lives in the modal the
 * native 开始 page opens, so two right rails never compete here.
 */
export interface LessonPanelInjected {
  ctx: Context;
  /** P4.1: this lesson's own material reads, all of them through the Host. */
  readonly host: LessonResourcesFace;
}

export type LessonPanelProps = ComposedProps<'sidebar.right.pane.tab', typeof LESSON_TAB_ID, never, undefined, LessonPanelInjected>;

/** One lesson's own facts and its material map. */
export function LessonPanel({ ctx, sessionId, host, useSession, useTabInfo }: LessonPanelProps): React.JSX.Element {
  const [refresh, setRefresh] = useState(0);
  // The native Session object's own running flag is the settle signal: it flips
  // when a turn finishes, so the lesson's state re-reads while this pane stays
  // open. No polling, no second event stream.
  const running = useSession(snapshot => snapshot.running);
  // This tab's own identity: what the composer remembers the pane is showing.
  const tabInfo = useTabInfo();
  const browseId = tabInfo.tab.visible ? String(tabInfo.tab.id) : undefined;
  return <aside className="sf-lesson" data-testid="studyforge-lesson-panel">
    <div className="sf-deck-tools" role="group" aria-label="工作台操作">
      <button type="button" className="sf-quiet sf-deck-spread" data-testid="spread-lesson-deck" aria-label="铺开工作台" title="铺开工作台" onClick={() => {
        const x = Math.max(12, Math.min(240, window.innerWidth * .16));
        ctx.sidebarRight.float(tabInfo.tab.id, { x, y: 60, width: window.innerWidth - x - 16, height: window.innerHeight - 80 });
      }}><span aria-hidden="true">↗</span></button>
      <button type="button" className="sf-quiet" data-testid="lesson-materials-refresh" aria-label="刷新资料" title="刷新资料" onClick={() => { setRefresh(n => n + 1); }}><span aria-hidden="true">↻</span></button>
    </div>
    <section className="sf-lesson-materials-section">
      {/* The pane belongs to one lesson, so everything it opens opens here. */}
      <LessonResources key={sessionId} ctx={ctx} sessionId={sessionId} host={host} browseId={browseId}
        refreshToken={`${String(running)}:${String(refresh)}`}
        renderObject={(target, controls) => <LearningObject ctx={ctx} sessionId={sessionId} target={target}
          onBack={controls.back} onSource={anchor => { controls.source([anchor], '原文'); }} />} />
    </section>
  </aside>;
}
