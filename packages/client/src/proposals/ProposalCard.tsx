/**
 * P5.3 one persisted confirmation, shown as the student's own desk copy.
 *
 * A proposal is not a message: it is a stored item list with its own version,
 * and confirming says *which draft revision and digest* the student is looking
 * at. So this card renders the current draft together with the teacher's
 * original (the first draft is never overwritten), and every decision sends the
 * exact revision it displayed — a newer draft shows as a newer current draft
 * instead of being confirmed by accident.
 *
 * Saving and delivery are two real outcomes: an applied item shows the revision
 * it really wrote, and a receipt that was not delivered yet stays visible and
 * retryable. Nothing here writes a card itself; the Host's effect writer does
 * that, and its failure — including "this may already have been written" — is
 * shown as it is instead of being retried as a fresh edit.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CardContent } from '@studyforge/contracts/cards';
import type { ProposalEffect, ProposalItemView, ProposalSelection, ProposalView } from '@studyforge/contracts/proposals';
import { useEffect, useState } from 'react';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { OrganizationDraftEditor, isOrganizationDraft, type OrganizationMaterialOption, type OrganizationCardOption } from './OrganizationDraftEditor.tsx';
import { useStableOperationId, attemptKey } from '../cards/attempt.ts';
import { MarkdownBody } from '../cards/MarkdownBody.tsx';
import { cardFieldLabel, PRESENTATION_LABELS } from '../cards/format.ts';

export interface ProposalCardProps {
  readonly ctx: Context;
  readonly proposal: ProposalView;
  /** The newest proposal read, after any decision this card made. */
  readonly onChanged?: (view: ProposalView) => void;
}

type Busy = { readonly kind: 'decide' | 'edit' | 'deliver'; readonly item?: string } | undefined;

