/**
 * P4.1 "本课用到什么", drawn as this lesson's own material map.
 *
 * The nodes come from the Host's projection — the lesson's declared references,
 * the sources accepted messages carried, and the objects the lesson really
 * saved — so a card that belongs to no book is its own node rather than being
 * filed under a book nobody recorded. A row that really is a book opens into
 * that book's own read; nothing here guesses an owner or a position.
 *
 * Picking a node opens it in this same pane: an original is read through the
 * lesson's own grant, a card opens its detail. Going back keeps the map's
 * expansion and selection, because they are this component's own state, and the
 * whole thing writes nothing — opening, focusing and reading are reads.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { BookStructure } from '@studyforge/contracts/book-exploration';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialContext, SourceAnchor } from '@studyforge/contracts/materials';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { LessonResource, LessonResourcesProjection } from '@studyforge/domain/lesson-resources';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CardDetail } from '../cards/CardDetail.tsx';
import { KnowledgeEditor } from '../cards/KnowledgeEditor.tsx';
import { Mindmap, type MindNode } from './mindmap.tsx';
import { kindLabel, lessonMindProjection, positionLabel, versionKeyOf } from './lesson-materials-mindmap.ts';
import { SourcePane, type SourcePaneFace } from './SourcePane.tsx';
import { heldSourceReferences } from './source-references-holder.ts';
import { subscribeLessonPane } from './lesson-pane-request.ts';
import './lesson-pane.css';

/** The Host reads one lesson's map needs; the original's own reads come from the pane. */
export interface LessonResourcesFace extends SourcePaneFace {
  lessonResources(input: { readonly sessionId: string }): Promise<RemoteResult<LessonResourcesProjection>>;
  /** The library's own file types, so only a real book offers to open. */
  materials(): Promise<RemoteResult<MaterialView[]>>;
  /** The card library's own names, so a used card is not drawn as "卡片". */
  cards(): Promise<RemoteResult<readonly CardView[]>>;
  /** One book's own read-only tree, read in the lesson that is using it. */
  book(input: { readonly sessionId: string; readonly material: MaterialContext }): Promise<RemoteResult<BookStructure>>;
  /** A card row's own pinned revision, when the lesson declared one. */
  card(input: { readonly target: string; readonly version?: number }): Promise<RemoteResult<CardView>>;
}

/** Where one node opens: an original, a saved object, or the classroom's own face. */
type PaneOpen =
  | { readonly kind: 'source'; readonly title: string; readonly anchors: readonly MaterialContext[] }
  | { readonly kind: 'card' | 'knowledge'; readonly title: string; readonly target: string; readonly version?: number | undefined }
  | { readonly kind: 'object'; readonly title: string; readonly target: string };

/** What a pane hands back to the classroom's own object faces. */
export interface PaneControls {
  readonly back: () => void;
  readonly source: (anchors: readonly MaterialContext[], title: string) => void;
}

export interface LessonResourcesProps {
  readonly ctx: Context;
  readonly sessionId: string;
  readonly host: LessonResourcesFace;
  /** This pane's browse identity — the right column tab it is drawn in. */
  readonly browseId?: string | undefined;
  /** Changes when the lesson's own state moved (a turn settled, its settings were saved). */
  readonly refreshToken?: string | number | boolean | undefined;
  /** The classroom's own object faces (记忆/小结/计划…), drawn inside this pane. */
  readonly renderObject?: ((target: string, controls: PaneControls) => ReactNode) | undefined;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly rows: readonly LessonResource[] };

