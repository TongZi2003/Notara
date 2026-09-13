/**
 * P6.3/P6.4 the precise-target plan editor.
 *
 * A plan is addressed by its own `ref`; nothing here falls back to "the first
 * book" or "the first campaign". Selecting a row reads that exact target, the
 * draft is checked against the real books, chapters, cards and sets, and the
 * student confirms the very content that will be stored — the preview and the
 * save take the same patch and the same baseline revision against one target.
 *
 * Two writers are normal: a stale save is refused by the Host, the draft stays
 * on screen, the newest revision is shown read-only, and only an explicit
 * re-read rebases the draft. Appending a line to one book never rewrites the
 * other book's or campaign's lines, because only this target receives a patch.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { PlanContent, PlanPatch, PlanView } from '@studyforge/contracts/plans';
import type { SkeletonNode } from '@studyforge/contracts/skeleton';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dayLabel, refusalCode } from '../courses/format.ts';

export interface PlanEditorProps {
  readonly ctx: Context;
  /** The lesson the student is in, when this editor is opened from a class. */
  readonly sessionId?: string;
  /**
   * One exact plan to open straight away — the target a lesson panel, a receipt
   * or the calendar really pointed at. Absent means the editor starts on the
   * list the student chooses from.
   */
  readonly target?: string;
}

/** One campaign draft; every field is the student's, and the patch is built from it. */
interface CampaignDraft {
  readonly title: string;
  readonly tags: string;
  readonly dailyCount: string;
  readonly start: string;
  readonly end: string;
  readonly cards: readonly string[];
}

type Mode = { readonly kind: 'list' } | { readonly kind: 'campaign'; readonly target: PlanView | null } | { readonly kind: 'book'; readonly target: PlanView };

const REFUSAL_COPY: Readonly<Record<string, string>> = {
  plan_conflict: '这份计划刚被别人改过，最新的一版在下面；你的草稿还在，要用它接着改就先换成最新这一版。',
  plan_expected_version_required: '先重新读一遍这份计划再改。',
  plan_missing: '这份计划已经不在了，重新读一下。',
  plan_chapter_missing: '这一章已经不在书里了，重新选一章。',
  plan_wrong_book: '这一行锚到了别的书上，重新选一章。',
  plan_card_missing: '有一张卡已经不在了，去掉它再存。',
  plan_set_missing: '这个学习集已经不在了。',
  plan_date_outside_campaign: '有一天不在起止日期里。',
  plan_duplicate_date: '同一天排了两次，合并成一天再存。',
  plan_duplicate_card: '同一天里有一张卡出现了两次。',
  plan_campaign_end_before_start: '结束日期早于开始日期。',
};

