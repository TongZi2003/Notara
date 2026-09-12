import type { Context } from '@deepseek-ai/cordis';
import type { SetView } from '@studyforge/contracts/sets';
import { SetCreateSchema, SetPatchSchema } from '@studyforge/contracts/sets';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { useEffect, useRef, useState } from 'react';
import { CardDetail } from '../cards/CardDetail.tsx';
import { ReviewScreen } from '../review/ReviewScreen.tsx';

interface Draft { name: string; subjects: string; ladder: string; materials: string[]; members: string[] }
const draftOf = (set?: SetView): Draft => ({ name: set?.name ?? '', subjects: set?.subjects.join('、') ?? '',
  ladder: set?.ladder?.join(', ') ?? '', materials: set?.materials ?? [], members: set?.members ?? [] });
const words = (value: string) => value.split(/[,，、\n]+/).map(s => s.trim()).filter(Boolean);
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];

/** One set's authoring draft keeps the exact target and read version through conflicts. */
export function SetPage({ ctx, onMaterial, onSource }: { ctx: Context; onMaterial(material: MaterialView): void; onSource(source: SourceAnchor): void }): React.JSX.Element {
  const [sets, setSets] = useState<SetView[]>([]), [materials, setMaterials] = useState<MaterialView[]>([]), [cards, setCards] = useState<CardView[]>([]);
  const [ready, setReady] = useState(false), [notice, setNotice] = useState('');
  const [selected, select] = useState<string>(), [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState<SetView>(), [latest, setLatest] = useState<SetView>();
  const [draft, setDraft] = useState<Draft>(draftOf()), [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<string>(), [studying, setStudying] = useState<string>();
  const attempt = useRef<{ fingerprint: string; id: string }>();
  const version = useRef(0);
  async function reload(): Promise<void> {
    const request = ++version.current;
    try {
      const [s, m, c] = await Promise.all([ctx.remote.studyforgeOrganization.sets({}), ctx.remote.studyforgeMaterials.list(), ctx.remote.studyforgeLearning.cards()]);
      if (version.current !== request) return;
      if (!s.ok || !m.ok || !c.ok) { setNotice('这次未能读到学习集，请重试。'); return; }
      setSets(s.value); setMaterials(m.value); setCards(c.value); setReady(true);
    } catch { if (version.current === request) setNotice('连接暂时不可用，请重试。'); }
  }
  useEffect(() => { void reload(); return () => { version.current++; }; }, [ctx]);
  const active = sets.find(set => set.ref === selected);
  const owned = active ? cards.filter(card => active.members.includes(card.ref) || card.content.sources.some(source => active.materials.includes(source.materialId))) : [];
  function edit(set?: SetView): void { setBaseline(set); setDraft(draftOf(set)); setLatest(undefined); setEditing(true); setNotice(''); attempt.current = undefined; }
  async function save(): Promise<void> {
    const content = SetCreateSchema.safeParse({ name: draft.name, subjects: words(draft.subjects),
      ladder: draft.ladder.trim() ? words(draft.ladder).map(Number) : null, materials: draft.materials, members: draft.members });
    if (!content.success) { setNotice('请填写名称；复习间隔留空使用默认，或填写从 1 开始递增的 2–12 个天数。'); return; }
    const fingerprint = JSON.stringify([baseline?.ref, baseline?.version, content.data]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true); setNotice('');
    try {
      const result = baseline ? await ctx.remote.studyforgeOrganization.updateSet({ ref: baseline.ref, expectedVersion: baseline.version, operationId: attempt.current.id,
        patch: SetPatchSchema.parse({ name: content.data.name, subjects: content.data.subjects, ladder: content.data.ladder,
          materials_add: draft.materials.filter(id => !baseline.materials.includes(id)), materials_remove: baseline.materials.filter(id => !draft.materials.includes(id)),
          members_add: draft.members.filter(id => !baseline.members.includes(id)), members_remove: baseline.members.filter(id => !draft.members.includes(id)) }) })
        : await ctx.remote.studyforgeOrganization.createSet({ operationId: attempt.current.id, set: content.data });
      if (!result.ok) {
        if (/version_conflict/.test(result.error.message) && baseline) {
          const current = await ctx.remote.studyforgeOrganization.set({ ref: baseline.ref });
          if (current.ok) setLatest(current.value);
          setNotice('这份学习集已经有新修改。你的草稿还在，请核对新版后合并。');
        } else setNotice('这次没有保存成功，草稿还在，可以重试。');
        return;
      }
      select(result.value.ref); setEditing(false); attempt.current = undefined; setNotice('学习集已保存。'); await reload();
    } catch { setNotice('暂时没有收到保存结果。重试会继续同一次保存。'); }
    finally { setBusy(false); }
  }
  return <main className="sf-page sf-organization" data-testid="studyforge-page-studyforge.sets">
    <header className="sf-page-head"><span>学习集</span><button className="sf-quiet" onClick={() => edit()}>新建学习集</button></header>
    {notice && <p role="status" className="sf-notice">{notice}</p>}
    <div className="sf-organization-columns">
      <nav aria-label="学习集" className="sf-organization-list">
        <button className="sf-quiet" onClick={() => { void reload(); }}>刷新</button>
        {!ready && <p className="sf-note">正在读取…</p>}
        {ready && !sets.length && <p>把一起学的资料和卡片放进一个学习集。</p>}
        {sets.map(set => <button className="sf-org-row" key={set.ref} aria-current={selected === set.ref} onClick={() => { select(set.ref); setEditing(false); setDetail(undefined); setStudying(undefined); }}>
          <strong>{set.name}</strong><span>{set.materials.length} 份资料 · {set.members.length} 张指定卡片</span>
        </button>)}
      </nav>
      <section className="sf-organization-detail">
        {editing ? <form className="sf-org-form" onSubmit={event => { event.preventDefault(); void save(); }} data-testid="set-editor">
          <h2>{baseline ? '调整学习集' : '新建学习集'}</h2>
          <label>名称<input aria-label="学习集名称" value={draft.name} disabled={busy} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>学科提示<input value={draft.subjects} disabled={busy} onChange={e => setDraft({ ...draft, subjects: e.target.value })} /></label>
          <label>复习间隔（天）<input aria-label="复习间隔" placeholder="留空使用默认间隔" value={draft.ladder} disabled={busy} onChange={e => setDraft({ ...draft, ladder: e.target.value })} /></label>
          <p className="sf-note">修改间隔会重排已学卡的到期日，保留所有学习记录；还没学的卡仍不计到期。</p>
          <fieldset><legend>资料</legend>{materials.map(m => <label className="sf-org-check" key={m.materialId}><input type="checkbox" checked={draft.materials.includes(m.materialId)} disabled={busy}
            onChange={() => setDraft({ ...draft, materials: toggle(draft.materials, m.materialId) })} />{m.title}</label>)}</fieldset>
          <fieldset><legend>指定卡片</legend>{cards.map(c => <label className="sf-org-check" key={c.ref}><input type="checkbox" checked={draft.members.includes(c.ref)} disabled={busy}
            onChange={() => setDraft({ ...draft, members: toggle(draft.members, c.ref) })} />{c.content.title}</label>)}</fieldset>
          {latest && <aside className="sf-notice"><p>新版：{latest.name} · {latest.ladder?.join(' → ') ?? '默认间隔'} · {latest.materials.length} 份资料 · {latest.members.length} 张指定卡片</p>
            <button type="button" className="sf-quiet" onClick={() => { setBaseline(latest); setLatest(undefined); attempt.current = undefined; }}>已核对，保留草稿继续合并</button></aside>}
          <div className="sf-org-actions"><button className="sf-action" disabled={busy || !!latest}>保存学习集</button><button type="button" className="sf-quiet" disabled={busy} onClick={() => setEditing(false)}>取消</button></div>
        </form> : studying ? <ReviewScreen ctx={ctx} start={studying} onBack={() => { setStudying(undefined); void reload(); }} />
          : detail ? <><button className="sf-action" onClick={() => setStudying(detail)}>开始学习</button><CardDetail ctx={ctx} target={detail} onBack={() => setDetail(undefined)} onSource={onSource} /></>
          : active ? <>
            <div className="sf-org-actions"><h2>{active.name}</h2><button className="sf-quiet" onClick={() => edit(active)}>调整学习集</button></div>
            <p>{active.subjects.join(' · ') || '不限学科'} · {active.ladder ? `复习间隔：${active.ladder.join(' → ')} 天` : '使用默认复习间隔'}</p>
            <h3>书架</h3>{materials.filter(m => active.materials.includes(m.materialId)).map(m => <button key={m.materialId} className="sf-org-row" onClick={() => onMaterial(m)}>{m.title}<span>打开原文与结构</span></button>)}
            <h3>卡片 · {owned.length}</h3>{owned.map(c => <button className="sf-org-row" key={c.ref} onClick={() => setDetail(c.ref)}>{c.content.title}<span>{c.review ? '已学' : '还没学'}</span></button>)}
          </> : <p className="sf-note">选择一个学习集，查看它的书架和卡片。</p>}
      </section>
    </div>
  </main>;
}
