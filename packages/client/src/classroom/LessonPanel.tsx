import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { CourseUsage, CourseView } from '@studyforge/contracts/courses';
import { useEffect, useState } from 'react';
import { NativeUsage, type UsageState } from './NativeUsage.tsx';

/** This client's tab implementation identity; the body registers under it. */
export const LESSON_TAB_ID = '@studyforge/dsh-client/lesson';
/** The page type `openTab` names; the tab is recorded at `sidebar://<kind>`. */
export const LESSON_TAB_KIND = 'studyforge-lesson';

/** The lesson's teaching additions, read from the Host through the frozen P2.1 Remote. */
export interface LessonPanelInjected {
  readCourse(input: { sessionId: string }): Promise<RemoteResult<CourseView>>;
  /** Native completed-turn usage plus its coverage; never re-counted in the browser. */
  readUsage(input: { sessionId: string }): Promise<RemoteResult<CourseUsage>>;
}

export type LessonPanelProps = ComposedProps<'sidebar.right.pane.tab', typeof LESSON_TAB_ID, never, undefined, LessonPanelInjected>;

type LessonMaterial = CourseView['data']['lessonMaterials']['materials'][number];

type PanelState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly view: CourseView };

/** One lesson's own facts: what it was given, and whether it is still running. */
export function LessonPanel({ sessionId, readCourse, readUsage, useSession }: LessonPanelProps): React.JSX.Element {
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [usage, setUsage] = useState<UsageState>({ status: 'loading' });
  // The native Session object's own running flag is the settle signal: it flips
  // when a turn finishes, so a second turn re-reads the totals while this panel
  // stays open. No polling, no second event stream, and no local turn counter
  // pretending to be one.
  const running = useSession(snapshot => snapshot.running);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    setUsage({ status: 'loading' });
    readCourse({ sessionId }).then(
      result => { if (live) setState(result.ok ? { status: 'ready', view: result.value } : { status: 'unavailable' }); },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    // Usage is its own read: a missing lesson row must not hide the turn totals.
    readUsage({ sessionId }).then(
      result => { if (live) setUsage(result.ok ? { status: 'ready', usage: result.value } : { status: 'unavailable' }); },
      () => { if (live) setUsage({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [sessionId, readCourse, readUsage, running]);

  // Unknown is not a fact: the status rows only name what the read actually returned.
  const status = state.status === 'ready'
    ? {
      lesson: state.view.data.closure !== null ? '已结束' : state.view.data.archived ? '已归入归档' : '进行中',
      set: state.view.data.learningSetRef === null ? '未归入' : '已归入',
    }
    : { lesson: state.status === 'loading' ? '未加载' : '暂不可用', set: state.status === 'loading' ? '未加载' : '暂不可用' };
  const materials = state.status === 'ready' ? state.view.data.lessonMaterials.materials : [];
  return <aside className="sf-lesson" data-testid="studyforge-lesson-panel">
    <h2>本课</h2>
    <p className="sf-note">讨论、材料和产出都留在这节课里。</p>
    <section>
      <h3>本课资料</h3>
      {state.status === 'loading' && <p className="sf-note" role="status">正在看这节课的材料…</p>}
      {state.status === 'unavailable' && <p className="sf-note" role="status">这节课的材料暂时取不到，稍后再看一次。</p>}
      {state.status === 'ready' && (materials.length === 0
        ? <p className="sf-note">还没有把资料放进这节课。</p>
        : <ul data-testid="studyforge-lesson-materials">{materials.map((material, index) => <li key={index}>
          <span>{materialLabel(material)}</span>
        </li>)}</ul>)}
    </section>
    <section>
      <h3>状态</h3>
      <ul>
        <li><span>这节课</span><span className="sf-meta">{status.lesson}</span></li>
        <li><span>学习集</span><span className="sf-meta">{status.set}</span></li>
      </ul>
    </section>
    <NativeUsage state={usage} />
  </aside>;
}

/** Source position when the material pins one; the opaque ids never reach the student. */
function materialLabel(material: LessonMaterial): string {
  if (material.kind === 'card') return '卡片';
  const { locator } = material.source;
  if (locator === undefined) return '资料';
  if (locator.kind === 'pdf') return `书页 · 第 ${locator.page} 页`;
  if (locator.kind === 'image') return '图片';
  if (locator.kind === 'text') {
    const { start, end } = locator;
    return start.line === end.line ? `原文 · 第 ${start.line} 行` : `原文 · 第 ${start.line}–${end.line} 行`;
  }
  return '文档';
}