/** One confirmation: the drafts, the decisions, and what really happened. */
export function ProposalCard({ ctx, proposal, onChanged }: ProposalCardProps): React.JSX.Element {
  const [busy, setBusy] = useState<Busy>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [showOriginal, setShowOriginal] = useState(false);
  const [recheckedSkeleton, setRecheckedSkeleton] = useState<{ version: number; paths: string[] }>();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<{ title: string; front: string; back: string; body: string }>({ title: '', front: '', back: '', body: '' });
  const operationFor = useStableOperationId();
  const [catalogue, setCatalogue] = useState<{ materials: OrganizationMaterialOption[]; cards: OrganizationCardOption[]; teaching: TeachingChoice[] }>();
  useEffect(() => {
    if (!editing || !proposal.items.some(item => item.id === editing && isOrganizationDraft(item.draft.effect.kind))) return;
    let live = true;
    // The teaching list is the Host's own installed set, so the choice shows a
    // real title; without it the field still keeps whatever the proposal said.
    void Promise.all([ctx.remote.studyforgeMaterials.list(), ctx.remote.studyforgeLearning.cards(), ctx.remote.studyforgeTeaching.choices()])
      .then(([materials, cards, teaching]) => {
        if (!live) return;
        if (materials.ok && cards.ok) setCatalogue({ materials: materials.value, cards: cards.value, teaching: teaching.ok ? teaching.value : [] });
        else setNotice('可选资料暂时无法读取，请关闭后重试，草稿仍在。');
      }).catch(() => { if (live) setNotice('可选资料暂时无法读取，请关闭后重试。'); });
    return () => { live = false; };
  }, [ctx, editing]);

  const pending = proposal.items.filter(item => item.status === 'pending');
  const live = proposal.items.filter(item => item.status === 'applied' || item.status === 'failed');

  function take(view: ProposalView): void {
    if (onChanged !== undefined) onChanged(view);
  }

  /** The selection is exactly what is on screen: revision, digest, target, baseline. */
  function selectionOf(items: readonly ProposalItemView[], view = proposal): ProposalSelection {
    return {
      revision: view.version,
      items: items.map(item => ({
        itemId: item.id, draft: item.draft.revision, digest: item.draft.digest,
        target: item.target, baseline: item.baseline,
      })),
    };
  }

  async function decide(kind: 'confirm' | 'reject', items: readonly ProposalItemView[]): Promise<void> {
    if (items.length === 0) return;
    setBusy({ kind: 'decide' });
    setNotice(undefined);
    const selection = selectionOf(items);
    const input = { operationId: operationFor(attemptKey(kind, proposal.ref, JSON.stringify(selection))), target: proposal.ref, selection };
    try {
    const result = kind === 'confirm'
      ? await ctx.remote.studyforgeProposals.confirm(input)
      : await ctx.remote.studyforgeProposals.reject(input);
    setBusy(undefined);
    if (!result.ok) { setNotice(decisionFailureCopy(result.error.message)); return; }
    take(result.value);
    } catch { setNotice('暂时没有收到结果，再试会继续同一次确认。'); }
    finally { setBusy(undefined); }
  }

  async function retryDelivery(): Promise<void> {
    setBusy({ kind: 'deliver' });
    setNotice(undefined);
    const result = await ctx.remote.studyforgeProposals.retryDelivery({ target: proposal.ref });
    setBusy(undefined);
    if (!result.ok) { setNotice('回执还没有送出去，稍后再试一次。'); return; }
    take(result.value);
    setNotice('回执已经送出。');
  }

  /** Explicitly rebase an unchanged draft; checking never confirms the new draft. */
  async function recheckSkeleton(displayed: ProposalItemView): Promise<void> {
    setBusy({ kind: 'edit', item: displayed.id });
    setNotice(undefined);
    try {
      const read = await ctx.remote.studyforgeProposals.read({ target: proposal.ref });
      if (!read.ok) { setNotice('暂时读不到这份草案，请稍后重新检查。'); return; }
      let view = read.value, item = view.items.find(row => row.id === displayed.id);
      if (!item || view.version !== proposal.version) { take(view); setNotice('草案已有变化，请看过最新内容再决定。'); return; }
      if (!isSkeletonConflict(item)) { take(view); return; }
      // Recover old record_exists/unknown records through the same effect
      // operation. Only the writer can resolve whether it actually committed.
      if (item.failure?.commit === 'unknown') {
        const checked = await ctx.remote.studyforgeProposals.confirm({ operationId: operationFor(attemptKey('check-skeleton-result', view.ref, String(view.version))),
          target: view.ref, selection: selectionOf([item], view) });
        if (!checked.ok) { setNotice(decisionFailureCopy(checked.error.message)); return; }
        view = checked.value; take(view); item = view.items.find(row => row.id === displayed.id);
      }
      if (!item || item.status !== 'failed' || item.failure?.commit !== 'none' || item.draft.effect.kind !== 'skeleton-save') return;
      const effect = item.draft.effect;
      const current = await ctx.remote.studyforgeMaterials.skeleton({ materialId: effect.materialId });
      if (!current.ok) { setNotice('暂时读不到当前目录，草案还在，请稍后重新检查。'); return; }
      const baseline = current.value.revision ?? 0;
      const preview = await ctx.remote.studyforgeOrganization.previewSkeleton({ materialId: effect.materialId, version: baseline, change: effect.change });
      if (!preview.ok || preview.value.requiresDetach) { setNotice('这份草案与当前目录仍有冲突，原稿已保留，请调整内容后再保存。'); return; }
      const edited = await ctx.remote.studyforgeProposals.edit({ operationId: operationFor(attemptKey('recheck-skeleton', view.ref, String(view.version), String(baseline))),
        target: view.ref, expectedVersion: view.version, edit: { itemId: item.id, target: item.target, baseline, effect } });
      if (!edited.ok) { setNotice(editFailureCopy(edited.error.message)); return; }
      setRecheckedSkeleton({ version: edited.value.version, paths: preview.value.nodes.map(node => node.path) });
      take(edited.value);
      setNotice('已按当前目录重新检查。请核对合并后的目录，再决定是否保存。');
    } catch { setNotice('暂时没有收到检查结果，草案仍保留，请稍后重新检查。'); }
    finally { setBusy(undefined); }
  }

  function startEditing(item: ProposalItemView): void {
    const effect = item.draft.effect;
    const content = effect.kind === 'card-create' ? effect.content : undefined;
    const summary = effect.kind === 'handoff' ? effect.draft : effect.kind === 'handoff-edit' ? effect.correction : undefined;
    setEditing(item.id);
    setNotice(undefined);
    setDraft({
      title: content?.title ?? summary?.title ?? '',
      front: content?.front ?? '',
      back: sectionsToText(content?.sections ?? []),
      body: summary?.body ?? '',
    });
  }

  async function saveDraft(item: ProposalItemView): Promise<void> {
    const effect = revisedEffect(item.draft.effect, draft);
    if (effect === undefined) return;
    await saveEffect(item, effect);
  }
  async function saveEffect(item: ProposalItemView, effect: ProposalEffect): Promise<void> {
    setBusy({ kind: 'edit', item: item.id });
    try {
    const result = await ctx.remote.studyforgeProposals.edit({
      operationId: operationFor(attemptKey('proposal-edit', proposal.ref, String(proposal.version), item.id, JSON.stringify(effect))), target: proposal.ref, expectedVersion: proposal.version,
      edit: { itemId: item.id, effect },
    });
    setBusy(undefined);
    if (!result.ok) { setNotice(editFailureCopy(result.error.message)); return; }
    setEditing(undefined);
    take(result.value);
    } catch { setNotice('暂时没有收到保存结果。你的草稿还在，可以用同一版重试。'); }
    finally { setBusy(undefined); }
  }

  return <article className="sf-proposal" data-testid="proposal-card" data-proposal-status={statusOf(proposal)}>
    <header className="sf-proposal-head">
      <h3 data-testid="proposal-title">{proposal.title}</h3>
      <span className="sf-meta">{originLabel(proposal)} · 第 {String(proposal.version)} 版提案</span>
    </header>

    {pending.length > 1 && <div className="sf-proposal-bulk">
      <button type="button" className="sf-action" data-testid="proposal-confirm-all" disabled={busy !== undefined}
        onClick={() => { void decide('confirm', pending); }}>全部保存（{String(pending.length)} 项）</button>
    </div>}

    <ul className="sf-proposal-items" data-testid="proposal-items">
      {proposal.items.map(item => <li className="sf-proposal-item" key={item.id} data-item-status={item.status} data-testid="proposal-item">
        <div className="sf-proposal-item-head">
          <span className="sf-meta">{effectLabel(item.draft.effect)}</span>
          <span className="sf-proposal-status" data-testid="proposal-item-status">{statusCopy(item)}</span>
        </div>

        {item.draft.effect.kind === 'card-create' && editing !== item.id && <div className="sf-proposal-content" data-testid="proposal-content">
          <h4>{item.draft.effect.content.title}</h4>
          <span className="sf-meta">{PRESENTATION_LABELS[item.draft.effect.content.presentation]}</span>
          {item.draft.effect.content.front !== '' && <MarkdownBody text={item.draft.effect.content.front} testId="proposal-front" />}
          {item.draft.effect.content.sections.length > 0 && <MarkdownBody text={sectionsToText(item.draft.effect.content.sections)} testId="proposal-back" />}
        </div>}

        {item.draft.effect.kind === 'card-edit' && <div className="sf-proposal-content" data-testid="proposal-content">
          <span className="sf-meta">在原卡上改：{describePatch(item.draft.effect.patch).join('、')}</span>
          {item.draft.effect.patch.front !== undefined && <MarkdownBody text={item.draft.effect.patch.front} />}
          {item.draft.effect.patch.sections !== undefined
            && <MarkdownBody text={sectionsToText(item.draft.effect.patch.sections)} />}
        </div>}

        {(item.draft.effect.kind === 'set-create' || item.draft.effect.kind === 'set-edit'
          || item.draft.effect.kind === 'route-add' || item.draft.effect.kind === 'route-edit'
          || item.draft.effect.kind === 'plan-create' || item.draft.effect.kind === 'plan-edit'
          || item.draft.effect.kind === 'skeleton-save') && <OrganizationSummary effect={item.draft.effect} decidable={item.status === 'pending'} />}
        {item.draft.effect.kind === 'skeleton-save' && item.status === 'pending' && recheckedSkeleton?.version === proposal.version
          && <div data-testid="skeleton-recheck-preview" className="sf-proposal-content">
            <h4>保存后的目录预览</h4>
            <ul>{recheckedSkeleton.paths.map(path => <li key={path}>{path}</li>)}</ul>
          </div>}

        {(item.draft.effect.kind === 'handoff' || item.draft.effect.kind === 'handoff-edit')
          && <HandoffSummary effect={item.draft.effect} decidable={item.status === 'pending'} />}
        {item.draft.effect.kind === 'lesson-edit' && <LessonSummary effect={item.draft.effect} teachingChoices={catalogue?.teaching} />}

        {item.draft.effect.kind === 'knowledge-collect' && <p className="sf-note" data-testid="proposal-content">把这条知识收录为锦囊，不复制成第二张卡。</p>}
        {item.draft.effect.kind === 'review' && <p className="sf-note" data-testid="proposal-content">
          记一次复习：{item.draft.effect.record.mark} · {item.draft.effect.record.channel}{item.draft.effect.record.note === '' ? '' : ` · ${item.draft.effect.record.note}`}
        </p>}

        {editing === item.id && isOrganizationDraft(item.draft.effect.kind) && (catalogue
          ? <OrganizationDraftEditor key={item.id + ':' + item.draft.revision} effect={item.draft.effect} original={item.original.effect}
            materials={catalogue.materials} cards={catalogue.cards} teachingChoices={catalogue.teaching} pending={busy !== undefined} onSave={effect => { void saveEffect(item, effect); }} onCancel={() => setEditing(undefined)} />
          : <p role="status">正在读取可选资料…</p>)}
        {editing === item.id && !isOrganizationDraft(item.draft.effect.kind) && <form className="sf-proposal-edit" data-testid="proposal-editor"
          onSubmit={event => { event.preventDefault(); void saveDraft(item); }}>
          <label className="sf-field"><span>标题</span>
            <input data-testid="proposal-editor-title" value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); }} />
          </label>
          {isHandoff(item.draft.effect) ? <label className="sf-field"><span>小结正文</span>
            <textarea data-testid="proposal-editor-handoff-body" rows={6} value={draft.body}
              onChange={event => { setDraft({ ...draft, body: event.target.value }); }} />
          </label> : <>
          <label className="sf-field"><span>卡面</span>
            <textarea data-testid="proposal-editor-front" rows={3} value={draft.front} onChange={event => { setDraft({ ...draft, front: event.target.value }); }} />
          </label>
          <label className="sf-field"><span>卡背（用 ## 起小标题）</span>
            <textarea data-testid="proposal-editor-back" rows={6} value={draft.back} onChange={event => { setDraft({ ...draft, back: event.target.value }); }} />
          </label>
          </>}
          <div className="sf-conflict-actions">
            <button type="submit" className="sf-action" data-testid="proposal-editor-save" disabled={busy !== undefined}>存成我的这版</button>
            <button type="button" className="sf-quiet" data-testid="proposal-editor-cancel" onClick={() => { setEditing(undefined); }}>取消</button>
          </div>
        </form>}

        {item.draft.revision > 1 && editing !== item.id && <div className="sf-proposal-versions">
          <button type="button" className="sf-quiet" data-testid="proposal-show-original" onClick={() => { setShowOriginal(!showOriginal); }}>
            {showOriginal ? '收起老师原稿' : '看老师原稿'}
          </button>
          {showOriginal && <div className="sf-proposal-original" data-testid="proposal-original">
            <span className="sf-meta">老师最初提的（第 {String(item.original.revision)} 版）</span>
            {describeEffect(item.original.effect)}
          </div>}
        </div>}

        {item.receipt !== undefined && <p className="sf-note" data-testid="proposal-receipt">
          已经保存：《{item.receipt.title}》第 {String(item.receipt.revision)} 版。{item.receipt.deliveredAt === undefined ? '回执还没送出。' : '回执已经送出。'}
        </p>}
        {item.failure !== undefined && <p className="sf-notice" data-testid="proposal-failure">
          {isSkeletonConflict(item) ? '目录已更新，这份草案尚未保存。重新检查当前目录后，再确认增补内容。' : failureCopy(item.failure.code, item.failure.commit)}
        </p>}

        <div className="sf-proposal-actions">
          {item.status === 'pending' && editing !== item.id && <>
            <button type="button" className="sf-action" data-testid="proposal-confirm" disabled={busy !== undefined}
              onClick={() => { void decide('confirm', [item]); }}>保存这一项</button>
            {isEditable(item.draft.effect) && <button type="button" className="sf-quiet" data-testid="proposal-edit"
              disabled={busy !== undefined} onClick={() => { startEditing(item); }}>改一下再说</button>}
            <button type="button" className="sf-quiet" data-testid="proposal-reject" disabled={busy !== undefined}
              onClick={() => { void decide('reject', [item]); }}>不要这一项</button>
          </>}
          {item.status === 'failed' && (isSkeletonConflict(item)
            ? <button type="button" className="sf-action" data-testid="proposal-recheck-skeleton" disabled={busy !== undefined}
              onClick={() => { void recheckSkeleton(item); }}>重新检查目录</button>
            : <button type="button" className="sf-action" data-testid="proposal-retry" disabled={busy !== undefined}
              onClick={() => { void decide('confirm', [item]); }}>重新确认保存结果</button>)}
          {item.status === 'applied' && item.receipt?.deliveredAt === undefined
            && <button type="button" className="sf-quiet" data-testid="proposal-redeliver" disabled={busy !== undefined}
              onClick={() => { void retryDelivery(); }}>重新送一次回执</button>}
        </div>
      </li>)}
    </ul>

    {live.length === 0 && <p className="sf-note">还没有保存的项。</p>}
    {proposal.items.every(item => item.status === 'applied') && <p className="sf-note" data-testid="proposal-done">这份提案已经全部保存。</p>}
    {notice !== undefined && <p className="sf-notice" role="status" data-testid="proposal-notice">{notice}</p>}
  </article>;
}

