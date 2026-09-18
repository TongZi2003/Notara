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
import { PRESENTATION_LABELS } from '../cards/format.ts';
import { AtlasSummary, SkeletonSummary } from './SkeletonSummary.tsx';
import { positionLabel } from '../materials/lesson-materials-mindmap.ts';

export interface ProposalCardProps {
  readonly ctx: Context;
  readonly proposal: ProposalView;
  /** The enclosing conversation disclosure already names this proposal. */
  readonly inline?: boolean;
  /** The newest proposal read, after any decision this card made. */
  readonly onChanged?: (view: ProposalView) => void;
}

type Busy = { readonly kind: 'decide' | 'edit' | 'deliver'; readonly item?: string } | undefined;
interface Catalogue {
  materials: OrganizationMaterialOption[];
  cards: OrganizationCardOption[];
  teaching: TeachingChoice[];
  sets: { ref: string; name: string }[];
}

/** One confirmation: the drafts, the decisions, and what really happened. */
export function ProposalCard({ ctx, proposal, inline = false, onChanged }: ProposalCardProps): React.JSX.Element {
  const [busy, setBusy] = useState<Busy>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [showOriginal, setShowOriginal] = useState<string>();
  const [recheckedSkeleton, setRecheckedSkeleton] = useState<{ version: number; paths: string[] }>();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState<{ title: string; front: string; back: string; body: string }>({ title: '', front: '', back: '', body: '' });
  const operationFor = useStableOperationId();
  const [catalogue, setCatalogue] = useState<Catalogue>();
  useEffect(() => {
    const needsNames = proposal.items.some(({ draft: { effect } }) => effect.kind !== 'card-create'
      || effect.content.sources.length > 0 || effect.content.links.length > 0);
    if (!editing && !needsNames) return;
    let live = true;
    // The teaching list is the Host's own installed set, so the choice shows a
    // real title; without it the field still keeps whatever the proposal said.
    void Promise.all([ctx.remote.studyforgeMaterials.list(), ctx.remote.studyforgeLearning.cards(), ctx.remote.studyforgeTeaching.choices(), ctx.remote.studyforgeOrganization.sets({})])
      .then(([materials, cards, teaching, sets]) => {
        if (!live) return;
        if (materials.ok && cards.ok) setCatalogue({ materials: materials.value, cards: cards.value, teaching: teaching.ok ? teaching.value : [], sets: sets.ok ? sets.value : [] });
        else setNotice('可选资料暂时无法读取，请关闭后重试，草稿仍在。');
      }).catch(() => { if (live) setNotice('可选资料暂时无法读取，请关闭后重试。'); });
    return () => { live = false; };
  }, [ctx, editing, proposal.ref]);

  const pending = proposal.items.filter(item => item.status === 'pending');
  const cardBatch = proposal.items.length > 1 && proposal.items.every(item => item.draft.effect.kind === 'card-create');
  const undecided = proposal.items.filter(item => item.status === 'pending' || item.status === 'failed');
  const selected = undecided.filter(item => !excluded.has(item.id));
  const savedCount = proposal.items.filter(item => item.status === 'applied').length;
  function toggle(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  function take(view: ProposalView): void {
    if (view.items.some(item => item.status === 'applied')) window.dispatchEvent(new Event('studyforge:learning-changed'));
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
    try {
      const result = await ctx.remote.studyforgeProposals.retryDelivery({ target: proposal.ref });
      if (!result.ok) { setNotice('保存结果还没通知老师，请稍后再试。'); return; }
      take(result.value);
      setNotice('保存结果已通知老师。');
    } catch { setNotice('保存结果还没通知老师，请稍后再试。'); }
    finally { setBusy(undefined); }
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
      title: content?.title ?? summary?.title ?? (effect.kind === 'teaching-override' ? effect.title : ''),
      front: content?.front ?? '',
      back: sectionsToText(content?.sections ?? []),
      body: summary?.body ?? (effect.kind === 'teaching-override' ? effect.body : ''),
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
    {!inline && <header className="sf-proposal-head">
      <h3 data-testid="proposal-title">{proposal.title}</h3>
    </header>}

    {cardBatch && <div className="sf-proposal-batch-bar" data-testid="proposal-batch-bar">
      <span>{proposal.items.length} 张卡片{savedCount > 0 ? ` · 已保存 ${savedCount} 张` : ''}</span>
      {undecided.length > 0 && <>
        <label><input type="checkbox" aria-label="全选待保存卡片" checked={selected.length === undecided.length}
          ref={element => { if (element) element.indeterminate = selected.length > 0 && selected.length < undecided.length; }}
          disabled={busy !== undefined || editing !== undefined}
          onChange={event => setExcluded(event.target.checked ? new Set() : new Set(undecided.map(item => item.id)))} />全选</label>
        <button type="button" className="sf-action" data-testid="proposal-confirm-all"
          disabled={busy !== undefined || editing !== undefined || selected.length === 0}
          onClick={() => { void decide('confirm', selected); }}>
          {busy?.kind === 'decide' ? '正在保存…' : `保存选中 ${selected.length} 张`}
        </button>
      </>}
    </div>}

    {!cardBatch && pending.length > 1 && editing === undefined && <div className="sf-proposal-bulk">
      <button type="button" className="sf-action" data-testid="proposal-confirm-all" disabled={busy !== undefined}
        onClick={() => { void decide('confirm', pending); }}>全部保存（{String(pending.length)} 项）</button>
    </div>}

    <ul className={`sf-proposal-items${cardBatch ? ' sf-proposal-batch-items' : ''}`} data-testid="proposal-items">
      {proposal.items.map(item => <li className="sf-proposal-item" key={item.id} data-item-status={item.status} data-testid="proposal-item">
        {cardBatch && item.draft.effect.kind === 'card-create' && <div className="sf-proposal-batch-row">
          <input type="checkbox" aria-label={`选择卡片：${item.draft.effect.content.title}`}
            checked={(item.status === 'pending' || item.status === 'failed') && !excluded.has(item.id)}
            disabled={busy !== undefined || editing !== undefined || item.status === 'applied' || item.status === 'rejected'}
            onChange={() => setExcluded(current => toggle(current, item.id))} />
          <button type="button" className="sf-proposal-batch-preview" data-testid="proposal-preview"
            aria-expanded={expanded.has(item.id) || editing === item.id}
            onClick={() => setExpanded(current => toggle(current, item.id))}>
            <span className="sf-proposal-batch-title">{item.draft.effect.content.title}</span>
            <span className="sf-proposal-batch-status">{statusCopy(item)}</span>
            <span aria-hidden="true">{expanded.has(item.id) || editing === item.id ? '⌃' : '⌄'}</span>
          </button>
        </div>}
        {(!cardBatch || expanded.has(item.id) || editing === item.id) && <>
        <div className="sf-proposal-slip" data-testid="proposal-slip">
        <div className="sf-proposal-item-head">
          <span className="sf-meta">{item.draft.effect.kind === 'skeleton-save'
            ? `${item.draft.effect.change.replaceExisting ? '重排目录' : '目录调整'} · ${item.draft.effect.change.nodes.length} 节` : effectLabel(item.draft.effect)}</span>
          {(!inline || proposal.items.length > 1 || item.status !== 'pending')
            && <span className="sf-proposal-status" data-testid="proposal-item-status">{statusCopy(item)}</span>}
        </div>

        {item.draft.effect.kind === 'card-create' && editing !== item.id && <div className="sf-proposal-content" data-testid="proposal-content">
          {(proposal.items.length > 1 || item.draft.effect.content.title !== proposal.title) && <h4>{item.draft.effect.content.title}</h4>}
          <span className="sf-meta">{PRESENTATION_LABELS[item.draft.effect.content.presentation]}</span>
          {item.draft.effect.content.front !== '' && <MarkdownBody text={item.draft.effect.content.front} testId="proposal-front" />}
          {item.draft.effect.content.sections.length > 0 && <MarkdownBody text={sectionsToText(item.draft.effect.content.sections)} testId="proposal-back" />}
          <CardMetadata content={item.draft.effect.content} catalogue={catalogue} />
        </div>}

        {item.draft.effect.kind === 'card-edit' && <div className="sf-proposal-content" data-testid="proposal-content">
          <h4>{cardName(item.target, catalogue)}</h4>
          <CardPatchSummary patch={item.draft.effect.patch} catalogue={catalogue} />
        </div>}

        {(item.draft.effect.kind === 'set-create' || item.draft.effect.kind === 'set-edit'
          || item.draft.effect.kind === 'route-add' || item.draft.effect.kind === 'route-edit'
          || item.draft.effect.kind === 'plan-create' || item.draft.effect.kind === 'plan-edit'
          || item.draft.effect.kind === 'skeleton-save' || item.draft.effect.kind === 'atlas-save') && editing !== item.id && <OrganizationSummary effect={item.draft.effect} catalogue={catalogue} />}
        {item.draft.effect.kind === 'skeleton-save' && item.status === 'pending' && recheckedSkeleton?.version === proposal.version
          && <div data-testid="skeleton-recheck-preview" className="sf-proposal-content">
            <h4>保存后的目录预览</h4>
            <ul>{recheckedSkeleton.paths.map(path => <li key={path}>{path}</li>)}</ul>
          </div>}

        {(item.draft.effect.kind === 'handoff' || item.draft.effect.kind === 'handoff-edit') && editing !== item.id
          && <HandoffSummary effect={item.draft.effect} />}
        {item.draft.effect.kind === 'lesson-edit' && editing !== item.id && <LessonSummary effect={item.draft.effect} catalogue={catalogue} />}
        {item.draft.effect.kind === 'teaching-override' && editing !== item.id && <TeachingSummary effect={item.draft.effect} />}
        {item.draft.effect.kind === 'classmate-role' && <ClassmateSummary effect={item.draft.effect} />}

        {item.draft.effect.kind === 'knowledge-collect' && <p className="sf-note" data-testid="proposal-content">将这条知识收录为锦囊。</p>}
        {item.draft.effect.kind === 'review' && <div className="sf-proposal-content" data-testid="proposal-content">
          <h4>{cardName(item.target, catalogue)}</h4>
          <p className="sf-note">{item.draft.effect.record.channel} · 复习结果：{item.draft.effect.record.mark}</p>
          {item.draft.effect.record.note !== '' && <MarkdownBody text={item.draft.effect.record.note} />}
        </div>}

        {editing === item.id && isOrganizationDraft(item.draft.effect.kind) && (catalogue
          ? <OrganizationDraftEditor key={item.id + ':' + item.draft.revision} effect={item.draft.effect} original={item.original.effect}
            materials={catalogue.materials} cards={catalogue.cards} teachingChoices={catalogue.teaching} pending={busy !== undefined} onSave={effect => { void saveEffect(item, effect); }} onCancel={() => setEditing(undefined)} />
          : <div><p role="status">正在读取可选资料…</p><button type="button" className="sf-quiet" onClick={() => setEditing(undefined)}>先不改</button></div>)}
        {editing === item.id && !isOrganizationDraft(item.draft.effect.kind) && <form className="sf-proposal-edit" data-testid="proposal-editor"
          onSubmit={event => { event.preventDefault(); void saveDraft(item); }}>
          <label className="sf-field"><span>标题</span>
            <input data-testid="proposal-editor-title" value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); }} />
          </label>
          {isHandoff(item.draft.effect) || item.draft.effect.kind === 'teaching-override' ? <label className="sf-field"><span>{item.draft.effect.kind === 'teaching-override' ? '教法正文' : '小结正文'}</span>
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
          <button type="button" className="sf-quiet" data-testid="proposal-show-original" onClick={() => { setShowOriginal(showOriginal === item.id ? undefined : item.id); }}>
            {showOriginal === item.id ? '收起老师原稿' : '看老师原稿'}
          </button>
          {showOriginal === item.id && <div className="sf-proposal-original" data-testid="proposal-original">
            <span className="sf-meta">老师最初提的</span>
            {describeEffect(item.original.effect, catalogue)}
          </div>}
        </div>}

        {item.receipt !== undefined && <p className="sf-note" data-testid="proposal-receipt">
          已经保存：《{item.receipt.title}》。{item.receipt.deliveredAt === undefined ? '还没通知老师。' : ''}
        </p>}
        {item.failure !== undefined && <p className="sf-notice" data-testid="proposal-failure">
          {isSkeletonConflict(item) ? '目录已更新，这份草案尚未保存。重新检查当前目录后，再确认增补内容。' : failureCopy(item.failure.code, item.failure.commit)}
        </p>}
        </div>
        <div className="sf-proposal-actions">
          {item.status === 'pending' && editing !== item.id && <>
            <button type="button" className="sf-action" data-testid="proposal-confirm" disabled={busy !== undefined}
              onClick={() => { void decide('confirm', [item]); }}>{confirmLabel(item.draft.effect.kind)}</button>
            {isEditable(item.draft.effect) && <button type="button" className="sf-quiet" data-testid="proposal-edit"
              disabled={busy !== undefined} onClick={() => { startEditing(item); }}>{item.draft.effect.kind === 'skeleton-save' ? '调整目录' : '改一下'}</button>}
            <button type="button" className="sf-quiet" data-testid="proposal-reject" disabled={busy !== undefined}
              onClick={() => { void decide('reject', [item]); }}>不采用</button>
          </>}
          {item.status === 'failed' && editing !== item.id && (isSkeletonConflict(item)
            ? <button type="button" className="sf-action" data-testid="proposal-recheck-skeleton" disabled={busy !== undefined}
              onClick={() => { void recheckSkeleton(item); }}>重新检查目录</button>
            : <button type="button" className="sf-action" data-testid="proposal-retry" disabled={busy !== undefined}
              onClick={() => { void decide('confirm', [item]); }}>重新确认保存结果</button>)}
          {item.status === 'failed' && item.failure?.commit === 'none' && editing !== item.id && <>
            {isEditable(item.draft.effect) && <button type="button" className="sf-quiet" data-testid="proposal-edit" disabled={busy !== undefined}
              onClick={() => startEditing(item)}>改一下</button>}
            <button type="button" className="sf-quiet" data-testid="proposal-reject" disabled={busy !== undefined}
              onClick={() => { void decide('reject', [item]); }}>不采用</button>
          </>}
          {item.status === 'applied' && item.receipt?.deliveredAt === undefined
            && <button type="button" className="sf-quiet" data-testid="proposal-redeliver" disabled={busy !== undefined}
              onClick={() => { void retryDelivery(); }}>重新送一次回执</button>}
        </div>
        </>}
      </li>)}
    </ul>

    {!inline && proposal.items.every(item => item.status === 'applied') && <p className="sf-note" data-testid="proposal-done">这份提案已经全部保存。</p>}
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
  const kind = item.draft.effect.kind;
  return item.status === 'failed' && (kind === 'skeleton-save' || kind === 'atlas-save')
    && ['record_exists', 'version_conflict', 'skeleton_version_conflict', 'atlas_version_conflict'].includes(item.failure?.code ?? '');
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
    case 'atlas-save': return '整理知识地图';
    case 'handoff': return '课后小结';
    case 'handoff-edit': return '更正小结';
    case 'lesson-edit': return '调整本课';
    case 'teaching-override': return '修改教法';
    case 'classmate-role': return '新同学';
  }
}

