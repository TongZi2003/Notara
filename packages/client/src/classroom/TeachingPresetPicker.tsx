import type { Context } from '@deepseek-ai/cordis';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import type { CourseView, CoursePatch } from '@studyforge/contracts/courses';
import { useEffect, useRef, useState } from 'react';
export function TeachingPresetPicker({ ctx, sessionId, course, onChange }: {
  ctx: Context; sessionId: string; course: CourseView; onChange(value: CourseView): void;
}): React.JSX.Element {
  const [choices, setChoices] = useState<TeachingChoice[]>();
  const [temporary, setTemporary] = useState(course.data.temporaryInstructions ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const active = useRef(sessionId); active.current = sessionId;
  useEffect(() => {
    let live = true;
    void ctx.remote.studyforgeTeaching.choices().then(result => {
      if (live) { if (result.ok) setChoices(result.value); else setNotice('教学方式暂时读不出来。'); }
    });
    return () => { live = false; };
  }, [ctx]);
  useEffect(() => {
    if (!dirty) setTemporary(course.data.temporaryInstructions ?? '');
  }, [course, dirty]);
  async function save(patch: CoursePatch): Promise<void> {
    const started = sessionId;
    setBusy(true); setNotice('');
    try {
      const result = await ctx.remote.studyforgeCourses.update({ sessionId: started, operationId: crypto.randomUUID(), expectedVersion: course.version, patch });
      if (active.current !== started) return;
      if (result.ok) { if (patch.temporaryInstructions !== undefined) setDirty(false); onChange(result.value); }
      else {
        const latest = await ctx.remote.studyforgeCourses.read({ sessionId: started });
        if (active.current !== started) return;
        if (latest.ok) onChange(latest.value);
        setNotice('设置刚有变化，已重新读取；你的文字还在，可以再保存。');
      }
    } catch { if (active.current === started) setNotice('这次没能保存，请再试一次。'); }
    finally { if (active.current === started) setBusy(false); }
  }
  return <section data-testid="teaching-settings">
    <h3>这节课怎么学</h3>
    <label>教学方式 <select data-testid="teaching-preset" disabled={busy || choices === undefined}
      value={course.data.teachingRef ?? 'socratic'} onChange={event => { void save({ teachingRef: event.target.value }); }}>
      {choices?.map(choice => <option value={choice.id} key={choice.id}>{choice.title}</option>)}
    </select></label>
    <p className="sf-note">{choices?.find(choice => choice.id === (course.data.teachingRef ?? 'socratic'))?.description}</p>
    <label style={{ display: 'block', marginTop: 12 }}>本课的临时要求
      <textarea data-testid="teaching-instructions" value={temporary} rows={3} style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
        onChange={event => { setTemporary(event.target.value); setDirty(true); }} placeholder="例如：先完整讲解，再让我独立做一道题。" />
    </label>
    <button type="button" disabled={busy || !dirty} data-testid="teaching-save" onClick={() => { void save({ temporaryInstructions: temporary }); }}>保存要求</button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
