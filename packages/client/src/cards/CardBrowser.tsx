/**
 * P5.6 the card library: ordinary cards and private knowledge, read from the
 * Host's own stores.
 *
 * Filtering and ordering only change the view — an unstudied card is visible
 * and learnable, and opening or sorting one writes nothing, so browsing never
 * creates a review row. Relations are read from the cards themselves, so the
 * radial view draws the links that really exist instead of a second index.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CardView } from '@studyforge/contracts/cards';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { useEffect, useMemo, useState } from 'react';
import { CardDetail } from './CardDetail.tsx';
import { CardEditor } from './CardEditor.tsx';
import { KnowledgeEditor } from './KnowledgeEditor.tsx';
import { MarkdownBody } from './MarkdownBody.tsx';
import { PRESENTATION_LABELS } from './format.ts';

export interface CardBrowserProps {
  readonly ctx: Context;
  readonly sessionId?: string;
  /** Bumped by the caller when something outside the browser saved a new card. */
  readonly refreshToken?: number;
  /** Where a row's source should open; the caller owns that preview. */
  readonly onSource?: (source: SourceAnchor) => void;
  /** Optional learn entry; absent means browsing stays read-only. */
  readonly onLearn?: (target: string) => void;
  /**
   * Open the library on this card instead of the list. The caller remounts the
   * browser with a new key when it wants the same card opened twice, so this
   * stays the initial position rather than a second live cursor.
   */
  readonly openTarget?: string;
}

type Filter = 'all' | 'card' | 'knowledge';
type Mode = 'order' | 'book' | 'radial';

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly cards: readonly CardView[]; readonly knowledge: readonly KnowledgeView[] };