function confirmLabel(kind: ProposalEffect['kind']): string {
  switch (kind) {
    case 'card-create': return '保存卡片';
    case 'card-edit': return '保存修改';
    case 'knowledge-collect': return '收录锦囊';
    case 'review': return '记下这次复习';
    case 'set-create': return '建立学习集';
    case 'set-edit': return '保存调整';
    case 'route-add': return '加入课程路线';
    case 'route-edit': return '保存课程安排';
    case 'plan-create': case 'plan-edit': return '保存计划';
    case 'skeleton-save': return '保存目录';
    case 'atlas-save': return '保存知识地图';
    case 'handoff': return '保存小结并结束';
    case 'handoff-edit': return '保存小结修改';
    case 'lesson-edit': return '保存本课设置';
    case 'teaching-override': return '保存教法修改';
    case 'classmate-role': return '加进教室';
  }
}

/** What one older draft asked for; only ever shown as the teacher's own text. */
function describeEffect(effect: ProposalEffect, catalogue?: Catalogue): React.JSX.Element {
  switch (effect.kind) {
    case 'card-create': return <div className="sf-proposal-content">
      <h4>{effect.content.title}</h4>
      {effect.content.front !== '' && <MarkdownBody text={effect.content.front} />}
      {effect.content.sections.length > 0 && <MarkdownBody text={sectionsToText(effect.content.sections)} />}
    </div>;
    case 'card-edit': return <CardPatchSummary patch={effect.patch} catalogue={catalogue} />;
    case 'knowledge-collect': return <span className="sf-meta">收录为锦囊</span>;
    case 'review': return <span className="sf-meta">{effect.record.mark} · {effect.record.channel}</span>;
    case 'set-create':
    case 'set-edit':
    case 'route-add':
    case 'route-edit':
    case 'plan-create':
    case 'plan-edit':
    case 'skeleton-save':
    case 'atlas-save':
      return <OrganizationSummary effect={effect} catalogue={catalogue} />;
    case 'handoff':
    case 'handoff-edit':
      return <HandoffSummary effect={effect} bodyTestId="proposal-original-handoff-body" />;
    case 'lesson-edit': return <LessonSummary effect={effect} catalogue={catalogue} />;
    case 'teaching-override': return <TeachingSummary effect={effect} />;
    case 'classmate-role': return <ClassmateSummary effect={effect} />;
  }
}

