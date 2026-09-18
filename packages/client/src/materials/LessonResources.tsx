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
 * opening, focusing and reading stay read-only. The empty desk also offers
 * explicit student file import through the shared lesson upload workflow.
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
import { MarkdownBody } from '../cards/MarkdownBody.tsx';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import { focusEntityNode } from './entity-reference-focus.ts';
import { LessonImport } from '../classroom/LessonImport.tsx';
import { Mindmap, type MindNode } from './mindmap.tsx';
import { kindLabel, lessonMindProjection, positionLabel, versionKeyOf } from './lesson-materials-mindmap.ts';
import { closeSheet, emptyDeck, lessonDecks, lessonRelations, openSheet, parentTrail, type DeckContent } from './lesson-deck.ts';
import { bookNodeIntent, breakdownLabel, type BreakdownAction } from './book-breakdown.ts';
import { SourcePane, type SourcePaneFace } from './SourcePane.tsx';
import { ContentHistory } from './ContentHistory.tsx';
import { heldSourceReferences } from './source-references-holder.ts';
import { requestLessonPane, subscribeLessonPane } from './lesson-pane-request.ts';
import './lesson-pane.css';
import { workbenchMaterials } from './workbench-materials.ts';
import { revealWorkspaceView } from '../classroom/workspace-layout.ts';

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
type PaneOpen = DeckContent;

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
  const [deck, setDeck] = useState(() => lessonDecks.get(sessionId) ?? emptyDeck());
  const { expanded, selected } = deck;
  const setSelected = (key: string | undefined): void => { setDeck(old => ({ ...old, selected: key })); };
  const setOpen = (content: PaneOpen, key?: string): void => { setDeck(old => openSheet(old, content, key)); };
  const surface = useRef<HTMLDivElement>(null);
  /** A pointer or focus inside the desk already saw the column; scrolling on
   *  that activation would move the click target mid-gesture. */
  const activatedInside = useRef(false);
  useEffect(() => { lessonDecks.set(sessionId, deck); }, [sessionId, deck]);
  useEffect(() => {
    const desk = surface.current;
    if (activatedInside.current) { activatedInside.current = false; return; }
    if (desk?.dataset.referenceActive === 'true') { desk.scrollLeft = 0; return; }
    const columns = desk?.querySelectorAll<HTMLElement>('[data-sheet-id]');
    const column = [...(columns ?? [])].find(element => element.dataset.sheetId === (deck.active ?? 'map'));
    if (!desk || !column) return;
    const left = column.getBoundingClientRect().left - desk.getBoundingClientRect().left + desk.scrollLeft;
    if (left < desk.scrollLeft) desk.scrollLeft = left;
    else if (left + column.offsetWidth > desk.scrollLeft + desk.clientWidth) desk.scrollLeft = left + column.offsetWidth - desk.clientWidth;
  }, [deck.active]);
  const [structures, setStructures] = useState<ReadonlyMap<string, BookStructure>>(() => new Map());
  const [materials, setMaterials] = useState<readonly MaterialView[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [library, setLibrary] = useState<{ readonly mediaTypes: ReadonlyMap<string, string>; readonly titles: ReadonlyMap<string, string> }>(() => ({ mediaTypes: new Map(), titles: new Map() }));
  const [cards, setCards] = useState<ReadonlyMap<string, CardView>>(() => new Map());
  const [pinnedCards, setPinnedCards] = useState<ReadonlyMap<string, CardView>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(0);
  const [userRelations, setUserRelations] = useState<import('@studyforge/contracts/library').LibraryRelation[]>([]);
  const [knowledge, setKnowledge] = useState<import('@studyforge/contracts/knowledge').KnowledgeView[]>([]);
  useEffect(() => { let live = true; void ctx.remote.studyforgeLearning.knowledge().then(result => { if (live && result.ok) setKnowledge(result.value); }).catch(() => {}); return () => { live = false; }; }, [ctx, focus, refreshToken]);
  useEffect(() => { let live = true; void ctx.remote.studyforgeLibrary.relations().then(result => { if (live && result.ok) setUserRelations(result.value); }).catch(() => {}); return () => { live = false; }; }, [ctx, focus, refreshToken]);
  const [sending, setSending] = useState(false);
  const attempt = useRef<{ key: string; id: string }>();
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
    window.addEventListener('studyforge:learning-changed', update);
    return () => { window.removeEventListener('focus', update); window.removeEventListener('studyforge:learning-changed', update); };
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
    if (request.entity) setDeck(old => ({ ...old, scope: 'all' }));
    setOpen(request);
  }), [sessionId]);

  useEffect(() => {
    let live = true;
    void host.materials().then(
      result => {
        if (!live) return;
        if (result.ok) { setMaterials(result.value); setLibraryStatus('ready'); }
        else setLibraryStatus('failed');
        setLibrary(result.ok
          ? { mediaTypes: new Map(result.value.map(view => [view.materialId, view.mediaType])), titles: new Map(result.value.map(view => [view.materialId, view.title])) }
          : { mediaTypes: new Map(), titles: new Map() });
      },
      // An unknown file type leaves the book read itself to answer.
      () => { if (live) setLibraryStatus('failed'); },
    );
    void host.cards().then(
      result => { if (live) setCards(result.ok ? new Map(result.value.map(view => [view.ref, view])) : new Map()); },
      () => { if (live) setCards(new Map()); },
    );
    return () => { live = false; };
    // The shelf and the card library move outside this pane too (a book is
    // imported, a card is saved), so the names re-read with the deck.
  }, [host, refreshToken, focus]);

  const rows = useMemo(() => {
    const lesson = state.status === 'ready' ? state.rows : [];
    if (deck.scope === 'lesson') return lesson;
    const inventory = [...workbenchMaterials(materials, lesson)];
    for (const sheet of deck.sheets) if ('entity' in sheet.content && sheet.content.entity) for (const source of sheet.content.entity.sources) {
      if (!inventory.some(row=>row.source?.materialId===source.materialId && row.source.versionId===source.versionId)) inventory.push({kind:'material',target:null,tabKey:`material:${source.materialId}@${source.versionId}`,title:library.titles.get(source.materialId)??'原文',source:{materialId:source.materialId,versionId:source.versionId},quote:null,origins:[]});
    }
    for (const item of [...cards.values(), ...knowledge]) if (!inventory.some(row => row.target === item.ref)) inventory.push({ kind: item.ref.startsWith('card:') ? 'card' : 'knowledge', target: item.ref, tabKey: item.ref, title: item.content.title, source: null, quote: null, origins: [] });
    return inventory;
  }, [state, materials, cards, knowledge, deck.scope, deck.sheets, library]);
  useEffect(() => {
    let live = true;
    const pinned = state.status === 'ready' ? state.rows.filter(row => row.kind === 'card' && row.target !== null && row.cardVersion !== undefined) : [];
    void Promise.all(pinned.map(async row => {
      const result = await host.card({ target: row.target!, version: row.cardVersion! }).catch(() => undefined);
      return result?.ok ? [`${row.target!}@${String(row.cardVersion)}`, result.value] as const : undefined;
    })).then(results => { if (live) setPinnedCards(new Map(results.flatMap(result => result ? [result] : []))); });
    return () => { live = false; };
  }, [host, state]);
  const projection = useMemo(() => lessonMindProjection({
    rows, structures, mediaTypeOf: materialId => library.mediaTypes.get(materialId),
    materialTitleOf: materialId => library.titles.get(materialId),
    cardTitleOf: (target, version) => (version === undefined ? cards.get(target) : pinnedCards.get(`${target}@${String(version)}`))?.content.title,
  }), [rows, structures, library, cards, pinnedCards]);
  const graph = useMemo(() => {
    const graph = lessonRelations(projection, cards, pinnedCards, deck.related, id => library.titles.get(id), expanded);
    const keyOf = (ref: string): string | undefined => graph.nodes.find(node => {
      const row = projection.rows.get(node.key), book = projection.books.get(node.key);
      return row?.target === ref || (row?.source && 'material:' + row.source.materialId === ref) || (book && 'target' in book && book.target === ref);
    })?.key;
    for (const edge of userRelations) { const from = keyOf(edge.from), to = keyOf(edge.to); if (from && to) graph.edges.push({ from, to, label: edge.label }); }
    const focusKeys = new Map<string,string>(), versions = new Map([...cards.values(),...knowledge].map(row=>[row.ref,row.version]));
    for (const sheet of deck.sheets) if ('entity' in sheet.content && sheet.content.entity) {
      const source = sheet.content.kind === 'source' && sheet.sourceIndex !== undefined ? sheet.content.anchors[sheet.sourceIndex] : undefined;
      const entity = source ? { ...sheet.content.entity, reference: { kind: 'source' as const, source }, sources: [source] } : sheet.content.entity;
      const result = focusEntityNode(graph.nodes,projection,versions,entity);
      graph.nodes=result.nodes; focusKeys.set(sheet.id,result.key); graph.requests.set(result.key,sheet.content);
    }
    return {...graph,focusKeys};
  }, [projection, cards, pinnedCards, deck.related, library, expanded, userRelations, deck.sheets, knowledge]);
  useEffect(() => {
    const sheet = deck.sheets.find(item => item.id === deck.active); if (!sheet) return;
    const focusKey = graph.focusKeys.get(sheet.id);
    if (!focusKey && sheet.nodeKey) return;
    const key = focusKey ?? graph.nodes.find(node => { const row = projection.rows.get(node.key), book = projection.books.get(node.key); return sheet.content.kind === 'source' ? row?.source?.materialId === sheet.content.anchors[0]?.materialId && row?.source?.versionId === sheet.content.anchors[0]?.versionId && JSON.stringify(row?.source?.locator)===JSON.stringify(sheet.content.anchors[0]?.locator) : row?.target === sheet.content.target && (!('version' in sheet.content) || sheet.content.version===undefined || (row.cardVersion??cards.get(sheet.content.target)?.version)===sheet.content.version) || (book && 'target' in book && book.target === sheet.content.target && (!('version' in sheet.content)||sheet.content.version===undefined||cards.get(sheet.content.target)?.version===sheet.content.version)); })?.key;
    if (!key) return;
    const parents = parentTrail(graph.nodes, key).map(node => node.key), focusTrail = JSON.stringify(parents);
    if (sheet.nodeKey === key && sheet.focusTrail === focusTrail) return;
    setDeck(old => ({ ...old, selected: key, expanded: [...new Set([...old.expanded, ...parents])], sheets: old.sheets.map(item => item.id === sheet.id ? { ...item, nodeKey: key, focusTrail } : item) }));
  }, [deck.active, deck.sheets, graph, projection]);
  useEffect(() => {
    const sheet=deck.sheets.find(item=>item.id===deck.active);
    if (sheet && 'entity' in sheet.content && sheet.content.entity) for(const source of sheet.content.entity.sources) readBook(source);
  }, [deck.active, deck.sheets]);
  // Reopening the native deck restores navigation, then reads these books anew.
  useEffect(() => {
    for (const [key, row] of projection.rows) if (row.source && expanded.includes(key) && !structures.has(versionKeyOf(row.source.materialId, row.source.versionId))) readBook(row.source);
  }, [projection.rows, expanded, structures]);

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
  const reading = useRef(new Set<string>());
  function readBook(source: MaterialContext): void {
    const key = versionKeyOf(source.materialId, source.versionId);
    if (reading.current.has(key) || structures.has(key)) return;
    reading.current.add(key);
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
    ).finally(() => { reading.current.delete(key); setBusy(reading.current.size > 0); });
  }

  function expand(node: MindNode, next: boolean): void {
    setSelected(node.key);
    setDeck(old => ({ ...old, expanded: next ? [...new Set([...old.expanded, node.key])] : old.expanded.filter(key => key !== node.key) }));
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
    const related = graph.requests.get(node.key);
    if (related) { setOpen(related, node.key); return; }
    const row = projection.rows.get(node.key);
    if (row !== undefined) {
      if (row.source !== null) {
        if (node.kind === 'book' && !structures.has(versionKeyOf(row.source.materialId, row.source.versionId))) readBook(row.source);
        setOpen({ kind: 'source', title: node.title, anchors: [anchorOf(row.source)] }, node.key);
        return;
      }
      if (row.target === null) return;
      if (row.kind === 'card' || row.kind === 'knowledge') {
        setOpen({ kind: row.kind, title: node.title, target: row.target, ...(row.cardVersion === undefined ? {} : { version: row.cardVersion }) }, node.key);
        return;
      }
      if (renderObject !== undefined) setOpen({ kind: 'object', title: row.title ?? kindLabel(row.kind), target: row.target });
      return;
    }
    const book = projection.books.get(node.key);
    if (book === undefined) return;
    if (book.kind === 'card' || book.kind === 'knowledge') {
      setOpen({ kind: book.kind, title: book.title, target: book.target }, node.key);
      return;
    }
    if (book.sources.length > 0) { setOpen({ kind: 'source', title: book.title, anchors: book.sources.map(asContext) }, node.key); return; }
    // No exact anchor is a real state, not a reason to guess one.
    setNotice('这一节还没有能精确定位的原文，先按结构看。');
  }

  function relate(node: MindNode, toggle = true): void {
    setDeck(old => ({ ...old, active: undefined, selected: node.key, related: old.related.includes(node.key) ? (toggle ? old.related.filter(key => key !== node.key) : old.related) : [...old.related, node.key] }));
  }
  function breakdownTarget(node: MindNode): { tree: BookStructure; node: BookStructure['nodes'][number] } | undefined {
    if (node.kind !== 'book' && node.kind !== 'section') return undefined;
    const row = projection.rows.get(node.key);
    if (row?.source) {
      const tree = structures.get(versionKeyOf(row.source.materialId, row.source.versionId));
      const root = tree?.nodes.find(item => item.kind === 'book');
      return tree && root ? { tree, node: root } : undefined;
    }
    const target = projection.books.get(node.key);
    const tree = target && [...structures.values()].find(value => value.nodes.includes(target));
    return tree && target ? { tree, node: target } : undefined;
  }
  async function breakdown(node: MindNode, action: BreakdownAction, range?: SourceAnchor): Promise<void> {
    const target = breakdownTarget(node);
    if (!target || sending) return;
    const intent = { ...bookNodeIntent(target.tree, target.node, action), ...(range ? { sources: [range] } : {}) }, key = JSON.stringify({ sessionId, intent });
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    setSending(true); setNotice(undefined);
    try {
      const result = await ctx.remote.studyforgeOrganization.breakdown({ sessionId, operationId: attempt.current.id, intent });
      if (staged.current !== sessionId) return;
      if (!result.ok) { setNotice('这次没能开始整理。请刷新节点后重试，已有内容仍保留。'); return; }
      attempt.current = undefined;
      setDeck(old => ({ ...old, active: undefined, selected: node.key, expanded: [...new Set([...old.expanded, ...parentTrail(graph.nodes, node.key).map(parent => parent.key), node.key])] }));
    } catch { if (staged.current === sessionId) setNotice('暂时没有收到结果，再试会核对同一次整理。'); }
    finally { setSending(false); }
  }
  return <div className="sf-lesson-materials" data-testid="lesson-materials" data-view={deck.sheets.length ? 'deck' : 'map'}>
    <div className="sf-workbench-filter">
      <select aria-label="工作台资料范围" data-testid="workbench-scope" value={deck.scope ?? 'all'} onChange={event => {
        const scope = event.target.value as 'all' | 'lesson'; setDeck(old => ({ ...old, scope, active: undefined }));
      }}><option value="all">全部资料</option><option value="lesson">本节课用到的</option></select>
    </div>
    {deck.sheets.length > 0 && <nav className="sf-deck-index" aria-label="工作台中打开的内容">
      <button type="button" className="sf-quiet" aria-pressed={deck.active === undefined} onClick={() => { setDeck(old => ({ ...old, active: undefined })); }}>关系图</button>
      {deck.sheets.map(sheet => <button key={sheet.id} type="button" className="sf-quiet" aria-pressed={deck.active === sheet.id}
        onClick={() => { setDeck(old => ({ ...old, active: sheet.id })); }}>{sheet.content.title}</button>)}
    </nav>}
    <div className="sf-deck-surface" ref={surface} data-testid="lesson-deck-surface" data-reference-active={deck.sheets.some(sheet => sheet.id === deck.active && 'entity' in sheet.content && !!sheet.content.entity)}>
    <section className="sf-deck-map" data-sheet-id="map" aria-label="资料白板">
    {(deck.scope === 'lesson' ? state.status : libraryStatus) !== 'ready' ? <p className="sf-note" role="status">{(deck.scope === 'lesson' ? state.status : libraryStatus) === 'loading' ? '正在读取资料…' : '资料暂时取不到，请稍后刷新。'}</p> : graph.nodes.length === 0 && deck.scope === 'lesson' ?
      <div className="sf-workbench-empty"><p>本节课还没有引用资料</p><button type="button" className="sf-quiet" onClick={() => setDeck(old => ({ ...old, scope: 'all' }))}>查看全部资料</button></div> : graph.nodes.length === 0 ?
    <div className="sf-empty-materials" data-testid="lesson-materials-empty">
      <LessonImport ctx={ctx} sessionId={sessionId} appearance="classroom" active={browseId !== undefined} onOpen={material => {
        requestLessonPane(sessionId, { kind: 'source', title: material.title, anchors: [{ materialId: material.materialId, versionId: material.currentVersion.versionId }] });
      }} />
    </div> :
    <Mindmap testId="lesson-materials-map" label={deck.scope === 'lesson' ? '本节课用到的资料' : '资料白板'} nodes={graph.nodes} mode="map" relations={graph.edges}
      expanded={expanded} selected={selected} onPick={pick} onExpand={expand} busy={busy || sending}
      action={{ label: node => deck.related.includes(node.key) ? '收起关联' : '展开关联', when: node => graph.canRelate(node.key), run: relate }}
      actions={(['directory', 'cards'] as const).map(action => ({ label: breakdownLabel(action), when: node => node.key === selected && breakdownTarget(node) !== undefined, run: node => { void breakdown(node, action); } }))}
      nodeTestId="lesson-resource-row" labelTestId="lesson-resource-open" />}
    </section>
    {deck.sheets.map(sheet => {
      const open = sheet.content, activeBrowseId = deck.active === sheet.id ? browseId : undefined;
      const trail = parentTrail(graph.nodes, sheet.nodeKey);
      const node = graph.nodes.find(candidate => candidate.key === sheet.nodeKey);
      const close = (): void => { setDeck(old => closeSheet(old, sheet.id)); };
      const activate = (): void => {
        setDeck(old => {
          if (old.active === sheet.id) return old;
          activatedInside.current = true;
          return { ...old, active: sheet.id };
        });
      };
      return <div className="sf-deck-sheet" key={sheet.id} data-sheet-id={sheet.id} data-active={deck.active === sheet.id}
        onPointerDownCapture={activate}
        onFocusCapture={activate}>
      <Pane open={open} onBack={close} sourceIndex={sheet.sourceIndex}>
        <nav className="sf-deck-trail" aria-label="父级与关系">
          {trail.map(parent => <button type="button" className="sf-quiet" data-testid="deck-parent" key={parent.key} onClick={() => { pick(parent); }}>↑ {parent.title}</button>)}
          {node && graph.canRelate(node.key) && <button type="button" className="sf-quiet" onClick={() => { relate(node, false); }}>查看关联</button>}
          {node && breakdownTarget(node) && (['directory', 'cards'] as const).map(action => <button type="button" className="sf-quiet" key={action} disabled={sending}
            onClick={() => { void breakdown(node, action); }}>{breakdownLabel(action)}</button>)}
        </nav>
        {open.kind === 'source'
          ? <><SourcePane ctx={ctx} face={host} sessionId={sessionId} anchors={open.anchors} browseId={activeBrowseId} sourceIndex={sheet.sourceIndex}
              onLocate={(_, sourceIndex) => setDeck(old => ({ ...old, sheets: old.sheets.map(item => item.id === sheet.id ? { ...item, sourceIndex, nodeKey: undefined } : item) }))} />
            {open.anchors.map((source, i) => <ContentHistory key={i} ctx={ctx} query={{ source }} refreshToken={refreshToken}
              onRefine={node && breakdownTarget(node) ? anchor => { void breakdown(node, 'directory', anchor); } : undefined}
              onSource={anchor => setOpen({ kind: 'source', title: open.title, anchors: [anchor] })} />)}</>
          : open.kind === 'card'
            ? <CardPane ctx={ctx} host={host} sessionId={sessionId} target={open.target} version={open.version} browseId={activeBrowseId}
              onSource={(anchors, title) => { setOpen({ kind: 'source', title, anchors }); }} />
            : open.kind === 'knowledge'
              ? open.version === undefined ? <KnowledgeEditor ctx={ctx} target={open.target} sessionId={sessionId} onSaved={() => { setFocus(n => n + 1); }} /> : <KnowledgeReference ctx={ctx} target={open.target} version={open.version} />
              : renderObject?.(open.target, { back: close, source: (anchors, title) => { setOpen({ kind: 'source', title, anchors }); } }) ?? <p className="sf-note" role="status">这份记录暂时打不开。</p>}
      </Pane>
      </div>;
    })}
    </div>
    {notice !== undefined && <p className="sf-note" role="status" data-testid="lesson-resources-notice">{notice}</p>}
  </div>;
}

