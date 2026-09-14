import type { CardView } from '@studyforge/contracts/cards';
import type { LessonPaneRequest } from './lesson-pane-request.ts';
import type { LessonMindProjection } from './lesson-materials-mindmap.ts';
import { visibleMindNodes, type MindNode } from './mindmap-model.ts';

export type DeckContent = LessonPaneRequest | { readonly kind: 'object'; readonly title: string; readonly target: string };
export interface DeckSheet { readonly id: string; readonly content: DeckContent; readonly nodeKey?: string | undefined }
export interface DeckState {
  readonly scope?: 'all' | 'lesson';
  readonly sheets: readonly DeckSheet[];
  readonly active: string | undefined;
  readonly expanded: readonly string[];
  readonly related: readonly string[];
  readonly selected: string | undefined;
}
/** Only navigation is retained when the native tab closes; facts are always re-read. */
export const lessonDecks = new Map<string, DeckState>();
export const emptyDeck = (): DeckState => ({ sheets: [], active: undefined, expanded: [], related: [], selected: undefined });
export function sheetId(content: DeckContent): string {
  return content.kind === 'source' ? `source:${JSON.stringify(content.anchors)}`
    : `${content.kind}:${content.target}@${'version' in content ? String(content.version ?? 'current') : 'current'}`;
}
export function openSheet(state: DeckState, content: DeckContent, nodeKey?: string): DeckState {
  const id = sheetId(content), sheet = { id, content, nodeKey };
  return { ...state, sheets: state.sheets.some(old => old.id === id) ? state.sheets.map(old => old.id === id ? sheet : old) : [...state.sheets, sheet], active: id, selected: nodeKey ?? state.selected };
}
export function closeSheet(state: DeckState, id: string): DeckState {
  const sheets = state.sheets.filter(sheet => sheet.id !== id);
  return { ...state, sheets, active: state.active === id ? sheets.at(-1)?.id : state.active };
}

export interface RelationEdge { readonly from: string; readonly to: string; readonly label: string }
/** Follow only recorded links and source anchors. Relations are edges, never invented parents. */
export function lessonRelations(base: LessonMindProjection, cards: ReadonlyMap<string, CardView>, pinned: ReadonlyMap<string, CardView>, expanded: readonly string[], titleOf: (id: string) => string | undefined, hierarchy: readonly string[] = base.nodes.map(node => node.key)) {
  // A card remains owned by its book even while that branch is collapsed.
  // Pinned old revisions keep their own reading reference.
  const inBook = new Map([...base.books].flatMap(([key, node]) => node.kind === 'card' ? [[node.target, key] as const] : []));
  const aliases = new Map<string, string>();
  for (const [key, row] of base.rows) {
    const bookKey = row.target && inBook.get(row.target);
    if (bookKey && row.kind === 'card' && row.cardVersion === undefined) aliases.set(key, bookKey);
  }
  // Before the lazy book read arrives, source-bound cards wait under that
  // book. Once read, the authoritative chapter nodes above replace them.
  const owned = new Map<string, string>();
  for (const [key, row] of base.rows) {
    if (row.kind !== 'card' || row.cardVersion !== undefined || !row.target || aliases.has(key)) continue;
    const card = cards.get(row.target);
    const book = base.nodes.find(node => node.kind === 'book' && card?.content.sources.some(source => source.materialId === base.rows.get(node.key)?.source?.materialId));
    if (book) owned.set(key, book.key);
  }
  const nodes: MindNode[] = base.nodes.filter(node => !aliases.has(node.key)).map(node => ({ ...node,
    parent: owned.get(node.key) ?? node.parent,
    children: [...new Set([...node.children.filter(key => !aliases.has(key)), ...[...owned].filter(([, parent]) => parent === node.key).map(([key]) => key)])],
  })), requests = new Map<string, LessonPaneRequest>(), views = new Map<string, CardView>();
  const visible = new Set(visibleMindNodes(nodes, hierarchy).map(node => node.key));
  const relationsOpen = new Set(expanded.map(key => aliases.get(key) ?? key));
  for (const node of nodes) {
    const row = base.rows.get(node.key), book = base.books.get(node.key);
    const target = row?.kind === 'card' ? row.target : book?.kind === 'card' ? book.target : undefined;
    if (!target) continue;
    const view = row?.cardVersion === undefined ? cards.get(target) : pinned.get(`${target}@${String(row.cardVersion)}`);
    if (view) views.set(node.key, view);
  }
  const edges: RelationEdge[] = [], seenEdges = new Set<string>();
  const edge = (from: string, to: string, label: string): void => {
    if (from === to) return;
    const id = JSON.stringify([from, to, label]);
    if (!seenEdges.has(id)) { seenEdges.add(id); edges.push({ from, to, label }); }
  };
  const addCard = (view: CardView): string => {
    const existing = [...views].find(([key, candidate]) => candidate.ref === view.ref && candidate.version === view.version && (visible.has(key) || requests.has(key)))?.[0];
    if (existing) return existing;
    const key = `related:${view.ref}@${String(view.version)}`;
    views.set(key, view);
    requests.set(key, { kind: 'card', target: view.ref, title: view.content.title });
    nodes.push({ key, kind: 'card', title: view.content.title, hint: '关联卡片', children: [] });
    return key;
  };
  // The loop can discover another explicitly expanded card; keys deduplicate cycles.
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!, view = views.get(node.key);
    if (!view || !relationsOpen.has(node.key) || (!visible.has(node.key) && !requests.has(node.key))) continue;
    for (const ref of view.content.links) { const other = cards.get(ref); if (other) edge(node.key, addCard(other), '关联'); }
    for (const other of cards.values()) if (other.content.links.includes(view.ref)) edge(addCard(other), node.key, '关联');
    for (const anchor of view.content.sources) {
      const key = `source:${JSON.stringify(anchor)}`;
      if (!requests.has(key)) {
        const title = titleOf(anchor.materialId) ?? '原文';
        requests.set(key, { kind: 'source', title, anchors: [anchor] });
        nodes.push({ key, kind: 'material', title, hint: '卡片的原文位置', children: [] });
      }
      edge(node.key, key, '来源');
    }
  }
  const canRelate = (key: string): boolean => {
    const view = views.get(key);
    return view !== undefined && (view.content.sources.length > 0 || view.content.links.some(ref => cards.has(ref)) || [...cards.values()].some(card => card.ref !== view.ref && card.content.links.includes(view.ref)));
  };
  return { nodes, requests, edges, canRelate };
}

/** Recorded hierarchy only; a horizontal card link never becomes a breadcrumb. */
export function parentTrail(nodes: readonly MindNode[], key: string | undefined): MindNode[] {
  const byKey = new Map(nodes.map(node => [node.key, node])), seen = new Set<string>(), trail: MindNode[] = [];
  let node = key === undefined ? undefined : byKey.get(key);
  while (node?.parent && !seen.has(node.parent)) {
    seen.add(node.parent); node = byKey.get(node.parent);
    if (node) trail.unshift(node);
  }
  return trail;
}