function ClassmateSummary({ effect }: { effect: Extract<ProposalEffect, { kind: 'classmate-role' }> }): React.JSX.Element {
  const role = effect.role;
  return <div className="sf-proposal-content" data-testid="proposal-content">
    <h4 data-testid="proposal-classmate-name">{role.name}{role.personality ? ` · ${role.personality}` : ''}{role.enabled ? '' : '（先不启用）'}</h4>
    <p className="sf-note" data-testid="proposal-classmate-purpose">{role.purpose}</p>
    <MarkdownBody text={role.instructions} />
    {role.greeting !== undefined && <p className="sf-note" data-testid="proposal-classmate-greeting">开场白：{role.greeting}</p>}
    {role.relations !== undefined && role.relations.length > 0 && <ul className="sf-proposal-lines" data-testid="proposal-classmate-relations">
      {role.relations.map((relation, index) => <li key={index}>对{relation.target === 'student' ? '你' : relation.target === 'teacher' ? '老师' : relation.target}：{relation.label}{relation.intimacy !== undefined ? `（亲密度 ${relation.intimacy}）` : ''}{relation.note !== '' ? `——${relation.note}` : ''}</li>)}
    </ul>}
    <p className="sf-note">保存后这位同学加入教室角色名单，可以由老师安排发言；世界书条目与已有同学不变。</p>
  </div>;
}

