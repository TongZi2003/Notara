import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { CourseView } from '@studyforge/contracts/courses';
import { useEffect, useState } from 'react';
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
 * The pane is one container: the lesson's name and its own state, then the
 * lesson's material map. Everything that is *about* the lesson (its settings,
 * learning profile, outputs, closeout and usage) lives in the modal the
 * conversation heading opens, so two right rails never compete here.
 */
export interface LessonPanelInjected {
  ctx: Context;
  readCourse(input: { sessionId: string }): Promise<RemoteResult<CourseView>>;
  /** P4.1: this lesson's own material reads, all of them through the Host. */
  readonly host: LessonResourcesFace;
}

export type LessonPanelProps = ComposedProps<'sidebar.right.pane.tab', typeof LESSON_TAB_ID, never, undefined, LessonPanelInjected>;

type PanelState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly view: CourseView };

/** One lesson's own facts and its material map. */
export function LessonPanel({ ctx, sessionId, readCourse, host, useSession, useSessions, useTabInfo }: LessonPanelProps): React.JSX.Element {
  const title = useSessions(snapshot => snapshot.byId[sessionId]?.title || '自由学习');
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [refresh, setRefresh] = useState(0);
  // The native Session object's own running flag is the settle signal: it flips
  // when a turn finishes, so the lesson's state re-reads while this pane stays
  // open. No polling, no second event stream.
  const running = useSession(snapshot => snapshot.running);
  // This tab's own identity: what the composer remembers the pane is showing.
  const browseId = String(useTabInfo().tab.id);
  useEffect(() => {
    let live = true;
    readCourse({ sessionId }).then(
      result => { if (live) setState(result.ok ? { status: 'ready', view: result.value } : { status: 'unavailable' }); },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [readCourse, sessionId, running]);
  // Unknown is not a fact: the row only names what the read really returned.
  const lessonState = state.status === 'ready'
    ? state.view.data.closure !== null ? '已结束' : state.view.data.archived ? '已归入归档' : '进行中'
    : state.status === 'loading' ? '未加载' : '暂不可用';
  return <aside className="sf-lesson" data-testid="studyforge-lesson-panel">
    <header className="sf-original-lesson-head"><span className="sf-lesson-seal" aria-hidden="true">课</span><div><small>本课资料</small><h2>{title}</h2><span className="sf-lesson-state">{lessonState}</span></div></header>
    <section className="sf-lesson-materials-section">
      <div className="sf-lesson-materials-head"><h3>本课资料</h3>
        <button type="button" className="sf-quiet" data-testid="lesson-materials-refresh" onClick={() => { setRefresh(n => n + 1); }}>刷新</button>
      </div>
      {/* The pane belongs to one lesson, so everything it opens opens here. */}
      <LessonResources key={sessionId} ctx={ctx} sessionId={sessionId} host={host} browseId={browseId}
        refreshToken={`${String(running)}:${state.status === 'ready' ? String(state.view.version) : 'x'}:${String(refresh)}`}
        renderObject={(target, controls) => <LearningObject ctx={ctx} sessionId={sessionId} target={target}
          onBack={controls.back} onSource={anchor => { controls.source([anchor], '原文'); }} />} />
    </section>
  </aside>;
}