/** The whole proposal's own state, for one glance. */
function statusOf(proposal: ProposalView): string {
  if (proposal.items.every(item => item.status === 'applied')) return 'applied';
  if (proposal.items.every(item => item.status === 'rejected')) return 'rejected';
  if (proposal.items.some(item => item.status === 'failed')) return 'failed';
  return 'pending';
}

/** One item's state, in the student's words. */
function statusCopy(item: ProposalItemView): string {
  switch (item.status) {
    case 'pending': return '等你决定';
    case 'applied': return '已经保存';
    case 'rejected': return '已经不要了';
    case 'failed': return isSkeletonConflict(item) || item.failure?.commit === 'none' ? '尚未保存' : '保存结果待核实';
  }
}

function isSkeletonConflict(item: ProposalItemView): boolean {
  return item.status === 'failed' && item.draft.effect.kind === 'skeleton-save'
    && ['record_exists', 'version_conflict', 'skeleton_version_conflict'].includes(item.failure?.code ?? '');
}

function originLabel(proposal: ProposalView): string {
  return proposal.origin.kind === 'native' ? '这节课上老师提的' : '老师提的';
}

function effectLabel(effect: ProposalEffect): string {
  switch (effect.kind) {
    case 'card-create': return '新卡片';
    case 'card-edit': return '修改卡片';
    case 'knowledge-collect': return '收录知识';
    case 'review': return '复习记录';
    case 'set-create': return '新建学习集';
    case 'set-edit': return '调整学习集';
    case 'route-add': return '排一节课';
    case 'route-edit': return '改一节课';
    case 'plan-create': return '排计划';
    case 'plan-edit': return '改计划';
    case 'skeleton-save': return '整理书籍结构';
    case 'handoff': return '课后小结';
    case 'handoff-edit': return '更正小结';
    case 'lesson-edit': return '调整本课';
  }
}

