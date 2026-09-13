/**
 * P5.6 one card opened: the face is what the student reads first, so the back,
 * the notes and any answer-bearing change text stay behind an explicit
 * "公开答案". Before that button the change projection is read with
 * `showBack:false`, so a hidden answer cannot leak through a diff either.
 *
 * Opening this component is reading, not studying: it writes nothing and never
 * creates a review row. Its sources hand the real anchor back to the caller,
 * which owns whatever preview opens it.
 */
import type { Context } from '@deepseek-ai/cordis';
import { ContentHistory } from '../materials/ContentHistory.tsx';
import type { CardView } from '@studyforge/contracts/cards';
import type { CardChangeView } from '@studyforge/contracts/changes';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { useEffect, useState } from 'react';
import { CardEditor } from './CardEditor.tsx';
import { CardChangeList } from './CardChangeList.tsx';
import { MarkdownBody } from './MarkdownBody.tsx';
import { SourceExcerpt } from './SourceExcerpt.tsx';
import { PRESENTATION_LABELS, versionLabel } from './format.ts';

export interface CardDetailProps {
  readonly ctx: Context;
  readonly target: string;
  readonly sessionId?: string;
  /**
   * Read one exact revision instead of the current one. A source reference names
   * a frozen version, so the tab must show that version rather than today's.
   */
  readonly version?: number;
  /**
   * A fixed historical version: it is shown, not edited. There is no edit entry
   * and no newer-change projection, because both belong to the current card — a
   * redline here would mix other people's later edits into a frozen original.
   */
  readonly readonly?: boolean;
  /** The version the caller already read; skips the first read. */
  readonly seed?: CardView;
  readonly onChange?: (view: CardView) => void;
  readonly onBack?: () => void;
  /** Hand one real source anchor to whoever owns the preview. */
  readonly onSource?: (source: SourceAnchor) => void;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly view: CardView };