/** The library view: filter, order, and open one object by its own identity. */
export function CardBrowser({ ctx, sessionId, refreshToken, onSource, onLearn, openTarget }: CardBrowserProps): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');
  const [mode, setMode] = useState<Mode>('order');
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | undefined>(openTarget);
  const [openKnowledge, setOpenKnowledge] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    Promise.all([ctx.remote.studyforgeLearning.cards(), ctx.remote.studyforgeLearning.knowledge()]).then(
      ([cards, knowledge]) => {
        if (!live) return;
        setState(cards.ok && knowledge.ok
          ? { status: 'ready', cards: cards.value, knowledge: knowledge.value }
          : { status: 'unavailable' });
      },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [ctx, revision, refreshToken]);

  const tags = useMemo(() => (state.status === 'ready'
    ? [...new Set([...state.cards.flatMap(card => card.content.tags), ...state.knowledge.flatMap(note => note.content.tags)])].sort()
    : []), [state]);

  if (state.status === 'loading') return <p className="sf-note" role="status" data-testid="card-browser-loading">正在看你的卡片…</p>;
  if (state.status === 'unavailable') return <p className="sf-note" role="status" data-testid="card-browser-unavailable">卡片暂时取不到，稍后再看一次。</p>;

  const matches = (title: string, rowTags: readonly string[]): boolean =>
    (tag === undefined || rowTags.includes(tag)) && (query.trim() === '' || title.includes(query.trim()));
  const cards = filter === 'knowledge' ? [] : state.cards.filter(card => matches(card.content.title, card.content.tags));
  const knowledge = filter === 'card' ? [] : state.knowledge.filter(note => matches(note.content.title, note.content.tags));
  const reload = (): void => { setRevision(value => value + 1); };

  if (open !== undefined) {
    const seed = state.cards.find(card => card.ref === open);
    return <section className="sf-cards" data-testid="studyforge-cards">
      <CardDetail ctx={ctx} target={open} {...(sessionId === undefined ? {} : { sessionId })}
        {...(seed === undefined ? {} : { seed })}
        {...(onSource === undefined ? {} : { onSource })}
        onBack={() => { setOpen(undefined); reload(); }}
        onChange={() => { reload(); }} />
    </section>;
  }
  if (openKnowledge !== undefined) {
    const seed = state.knowledge.find(note => note.ref === openKnowledge);
    if (seed === undefined) return <p className="sf-note" role="status">这条知识已经不在了，返回列表看看。</p>;
    return <section className="sf-cards" data-testid="studyforge-cards">
      <KnowledgeEditor ctx={ctx} target={openKnowledge} seed={seed} {...(sessionId === undefined ? {} : { sessionId })}
        onSaved={() => { reload(); setOpenKnowledge(undefined); }}
        onDeleted={() => { reload(); setOpenKnowledge(undefined); }}
        onCancel={() => { setOpenKnowledge(undefined); }} />
    </section>;
  }
  if (creating) return <section className="sf-cards" data-testid="studyforge-cards">
    <CardEditor ctx={ctx} {...(sessionId === undefined ? {} : { sessionId })}
      onSaved={view => { setCreating(false); setOpen(view.ref); reload(); }}
      onCancel={() => { setCreating(false); }} />
  </section>;

  return <section className="sf-cards" data-testid="studyforge-cards">
    <header className="sf-cards-head">
      <h2>卡片</h2>
      <button type="button" className="sf-action" data-testid="card-browser-create" onClick={() => { setCreating(true); }}>新建卡片</button>
    </header>
    <div className="sf-cards-controls">
      <div className="sf-chip-row" role="group" aria-label="种类">
        {(['all', 'card', 'knowledge'] as const).map(value => <button type="button" key={value}
          className={filter === value ? 'sf-chip sf-chip-on' : 'sf-chip'} data-testid={`card-filter-${value}`}
          aria-pressed={filter === value} onClick={() => { setFilter(value); }}>{filterLabel(value)}</button>)}
      </div>
      <div className="sf-chip-row" role="group" aria-label="顺序">
        {(['order', 'book', 'radial'] as const).map(value => <button type="button" key={value}
          className={mode === value ? 'sf-chip sf-chip-on' : 'sf-chip'} data-testid={`card-mode-${value}`}
          aria-pressed={mode === value} onClick={() => { setMode(value); }}>{modeLabel(value)}</button>)}
      </div>
      <input className="sf-cards-search" data-testid="card-browser-search" placeholder="按标题找" value={query}
        onChange={event => { setQuery(event.target.value); }} />
    </div>
    {tags.length > 0 && <div className="sf-chip-row" role="group" aria-label="标签">
      {tags.map(value => <button type="button" key={value}
        className={tag === value ? 'sf-chip sf-chip-on' : 'sf-chip'} data-testid="card-tag" aria-pressed={tag === value}
        onClick={() => { setTag(tag === value ? undefined : value); }}>{value}</button>)}
    </div>}

    {mode === 'radial' ? <RadialMap cards={cards} onOpen={ref => { setOpen(ref); }} />
      : <ul className="sf-card-list sf-linear-tree" data-testid="card-list">
        {mode === 'book' ? groupByBook(cards).map(([chapter, rows]) => <li key={chapter} className="sf-card-group">
          <h3 className="sf-card-group-title">{chapter}</h3>
          <ul className="sf-linear-tree">{rows.map(card => <CardRow key={card.ref} card={card} onOpen={setOpen} onLearn={onLearn} />)}</ul>
        </li>) : cards.map(card => <CardRow key={card.ref} card={card} onOpen={setOpen} onLearn={onLearn} />)}
        {knowledge.map(note => <li key={note.ref} className="sf-card-row" data-testid="card-row" data-kind="knowledge">
          <button type="button" className="sf-card-row-open" data-testid="card-row-open" onClick={() => { setOpenKnowledge(note.ref); }}>
            <span className="sf-card-row-title">{note.content.title}</span>
            <span className="sf-meta">知识 · {note.collection === undefined ? '还没收录' : '已经收录'}{note.content.tags.length > 0 ? ` · ${note.content.tags.join('、')}` : ''}</span>
          </button>
        </li>)}
        {cards.length === 0 && knowledge.length === 0 && <li className="sf-note" data-testid="card-list-empty">这里还没有符合条件的内容。</li>}
      </ul>}
  </section>;
}