function TeachingSummary({ effect }: { effect: Extract<ProposalEffect, { kind: 'teaching-override' }> }): React.JSX.Element {
  return <div className="sf-proposal-content" data-testid="proposal-content">
    <h4>修改教法「{effect.title}」</h4>
    <pre className="sf-proposal-teaching" data-testid="proposal-teaching-body">{effect.body}</pre>
    <p className="sf-note">保存后这节课及以后的课都用这份新文本；内置原文可在「教法」页恢复。</p>
  </div>;
}
function LessonSummary({ effect, catalogue }: { effect: Extract<ProposalEffect, { kind: 'lesson-edit' }>; catalogue?: Catalogue | undefined }): React.JSX.Element {
  const p = effect.patch;
  const builtIn: Record<string, string> = { organize: '资料整理', diagnose: '诊断分析', socratic: '苏格拉底授课', brainstorm: '头脑风暴拓展', search: '搜索' };
  const teachingName = (id: string): string => catalogue?.teaching.find(choice => choice.id === id)?.title ?? builtIn[id] ?? '所选教学配置';
  return <div className="sf-proposal-content" data-testid="proposal-lesson-summary"><h4>调整这节课的设置</h4>
    {p.archived !== undefined && <p data-testid="proposal-lesson-archived">{p.archived ? '将这节课归档，从课程列表收起。' : '恢复这节课，重新显示在课程列表。'}</p>}
    {p.lessonMaterials !== undefined && <ul className="sf-proposal-lines" data-testid="proposal-lesson-materials">{p.lessonMaterials.materials.length
      ? materialLines(p.lessonMaterials.materials, catalogue).map((line, index) => <li key={index}>{index + 1}. {line}{index === (p.lessonMaterials?.initialIndex ?? 0) ? '（默认打开）' : ''}</li>)
      : <li>不带资料，从当前讨论继续。</li>}</ul>}
    {p.learningSetRef !== undefined && <p data-testid="proposal-lesson-set">{p.learningSetRef ? `所属学习集：${setName(p.learningSetRef, catalogue)}` : '这节课不指定学习集。'}</p>}
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
  return effect.kind === 'card-create' || isHandoff(effect) || effect.kind === 'teaching-override' || isOrganizationDraft(effect.kind);
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
  if (effect.kind === 'teaching-override') return { ...effect, body: draft.body };
  return undefined;
}