/** One pane: a back to the map, the node's own name, and the body it opened. */
function Pane({ open, onBack, children, sourceIndex = 0 }: { readonly open: PaneOpen; readonly onBack: () => void; readonly children: ReactNode; readonly sourceIndex?: number | undefined }): React.JSX.Element {
  const locator = open.kind === 'source' ? open.anchors[sourceIndex]?.locator : undefined;
  const hint = locator === undefined ? undefined : positionLabel(locator);
  return <section className="sf-lesson-pane" data-testid="lesson-materials-pane" data-pane={open.kind}>
    <header className="sf-lesson-pane-head">
      <span className="sf-lesson-pane-title">{open.title}</span>
      <button type="button" className="sf-quiet sf-deck-close" data-testid="mindmap-back" aria-label={`收起${open.title}`} onClick={onBack}>×</button>
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
  return <><div className="sf-source-actions"><button type="button" className="sf-quiet" onClick={() => {
    references?.stage(sessionId, view.content.title, { currentMaterial: { kind: 'card', cardRef: view.ref, cardVersion: view.version } });
    revealWorkspaceView(sessionId, 'chat');
  }}>带入对话</button></div><CardDetail key={`${target}@${String(version ?? 'current')}`} ctx={ctx} target={target} seed={view} sessionId={sessionId}
    {...(version === undefined ? {} : { version, readonly: true })}
    onSource={anchor => { onSource([asContext(anchor)], view.content.title); }} /></>;
}