/** What one older draft asked for; only ever shown as the teacher's own text. */
function describeEffect(effect: ProposalEffect): React.JSX.Element {
  switch (effect.kind) {
    case 'card-create': return <div className="sf-proposal-content">
      <h4>{effect.content.title}</h4>
      {effect.content.front !== '' && <MarkdownBody text={effect.content.front} />}
      {effect.content.sections.length > 0 && <MarkdownBody text={sectionsToText(effect.content.sections)} />}
    </div>;
    case 'card-edit': return <span className="sf-meta">{describePatch(effect.patch).join('、')}</span>;
    case 'knowledge-collect': return <span className="sf-meta">收录为锦囊</span>;
    case 'review': return <span className="sf-meta">{effect.record.mark} · {effect.record.channel}</span>;
    case 'set-create':
    case 'set-edit':
    case 'route-add':
    case 'route-edit':
    case 'plan-create':
    case 'plan-edit':
    case 'skeleton-save':
      return <OrganizationSummary effect={effect} />;
    case 'handoff':
    case 'handoff-edit':
      return <HandoffSummary effect={effect} bodyTestId="proposal-original-handoff-body" />;
    case 'lesson-edit': return <LessonSummary effect={effect} />;
  }
}
function LessonSummary({ effect, teachingChoices }: { effect: Extract<ProposalEffect, { kind: 'lesson-edit' }>; teachingChoices?: readonly TeachingChoice[] | undefined }): React.JSX.Element {
  const p = effect.patch;
  const builtIn: Record<string, string> = { organize: '资料整理', diagnose: '诊断分析', socratic: '苏格拉底授课', brainstorm: '头脑风暴拓展', search: '搜索' };
  const teachingName = (id: string): string => teachingChoices?.find(choice => choice.id === id)?.title ?? builtIn[id] ?? '所选教学配置';
  return <div className="sf-proposal-content" data-testid="proposal-lesson-summary"><h4>调整这节课的设置</h4>
    {p.lessonMaterials !== undefined && <p data-testid="proposal-lesson-materials">采用 {p.lessonMaterials.materials.length} 项资料；{p.lessonMaterials.materials.length ? '顺序和默认项按这版保存。' : '从当前讨论继续。'}</p>}
    {p.learningSetRef !== undefined && <p data-testid="proposal-lesson-set">{p.learningSetRef ? '调整所属学习集。' : '这节课不指定学习集。'}</p>}
    {p.teachingRef !== undefined && <p data-testid="proposal-lesson-teaching">教学方式：{teachingName(p.teachingRef)}</p>}
    {p.stance !== undefined && <p data-testid="proposal-lesson-stance">本课重点：{p.stance === '' ? '清除原来的重点。' : p.stance}</p>}
    {p.temporaryInstructions !== undefined && (p.temporaryInstructions === ''
      ? <p data-testid="proposal-lesson-instructions">清除本课临时要求。</p>
      : <MarkdownBody text={p.temporaryInstructions} />)}
  </div>;
}