const HANDOFF_FACT_LABEL = { material: '课上用了', saved: '当时保存了', pending: '当时还没确认' } as const;

function HandoffSummary({ effect, bodyTestId = 'proposal-handoff-body' }: { readonly effect: HandoffEffect; readonly bodyTestId?: string }): React.JSX.Element {
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
      确认后保存这份小结，并结束本课。
    </p>}
  </div>;
}

/**
 * P6's own kinds are organisation, not card text, so they read as names, dates
 * and counts. Ids, entity refs, teaching keys and raw JSON stay out of the
 * student's view: "2 份资料移进了这个集", never `materials_add: [...]`.
 */
type OrganizationEffect = Extract<ProposalEffect,
  { kind: 'set-create' | 'set-edit' | 'route-add' | 'route-edit' | 'plan-create' | 'plan-edit' | 'skeleton-save' | 'atlas-save' }>;

function OrganizationSummary({ effect, catalogue }: { readonly effect: OrganizationEffect; readonly catalogue?: Catalogue | undefined }): React.JSX.Element {
  if (effect.kind === 'skeleton-save') return <SkeletonSummary change={effect.change} />;
  if (effect.kind === 'atlas-save') return <AtlasSummary change={effect.change} />;
  const block = organizationLines(effect, catalogue);
  return <div className="sf-proposal-content" data-testid="proposal-content">
    <h4>{block.heading}</h4>
    {block.lines.length > 0 && <ul className="sf-proposal-lines">
      {block.lines.map((line, index) => <li key={`${String(index)}:${line}`} className="sf-meta">{line}</li>)}
    </ul>}
  </div>;
}