/** The plan surface: list every target, then edit exactly the one that was opened. */
export function PlanEditor({ ctx, sessionId, target }: PlanEditorProps): React.JSX.Element {
  const [plans, setPlans] = useState<readonly PlanView[] | undefined>(undefined);
  const [cards, setCards] = useState<readonly CardView[]>([]);
  const [materials, setMaterials] = useState<readonly MaterialView[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [draft, setDraft] = useState<CampaignDraft>({ title: '', tags: '', dailyCount: '10', start: '', end: '', cards: [] });
  const [skeleton, setSkeleton] = useState<readonly SkeletonNode[]>([]);
  const [bookDate, setBookDate] = useState('');
  const [bookChapter, setBookChapter] = useState('');
  const [preview, setPreview] = useState<PlanContent | undefined>(undefined);
  const [latest, setLatest] = useState<PlanView | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const ids = useRef<{ signature: string; value: string }>({ signature: '', value: '' });
  const bound = sessionId === undefined ? {} : { sessionId };

  const loadList = useCallback(async (): Promise<readonly PlanView[] | undefined> => {
    try {
      const [list, cardList, materialList] = await Promise.all([
        ctx.remote.studyforgeOrganization.plans(bound),
        ctx.remote.studyforgeLearning.cards(),
        ctx.remote.studyforgeMaterials.list(),
      ]);
      if (!list.ok) { setNotice('计划暂时读不出来。'); return undefined; }
      setPlans(list.value);
      setCards(cardList.ok ? cardList.value : []);
      setMaterials(materialList.ok ? materialList.value : []);
      setNotice('');
      return list.value;
    } catch { setNotice('计划暂时读不出来。'); return undefined; }
  }, [ctx, sessionId]);

  useEffect(() => { void loadList(); }, [loadList]);

  function operationId(signature: string): string {
    if (ids.current.signature === signature && ids.current.value !== '') return ids.current.value;
    const value = crypto.randomUUID();
    ids.current = { signature, value };
    return value;
  }

  const readTarget = useCallback(async (ref: string): Promise<PlanView | undefined> => {
    try {
      const reply = await ctx.remote.studyforgeOrganization.plan({ ref, ...bound });
      if (!reply.ok) { setNotice(REFUSAL_COPY[refusalCode(reply.error)] ?? '这份计划读不出来。'); return undefined; }
      return reply.value;
    } catch { setNotice('这份计划读不出来。'); return undefined; }
  }, [ctx, sessionId]);

  /**
   * Entering one exact target: read it first, then open its own editor. A
   * target that no longer exists says so instead of silently falling back to
   * "some plan", because a stale link must never retarget the student's edit.
   */
  useEffect(() => {
    if (target === undefined) return;
    let live = true;
    void (async () => {
      const view = await readTarget(target);
      if (!live) return;
      if (view === undefined) { setMode({ kind: 'list' }); return; }
      if (view.content.kind === 'campaign') await openCampaign(view);
      else await openBook(view);
    })();
    return () => { live = false; };
  }, [target, readTarget]);

  async function openCampaign(target: PlanView | null): Promise<void> {
    setPreview(undefined); setLatest(target ?? undefined); setNotice('');
    if (target === null || target.content.kind !== 'campaign') {
      setDraft({ title: '', tags: '', dailyCount: '10', start: '', end: '', cards: [] });
      setMode({ kind: 'campaign', target });
      return;
    }
    const content = target.content;
    setDraft({
      title: content.title, tags: content.tags.join('、'), dailyCount: String(content.dailyCount),
      start: content.start, end: content.end, cards: content.cards,
    });
    setMode({ kind: 'campaign', target });
  }

  async function openBook(target: PlanView): Promise<void> {
    setPreview(undefined); setLatest(target); setNotice(''); setBookDate(''); setBookChapter(''); setSkeleton([]);
    setMode({ kind: 'book', target });
    if (target.content.kind !== 'book') return;
    try {
      const reply = await ctx.remote.studyforgeMaterials.skeleton({ materialId: target.content.materialId });
      setSkeleton(reply.ok ? reply.value.nodes : []);
    } catch { setSkeleton([]); }
  }

  function campaignPatch(): PlanPatch {
    return {
      title: draft.title.trim(),
      tags: draft.tags.split(/[、,，\s]+/u).filter(item => item !== ''),
      dailyCount: Number(draft.dailyCount),
      start: draft.start,
      end: draft.end,
      cards: [...draft.cards],
    };
  }

  async function checkCampaign(): Promise<void> {
    setBusy(true); setNotice('');
    try {
      const patch = campaignPatch();
      const target = mode.kind === 'campaign' ? mode.target : null;
      if (target === null) {
        const content: PlanContent = { kind: 'campaign', title: patch.title ?? '', learningSetRef: null, tags: patch.tags ?? [], cards: patch.cards ?? [], dailyCount: patch.dailyCount ?? 10, start: patch.start ?? '', end: patch.end ?? '', schedule: [] };
        const reply = await ctx.remote.studyforgeOrganization.checkPlan({ plan: content, ...bound });
        if (reply.ok) { setPreview(reply.value); setLatest(undefined); return; }
        setNotice(REFUSAL_COPY[refusalCode(reply.error)] ?? '这份计划还差一点，先看看提示。');
        return;
      }
      // The preview *is* what would be written, so it is only honest against the
      // revision that is really stored now. Reading first turns a stale draft into
      // the same "刚被别人改过" answer a save would give, shows the newest version,
      // and leaves the next check running on the revision that was just read.
      const fresh = await readTarget(target.ref);
      if (fresh === undefined) return;
      if (fresh.version !== target.version) {
        // Show the newest revision and keep this editor's own baseline: nothing is
        // rebased behind the student's back, so a draft read before another writer's
        // save can never silently overwrite it. Adopting the new baseline is the
        // explicit button below.
        setPreview(undefined); setLatest(fresh);
        setNotice(REFUSAL_COPY.plan_conflict ?? '这份计划刚被别人改过，最新的一版在下面；你的草稿还在，要用它接着改就先换成最新这一版。');
        return;
      }
      const reply = await ctx.remote.studyforgeOrganization.previewPlan({ ref: target.ref, expectedVersion: target.version, patch, ...bound });
      if (reply.ok) { setPreview(reply.value); setLatest(undefined); return; }
      // A refusal can still race the read above (another writer landed between the
      // two calls): read again and show the revision the save would have to use.
      const newest = await readTarget(target.ref);
      if (newest !== undefined) setLatest(newest);
      setNotice(REFUSAL_COPY[refusalCode(reply.error)] ?? '这份计划还差一点，先看看提示。');
    } catch { setNotice('这次没能检查，请再试一次。'); }
    finally { setBusy(false); }
  }

  async function saveCampaign(): Promise<void> {
    setBusy(true); setNotice('');
    try {
      const target = mode.kind === 'campaign' ? mode.target : null;
      if (target === null) {
        if (preview === null || preview === undefined || preview.kind !== 'campaign') return;
        const reply = await ctx.remote.studyforgeOrganization.createPlan({ operationId: operationId('plan-create:' + JSON.stringify(preview)), plan: preview, ...bound });
        if (reply.ok) { setPreview(undefined); setMode({ kind: 'list' }); await loadList(); return; }
        setNotice(REFUSAL_COPY[refusalCode(reply.error)] ?? '这次没存上，请再试一次。');
        return;
      }
      const reply = await ctx.remote.studyforgeOrganization.editPlan({ operationId: operationId('plan-edit:' + target.ref + ':' + JSON.stringify(campaignPatch())), ref: target.ref, expectedVersion: target.version, patch: campaignPatch(), ...bound });
      if (reply.ok) { setPreview(undefined); setMode({ kind: 'list' }); await loadList(); return; }
      // The draft survives, but the confirmation that was shown no longer matches
      // what would be written. The newest revision is only *shown*: the baseline
      // moves when the student presses the explicit button, never here.
      setPreview(undefined);
      const fresh = await readTarget(target.ref);
      if (fresh !== undefined) setLatest(fresh);
      setNotice(REFUSAL_COPY[refusalCode(reply.error)] ?? '这次没存上，请再试一次。');
    } catch { setNotice('这次没存上，请再试一次。'); }
    finally { setBusy(false); }
  }

  /**
   * The student's own decision to keep the draft and move to the revision they
   * were just shown. Until this is pressed, the editor keeps its original
   * baseline, so a next save can only be refused again — never overwrite.
   */
  function adoptLatest(): void {
    if (latest === undefined) return;
    setPreview(undefined);
    setMode({ kind: 'campaign', target: latest });
    setNotice('');
  }

  async function appendBookEntry(): Promise<void> {
    if (mode.kind !== 'book' || mode.target.content.kind !== 'book') return;
    const chapter = skeleton.find(node => node.path === bookChapter);
    if (chapter === undefined || bookDate === '') { setNotice('先选一天、再选一章。'); return; }
    const patch: PlanPatch = { entries: [...mode.target.content.entries, { date: bookDate, chapter: chapter.path, sources: chapter.sources }] };
    setBusy(true); setNotice('');
    try {
      const reply = await ctx.remote.studyforgeOrganization.editPlan({ operationId: operationId('plan-append:' + mode.target.ref + ':' + JSON.stringify(patch)), ref: mode.target.ref, expectedVersion: mode.target.version, patch, ...bound });
      if (reply.ok) { setMode({ kind: 'book', target: reply.value }); setLatest(reply.value); setBookDate(''); setBookChapter(''); await loadList(); return; }
      const fresh = await readTarget(mode.target.ref);
      if (fresh !== undefined) { setMode({ kind: 'book', target: fresh }); setLatest(fresh); }
      setNotice(REFUSAL_COPY[refusalCode(reply.error)] ?? '这一行没加上，请再试一次。');
    } catch { setNotice('这一行没加上，请再试一次。'); }
    finally { setBusy(false); }
  }

  if (plans === undefined) {
    return <section className="sf-plan-editor" data-testid="plan-editor">
      <h3>计划</h3>
      <p className="sf-note" role="status">正在看你的计划…</p>
    </section>;
  }

  if (mode.kind === 'list') {
    return <section className="sf-plan-editor" data-testid="plan-editor">
      {plans.length === 0 && <p className="sf-note" data-testid="plan-empty">暂无复习安排</p>}
      <ul className="sf-plan-list sf-linear-tree" data-testid="plan-list">
        {plans.map(plan => <li key={plan.ref} className="sf-plan-row" data-testid="plan-row" data-plan-ref={plan.ref} data-plan-version={String(plan.version)}>
          <button type="button" className="sf-plan-open" data-testid="plan-row-open"
            onClick={() => { void (plan.content.kind === 'campaign' ? openCampaign(plan) : openBook(plan)); }}>
            <span>{plan.content.title}</span>
          </button>
          <span className="sf-meta" data-testid="plan-row-kind">{plan.content.kind === 'campaign' ? '复习计划' : '书的安排'} · 第 {plan.version} 版</span>
        </li>)}
      </ul>
      <div className="sf-plan-editor-actions">
        <button type="button" className="sf-action" data-testid="plan-create-campaign" disabled={busy} onClick={() => { void openCampaign(null); }}>安排复习</button>
        {plans.length > 0 && <button type="button" className="sf-quiet" data-testid="plan-refresh" onClick={() => { void loadList(); }}>刷新</button>}
      </div>
      {notice !== '' && <p className="sf-notice" role="status" data-testid="plan-notice">{notice}</p>}
    </section>;
  }

  if (mode.kind === 'campaign') {
    return <section className="sf-plan-editor" data-testid="plan-editor">
      <h3 data-testid="plan-editor-heading">{mode.target === null ? '排一份复习计划' : '改这份复习计划'}</h3>
      {mode.target !== null && <p className="sf-meta" data-testid="plan-editor-target" data-plan-ref={mode.target.ref}>这份计划 · 第 {mode.target.version} 版</p>}
      <label>名字 <input data-testid="plan-editor-title" value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); }} /></label>
      <label>标签（用顿号隔开） <input data-testid="plan-editor-tags" value={draft.tags} onChange={event => { setDraft({ ...draft, tags: event.target.value }); }} /></label>
      <label>每天几张 <input type="number" min={1} data-testid="plan-editor-daily" value={draft.dailyCount} onChange={event => { setDraft({ ...draft, dailyCount: event.target.value }); }} /></label>
      <label>从哪天 <input type="date" data-testid="plan-editor-start" value={draft.start} onChange={event => { setDraft({ ...draft, start: event.target.value }); }} /></label>
      <label>到哪天 <input type="date" data-testid="plan-editor-end" value={draft.end} onChange={event => { setDraft({ ...draft, end: event.target.value }); }} /></label>
      <fieldset>
        <legend>要在计划里的卡</legend>
        <p className="sf-note">没点名的时段按当天到期卡自由取；点名了的就按点名的来，不往后顺延。</p>
        <ul className="sf-route-materials sf-linear-tree" data-testid="plan-editor-cards">
          {draft.cards.map(ref => <li key={ref}>
            <span className="sf-route-material-label">{cards.find(card => card.ref === ref)?.content.title ?? ref}</span>
            <button type="button" className="sf-quiet" data-testid="plan-editor-card-remove" onClick={() => { setDraft({ ...draft, cards: draft.cards.filter(item => item !== ref) }); }}>去掉</button>
          </li>)}
        </ul>
        <select data-testid="plan-editor-card-add" defaultValue="" onChange={event => {
          const value = event.target.value;
          if (value !== '' && !draft.cards.includes(value)) setDraft({ ...draft, cards: [...draft.cards, value] });
          event.target.value = '';
        }}>
          <option value="">加一张卡…</option>
          {cards.map(card => <option key={card.ref} value={card.ref}>{card.content.title}</option>)}
        </select>
      </fieldset>
      {preview !== undefined && <div className="sf-plan-preview" data-testid="plan-preview">
        <h4>确认后就是这样</h4>
        <ul>{describe(preview).map(line => <li key={line}>{line}</li>)}</ul>
      </div>}
      {latest !== undefined && <div className="sf-plan-latest" data-testid="plan-editor-latest">
        <h4>最新的一版</h4>
        <ul>{describe(latest.content).map(line => <li key={line}>{line}</li>)}</ul>
        {mode.target !== null && latest.version !== mode.target.version
          ? <>
            <p className="sf-note">你的草稿还在上面；要用它接着这一版存，先明确把基线换成这一版。</p>
            <button type="button" className="sf-quiet" data-testid="plan-editor-rebase" disabled={busy} onClick={adoptLatest}>保留我的草稿，改在最新这一版上</button>
          </>
          : <p className="sf-note">你的草稿还在上面，改完再确认就是接着这一版存。</p>}
      </div>}
      <div className="sf-plan-editor-actions">
        <button type="button" className="sf-action sf-action-quiet" data-testid="plan-editor-check" disabled={busy} onClick={() => { void checkCampaign(); }}>先检查一遍</button>
        <button type="button" className="sf-action" data-testid="plan-editor-save" disabled={busy || preview === undefined} onClick={() => { void saveCampaign(); }}>{mode.target === null ? '确认排上' : '确认保存'}</button>
        <button type="button" className="sf-quiet" data-testid="plan-editor-cancel" onClick={() => { setMode({ kind: 'list' }); setPreview(undefined); setLatest(undefined); setNotice(''); }}>先不改</button>
      </div>
      {notice !== '' && <p className="sf-notice" role="status" data-testid="plan-editor-notice">{notice}</p>}
    </section>;
  }

  const book = mode.target.content;
  return <section className="sf-plan-editor" data-testid="plan-editor">
    <h3 data-testid="plan-editor-heading">这份书的安排</h3>
    <p className="sf-meta" data-testid="plan-editor-target" data-plan-ref={mode.target.ref}>这份书的安排 · 第 {mode.target.version} 版</p>
    <ul className="sf-plan-list sf-linear-tree" data-testid="plan-book-entries">
      {book.kind === 'book' && book.entries.map(entry => <li key={`${entry.date}:${entry.chapter ?? ''}`} className="sf-plan-row" data-testid="plan-book-entry">
        <span>{dayLabel(entry.date)}</span><span className="sf-meta">{entry.chapter ?? '未分章'}</span>
      </li>)}
    </ul>
    <fieldset>
      <legend>再加一行</legend>
      <label>哪天 <input type="date" data-testid="plan-book-date" value={bookDate} onChange={event => { setBookDate(event.target.value); }} /></label>
      <label>哪一章
        <select data-testid="plan-book-chapter" value={bookChapter} onChange={event => { setBookChapter(event.target.value); }}>
          <option value="">选一章…</option>
          {skeleton.map(node => <option key={node.path} value={node.path}>{node.path}</option>)}
        </select>
      </label>
      {skeleton.length === 0 && <p className="sf-note">这本书还没有骨架，先去资料页整理出章节，再回来排。</p>}
    </fieldset>
    <div className="sf-plan-editor-actions">
      <button type="button" className="sf-action" data-testid="plan-book-append" disabled={busy || skeleton.length === 0} onClick={() => { void appendBookEntry(); }}>加上这一行</button>
      <button type="button" className="sf-quiet" data-testid="plan-editor-cancel" onClick={() => { setMode({ kind: 'list' }); setNotice(''); }}>先不改</button>
    </div>
    {notice !== '' && <p className="sf-notice" role="status" data-testid="plan-editor-notice">{notice}</p>}
  </section>;
}

/** The exact stored shape, spelled out so the student confirms what really saves. */
function describe(content: PlanContent): string[] {
  if (content.kind === 'campaign') {
    return [
      `名字：${content.title}`,
      `起止：${dayLabel(content.start)} → ${dayLabel(content.end)}`,
      `每天：${String(content.dailyCount)} 张`,
      `标签：${content.tags.length === 0 ? '（无）' : content.tags.join('、')}`,
      `点名的卡：${content.cards.length === 0 ? '按当天到期自由取' : String(content.cards.length) + ' 张'}`,
      `已排的具体日子：${content.schedule.length === 0 ? '（无）' : content.schedule.map(day => dayLabel(day.date)).join('、')}`,
    ];
  }
  return [`书名：${content.title}`, `已排：${String(content.entries.length)} 行`];
}