/**
 * A handoff is the teacher's own prose about a lesson, so it reads as prose:
 * the short title and the real body, with the same "keep it or drop it" rule as
 * the organisation kinds. Nothing about the cutoff, the snapshots or the pinned
 * continuation version is shown — those are Host facts, not the student's call.
 */
type HandoffEffect = Extract<ProposalEffect, { kind: 'handoff' | 'handoff-edit' }>;

function isHandoff(effect: ProposalEffect): effect is HandoffEffect {
  return effect.kind === 'handoff' || effect.kind === 'handoff-edit';
}

/** The kinds a student may reword before deciding; the rest are decided as they are. */
function isEditable(effect: ProposalEffect): boolean {
  return effect.kind === 'card-create' || isHandoff(effect) || isOrganizationDraft(effect.kind);
}

/**
 * The student's own revised draft of one item. A handoff spreads the frozen
 * effect back out unchanged: the cutoff, the system facts and the pinned
 * continuation are Host facts from the moment the teacher proposed, so a reworded
 * body never swaps in a newer list — the Host refuses that, and the confirm shows
 * exactly what the student accepted.
 */
function revisedEffect(effect: ProposalEffect, draft: { title: string; front: string; back: string; body: string }): ProposalEffect | undefined {
  if (effect.kind === 'card-create') return {
    kind: 'card-create',
    content: { ...effect.content, title: draft.title.trim(), front: draft.front, sections: textToSections(draft.back) },
  };
  if (effect.kind === 'handoff') return { ...effect, draft: { title: draft.title.trim(), body: draft.body } };
  if (effect.kind === 'handoff-edit') return {
    kind: 'handoff-edit',
    correction: { ...(draft.title.trim() === '' ? {} : { title: draft.title.trim() }), body: draft.body },
  };
  return undefined;
}