function organizationLines(effect: Exclude<OrganizationEffect, { kind: 'skeleton-save' | 'atlas-save' }>, catalogue?: Catalogue): { heading: string; lines: string[] } {
  switch (effect.kind) {
    case 'set-create': return { heading: `学习集「${effect.content.name}」`, lines: setCreateLines(effect.content, catalogue) };
    case 'set-edit': return { heading: '改这个学习集', lines: setPatchLines(effect.patch, catalogue) };
    case 'route-add': return { heading: effect.content.title, lines: routeNodeLines(effect.content, catalogue) };
    case 'route-edit': return { heading: '改这一节课的安排', lines: routePatchLines(effect.patch, catalogue) };
    case 'plan-create': return planCreateBlock(effect.content, catalogue);
    case 'plan-edit': return { heading: '改这份计划', lines: planPatchLines(effect.patch, catalogue) };
  }
}

type SetCreateContent = Extract<ProposalEffect, { kind: 'set-create' }>['content'];
type SetPatchContent = Extract<ProposalEffect, { kind: 'set-edit' }>['patch'];
type RouteNodeContent = Extract<ProposalEffect, { kind: 'route-add' }>['content'];
type RouteNodePatchContent = Extract<ProposalEffect, { kind: 'route-edit' }>['patch'];
type PlanContentValue = Extract<ProposalEffect, { kind: 'plan-create' }>['content'];
type PlanPatchContent = Extract<ProposalEffect, { kind: 'plan-edit' }>['patch'];
type LessonMaterialValue = RouteNodeContent['materials']['materials'][number];

function ladderCopy(ladder: readonly number[] | null): string {
  return ladder === null ? '用默认梯子' : `隔 ${ladder.join('、')} 天复习`;
}

function setCreateLines(content: SetCreateContent, catalogue?: Catalogue): string[] {
  const lines = [ladderCopy(content.ladder)];
  if (content.subjects.length > 0) lines.push(`科目：${content.subjects.join('、')}`);
  lines.push(...content.materials.map(id => `放入资料：${bookName(id, catalogue)}`));
  lines.push(...content.members.map(id => `放入卡片：${cardName(id, catalogue)}`));
  return lines;
}

function setPatchLines(patch: SetPatchContent, catalogue?: Catalogue): string[] {
  const lines: string[] = [];
  if (patch.name !== undefined) lines.push(`名字改成「${patch.name}」`);
  if (patch.subjects !== undefined) lines.push(`科目改成 ${patch.subjects.length === 0 ? '不设' : patch.subjects.join('、')}`);
  if (patch.ladder !== undefined) lines.push(`复习梯子改成${ladderCopy(patch.ladder)}`);
  lines.push(...patch.materials_add.map(id => `放入资料：${bookName(id, catalogue)}`));
  lines.push(...patch.materials_remove.map(id => `移出资料：${bookName(id, catalogue)}`));
  lines.push(...patch.members_add.map(id => `放入卡片：${cardName(id, catalogue)}`));
  lines.push(...patch.members_remove.map(id => `移出卡片：${cardName(id, catalogue)}`));
  if (patch.reason) lines.push(patch.reason);
  return lines.length === 0 ? ['没有实质改动'] : lines;
}

