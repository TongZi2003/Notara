/**
 * P5.5 the student's own editor for one ordinary card.
 *
 * One object, one identity: a create posts the student's real content, an edit
 * posts only the fields they changed from the version they read. A save that
 * meets somebody else's newer version does not overwrite it and does not throw
 * the draft away — the editor keeps the draft, shows the latest version
 * read-only, and needs an explicit "use the latest as the new baseline" before
 * it will save again. Nothing here writes a ref, a version or a JSON document:
 * the version is the Host's, and relations move by increment.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CardContent, CardPatch, CardView } from '@studyforge/contracts/cards';
import { useEffect, useState } from 'react';
import { MarkdownBody } from './MarkdownBody.tsx';
import { attemptKey, UNKNOWN_WRITE_COPY, useStableOperationId } from './attempt.ts';
import { answerLost, codeOf, draftOf, emptyDraft, failureCode, patchFor, PRESENTATIONS, PRESENTATION_LABELS, saveFailureCopy, versionLabel, type CardDraft } from './format.ts';

export interface CardEditorProps {
  readonly ctx: Context;
  readonly sessionId?: string;
  /** The card to edit; absent means the student is creating one. */
  readonly target?: string;
  /** The version the caller already read, so the editor does not re-read it. */
  readonly seed?: CardView;
  readonly onSaved: (view: CardView) => void;
  readonly onCancel?: () => void;
}

type LoadState =
  | { readonly status: 'ready' }
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' };

/** One write that was really sent; frozen verbatim when its answer was lost. */
type FrozenWrite = { readonly sessionId?: string } & (
  | { readonly kind: 'create'; readonly operationId: string; readonly content: CardContent }
  | { readonly kind: 'edit'; readonly operationId: string; readonly target: string; readonly expectedVersion: number; readonly patch: CardPatch });

