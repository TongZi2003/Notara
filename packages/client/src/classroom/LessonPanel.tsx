import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { CourseUsage, CourseView } from '@studyforge/contracts/courses';
import { useEffect, useRef, useState } from 'react';
import { openLessonSource } from '../materials/native-preview-adapter.ts';
import { LessonResources, type LessonResourcesFace } from '../materials/LessonResources.tsx';
import { NativeUsage, type UsageState } from './NativeUsage.tsx';
import type { Context } from '@deepseek-ai/cordis';
import { TeachingPresetPicker } from './TeachingPresetPicker.tsx';
import { MemoryPanel } from '../memory/MemoryPanel.tsx';
import { ProposalInbox } from '../proposals/ProposalInbox.tsx';
import { Outputs } from './Outputs.tsx';
import type { OutputProjection } from '@studyforge/domain/outputs';
import { LearningObject } from './LearningObject.tsx';
import { HandoffEditor } from './HandoffEditor.tsx';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { LessonMaterialsEditor } from './LessonMaterialsEditor.tsx';

/** This client's tab implementation identity; the body registers under it. */
export const LESSON_TAB_ID = '@studyforge/dsh-client/lesson';
/** The page type `openTab` names; the tab is recorded at `sidebar://<kind>`. */
export const LESSON_TAB_KIND = 'studyforge-lesson';

/** The lesson's teaching additions, read from the Host through the frozen P2.1 Remote. */
export interface LessonPanelInjected {
  ctx: Context;
  readCourse(input: { sessionId: string }): Promise<RemoteResult<CourseView>>;
  /** Native completed-turn usage plus its coverage; never re-counted in the browser. */
  readUsage(input: { sessionId: string }): Promise<RemoteResult<CourseUsage>>;
  /**
   * P4.1: this lesson's own material projection. The rows come from the course's
   * declared references, the accepted messages and the saved outputs — not from
   * the course's materials list alone.
   */
  readonly resources: LessonResourcesFace;
}

export type LessonPanelProps = ComposedProps<'sidebar.right.pane.tab', typeof LESSON_TAB_ID, never, undefined, LessonPanelInjected>;

type PanelState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly view: CourseView };

/** One lesson's own facts: what it was given, and whether it is still running. */
export function LessonPanel({ ctx, sessionId, readCourse, readUsage, resources, useSession, useSessions }: LessonPanelProps): React.JSX.Element {
  const title = useSessions(snapshot => snapshot.byId[sessionId]?.title || '自由学习');
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [usage, setUsage] = useState<UsageState>({ status: 'loading' });
  const [refresh, setRefresh] = useState(0), [memory, setMemory] = useState(false), [target, setTarget] = useState<string>();
  const [outputs, setOutputs] = useState<OutputProjection>();
  const current = useRef(sessionId); current.current = sessionId;
  // The native Session object's own running flag is the settle signal: it flips
  // when a turn finishes, so a second turn re-reads the totals while this panel
  // stays open. No polling, no second event stream, and no local turn counter
  // pretending to be one.
  const running = useSession(snapshot => snapshot.running);
  useEffect(() => { setState({ status: 'loading' }); setUsage({ status: 'loading' }); setMemory(false); setTarget(undefined); setOutputs(undefined); }, [sessionId]);
  useEffect(() => {
    let live = true;
    readCourse({ sessionId }).then(
      result => { if (live) setState(result.ok ? { status: 'ready', view: result.value } : { status: 'unavailable' }); },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    // Usage is its own read: a missing lesson row must not hide the turn totals.
    readUsage({ sessionId }).then(
      result => { if (live) setUsage(result.ok ? { status: 'ready', usage: result.value } : { status: 'unavailable' }); },
      () => { if (live) setUsage({ status: 'unavailable' }); },
    );
    void ctx.remote.studyforgeCourses.outputs({ sessionId }).then(result => { if (live) setOutputs(result.ok ? result.value : undefined); }).catch(() => { if (live) setOutputs(undefined); });
    return () => { live = false; };
  }, [ctx, sessionId, readCourse, readUsage, running, refresh]);

  // Unknown is not a fact: the status rows only name what the read actually returned.
  const status = state.status === 'ready'
    ? {
      lesson: state.view.data.closure !== null ? '已结束' : state.view.data.archived ? '已归入归档' : '进行中',
      set: state.view.data.learningSetRef === null ? '未归入' : '已归入',
    }
    : { lesson: state.status === 'loading' ? '未加载' : '暂不可用', set: state.status === 'loading' ? '未加载' : '暂不可用' };
  return <aside className="sf-lesson" data-testid="studyforge-lesson-panel">
    <header className="sf-original-lesson-head"><span className="sf-lesson-seal" aria-hidden="true">课</span><div><small>本课信息与设置</small><h2>{title}</h2><span className="sf-lesson-state">{status.lesson}</span></div></header>
    <section className="sf-original-lesson-overview"><h3>本课概况</h3><dl>
      <div><dt>课名</dt><dd>{title}</dd></div>
      <div><dt>所属</dt><dd>{state.status === 'ready' ? state.view.data.learningSetRef === null ? '全局学习' : '已指定学习集' : '正在读取…'}</dd></div>
      <div><dt>接续</dt><dd>{state.status === 'ready' ? state.view.data.continuation ? '接着上次的小结' : '独立开始' : '正在读取…'}</dd></div>
      <div><dt>带入资料</dt><dd>{state.status === 'ready' ? `${state.view.data.lessonMaterials.materials.length} 项` : '正在读取…'}</dd></div>
    </dl></section>
    <button className="sf-quiet" data-testid="lesson-memory" onClick={() => { setMemory(!memory); setTarget(undefined); }}>{memory ? '返回本课' : '学情与偏好'}</button>
    {memory && <MemoryPanel ctx={ctx} sessionId={sessionId} />}
    {target && <LearningObject ctx={ctx} sessionId={sessionId} target={target} onBack={() => setTarget(undefined)}
      onSource={source => { void openLessonSource(resources, sessionId, source, () => current.current); }} />}
    <section>
      <h3>本课资料</h3>
      {/* The pane belongs to one lesson, so the session it opens in is its own. */}
      <LessonResources key={String(running) + ':' + refresh} sessionId={sessionId} host={resources} currentSession={() => sessionId} onOpenObject={setTarget} />
    </section>
    {outputs && <Outputs projection={outputs} onOpen={entry => {
      if (entry.status !== 'saved') { setTarget(undefined); return; }
      if (entry.target) { setMemory(false); setTarget(entry.target); }
    }} />}
    <ProposalInbox ctx={ctx} sessionId={sessionId} refreshToken={refresh * 2 + Number(running)} onChanged={() => setRefresh(n => n + 1)} />
    {state.status === 'ready' && (state.view.data.closure || state.view.data.continuation) && <HandoffEditor ctx={ctx} sessionId={sessionId} onChanged={() => setRefresh(n => n + 1)}
      onContinued={next => { ctx.sessions.open(next as SessionId); ctx.layout.selectPanel(null); }} />}
    {state.status === 'ready' && <details className="sf-lesson-adjust" data-testid="lesson-adjust">
      <summary>调整本课</summary>
      <TeachingPresetPicker key={sessionId} ctx={ctx} sessionId={sessionId} course={state.view}
        onChange={view => { setState({ status: 'ready', view }); }} />
      <LessonMaterialsEditor ctx={ctx} course={state.view} onSaved={view => { setState({ status: 'ready', view }); setRefresh(n => n + 1); }} />
    </details>}
    <NativeUsage state={usage} />
  </aside>;
}
