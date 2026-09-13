/**
 * 本课设置: everything that is *about* this lesson — its own state, the
 * student's learning profile for it, the outputs it saved, its closeout and the
 * teaching configuration — in one modal opened from the native 开始 page.
 *
 * That is what lets the right column stay a single container: the classroom
 * shows the lesson's material map, and settings never compete with it. The
 * modal writes nothing of its own: the teaching controls and the material
 * editor below still save through the Host's own course update, exactly as
 * they did when they lived in the column.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { CourseUsage, CourseView } from '@studyforge/contracts/courses';
import type { OutputProjection } from '@studyforge/domain/outputs';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { requestLessonPane } from '../materials/lesson-pane-request.ts';
import { MemoryPanel } from '../memory/MemoryPanel.tsx';
import { HandoffEditor } from './HandoffEditor.tsx';
import { LearningObject } from './LearningObject.tsx';
import { LessonMaterialsEditor } from './LessonMaterialsEditor.tsx';
import { NativeUsage, type UsageState } from './NativeUsage.tsx';
import { Outputs } from './Outputs.tsx';
import { TeachingPresetPicker } from './TeachingPresetPicker.tsx';
import './lesson-settings.css';

export interface LessonSettingsProps {
  readonly ctx: Context;
  readonly sessionId: string;
  /** The lesson's own name, as the conversation heading spells it. */
  readonly title: string;
  readCourse(input: { readonly sessionId: string }): Promise<RemoteResult<CourseView>>;
  /** Changes when a native turn settles, so the totals re-read while the modal is open. */
  readonly refreshToken: string | number | boolean;
  readonly onClose: () => void;
}

type PanelState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly view: CourseView };

/** One lesson's settings, portalled above docked and floating 开始 tabs. */
export function LessonSettingsModal({ ctx, sessionId, title, readCourse, refreshToken, onClose }: LessonSettingsProps): React.JSX.Element {
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [usage, setUsage] = useState<UsageState>({ status: 'loading' });
  const [outputs, setOutputs] = useState<OutputProjection>();
  const [memory, setMemory] = useState(false);
  const [target, setTarget] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    setUsage({ status: 'loading' });
    setMemory(false);
    setTarget(undefined);
    setOutputs(undefined);
    readCourse({ sessionId }).then(
      result => { if (live) setState(result.ok ? { status: 'ready', view: result.value } : { status: 'unavailable' }); },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    // Usage is its own read: a missing lesson row must not hide the turn totals.
    ctx.remote.studyforgeCourses.usage({ sessionId }).then(
      result => { if (live) setUsage(result.ok ? { status: 'ready', usage: result.value } : { status: 'unavailable' }); },
      () => { if (live) setUsage({ status: 'unavailable' }); },
    );
    void ctx.remote.studyforgeCourses.outputs({ sessionId }).then(
      result => { if (live) setOutputs(result.ok ? result.value : undefined); },
      () => { if (live) setOutputs(undefined); },
    );
    return () => { live = false; };
  }, [ctx, sessionId, readCourse, refreshToken, refresh]);
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Unknown is not a fact: the status rows only name what the read really returned.
  const lessonState = state.status === 'ready'
    ? { lesson: state.view.data.closure !== null ? '已结束' : state.view.data.archived ? '已归入归档' : '进行中',
      set: state.view.data.learningSetRef === null ? '未归入' : '已归入' }
    : { lesson: state.status === 'loading' ? '未加载' : '暂不可用', set: state.status === 'loading' ? '未加载' : '暂不可用' };
  return createPortal(<div className="sf-lesson-modal" data-testid="lesson-settings-modal" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sf-lesson-modal-card" role="dialog" aria-modal="true" aria-label="本课设置" tabIndex={-1} ref={dialog}>
      <header className="sf-lesson-modal-head">
        <h2>本课设置</h2>
        <button type="button" className="sf-quiet" data-testid="lesson-settings-close" onClick={onClose}>关闭</button>
      </header>
      <section className="sf-original-lesson-overview"><h3>本课概况</h3><dl>
        <div><dt>课名</dt><dd>{title}</dd></div>
        <div><dt>所属</dt><dd>{state.status === 'ready' ? state.view.data.learningSetRef === null ? '全局学习' : '已指定学习集' : '正在读取…'}</dd></div>
        <div><dt>接续</dt><dd>{state.status === 'ready' ? state.view.data.continuation ? '接着上次的小结' : '独立开始' : '正在读取…'}</dd></div>
        <div><dt>状态</dt><dd>{lessonState.lesson} · {lessonState.set}</dd></div>
        <div><dt>带入资料</dt><dd>{state.status === 'ready' ? `${String(state.view.data.lessonMaterials.materials.length)} 项` : '正在读取…'}</dd></div>
      </dl></section>
      <button type="button" className="sf-quiet" data-testid="lesson-memory" onClick={() => { setMemory(!memory); setTarget(undefined); }}>{memory ? '收起学情与偏好' : '学情与偏好'}</button>
      {memory && <MemoryPanel ctx={ctx} sessionId={sessionId} />}
      {target !== undefined && <LearningObject ctx={ctx} sessionId={sessionId} target={target} onBack={() => { setTarget(undefined); }}
        onSource={anchor => {
          // The column is the lesson's own map: its pane reads the original, so
          // the modal steps aside instead of leaving a second rail behind it.
          requestLessonPane(sessionId, { kind: 'source', title: anchor.quote ?? '原文', anchors: [{ materialId: anchor.materialId, versionId: anchor.versionId, locator: anchor.locator }] });
          onClose();
        }} />}
      {outputs !== undefined && <Outputs projection={outputs} onOpen={entry => {
        if (entry.status !== 'saved') { setTarget(undefined); return; }
        if (entry.target !== null) { setMemory(false); setTarget(entry.target); }
      }} />}
      {state.status === 'ready' && (state.view.data.closure !== null || state.view.data.continuation) && <HandoffEditor ctx={ctx} sessionId={sessionId}
        onChanged={() => { setRefresh(n => n + 1); }}
        onContinued={next => { ctx.sessions.open(next as SessionId); ctx.layout.selectPanel(null); onClose(); }} />}
      {state.status === 'ready' && <details className="sf-lesson-adjust" data-testid="lesson-adjust">
        <summary>调整本课</summary>
        <TeachingPresetPicker key={sessionId} ctx={ctx} sessionId={sessionId} course={state.view}
          onChange={view => { setState({ status: 'ready', view }); }} />
        <LessonMaterialsEditor ctx={ctx} course={state.view} onSaved={view => { setState({ status: 'ready', view }); setRefresh(n => n + 1); }} />
      </details>}
      <NativeUsage state={usage} />
    </div>
  </div>, document.body);
}