/** The lesson's materials, each node opening where it really points. */
export function LessonResources({ ctx, sessionId, host, browseId, refreshToken, renderObject }: LessonResourcesProps): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [structures, setStructures] = useState<ReadonlyMap<string, BookStructure>>(() => new Map());
  const [library, setLibrary] = useState<{ readonly mediaTypes: ReadonlyMap<string, string>; readonly titles: ReadonlyMap<string, string> }>(() => ({ mediaTypes: new Map(), titles: new Map() }));
  const [cardTitles, setCardTitles] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [pinnedTitles, setPinnedTitles] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [open, setOpen] = useState<PaneOpen | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(0);
  const loaded = useRef<string | undefined>(undefined);
  /** The lesson on stage right now; an async tree read compares against it. */
  const staged = useRef(sessionId);
  staged.current = sessionId;
  const opened = useRef<ReadonlyMap<string, BookStructure>>(new Map());
  opened.current = structures;

  // A lesson's deck really changes outside this pane (a confirmation lands, the
  // teacher saves settings). Coming back to the window re-reads it, so the map
  // is never a stale list presented as current.
  useEffect(() => {
    const update = (): void => { setFocus(n => n + 1); };
    window.addEventListener('focus', update);
    return () => { window.removeEventListener('focus', update); };
  }, []);
  // The classroom's own clicks — a message's source, a saved object's original —
  // land in this same pane instead of opening a second rail beside the map.
  useEffect(() => {
    let live = true;
    setNotice(undefined);
    // A different lesson starts clean; a re-read of the same one keeps the map
    // exactly where the student left it.
    if (loaded.current !== sessionId) {
      loaded.current = sessionId;
      setState({ status: 'loading' });
      setOpen(undefined);
      setExpanded([]);
      setSelected(undefined);
      setStructures(new Map());
    }
    host.lessonResources({ sessionId }).then(
      // An unreadable projection is not an empty lesson: the copy says which.
      result => { if (live) setState(result.ok ? { status: 'ready', rows: result.value.resources } : { status: 'unavailable' }); },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [host, sessionId, refreshToken, focus]);
  useEffect(() => subscribeLessonPane(sessionId, request => {
    setNotice(undefined);
    setOpen(request);
  }), [sessionId]);

  useEffect(() => {
    let live = true;
    void host.materials().then(
      result => {
        if (!live) return;
        setLibrary(result.ok
          ? { mediaTypes: new Map(result.value.map(view => [view.materialId, view.mediaType])), titles: new Map(result.value.map(view => [view.materialId, view.title])) }
          : { mediaTypes: new Map(), titles: new Map() });
      },
      // An unknown file type leaves the book read itself to answer.
      () => { if (live) setLibrary({ mediaTypes: new Map(), titles: new Map() }); },
    );
    void host.cards().then(
      result => { if (live) setCardTitles(result.ok ? new Map(result.value.map(view => [view.ref, view.content.title])) : new Map()); },
      () => { if (live) setCardTitles(new Map()); },
    );
    return () => { live = false; };
    // The shelf and the card library move outside this pane too (a book is
    // imported, a card is saved), so the names re-read with the deck.
  }, [host, refreshToken, focus]);

  const rows = state.status === 'ready' ? state.rows : [];
  useEffect(() => {
    let live = true;
    const pinned = state.status === 'ready' ? state.rows.filter(row => row.kind === 'card' && row.target !== null && row.cardVersion !== undefined) : [];
    void Promise.all(pinned.map(async row => {
      const result = await host.card({ target: row.target!, version: row.cardVersion! }).catch(() => undefined);
      return result?.ok ? [`${row.target!}@${String(row.cardVersion)}`, result.value.content.title] as const : undefined;
    })).then(results => { if (live) setPinnedTitles(new Map(results.flatMap(result => result ? [result] : []))); });
    return () => { live = false; };
  }, [host, state]);
  const projection = useMemo(() => lessonMindProjection({
    rows, structures, mediaTypeOf: materialId => library.mediaTypes.get(materialId),
    materialTitleOf: materialId => library.titles.get(materialId),
    cardTitleOf: (target, version) => version === undefined ? cardTitles.get(target) : pinnedTitles.get(`${target}@${String(version)}`),
  }), [rows, structures, library, cardTitles, pinnedTitles]);

  /**
   * A saved structure moves when 继续拆解's confirmation lands (the skeleton was
   * written) or when the student comes back to the window. Re-read whatever is
   * open so the map is never a stale tree presented as current.
   */
  useEffect(() => {
    const trees = [...opened.current.values()];
    if (trees.length === 0) return undefined;
    let live = true;
    void Promise.all(trees.map(tree => host.book({ sessionId, material: tree.material }).catch(() => undefined))).then(
      results => {
        if (!live) return;
        setStructures(current => {
          const next = new Map(current);
          for (const result of results) if (result?.ok === true) next.set(versionKeyOf(result.value.material.materialId, result.value.material.versionId), result.value);
          return next;
        });
      },
      // A refresh that fails leaves the tree it already had; the map stays open.
      () => undefined,
    );
    return () => { live = false; };
  }, [host, sessionId, refreshToken, focus]);

  /** Opening a book reads that exact version's own tree once; a failed read is not an empty book. */
  function readBook(source: MaterialContext): void {
    const key = versionKeyOf(source.materialId, source.versionId);
    const at = sessionId;
    setBusy(true);
    void host.book({ sessionId, material: { materialId: source.materialId, versionId: source.versionId } }).then(
      result => {
        // A tree read under another lesson's grant never lands in this one.
        if (staged.current !== at || loaded.current !== at) return;
        if (result.ok) setStructures(old => old.has(key) ? old : new Map(old).set(key, result.value));
        else setNotice('这本书的结构暂时读不出来，稍后再展开。');
      },
      () => { if (staged.current === at && loaded.current === at) setNotice('这本书的结构暂时读不出来，稍后再展开。'); },
    ).finally(() => { setBusy(false); });
  }

  function expand(node: MindNode, next: boolean): void {
    setExpanded(old => next ? (old.includes(node.key) ? old : [...old, node.key]) : old.filter(key => key !== node.key));
    setNotice(undefined);
    if (!next) return;
    const source = projection.rows.get(node.key)?.source;
    if (source === null || source === undefined || structures.has(versionKeyOf(source.materialId, source.versionId))) return;
    readBook(source);
  }

  /** One pick opens what the node really stands for, in this same pane. */
  function pick(node: MindNode): void {
    setSelected(node.key);
    setNotice(undefined);
    const row = projection.rows.get(node.key);
    if (row !== undefined) {
      if (row.source !== null) {
        setOpen({ kind: 'source', title: row.title ?? kindLabel(row.kind), anchors: [anchorOf(row.source)] });
        return;
      }
      if (row.target === null) return;
      if (row.kind === 'card' || row.kind === 'knowledge') {
        setOpen({ kind: row.kind, title: row.title ?? kindLabel(row.kind), target: row.target, ...(row.cardVersion === undefined ? {} : { version: row.cardVersion }) });
        return;
      }
      if (renderObject !== undefined) setOpen({ kind: 'object', title: row.title ?? kindLabel(row.kind), target: row.target });
      return;
    }
    const book = projection.books.get(node.key);
    if (book === undefined) return;
    if (book.kind === 'card' || book.kind === 'knowledge') {
      setOpen({ kind: book.kind, title: book.title, target: book.target });
      return;
    }
    if (book.sources.length > 0) { setOpen({ kind: 'source', title: book.title, anchors: book.sources.map(asContext) }); return; }
    // No exact anchor is a real state, not a reason to guess one.
    setNotice('这一节还没有能精确定位的原文，先按结构看。');
  }

  if (open !== undefined) return <div className="sf-lesson-materials" data-testid="lesson-materials" data-view="pane">
    <Pane open={open} onBack={() => { setOpen(undefined); }}>
      {open.kind === 'source'
        ? <SourcePane face={host} sessionId={sessionId} anchors={open.anchors} browseId={browseId} />
        : open.kind === 'card'
          ? <CardPane ctx={ctx} host={host} sessionId={sessionId} target={open.target} {...(open.version === undefined ? {} : { version: open.version })} browseId={browseId}
            onSource={(anchors, title) => { setOpen({ kind: 'source', title, anchors }); }} />
          : open.kind === 'knowledge'
            ? <KnowledgeEditor key={open.target} ctx={ctx} target={open.target} sessionId={sessionId} onSaved={() => { setNotice('已经收好。'); }} />
            : renderObject?.(open.target, { back: () => { setOpen(undefined); }, source: (anchors, title) => { setOpen({ kind: 'source', title, anchors }); } }) ?? <p className="sf-note" role="status">这份记录暂时打不开。</p>}
    </Pane>
  </div>;

  if (state.status === 'loading') return <p className="sf-note" role="status">正在看这节课用到什么…</p>;
  if (state.status === 'unavailable') return <p className="sf-note" role="status">这节课用到的资料暂时取不到，稍后再看一次。</p>;
  if (state.rows.length === 0) return <p className="sf-note" data-testid="lesson-resources-empty">这节课还没有用到资料。</p>;
  return <div className="sf-lesson-materials" data-testid="lesson-materials" data-view="map">
    <Mindmap testId="lesson-materials-map" label="这节课用到的资料" nodes={projection.nodes} mode="map"
      expanded={expanded} selected={selected} onPick={pick} onExpand={expand} busy={busy}
      nodeTestId="lesson-resource-row" labelTestId="lesson-resource-open"
      empty="这节课还没有用到资料。" />
    {notice !== undefined && <p className="sf-note" role="status" data-testid="lesson-resources-notice">{notice}</p>}
  </div>;
}

/** One pane: a back to the map, the node's own name, and the body it opened. */
function Pane({ open, onBack, children }: { readonly open: PaneOpen; readonly onBack: () => void; readonly children: ReactNode }): React.JSX.Element {
  const hint = open.kind === 'source' && open.anchors[0]?.locator !== undefined ? positionLabel(open.anchors[0].locator) : undefined;
  return <section className="sf-lesson-pane" data-testid="lesson-materials-pane" data-pane={open.kind}>
    <header className="sf-lesson-pane-head">
      <button type="button" className="sf-quiet" data-testid="mindmap-back" onClick={onBack}>← 脑图</button>
      <span className="sf-lesson-pane-title">{open.title}</span>
      {hint !== undefined && <span className="sf-meta">{hint}</span>}
    </header>
    {children}
  </section>;
}

/** One saved card, read here and remembered as what the composer is looking at. */
function CardPane({ ctx, host, sessionId, target, version, browseId, onSource }: {
  readonly ctx: Context;
  readonly host: LessonResourcesFace;
  readonly sessionId: string;
  readonly target: string;
  /** The lesson pinned this revision, so that version — not today's — is shown. */
  readonly version?: number | undefined;
  readonly browseId?: string | undefined;
  readonly onSource: (anchors: readonly MaterialContext[], title: string) => void;
}): React.JSX.Element {
  const [view, setView] = useState<CardView | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const references = heldSourceReferences();
  useEffect(() => {
    let live = true;
    setView(undefined);
    setFailed(false);
    void host.card({ target, ...(version === undefined ? {} : { version }) }).then(
      result => { if (!live) return; if (result.ok) setView(result.value); else setFailed(true); },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, [host, target, version]);
  useEffect(() => {
    if (view === undefined || references === undefined || browseId === undefined) return undefined;
    return references.browse(browseId, {
      sessionId, label: view.content.title,
      context: { currentMaterial: { kind: 'card', cardRef: view.ref, cardVersion: view.version } },
    });
  }, [references, browseId, sessionId, view]);
  if (failed) return <p className="sf-note" role="status">这张卡暂时打不开。</p>;
  if (view === undefined) return <p className="sf-note" role="status">正在打开卡片…</p>;
  // A pinned revision is a frozen original: shown, not edited, exactly as the
  // native card tab does for a versioned address.
  return <CardDetail key={`${target}@${String(version ?? 'current')}`} ctx={ctx} target={target} seed={view} sessionId={sessionId}
    {...(version === undefined ? {} : { version, readonly: true })}
    onSource={anchor => { onSource([asContext(anchor)], view.content.title); }} />;
}

/** One immutable version plus one position, exactly as the projection spelled it. */
function anchorOf(source: MaterialContext): MaterialContext {
  return { materialId: source.materialId, versionId: source.versionId, ...(source.locator === undefined ? {} : { locator: source.locator }) };
}

/** A saved anchor and a material context are the same reference minus its quote. */
function asContext(anchor: SourceAnchor): MaterialContext {
  return { materialId: anchor.materialId, versionId: anchor.versionId, locator: anchor.locator };
}
