import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { CourseView, LearningPath } from '@studyforge/contracts/courses';
import { useEffect, useRef, useState } from 'react';
import './learning-entry.css';

/** Recommendations belong to the native blank session, never to a second draft. */
export function LearningEntry({ ctx, sessionId, useSession }: PropsRuntime<'conversation.composer.dock'> & { ctx: Context }): React.JSX.Element | null {
  const blank = useSession(state => state.blank);
  const [course, setCourse] = useState<CourseView>();
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [pathsReady, setPathsReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const loading = useRef(false);
  const current = useRef(sessionId); current.current = sessionId;
  useEffect(() => {
    if (!blank) return;
    let live = true;
    setCourse(undefined); setPaths([]); setPathsReady(false); setLoadFailed(false); setChoosing(false); setNotice('');
    void Promise.all([ctx.remote.studyforgeCourses.read({ sessionId }), ctx.remote.studyforgeCourses.learningPaths()]).then(([row, routes]) => {
      if (!live) return;
      if (row.ok) setCourse(row.value);
      else { setLoadFailed(true); setNotice('这节课暂时读不出来，可以重试。'); }
      if (routes.ok) { setPaths(routes.value.filter(path => path.status !== 'complete' && path.originSessionId !== sessionId)); setPathsReady(true); }
      else { setLoadFailed(true); setNotice('学习路线暂时读不出来，可以重试。'); }
    }).catch(() => { if (live) { setLoadFailed(true); setNotice('暂时没有连上，可以重试。'); } });
    return () => { live = false; };
  }, [sessionId, blank, refresh]);
  if (!blank) return null;
  const focus = (): void => { if (ctx.sessions.list.getSnapshot().current === sessionId) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-composer-input]')?.focus()); };
  async function choose(guided: boolean): Promise<void> {
    if (!course || loading.current || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) return;
    loading.current = true; setBusy(true); setNotice('');
    const block = { reason: '正在准备这节课…' };
    ctx.conversation.blocks.set(sessionId, block);
    try {
      const result = await ctx.remote.studyforgeCourses.update({ sessionId, operationId: crypto.randomUUID(), expectedVersion: course.version,
        patch: { guided, teachingRef: guided ? 'diagnose' : 'socratic' } });
      if (!result.ok) throw new Error('choice_failed');
      if (current.current === sessionId) { setCourse(result.value); setChoosing(false); }
    } catch { if (current.current === sessionId) setNotice('这次没能选好，请再点一次。原来的内容仍保留。'); }
    finally {
      loading.current = false; setBusy(false);
      if (ctx.conversation.blocks.storeFor(sessionId).getSnapshot() === block) ctx.conversation.blocks.set(sessionId, undefined);
      focus();
    }
  }
  async function open(path: LearningPath): Promise<void> {
    if (!path.next || busy) return;
    setBusy(true); setNotice('');
    try {
      let id = path.next.sessionId;
      if (!id && path.next.nodeId) {
        const result = await ctx.remote.studyforgeOrganization.openPlannedLesson({ operationId: crypto.randomUUID(), nodeId: path.next.nodeId });
        if (!result.ok) throw new Error('open_failed');
        id = result.value.sessionId;
      }
      if (id) {
        await ctx.sessions.refresh();
        if (ctx.sessions.list.getSnapshot().current === sessionId) { ctx.sessions.open(id as SessionId); ctx.layout.selectPanel(null); }
      }
    } catch { setNotice('这节课暂时打不开，可以再试一次。'); }
    finally { setBusy(false); }
  }
  return <div className="sf-learning-entry" data-testid="learning-entry">
    {choosing && <div className="sf-learning-paths">{paths.map(path => <button key={path.originSessionId} disabled={busy} onClick={() => { void open(path); }}><b>{path.title}</b><span>{path.next?.title}</span></button>)}
      <button disabled={busy} onClick={() => { void choose(true); }}>开始新的学习路线</button></div>}
    <div className="sf-learning-choices">
      <button disabled={busy || !course || !pathsReady} aria-pressed={course?.data.guided === true} onClick={() => { if (paths.length === 1) void open(paths[0]!); else if (paths.length) setChoosing(!choosing); else void choose(true); }}>按路线学习</button>
      <button disabled={busy || !course} aria-pressed={course?.data.guided === false} onClick={() => { void choose(false); }}>自由学习</button>
    </div>
    {(notice || loadFailed) && <p role="status">{notice}{loadFailed && <button disabled={busy} onClick={() => setRefresh(n => n + 1)}>重试</button>}</p>}
  </div>;
}