const HANDOFF_FACT_LABEL = { material: '课上用了', saved: '当时保存了', pending: '当时还没确认' } as const;

function HandoffSummary({ effect, decidable, bodyTestId = 'proposal-handoff-body' }: { readonly effect: HandoffEffect; readonly decidable?: boolean; readonly bodyTestId?: string }): React.JSX.Element {
  const title = effect.kind === 'handoff' ? effect.draft.title : effect.correction.title;
  const body = effect.kind === 'handoff' ? effect.draft.body : effect.correction.body;
  return <div className="sf-proposal-content" data-testid="proposal-content">
    <h4>课后小结{title === undefined ? '' : `「${title}」`}</h4>
    <MarkdownBody text={body} testId={bodyTestId} />
    {effect.kind === 'handoff' && effect.facts.length > 0 && <ul className="sf-proposal-lines" data-testid="proposal-handoff-facts">
      {effect.facts.map((fact, index) => <li key={`${String(index)}:${fact.kind}:${fact.title}`} className="sf-meta">
        {HANDOFF_FACT_LABEL[fact.kind]}《{fact.title}》
      </li>)}
    </ul>}
    {effect.kind === 'handoff' && <p className="sf-note" data-testid="proposal-handoff-frozen">
      这份小结写在老师提出来的时候，上面就是当时手上的东西；确认后一起收好，之后也不会被后来的动静替换。
    </p>}
    {decidable === true && <p className="sf-note" data-testid="proposal-no-detail-edit">
      {isEditable(effect) ? '可以改一下正文再决定，也可以整份不要。' : '还能整份保存或整份不要；里面的细节暂时改不了。'}
    </p>}
  </div>;
}

/**
 * P6's own kinds are organisation, not card text, so they read as names, dates
 * and counts. Ids, entity refs, teaching keys and raw JSON stay out of the
 * student's view: "2 份资料移进了这个集", never `materials_add: [...]`.
 */
type OrganizationEffect = Extract<ProposalEffect,
  { kind: 'set-create' | 'set-edit' | 'route-add' | 'route-edit' | 'plan-create' | 'plan-edit' | 'skeleton-save' }>;

function OrganizationSummary({ effect, decidable }: { readonly effect: OrganizationEffect; readonly decidable?: boolean }): React.JSX.Element {
  const block = organizationLines(effect);
  return <div className="sf-proposal-content" data-testid="proposal-content">
    <h4>{block.heading}</h4>
    {block.lines.length > 0 && <ul className="sf-proposal-lines">
      {block.lines.map((line, index) => <li key={`${String(index)}:${line}`} className="sf-meta">{line}</li>)}
    </ul>}
    {decidable === true && <p className="sf-note" data-testid="proposal-no-detail-edit">
      还能整份保存或整份不要；里面的细节暂时改不了。
    </p>}
  </div>;
}

function organizationLines(effect: OrganizationEffect): { heading: string; lines: string[] } {
  switch (effect.kind) {
    case 'set-create': return { heading: `学习集「${effect.content.name}」`, lines: setCreateLines(effect.content) };
    case 'set-edit': return { heading: '改这个学习集', lines: setPatchLines(effect.patch) };
    case 'route-add': return { heading: `排一节课：${effect.content.title}`, lines: routeNodeLines(effect.content) };
    case 'route-edit': return { heading: '改这一节课的安排', lines: routePatchLines(effect.patch) };
    case 'plan-create': return planCreateBlock(effect.content);
    case 'plan-edit': return { heading: '改这份计划', lines: planPatchLines(effect.patch) };
    case 'skeleton-save': return { heading: '整理这本书的结构', lines: skeletonChangeLines(effect.change) };
  }
}

type SetCreateContent = Extract<ProposalEffect, { kind: 'set-create' }>['content'];
type SetPatchContent = Extract<ProposalEffect, { kind: 'set-edit' }>['patch'];
type RouteNodeContent = Extract<ProposalEffect, { kind: 'route-add' }>['content'];
type RouteNodePatchContent = Extract<ProposalEffect, { kind: 'route-edit' }>['patch'];
type PlanContentValue = Extract<ProposalEffect, { kind: 'plan-create' }>['content'];
type PlanPatchContent = Extract<ProposalEffect, { kind: 'plan-edit' }>['patch'];
type SkeletonChangeContent = Extract<ProposalEffect, { kind: 'skeleton-save' }>['change'];
type LessonMaterialValue = RouteNodeContent['materials']['materials'][number];