function routeNodeLines(content: RouteNodeContent, catalogue?: Catalogue): string[] {
  const lines: string[] = [];
  if (content.date !== null) lines.push(`安排在这一天：${content.date}`);
  const materials = materialLines(content.materials.materials, catalogue);
  lines.push(...(materials.length === 0 ? ['还没指定材料'] : materials.map((line, index) => `资料 ${index + 1}：${line}${index === (content.materials.initialIndex ?? 0) ? '（默认打开）' : ''}`)));
  const decl = declLine(content.decl);
  if (decl !== undefined) lines.push(decl);
  return lines;
}

function routePatchLines(patch: RouteNodePatchContent, catalogue?: Catalogue): string[] {
  const lines: string[] = [];
  if (patch.title !== undefined) lines.push(`标题改成「${patch.title}」`);
  if (patch.date !== undefined) lines.push(patch.date === null ? '去掉安排的日期' : `安排在这一天：${patch.date}`);
  if (patch.materials !== undefined) {
    const materials = materialLines(patch.materials.materials, catalogue);
    lines.push(...(materials.length === 0 ? ['材料改成不带材料'] : materials.map((line, index) => `资料 ${index + 1}：${line}${index === (patch.materials?.initialIndex ?? 0) ? '（默认打开）' : ''}`)));
  }
  if (patch.decl !== undefined) {
    const decl = patch.decl === null ? undefined : declLine(patch.decl);
    lines.push(decl ?? '清掉这节课的教学说明');
  }
  if (patch.reason) lines.push(patch.reason);
  return lines.length === 0 ? ['没有实质改动'] : lines;
}

/** One planned position, in the words the student reads on their own shelf. */
function materialLines(materials: readonly LessonMaterialValue[], catalogue?: Catalogue): string[] {
  return materials.map(material => {
    if (material.kind === 'card') return cardName(material.cardRef, catalogue);
    const locator = material.source.locator;
    return `${bookName(material.source.materialId, catalogue)}${locator ? ` · ${positionLabel(locator)}` : ''}`;
  });
}

function declLine(decl: RouteNodeContent['decl']): string | undefined {
  const parts: string[] = [];
  if (decl.name !== undefined) parts.push(`方式：${decl.name}`);
  if (decl.teachingRef !== undefined && decl.name === undefined) parts.push('教学方式已指定');
  if (decl.stance !== undefined) parts.push(`重点：${decl.stance}`);
  return parts.length === 0 ? undefined : parts.join(' · ');
}

function planCreateBlock(content: PlanContentValue, catalogue?: Catalogue): { heading: string; lines: string[] } {
  if (content.kind === 'book') {
    const lines = [bookName(content.materialId, catalogue), ...bookPlanLines(content.entries)];
    return { heading: `排课：《${content.title}》`, lines };
  }
  const lines = [content.schedule.length ? '按下方逐日安排复习' : `每天 ${String(content.dailyCount)} 张到期卡`, `${content.start} 到 ${content.end}`];
  if (content.learningSetRef) lines.push(`学习集：${setName(content.learningSetRef, catalogue)}`);
  if (content.tags.length > 0) lines.push(`标签：${content.tags.join('、')}`);
  if (content.cards.length) lines.push(`复习范围：${content.cards.map(id => cardName(id, catalogue)).join('、')}`);
  lines.push(...scheduleLines(content.schedule, catalogue));
  return { heading: `复习计划「${content.title}」`, lines };
}

function planPatchLines(patch: PlanPatchContent, catalogue?: Catalogue): string[] {
  const lines: string[] = [];
  if (patch.title !== undefined) lines.push(`标题改成「${patch.title}」`);
  if (patch.entries !== undefined) lines.push(...(patch.entries.length ? bookPlanLines(patch.entries) : ['清除排课日期']));
  if (patch.learningSetRef !== undefined) lines.push(patch.learningSetRef === null ? '不再绑定学习集' : `学习集改为：${setName(patch.learningSetRef, catalogue)}`);
  if (patch.tags !== undefined) lines.push(patch.tags.length === 0 ? '清掉标签' : `标签改成 ${patch.tags.join('、')}`);
  if (patch.cards !== undefined) lines.push(patch.cards.length ? `卡片范围：${patch.cards.map(id => cardName(id, catalogue)).join('、')}` : '不限定具体卡片');
  if (patch.dailyCount !== undefined) lines.push(`每天改成 ${String(patch.dailyCount)} 张`);
  if (patch.start !== undefined) lines.push(`开始日期：${patch.start}`);
  if (patch.end !== undefined) lines.push(`结束日期：${patch.end}`);
  if (patch.schedule !== undefined) lines.push(...(patch.schedule.length ? scheduleLines(patch.schedule, catalogue) : ['取消逐日指定，按每日数量取到期卡']));
  return lines.length === 0 ? ['没有实质改动'] : lines;
}

