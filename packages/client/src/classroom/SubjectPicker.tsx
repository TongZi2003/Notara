import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CourseView } from '@studyforge/contracts/courses';
import { useEffect, useState } from 'react';
import { ControlPopover } from './ControlPopover.tsx';

/** Explicit lesson applicability, independent of role, pedagogy and the sidebar. */
export function SubjectPicker({ ctx, sessionId, useSessions }: PropsRuntime<'conversation.input.right'> & { ctx: Context }): React.JSX.Element | null {
  const learning = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset === 'studyforge-learning');
  const [course, setCourse] = useState<CourseView>();
  const [subjects, setSubjects] = useState<{ effective: string[]; inherited: boolean; choices: string[] }>();
  const [custom, setCustom] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    if (!learning) return;
    let live = true;
    const load = (): void => { void Promise.all([ctx.remote.studyforgeCourses.read({ sessionId }), ctx.remote.studyforgeTeaching.subjects({ sessionId })]).then(([row, options]) => {
      if (!live) return;
      if (row.ok && options.ok) { setCourse(row.value); setSubjects(options.value); }
      else setNotice('科目暂时读不出来。');
    }).catch(() => { if (live) setNotice('科目暂时读不出来。'); }); };
    load(); window.addEventListener('focus', load); window.addEventListener('studyforge:learning-changed', load);
    return () => { live = false; window.removeEventListener('focus', load); window.removeEventListener('studyforge:learning-changed', load); };
  }, [ctx, sessionId, learning]);
  if (!learning) return null;
  async function save(next: string[] | null): Promise<void> {
    if (!course || busy) return;
    setBusy(true); setNotice('');
    try {
      const result = await ctx.remote.studyforgeCourses.update({ sessionId, operationId: crypto.randomUUID(), expectedVersion: course.version, patch: { subjects: next } });
      if (!result.ok) {
        const latest = await ctx.remote.studyforgeCourses.read({ sessionId }); if (latest.ok) setCourse(latest.value);
        setNotice('本课设置刚有变化，请再选一次。'); return;
      }
      setCourse(result.value);
      const options = await ctx.remote.studyforgeTeaching.subjects({ sessionId }); if (options.ok) setSubjects(options.value);
      setCustom('');
    } catch { setNotice('这次没能保存，请重试。'); }
    finally { setBusy(false); }
  }
  return <ControlPopover className="sf-subject-picker" testId="subject-picker" title="选择本课涉及科目" chevron={false}
    label={<><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M10 5C7 3 4 3 2 4v12c3-1 5-1 8 1 3-2 5-2 8-1V4c-2-1-5-1-8 1Zm0 0v12" /></svg><span>Subject</span></>}>
    <div className="sf-subject-menu">
      <button type="button" disabled={busy || !course} onClick={() => { void save(null); }}>继承学习集{subjects?.inherited ? ' ✓' : ''}</button>
      {subjects?.choices.map(subject => <label key={subject}><input type="checkbox" disabled={busy} checked={subjects.effective.includes(subject)} onChange={event => {
        void save(event.target.checked ? [...subjects.effective, subject] : subjects.effective.filter(item => item !== subject));
      }} />{subject}</label>)}
      <form onSubmit={event => { event.preventDefault(); if (custom.trim()) void save([...new Set([...(subjects?.effective ?? []), custom.trim()])]); }}>
        <input aria-label="添加涉及科目" placeholder="添加科目" maxLength={80} value={custom} onChange={event => setCustom(event.target.value)} />
        <button type="submit" disabled={busy || !custom.trim() || !course}>添加</button>
      </form>
      <button type="button" disabled={busy || !course} onClick={() => { void save([]); }}>通用教学</button>
      {notice && <p role="status">{notice}</p>}
    </div>
  </ControlPopover>;
}