function ladderCopy(ladder: readonly number[] | null): string {
  return ladder === null ? '用默认梯子' : `隔 ${ladder.join('、')} 天复习`;
}

function countCopy(count: number, unit: string): string {
  return `${String(count)} ${unit}`;
}

function setCreateLines(content: SetCreateContent): string[] {
  const lines = [ladderCopy(content.ladder)];
  if (content.subjects.length > 0) lines.push(`科目：${content.subjects.join('、')}`);
  if (content.materials.length > 0) lines.push(`先把 ${countCopy(content.materials.length, '份资料')}放进来`);
  return lines;
}

function setPatchLines(patch: SetPatchContent): string[] {
  const lines: string[] = [];
  if (patch.name !== undefined) lines.push(`名字改成「${patch.name}」`);
  if (patch.subjects !== undefined) lines.push(`科目改成 ${patch.subjects.length === 0 ? '不设' : patch.subjects.join('、')}`);
  if (patch.ladder !== undefined) lines.push(`复习梯子改成${ladderCopy(patch.ladder)}`);
  if (patch.materials_add.length > 0) lines.push(`放进 ${countCopy(patch.materials_add.length, '份资料')}`);
  if (patch.materials_remove.length > 0) lines.push(`移出 ${countCopy(patch.materials_remove.length, '份资料')}`);
  if (patch.members_add.length > 0) lines.push(`加进 ${countCopy(patch.members_add.length, '张卡')}`);
  if (patch.members_remove.length > 0) lines.push(`移出 ${countCopy(patch.members_remove.length, '张卡')}`);
  return lines.length === 0 ? ['没有实质改动'] : lines;
}

function routeNodeLines(content: RouteNodeContent): string[] {
  const lines: string[] = [];
  if (content.date !== null) lines.push(`安排在这一天：${content.date}`);
  const materials = materialLines(content.materials.materials);
  lines.push(materials.length === 0 ? '还没指定材料' : `材料：${materials.join('、')}`);
  const decl = declLine(content.decl);
  if (decl !== undefined) lines.push(decl);
  return lines;
}

function routePatchLines(patch: RouteNodePatchContent): string[] {
  const lines: string[] = [];
  if (patch.title !== undefined) lines.push(`标题改成「${patch.title}」`);
  if (patch.date !== undefined) lines.push(patch.date === null ? '去掉安排的日期' : `安排在这一天：${patch.date}`);
  if (patch.materials !== undefined) {
    const materials = materialLines(patch.materials.materials);
    lines.push(materials.length === 0 ? '材料改成不带材料' : `材料改成：${materials.join('、')}`);
  }
  if (patch.decl !== undefined) {
    const decl = patch.decl === null ? undefined : declLine(patch.decl);
    lines.push(decl ?? '清掉这节课的教学说明');
  }
  return lines.length === 0 ? ['没有实质改动'] : lines;
}

/** One planned position, in the words the student reads on their own shelf. */
function materialLines(materials: readonly LessonMaterialValue[]): string[] {
  return materials.map(material => {
    if (material.kind === 'card') return '一张卡';
    const locator = material.source.locator;
    if (locator === undefined) return '书里的一段';
    switch (locator.kind) {
      case 'pdf': return `书里第 ${String(locator.page)} 页`;
      case 'image': return '书里的一张图';
      case 'text': return `书里第 ${String(locator.start.line)} 行起`;
      case 'docx': return '文档里的一段';
    }
  });
}

function declLine(decl: RouteNodeContent['decl']): string | undefined {
  const parts: string[] = [];
  if (decl.name !== undefined) parts.push(`方式：${decl.name}`);
  if (decl.teachingRef !== undefined && decl.name === undefined) parts.push('教学方式已指定');
  if (decl.stance !== undefined) parts.push(`重点：${decl.stance}`);
  return parts.length === 0 ? undefined : parts.join(' · ');
}

function planCreateBlock(content: PlanContentValue): { heading: string; lines: string[] } {
  if (content.kind === 'book') {
    const lines = [`共 ${countCopy(content.entries.length, '天的安排')}`];
    return { heading: `排课：《${content.title}》`, lines };
  }
  const lines = [`每天 ${String(content.dailyCount)} 张`, `${content.start} 到 ${content.end}`];
  if (content.tags.length > 0) lines.push(`标签：${content.tags.join('、')}`);
  if (content.schedule.length > 0) lines.push(`其中 ${countCopy(content.schedule.length, '天')}已经排好具体卡片`);
  return { heading: `复习计划「${content.title}」`, lines };
}