function bookName(id: string, catalogue?: Catalogue): string {
  return catalogue?.materials.find(book => book.materialId === id)?.title ?? '资料（名称暂未读到）';
}
function cardName(ref: string | null, catalogue?: Catalogue): string {
  return catalogue?.cards.find(card => card.ref === ref)?.content.title ?? '卡片（名称暂未读到）';
}
function setName(ref: string, catalogue?: Catalogue): string {
  return catalogue?.sets.find(set => set.ref === ref)?.name ?? '学习集（名称暂未读到）';
}
function bookPlanLines(entries: Extract<PlanContentValue, { kind: 'book' }>['entries']): string[] {
  return entries.map(entry => `${entry.date} · ${entry.chapter?.split('/').join(' › ') ?? '阅读选段'} · ${entry.sources.map(source => positionLabel(source.locator)).join('、')}`);
}
function scheduleLines(schedule: Extract<PlanContentValue, { kind: 'campaign' }>['schedule'], catalogue?: Catalogue): string[] {
  return schedule.map(day => `${day.date} · ${day.cards.length ? day.cards.map(ref => cardName(ref, catalogue)).join('、') : '这天不安排卡片'}`);
}

function CardMetadata({ content, catalogue }: { content: CardContent; catalogue?: Catalogue | undefined }): React.JSX.Element {
  return <div className="sf-proposal-metadata">
    {content.notes && <MarkdownBody text={content.notes} />}
    {content.chapter && <p className="sf-note">章节：{content.chapter.split('/').join(' › ')}</p>}
    {content.tags.length > 0 && <p className="sf-note">标签：{content.tags.join('、')}</p>}
    {content.sources.map((source, index) => <p className="sf-note" key={index}>来源：{bookName(source.materialId, catalogue)} · {positionLabel(source.locator)}</p>)}
    {content.links.length > 0 && <p className="sf-note">相关卡片：{content.links.map(ref => cardName(ref, catalogue)).join('、')}</p>}
  </div>;
}
function CardPatchSummary({ patch, catalogue }: { patch: Extract<ProposalEffect, { kind: 'card-edit' }>['patch']; catalogue?: Catalogue | undefined }): React.JSX.Element {
  return <div className="sf-proposal-content">
    {patch.title !== undefined && <p>标题改为：{patch.title}</p>}
    {patch.presentation !== undefined && <p className="sf-note">类型：{PRESENTATION_LABELS[patch.presentation]}</p>}
    {patch.front !== undefined && <div><h4>卡面</h4>{patch.front ? <MarkdownBody text={patch.front} /> : <p className="sf-note">清空卡面文字</p>}</div>}
    {patch.sections !== undefined && <div><h4>卡背</h4>{patch.sections.length ? <MarkdownBody text={sectionsToText(patch.sections)} /> : <p className="sf-note">清空卡背</p>}</div>}
    {patch.notes !== undefined && (patch.notes ? <MarkdownBody text={patch.notes} /> : <p className="sf-note">清空笔记</p>)}
    {patch.tags !== undefined && <p className="sf-note">{patch.tags.length ? `标签改为：${patch.tags.join('、')}` : '清除所有标签'}</p>}
    {patch.chapter !== undefined && <p className="sf-note">{patch.chapter ? `章节改为：${patch.chapter.split('/').join(' › ')}` : '不再挂在章节下'}</p>}
    {patch.sources !== undefined && (patch.sources.length ? patch.sources.map((source, index) => <p className="sf-note" key={index}>来源改为：{bookName(source.materialId, catalogue)} · {positionLabel(source.locator)}</p>) : <p className="sf-note">清除来源</p>)}
    {patch.links_add.map(ref => <p className="sf-note" key={'add:' + ref}>关联卡片：{cardName(ref, catalogue)}</p>)}
    {patch.links_remove.map(ref => <p className="sf-note" key={'remove:' + ref}>解除关联：{cardName(ref, catalogue)}</p>)}
    {patch.reason && <p className="sf-note">{patch.reason}</p>}
  </div>;
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