/** One immutable version plus one position, exactly as the projection spelled it. */
function anchorOf(source: MaterialContext): MaterialContext {
  return { materialId: source.materialId, versionId: source.versionId, ...(source.locator === undefined ? {} : { locator: source.locator }) };
}

/** A saved anchor and a material context are the same reference minus its quote. */
function asContext(anchor: SourceAnchor): MaterialContext {
  return { materialId: anchor.materialId, versionId: anchor.versionId, locator: anchor.locator };
}

function KnowledgeReference({ctx,target,version}:{ctx:Context;target:string;version:number}):React.JSX.Element {
  const [value,setValue]=useState<KnowledgeView>(),[failed,setFailed]=useState(false);
  useEffect(()=>{let live=true;setValue(undefined);setFailed(false);void ctx.remote.studyforgeLearning.method({target,version}).then(reply=>{if(live){if(reply.ok)setValue(reply.value);else setFailed(true);}},()=>{if(live)setFailed(true);});return()=>{live=false;};},[ctx,target,version]);
  return <article className="sf-reference-note" data-testid="knowledge-reference" data-version={version}>{value?<><h2>{value.content.title}</h2><MarkdownBody text={value.content.body}/></>:<p role="status">{failed?'这份知识笔记暂时无法打开。':'正在打开知识笔记…'}</p>}</article>;
}
