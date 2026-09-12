import type { Context } from '@deepseek-ai/cordis';
import type { CourseView } from '@studyforge/contracts/courses';
import type { LessonMaterial } from '@studyforge/contracts/materials';
import type { SetView } from '@studyforge/contracts/sets';
import { useEffect, useRef, useState } from 'react';
import { MixedMaterials, type OrganizationMaterialOption, type OrganizationCardOption } from '../proposals/OrganizationDraftEditor.tsx';
import { attemptKey, useStableOperationId } from '../cards/attempt.ts';

export function LessonMaterialsEditor({ ctx, course, onSaved }: { ctx: Context; course: CourseView; onSaved(view: CourseView): void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  return <section><button className="sf-quiet" data-testid="lesson-edit-materials" onClick={() => setEditing(!editing)}>{editing ? '收起资料设置' : '调整本课资料'}</button>
    {editing && <Editor key={course.data.sessionId} ctx={ctx} seed={course} onSaved={view => { onSaved(view); setEditing(false); }} />}
  </section>;
}
function Editor({ ctx, seed, onSaved }: { ctx: Context; seed: CourseView; onSaved(view: CourseView): void }): React.JSX.Element {
  const [baseline, setBaseline] = useState(seed), [latest, setLatest] = useState<CourseView>();
  const [list, setList] = useState<readonly LessonMaterial[]>(seed.data.lessonMaterials.materials), [initial, setInitial] = useState(seed.data.lessonMaterials.initialIndex);
  const [setRef, setSetRef] = useState(seed.data.learningSetRef ?? '');
  const [catalogue, setCatalogue] = useState<{ materials: OrganizationMaterialOption[]; cards: OrganizationCardOption[]; sets: SetView[] }>();
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const operationFor = useStableOperationId(), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void Promise.all([ctx.remote.studyforgeMaterials.list(), ctx.remote.studyforgeLearning.cards(), ctx.remote.studyforgeOrganization.sets({})]).then(([materials, cards, sets]) => {
      if (!alive.current) return;
      if (materials.ok && cards.ok && sets.ok) setCatalogue({ materials: materials.value, cards: cards.value, sets: sets.value });
      else setNotice('可选资料暂时读不到，请稍后重开。');
    }).catch(() => { if (alive.current) setNotice('可选资料暂时读不到，请稍后重开。'); });
    return () => { alive.current = false; };
  }, [ctx]);
  async function save(): Promise<void> {
    const patch = { learningSetRef: setRef || null, lessonMaterials: { materials: [...list], ...(initial !== undefined && initial < list.length ? { initialIndex: initial } : {}) } };
    const sessionId = baseline.data.sessionId;
    setBusy(true);
    try {
      const result = await ctx.remote.studyforgeCourses.update({ sessionId, expectedVersion: baseline.version,
        operationId: operationFor(attemptKey('lesson-materials', sessionId, String(baseline.version), JSON.stringify(patch))), patch });
      if (!alive.current) return;
      if (result.ok) { onSaved(result.value); return; }
      const read = await ctx.remote.studyforgeCourses.read({ sessionId });
      if (!alive.current) return;
      if (read.ok) setLatest(read.value);
      setNotice('本课设置已有变化或资料已不在。草稿仍保留，请核对后再保存。');
    } catch { if (alive.current) setNotice('暂时未收到结果，可以用同一版重试。'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <div className="sf-org-form" data-testid="lesson-materials-editor">
    <p className="sf-note">调整本课采用的资料和顺序；阅读其他本人的资料仍然可用。</p>
    {catalogue && <>
      <label>所属学习集<select data-testid="lesson-learning-set" value={setRef} onChange={e => setSetRef(e.target.value)}><option value="">不指定</option>{catalogue.sets.map(set => <option key={set.ref} value={set.ref}>{set.name}</option>)}</select></label>
      <MixedMaterials list={list} initialIndex={initial} materials={catalogue.materials} cards={catalogue.cards} onChange={setList} onInitial={setInitial} />
    </>}
    {notice && <p role="status">{notice}</p>}
    {latest && <aside><p>新版共有 {latest.data.lessonMaterials.materials.length} 项资料。</p><button className="sf-quiet" onClick={() => { setBaseline(latest); setLatest(undefined); }}>已核对，保留我的草稿合并</button></aside>}
    <button className="sf-action" data-testid="lesson-materials-save" disabled={busy || !catalogue || !!latest} onClick={() => { void save(); }}>保存本课资料</button>
  </div>;
}