/** One card, its real sources, and — for the current version — its own change history. */
export function CardDetail({ ctx, target, sessionId, version, readonly, seed, onChange, onBack, onSource }: CardDetailProps): React.JSX.Element {
  const [state, setState] = useState<State>(seed === undefined ? { status: 'loading' } : { status: 'ready', view: seed });
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState<readonly CardChangeView[] | undefined>(undefined);
  const [relationTitles, setRelationTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const links = state.status === 'ready' ? state.view.content.links : [];
    void Promise.all(links.map(async ref => {
      try { const result = ref.startsWith('knowledge:') ? await ctx.remote.studyforgeLearning.method({ target: ref }) : await ctx.remote.studyforgeLearning.card({ target: ref });
        return [ref, result.ok ? result.value.content.title : '这条关联暂时不可用'] as const;
      } catch { return [ref, '这条关联暂时不可用'] as const; }
    })).then(rows => { if (live) setRelationTitles(Object.fromEntries(rows)); });
    return () => { live = false; };
  }, [ctx, state]);
  const fixed = readonly === true;

  useEffect(() => {
    if (seed !== undefined) return undefined;
    let live = true;
    ctx.remote.studyforgeLearning.card(version === undefined ? { target } : { target, version }).then(
      result => {
        if (!live) return;
        setState(result.ok ? { status: 'ready', view: result.value } : { status: 'unavailable' });
      },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [ctx, target, version, seed]);

  // The answer-bearing text is only ever asked for after the student opened it,
  // and a frozen version is not asked for its newer edits at all.
  useEffect(() => {
    if (fixed) { setChanges(undefined); return undefined; }
    let live = true;
    const input = sessionId === undefined
      ? { target, showBack: revealed }
      : { target, sessionId, showBack: revealed };
    ctx.remote.studyforgeLearning.cardChanges(input).then(
      result => { if (live) setChanges(result.ok ? result.value : []); },
      () => { if (live) setChanges([]); },
    );
    return () => { live = false; };
  }, [ctx, target, sessionId, revealed, fixed]);

  if (state.status === 'loading') return <p className="sf-note" role="status" data-testid="card-detail-loading">正在打开这张卡…</p>;
  if (state.status === 'unavailable') return <p className="sf-note" role="status" data-testid="card-detail-unavailable">这张卡暂时打不开，稍后再看一次。</p>;
  const view = state.view;
  const content = view.content;

  if (editing && !fixed) return <CardEditor ctx={ctx} target={target} seed={view}
    {...(sessionId === undefined ? {} : { sessionId })}
    onSaved={saved => { setState({ status: 'ready', view: saved }); setEditing(false); if (onChange !== undefined) onChange(saved); }}
    onCancel={() => { setEditing(false); }} />;

  return <article className="sf-card-detail" data-testid="card-detail">
    <header className="sf-card-detail-head">
      <span className="sf-meta">{PRESENTATION_LABELS[content.presentation]} · {versionLabel(view)}</span>
      {fixed && <span className="sf-meta" data-testid="card-detail-fixed">当时的固定版</span>}
      <h2 data-testid="card-detail-title">{content.title}</h2>
      {onBack !== undefined && <button type="button" className="sf-quiet" data-testid="card-detail-back" onClick={onBack}>返回</button>}
    </header>

    <section className="sf-card-face">
      <h3>卡面</h3>
      {content.front === '' ? (content.sources.length ? <SourceExcerpt ctx={ctx} sources={content.sources} /> : <p className="sf-note">这张卡还没有卡面。</p>) : <MarkdownBody text={content.front} testId="card-detail-front" />}
    </section>

    {!revealed && <button type="button" className="sf-action" data-testid="card-detail-reveal" onClick={() => { setRevealed(true); }}>公开答案</button>}
    {revealed && <section className="sf-card-back" data-testid="card-detail-back-body">
      <h3>卡背</h3>
      {content.sections.length === 0 ? <p className="sf-note">这张卡还没有卡背。</p>
        : content.sections.map((section, index) => <div key={`section-${String(index)}`}>
          <h4>{section.heading}</h4>
          <MarkdownBody text={section.body} />
        </div>)}
      {content.notes !== '' && <div className="sf-card-notes"><h4>笔记</h4><MarkdownBody text={content.notes} testId="card-detail-notes" /></div>}
    </section>}

    <section className="sf-card-meta">
      <h3>这张卡</h3>
      <ul>
        <li><span>标签</span><span className="sf-meta">{content.tags.length === 0 ? '（空）' : content.tags.join('、')}</span></li>
        <li><span>章节</span><span className="sf-meta">{content.chapter ?? '未归书'}</span></li>
        <li><span>学习</span><span className="sf-meta" data-testid="card-detail-review">
          {view.review === undefined ? '还没学过' : `${String(view.review.reviewCount)} 次 · 下次 ${view.review.nextDue}`}
        </span></li>
      </ul>
    </section>

    <ContentHistory ctx={ctx} query={{ target: view.ref, ...(version ? { version } : {}) }} onSource={onSource} />
    {content.sources.length > 0 && <section className="sf-card-sources">
      <h3>来源</h3>
      <ul data-testid="card-detail-sources">
        {content.sources.map((source, index) => <li key={`source-${String(index)}`}>
          <span className="sf-meta">{source.quote ?? describeLocator(source)}</span>
          {onSource !== undefined && <button type="button" className="sf-quiet" data-testid="card-detail-source-open"
            onClick={() => { onSource(source); }}>打开原处</button>}
        </li>)}
      </ul>
    </section>}

    {content.links.length > 0 && <section className="sf-card-links">
      <h3>关联</h3>
      <ul data-testid="card-detail-links">{content.links.map(link => <li key={link}><span className="sf-meta">{relationTitles[link] ?? '正在读取关联…'}</span></li>)}</ul>
    </section>}

    {changes !== undefined && <CardChangeList changes={changes} showBack={revealed} />}

    {!fixed && <footer className="sf-card-detail-actions">
      <button type="button" className="sf-action" data-testid="card-detail-edit" onClick={() => { setEditing(true); }}>修改这张卡</button>
    </footer>}
  </article>;
}

/** Where one source sits, in the student's words; the ids stay inside. */
function describeLocator(source: SourceAnchor): string {
  switch (source.locator.kind) {
    case 'text': return `第 ${String(source.locator.start.line)} 行`;
    case 'pdf': return `第 ${String(source.locator.page)} 页`;
    case 'image': return '图上一处';
    case 'docx': return '文档里一段';
  }
}
