/**
 * P6 学习集页，移植自 B@3831987 `app/js/sets.js` 的 `renderSetsScreen`
 * （`sec-head` 目录 + 每集一张 `set-card`，只有当前集展开设置）。
 *
 * B 的骨架与文案照搬：一集一行「名字 / 学科 / 几本书几张卡 / 打开书架 →」，
 * 右边一颗「设置」；展开后是改名、学科、复习梯子三行加高级设置。DSH 已有的真实
 * 能力一个不少——材料与指定卡片的显式增删、冲突时保留草稿并核对新版、开始学习、
 * 卡片详情——只是搬到 B 的纸页密度上。所有读写仍走原 RPC 与 operationId 幂等。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SetView } from '@studyforge/contracts/sets';
import { SetCreateSchema, SetPatchSchema } from '@studyforge/contracts/sets';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { setNavigation } from './set-navigation.ts';
import { CardDetail } from '../cards/CardDetail.tsx';
import { ReviewScreen } from '../review/ReviewScreen.tsx';

interface Draft { name: string; subjects: string; ladder: string; materials: string[]; members: string[] }
const draftOf = (set?: SetView): Draft => ({ name: set?.name ?? '', subjects: set?.subjects.join('、') ?? '',
  ladder: set?.ladder?.join(', ') ?? '', materials: set?.materials ?? [], members: set?.members ?? [] });
const words = (value: string) => value.split(/[,，、\n]+/).map(s => s.trim()).filter(Boolean);
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
const DEFAULT_LADDER = '1, 3, 7, 14, 30, 60, 120';

/** One set's authoring draft keeps the exact target and read version through conflicts. */
export function SetPage({ ctx, onMaterial, onSource }: { ctx: Context; onMaterial(material: MaterialView): void; onSource(source: SourceAnchor): void }): React.JSX.Element {
  const [sets, setSets] = useState<SetView[]>([]), [materials, setMaterials] = useState<MaterialView[]>([]), [cards, setCards] = useState<CardView[]>([]);
  const [ready, setReady] = useState(false), [notice, setNotice] = useState('');
  const [selected, select] = useState<string>(), [editing, setEditing] = useState(false);
  const navigationTarget = useSyncExternalStore(setNavigation.subscribe, setNavigation.read);
  useEffect(() => { if (navigationTarget !== undefined) { select(navigationTarget); setEditing(false); } }, [navigationTarget]);
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
  function edit(set?: SetView): void { setBaseline(set); setDraft(draftOf(set)); setLatest(undefined); setEditing(true); setNotice(''); select(set?.ref ?? ''); setDetail(undefined); setStudying(undefined); attempt.current = undefined; }
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
  const count = (set: SetView) => `${String(set.materials.length)} 份资料 · ${String(set.members.length)} 张指定卡片`;

  return <main className="sf-orig sf-page-scroll" data-testid="studyforge-page-studyforge.sets">
    <div className="plain-wrap">
      <div className="sec-head"><h2>学习集</h2><div className="line" /><button className="btn primary" onClick={() => { edit(); }}>新建学习集</button></div>
      {notice && <p role="status" className="mini-note" data-testid="set-notice">{notice}</p>}
      {!ready && <p className="mini-note">正在读取…</p>}
      {ready && sets.length === 0 && !editing && <p className="mini-note">暂无学习集</p>}

      {editing && baseline === undefined && <form className="set-editor" data-testid="set-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2>新建学习集</h2>
        <EditorFields draft={draft} setDraft={setDraft} materials={materials} cards={cards} busy={busy} />
        {latest !== undefined && <LatestNotice latest={latest} onMerge={() => { setBaseline(latest); setLatest(undefined); attempt.current = undefined; }} />}
        <div className="set-card-row"><button className="btn primary" disabled={busy || latest !== undefined}>保存学习集</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { setEditing(false); }}>取消</button></div>
      </form>}

      <div className="sf-linear-tree">{sets.map(set => <div className={`set-card${set.ref === selected ? ' editing' : ''}`} key={set.ref} data-setcard={set.ref}>
        <div className="set-list-row">
          <button className="set-shelf" data-set-shelf={set.ref} onClick={() => { select(set.ref); setEditing(false); setDetail(undefined); setStudying(undefined); }}>
            <span className="set-card-name">{set.name}</span>
            <span className="set-card-meta"><b>{set.subjects.join('、') || '未设置学科'}</b><i>{count(set)}</i></span>
            <em>{set.ref === selected ? '正在看 →' : '打开书架 →'}</em>
          </button>
          <button type="button" className="btn ghost set-settings-toggle" aria-expanded={editing && baseline?.ref === set.ref}
            onClick={() => { if (editing && baseline?.ref === set.ref) setEditing(false); else edit(set); }}>{editing && baseline?.ref === set.ref ? '收起' : '设置'}</button>
        </div>

        {editing && baseline?.ref === set.ref && <form className="set-editor" data-testid="set-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
          <h2>调整学习集</h2>
          <EditorFields draft={draft} setDraft={setDraft} materials={materials} cards={cards} busy={busy} />
          <p className="mini-note">修改间隔会重排已学卡的到期日，保留所有学习记录；还没学的卡仍不计到期。</p>
          {latest !== undefined && <LatestNotice latest={latest} onMerge={() => { setBaseline(latest); setLatest(undefined); attempt.current = undefined; }} />}
          <div className="set-card-row"><button className="btn primary" disabled={busy || latest !== undefined}>保存学习集</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => { setEditing(false); }}>取消</button></div>
        </form>}

        {set.ref === selected && !(editing && baseline?.ref === set.ref) && !studying && !detail && <>
          <div className="set-card-row"><h2>{set.name}</h2>
            <button type="button" className="btn ghost" onClick={() => { edit(set); }}>调整学习集</button></div>
          <p className="mini-note">{set.subjects.join(' · ') || '不限学科'} · {set.ladder ? `复习间隔：${set.ladder.join(' → ')} 天` : `使用默认复习间隔（${DEFAULT_LADDER}）`}</p>
          <h3>书架</h3>
          <div className="sf-linear-tree">{materials.filter(m => set.materials.includes(m.materialId)).map(m => <button key={m.materialId} className="cal-lrow" onClick={() => { onMaterial(m); }}>{m.title}<small>打开原文与结构</small></button>)}</div>
          {materials.every(m => !set.materials.includes(m.materialId)) && <p className="mini-note">这个集还没有放资料。</p>}
          <h3>卡片 · {owned.length}</h3>
          <div className="sf-linear-tree">{owned.map(c => <button key={c.ref} className="cal-lrow" onClick={() => { setDetail(c.ref); }}>{c.content.title}<small>{c.review ? '已学' : '还没学'}</small></button>)}</div>
        </>}

        {set.ref === selected && studying && <div className="set-editor"><ReviewScreen ctx={ctx} start={studying} onBack={() => { setStudying(undefined); void reload(); }} /></div>}
        {set.ref === selected && !studying && detail && <div className="set-editor">
          <button className="btn" onClick={() => { setStudying(detail); }}>开始学习</button>
          <CardDetail ctx={ctx} target={detail} onBack={() => { setDetail(undefined); }} onSource={onSource} /></div>}
      </div>)}</div>
    </div>
  </main>;
}