/** One ordinary card row: display kind, tags, chapter and how it is going. */
function CardRow({ card, onOpen, onLearn }: {
  readonly card: CardView;
  readonly onOpen: (target: string) => void;
  readonly onLearn?: ((target: string) => void) | undefined;
}): React.JSX.Element {
  return <li className="sf-card-row" data-testid="card-row" data-kind="card">
    <button type="button" className="sf-card-row-open" data-testid="card-row-open" onClick={() => { onOpen(card.ref); }}>
      <span className="sf-card-row-title">{card.content.title}</span>
      {card.content.front && <span className="sf-card-face-preview">{clip(card.content.front, 180)}</span>}
      <span className="sf-meta">{PRESENTATION_LABELS[card.content.presentation]}
        {card.content.chapter === undefined ? ' · 未归书' : ` · ${card.content.chapter}`}
        {card.content.tags.length > 0 ? ` · ${card.content.tags.join('、')}` : ''}
        {card.review === undefined ? ' · 还没学过' : ` · 下次 ${card.review.nextDue}`}</span>
    </button>
    {/* Learning an unstudied card is allowed here and writes nothing by itself. */}
    {onLearn !== undefined && <button type="button" className="sf-quiet" data-testid="card-row-learn"
      data-card-ref={card.ref} onClick={() => { onLearn(card.ref); }}>{card.review === undefined ? '开始学' : '复习'}</button>}
  </li>;
}

/** Cards grouped by the book hook they really carry. */
function groupByBook(cards: readonly CardView[]): readonly (readonly [string, readonly CardView[]])[] {
  const groups = new Map<string, CardView[]>();
  for (const card of cards) {
    const key = card.content.chapter ?? '未归书';
    const rows = groups.get(key);
    if (rows === undefined) groups.set(key, [card]); else rows.push(card);
  }
  return [...groups.entries()];
}

/** The same cards drawn as nodes and their real links; nothing here is written. */
function RadialMap({ cards, onOpen }: {
  readonly cards: readonly CardView[];
  readonly onOpen: (target: string) => void;
}): React.JSX.Element {
  const size = 320, center = size / 2, radius = cards.length <= 1 ? 0 : 118;
  const at = new Map(cards.map((card, index) => [card.ref, {
    x: center + radius * Math.cos((2 * Math.PI * index) / Math.max(cards.length, 1)),
    y: center + radius * Math.sin((2 * Math.PI * index) / Math.max(cards.length, 1)),
  }]));
  return <div className="sf-radial" data-testid="card-radial">
    <svg viewBox={`0 0 ${String(size)} ${String(size)}`} width="100%" height="320" role="img" aria-label="卡片关系图">
      {cards.flatMap(card => card.content.links.flatMap(link => {
        const from = at.get(card.ref), to = at.get(link);
        return from === undefined || to === undefined ? []
          : [<line key={`${card.ref}->${link}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#cfc7ae" strokeWidth={1} />];
      }))}
      {cards.map(card => {
        const spot = at.get(card.ref);
        return spot === undefined ? null : <g key={card.ref}>
          <circle cx={spot.x} cy={spot.y} r={7} fill="#26437c" />
          <text x={spot.x} y={spot.y - 12} textAnchor="middle" fontSize={11} fill="#5a688a">{clip(card.content.title, 10)}</text>
        </g>;
      })}
    </svg>
    <ul className="sf-radial-list sf-linear-tree" data-testid="card-radial-list">
      {cards.map(card => <li key={card.ref}><button type="button" className="sf-quiet" data-testid="card-radial-open"
        onClick={() => { onOpen(card.ref); }}>{card.content.title}</button></li>)}
    </ul>
  </div>;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function filterLabel(value: Filter): string {
  return value === 'all' ? '全部' : value === 'card' ? '普通卡' : '知识';
}

function modeLabel(value: Mode): string {
  return value === 'order' ? '顺序' : value === 'book' ? '按书' : '关系图';
}