function planPatchLines(patch: PlanPatchContent): string[] {
  const lines: string[] = [];
  if (patch.title !== undefined) lines.push(`标题改成「${patch.title}」`);
  if (patch.entries !== undefined) lines.push(`排课改成 ${countCopy(patch.entries.length, '天')}`);
  if (patch.learningSetRef !== undefined) lines.push(patch.learningSetRef === null ? '不再绑定学习集' : '换到另一个学习集');
  if (patch.tags !== undefined) lines.push(patch.tags.length === 0 ? '清掉标签' : `标签改成 ${patch.tags.join('、')}`);
  if (patch.cards !== undefined) lines.push(`卡片范围改成 ${countCopy(patch.cards.length, '张')}`);
  if (patch.dailyCount !== undefined) lines.push(`每天改成 ${String(patch.dailyCount)} 张`);
  if (patch.start !== undefined) lines.push(`开始日期：${patch.start}`);
  if (patch.end !== undefined) lines.push(`结束日期：${patch.end}`);
  if (patch.schedule !== undefined) lines.push(`具体排到 ${countCopy(patch.schedule.length, '天')}`);
  return lines.length === 0 ? ['没有实质改动'] : lines;
}

function skeletonChangeLines(change: SkeletonChangeContent): string[] {
  const lines: string[] = [];
  if (change.nodes.length > 0) {
    const shown = change.nodes.slice(0, 3).map(node => node.path).join('、');
    lines.push(change.nodes.length > 3 ? `新增这些节：${shown} 等 ${countCopy(change.nodes.length, '节')}` : `新增这些节：${shown}`);
  }
  if (change.replaceExisting) lines.push('用这份结构替换原来的结构');
  if (change.removePaths.length > 0) lines.push(`删掉 ${countCopy(change.removePaths.length, '节')}`);
  if (change.repath.length > 0) lines.push(`改 ${countCopy(change.repath.length, '条路径')}`);
  if (change.detachDependents) lines.push('同时放开原本挂在这些节上的卡');
  return lines.length === 0 ? ['没有实质改动'] : lines;
}

/** The patch's own field names, never the whole card. */
function describePatch(patch: unknown): string[] {
  const fields = Object.entries(patch as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && Array.isArray(value) ? value.length > 0 : true)
    .map(([key]) => fieldLabel(key));
  return fields.length === 0 ? ['没有实质改动'] : fields;
}

function fieldLabel(key: string): string {
  return cardFieldLabel(key);
}

/** The back as the student edits it: `## 小标题` blocks. */
export function sectionsToText(sections: readonly { heading: string; body: string }[]): string {
  return sections.map(section => `## ${section.heading}\n${section.body}`).join('\n\n');
}

/** Parse the same shape back; a heading-less block keeps its text under one heading. */
export function textToSections(text: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  let heading = '解法';
  let body: string[] = [];
  const flush = (): void => {
    const joined = body.join('\n').trim();
    if (joined !== '') sections.push({ heading, body: joined });
    body = [];
  };
  for (const line of text.split('\n')) {
    const match = /^##\s+(.+)$/u.exec(line.trim());
    if (match === null) { body.push(line); continue; }
    flush();
    heading = (match[1] ?? '解法').trim();
  }
  flush();
  return sections;
}

/** What a refused decision means for the next action. */
function decisionFailureCopy(message: string): string {
  if (/proposal_stale_confirmation/u.test(message)) return '你看到的那一版已经变了，先看一遍最新稿再决定。';
  if (/version_conflict/u.test(message)) return '这份提案刚在别处更新过，重新打开再决定。';
  if (/proposal_item_closed/u.test(message)) return '这一项已经决定了，不用再来一次。';
  if (/proposal_commit_unknown/u.test(message)) return '上次保存结果还未确定，请先重新确认保存结果。';
  return '这次没有决定成功，稍后再试一次。';
}

function editFailureCopy(message: string): string {
  if (/proposal_commit_unknown/u.test(message)) return '上次保存结果还未确定，请先重新确认保存结果，再修改草案。';
  if (/proposal_item_closed/u.test(message)) return '这一项已经决定了，改不了了。';
  if (/skeleton_version_conflict|目录已更新/u.test(message)) return '目录刚刚又有更新，请重新检查后再确认。';
  if (/proposal_expected_version_required|version_conflict/u.test(message)) return '提案刚在别处更新过，重新打开再改。';
  return '这一版没有存上，稍后再试一次。';
}

/** A failed effect, with the one thing the student has to know: written or not. */
function failureCopy(code: string, commit: 'none' | 'unknown'): string {
  if (commit === 'unknown') return '暂时无法确定保存结果。重新确认会核对这次操作，不会重复保存。';
  switch (code) {
    case 'card_version_conflict': return '要改的那张卡已经变了，先打开最新版再看一遍。';
    case 'card_math_invalid': return '正文里的公式写错了，改好再保存。';
    default: return '这一项这次没有写进去，可以再试一次。';
  }
}

/** CardContent's own shape is what the editor rewrites; kept local to the effect. */
export type ProposalCardContent = CardContent;