/** One ordinary card's editor: create, edit, and the conflict step between. */
export function CardEditor({ ctx, sessionId, target, seed, onSaved, onCancel }: CardEditorProps): React.JSX.Element {
  const [state, setState] = useState<LoadState>(seed !== undefined || target === undefined ? { status: 'ready' } : { status: 'loading' });
  const [baseline, setBaseline] = useState<CardView | undefined>(seed);
  const [draft, setDraft] = useState<CardDraft>(() => (seed === undefined ? emptyDraft() : draftOf(seed.content)));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState<CardView | undefined>(undefined);
  const [relations, setRelations] = useState<readonly CardView[] | undefined>(undefined);
  // Which fields this student really touched. It is only used by the conflict
  // step: after rebasing, the fields they never edited take the newest text
  // instead of being written back with their stale copy.
  const [dirty, setDirty] = useState<readonly string[]>([]);
  // One attempt keeps one operation id: a lost answer is retried, not repeated.
  const operationFor = useStableOperationId();

  const mark = (field: string): void => { setDirty(seen => (seen.includes(field) ? seen : [...seen, field])); };

  useEffect(() => {
    if (seed !== undefined || target === undefined) return undefined;
    let live = true;
    ctx.remote.studyforgeLearning.card({ target }).then(
      result => {
        if (!live) return;
        if (!result.ok) { setState({ status: 'unavailable' }); return; }
        setBaseline(result.value);
        setDraft(draftOf(result.value.content));
        setState({ status: 'ready' });
      },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [ctx, target, seed]);


  // A write whose answer never came back keeps its exact request: retrying
  // repeats that request, while a changed draft would be a different operation
  // and, for a creation, a second card.
  const [frozen, setFrozen] = useState<FrozenWrite | undefined>(undefined);

  async function send(write: FrozenWrite): Promise<void> {
    const session = write.sessionId === undefined ? {} : { sessionId: write.sessionId };
    if (write.kind === 'create') {
      const created = await ctx.remote.studyforgeLearning.createCard({
        operationId: write.operationId, ...session, content: write.content,
      });
      if (!created.ok) {
        // No answer: the card may already exist, so the form freezes around the
        // request that was really sent instead of claiming it failed.
        if (answerLost(failureCode(created.error))) { setFrozen(write); setNotice(UNKNOWN_WRITE_COPY); return; }
        setFrozen(undefined);
        setNotice(saveFailureCopy(created.error.message));
        return;
      }
      setFrozen(undefined);
      setBaseline(created.value);
      setDraft(draftOf(created.value.content));
      onSaved(created.value);
      return;
    }
    const saved = await ctx.remote.studyforgeLearning.editCard({
      operationId: write.operationId, ...session, target: write.target, expectedVersion: write.expectedVersion, patch: write.patch,
    });
    if (!saved.ok) {
      if (answerLost(failureCode(saved.error))) { setFrozen(write); setNotice(UNKNOWN_WRITE_COPY); return; }
      setFrozen(undefined);
      if (codeOf(saved.error.message) === 'version_conflict') {
        // The draft stays exactly as the student left it; only the baseline moved.
        const latest = await ctx.remote.studyforgeLearning.card({ target: write.target });
        if (latest.ok) { setConflict(latest.value); return; }
      }
      setNotice(saveFailureCopy(saved.error.message));
      return;
    }
    setFrozen(undefined);
    setBaseline(saved.value);
    setDraft(draftOf(saved.value.content));
    setDirty([]);
    setConflict(undefined);
    onSaved(saved.value);
  }

  async function submit(write: FrozenWrite): Promise<void> {
    setSaving(true);
    setNotice(undefined);
    try { await send(write); }
    catch {
      // The Host may have stored it and the answer got lost; retry the same write.
      setNotice(UNKNOWN_WRITE_COPY);
    } finally {
      setSaving(false);
    }
  }

  async function save(): Promise<void> {
    if (frozen !== undefined) return;
    if (draft.title.trim() === '') { setNotice('先写一个标题。'); return; }
    if (baseline === undefined) {
      const content: CardContent = {
        title: draft.title.trim(), presentation: draft.presentation, front: draft.front,
        sections: draft.sections.map(section => ({ heading: section.heading, body: section.body })),
        notes: draft.notes, sources: [], tags: [...draft.tags], links: [...draft.links],
        ...(draft.chapter === '' ? {} : { chapter: draft.chapter }),
      };
      await submit({ ...(sessionId ? { sessionId } : {}), kind: 'create', operationId: operationFor(attemptKey('create', sessionId ?? '', JSON.stringify(content))), content });
      return;
    }
    const patch = patchFor(baseline.content, draft);
    await submit({
      ...(sessionId ? { sessionId } : {}), kind: 'edit', operationId: operationFor(attemptKey('edit', sessionId ?? '', baseline.ref, String(baseline.version), JSON.stringify(patch))),
      target: baseline.ref, expectedVersion: baseline.version, patch,
    });
  }

  /** The only write allowed while an answer is missing: the same request again. */
  async function retry(): Promise<void> {
    if (frozen === undefined) return;
    await submit(frozen);
  }

  async function openRelations(): Promise<void> {
    if (relations !== undefined) return;
    const all = await ctx.remote.studyforgeLearning.cards();
    setRelations(all.ok ? all.value.filter(view => view.ref !== (baseline?.ref ?? target)) : []);
  }

  if (state.status === 'loading') return <p className="sf-note" role="status" data-testid="card-editor-loading">正在打开这张卡…</p>;
  if (state.status === 'unavailable') return <p className="sf-note" role="status" data-testid="card-editor-unavailable">这张卡暂时打不开，稍后再看一次。</p>;

  const preview = draft.sections.map(section => `## ${section.heading}\n${section.body}`).join('\n\n');
  const frozenNow = frozen !== undefined;
  return <form className="sf-card-editor" data-testid="card-editor" data-frozen={frozenNow ? 'true' : undefined}
    onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset className="sf-write-frozen" disabled={frozenNow}>
    <header className="sf-card-editor-head">
      <h3>{baseline === undefined ? '新建卡片' : '修改卡片'}</h3>
      {baseline !== undefined && <span className="sf-meta" data-testid="card-editor-version">正在改 {versionLabel(baseline)}</span>}
    </header>

    <label className="sf-field"><span>标题</span>
      <input data-testid="card-editor-title" value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); mark('title'); }} />
    </label>

    <label className="sf-field"><span>类型</span>
      <select data-testid="card-editor-presentation" value={draft.presentation}
        onChange={event => { setDraft({ ...draft, presentation: event.target.value as CardDraft['presentation'] }); mark('presentation'); }}>
        {PRESENTATIONS.map(value => <option key={value} value={value}>{PRESENTATION_LABELS[value]}</option>)}
      </select>
    </label>

    <label className="sf-field"><span>卡面</span>
      <textarea data-testid="card-editor-front" rows={4} value={draft.front}
        onChange={event => { setDraft({ ...draft, front: event.target.value }); mark('front'); }} />
    </label>

    <section className="sf-card-editor-sections">
      <h4>卡背</h4>
      {draft.sections.map((section, index) => <div className="sf-section-row" key={`section-${String(index)}`}>
        <input aria-label={`小标题 ${String(index + 1)}`} data-testid="card-editor-section-heading" value={section.heading}
          onChange={event => { setDraft({ ...draft, sections: replace(draft.sections, index, { ...section, heading: event.target.value }) }); mark('sections'); }} />
        <textarea aria-label={`正文 ${String(index + 1)}`} data-testid="card-editor-section-body" rows={4} value={section.body}
          onChange={event => { setDraft({ ...draft, sections: replace(draft.sections, index, { ...section, body: event.target.value }) }); mark('sections'); }} />
        <button type="button" className="sf-quiet" data-testid="card-editor-section-remove"
          onClick={() => { setDraft({ ...draft, sections: draft.sections.filter((_, at) => at !== index) }); }}>删掉这一段</button>
      </div>)}
      <button type="button" className="sf-quiet" data-testid="card-editor-section-add"
        onClick={() => { setDraft({ ...draft, sections: [...draft.sections, { heading: '解法', body: '' }] }); mark('sections'); }}>加一段</button>
    </section>

    <label className="sf-field"><span>笔记（只有你和老师看）</span>
      <textarea data-testid="card-editor-notes" rows={3} value={draft.notes}
        onChange={event => { setDraft({ ...draft, notes: event.target.value }); mark('notes'); }} />
    </label>

    <label className="sf-field"><span>标签</span>
      <input data-testid="card-editor-tags" value={draft.tags.join('、')}
        onChange={event => { setDraft({ ...draft, tags: event.target.value.split(/[、,，\s]+/u).map(tag => tag.trim()).filter(tag => tag !== '') }); mark('tags'); }} />
    </label>

    <label className="sf-field"><span>章节（可留空）</span>
      <input data-testid="card-editor-chapter" value={draft.chapter}
        onChange={event => { setDraft({ ...draft, chapter: event.target.value }); mark('chapter'); }} />
    </label>

    <section className="sf-card-editor-links">
      <h4>关联</h4>
      <ul data-testid="card-editor-links">
        {draft.links.map(link => <li key={link}>
          <span className="sf-meta">{relations?.find(view => view.ref === link)?.content.title ?? '已有关联（展开可查看）'}</span>
          <button type="button" className="sf-quiet" data-testid="card-editor-link-remove"
            onClick={() => { setDraft({ ...draft, links: draft.links.filter(item => item !== link) }); mark('links'); }}>移除</button>
        </li>)}
      </ul>
      <button type="button" className="sf-quiet" data-testid="card-editor-link-add" onClick={() => { void openRelations(); }}>添加关联</button>
      {relations !== undefined && relations.filter(view => !draft.links.includes(view.ref)).length > 0
        && <select data-testid="card-editor-link-pick" value="" onChange={event => {
          const ref = event.target.value;
          if (ref !== '') { setDraft({ ...draft, links: [...draft.links, ref] }); mark('links'); }
        }}>
          <option value="">选一张自己的卡…</option>
          {relations.filter(view => !draft.links.includes(view.ref)).map(view => <option key={view.ref} value={view.ref}>{view.content.title}</option>)}
        </select>}
    </section>

    {baseline?.content.sources !== undefined && baseline.content.sources.length > 0 && <section className="sf-card-editor-sources">
      <h4>来源</h4>
      <ul><li className="sf-meta">这张卡带着 {baseline.content.sources.length} 处原始位置（不可在这里手填）。</li></ul>
    </section>}

    {(draft.front !== '' || preview !== '') && <section className="sf-card-editor-preview">
      <h4>预览</h4>
      <MarkdownBody text={draft.front} testId="card-editor-preview-front" />
      {preview !== '' && <MarkdownBody text={preview} testId="card-editor-preview-back" />}
    </section>}

    {conflict !== undefined && <section className="sf-conflict" data-testid="card-editor-conflict">
      <p className="sf-notice">这张卡刚在别处更新过：你已经改了 {versionLabel(baseline ?? conflict)}，现在已经是 {versionLabel(conflict)}。下面是最新版，先看一遍再决定。</p>
      <dl className="sf-conflict-latest" data-testid="card-editor-latest">
        <dt>标题</dt><dd>{conflict.content.title}</dd>
        <dt>卡面</dt><dd>{conflict.content.front === '' ? '（空）' : conflict.content.front}</dd>
        <dt>卡背</dt><dd>{conflict.content.sections.map(section => `## ${section.heading} ${section.body}`).join(' / ') || '（空）'}</dd>
        <dt>标签</dt><dd>{conflict.content.tags.join('、') || '（空）'}</dd>
      </dl>
      <div className="sf-conflict-actions">
        <button type="button" className="sf-action" data-testid="card-editor-rebase"
          onClick={() => {
            // The explicit merge: untouched fields take the newest text, the
            // fields this student wrote keep their own words.
            const latest = draftOf(conflict.content);
            const keep = (field: keyof CardDraft): boolean => dirty.includes(field);
            setDraft({
              title: keep('title') ? draft.title : latest.title,
              presentation: keep('presentation') ? draft.presentation : latest.presentation,
              front: keep('front') ? draft.front : latest.front,
              sections: keep('sections') ? draft.sections : latest.sections,
              notes: keep('notes') ? draft.notes : latest.notes,
              tags: keep('tags') ? draft.tags : latest.tags,
              chapter: keep('chapter') ? draft.chapter : latest.chapter,
              links: keep('links') ? draft.links : latest.links,
            });
            setBaseline(conflict);
            setConflict(undefined);
            setNotice('没改过的字段已经换成最新版；你改过的字段保留你的写法，检查一遍再保存。');
          }}>
          以最新版为基线继续改
        </button>
        <button type="button" className="sf-quiet" data-testid="card-editor-take-latest"
          onClick={() => { setBaseline(conflict); setDraft(draftOf(conflict.content)); setDirty([]); setConflict(undefined); }}>
          用最新版替换我的草稿
        </button>
      </div>
    </section>}

    </fieldset>

    {notice !== undefined && <p className="sf-notice" role="status" data-testid="card-editor-notice">{notice}</p>}

    <footer className="sf-card-editor-actions">
      {frozenNow
        ? <button type="button" className="sf-action" data-testid="card-editor-retry" disabled={saving}
          onClick={() => { void retry(); }}>{saving ? '正在重试…' : '用同一次再试一次'}</button>
        : <button type="submit" className="sf-action" data-testid="card-editor-save" disabled={saving}>{saving ? '正在保存…' : '保存'}</button>}
      {onCancel !== undefined && <button type="button" className="sf-quiet" data-testid="card-editor-cancel" onClick={onCancel}>取消</button>}
    </footer>
  </form>;
}

/** Replace one row of a readonly list without touching the others. */
function replace<T>(rows: readonly T[], index: number, value: T): readonly T[] {
  return rows.map((row, at) => (at === index ? value : row));
}