/** B's three rows (名字 / 学科 / 复习梯子) plus this contract's own explicit picks. */
function EditorFields({ draft, setDraft, materials, cards, busy }: {
  readonly draft: Draft; readonly setDraft: (next: Draft) => void;
  readonly materials: readonly MaterialView[]; readonly cards: readonly CardView[]; readonly busy: boolean;
}): React.JSX.Element {
  return <>
    <div className="set-card-row"><label>名字</label>
      <input aria-label="学习集名称" value={draft.name} disabled={busy} onChange={e => { setDraft({ ...draft, name: e.target.value }); }} /></div>
    <div className="set-card-row"><label>学科</label>
      <input aria-label="学科提示" placeholder="可留空；多个用逗号分隔" value={draft.subjects} disabled={busy} onChange={e => { setDraft({ ...draft, subjects: e.target.value }); }} /></div>
    <div className="set-card-row"><label>复习梯子</label>
      <input aria-label="复习间隔" placeholder={`留空＝缺省 ${DEFAULT_LADDER}`} value={draft.ladder} disabled={busy} onChange={e => { setDraft({ ...draft, ladder: e.target.value }); }} /></div>
    <p className="mini-note">用递增天数表示复习间隔，第一档为 1；留空使用 {DEFAULT_LADDER}。</p>
    <fieldset className="set-picks"><legend>资料</legend>
      {materials.length === 0 && <p className="mini-note">还没有导入资料。</p>}
      {materials.map(m => <label className="set-pick" key={m.materialId}><input type="checkbox" checked={draft.materials.includes(m.materialId)} disabled={busy}
        onChange={() => { setDraft({ ...draft, materials: toggle(draft.materials, m.materialId) }); }} />{m.title}</label>)}</fieldset>
    <fieldset className="set-picks"><legend>指定卡片</legend>
      {cards.length === 0 && <p className="mini-note">还没有卡片。</p>}
      {cards.map(c => <label className="set-pick" key={c.ref}><input type="checkbox" checked={draft.members.includes(c.ref)} disabled={busy}
        onChange={() => { setDraft({ ...draft, members: toggle(draft.members, c.ref) }); }} />{c.content.title}</label>)}</fieldset>
  </>;
}

/** A real concurrent update is shown as its own version; the draft is never silently re-based. */
function LatestNotice({ latest, onMerge }: { readonly latest: SetView; onMerge(): void }): React.JSX.Element {
  return <aside className="set-editor" role="status">
    <p>新版：{latest.name} · {latest.ladder?.join(' → ') ?? '默认间隔'} · {latest.materials.length} 份资料 · {latest.members.length} 张指定卡片</p>
    <button type="button" className="btn" onClick={onMerge}>已核对，保留草稿继续合并</button></aside>;
}
