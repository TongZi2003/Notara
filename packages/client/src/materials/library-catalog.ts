import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import type { SetView } from '@studyforge/contracts/sets';
import type { BookStructure } from '@studyforge/contracts/book-exploration';

export interface LibraryItem {
  ref: string; title: string; kind: 'material' | 'card' | 'knowledge'; version: number;
  tags: readonly string[]; materialIds: readonly string[];
  chapter?: string | undefined;
  source?: { materialId: string; versionId: string };
}
export type LibraryKind = 'all' | LibraryItem['kind'];
export function libraryItems(materials: readonly MaterialView[], cards: readonly CardView[], knowledge: readonly KnowledgeView[]): LibraryItem[] {
  return [
    ...materials.map(m => ({ ref: 'material:' + m.materialId, title: m.title, kind: 'material' as const, version: m.revision,
      tags: [], materialIds: [m.materialId], source: { materialId: m.materialId, versionId: m.currentVersion.versionId } })),
    ...cards.map(c => ({ ref: c.ref, title: c.content.title, kind: 'card' as const, version: c.version,
      tags: [...new Set(c.content.tags)], materialIds: [...new Set(c.content.sources.map(s => s.materialId))], chapter: c.content.chapter })),
    ...knowledge.map(k => ({ ref: k.ref, title: k.content.title, kind: 'knowledge' as const, version: k.version,
      tags: [...new Set(k.content.tags)], materialIds: [] })),
  ];
}
export function belongsToSet(group: SetView, item: LibraryItem): boolean {
  return group.members.includes(item.ref) || item.materialIds.some(id => group.materials.includes(id));
}

/** Source hierarchy is derived from anchors, never from semantic links. A card
 * cited by two books can appear under both, retaining one editable identity. */
export function libraryCatalog(items: readonly LibraryItem[], scoped: readonly LibraryItem[], filter: { kind: LibraryKind; query: string; tag: string }) {
  const originals = items.filter(item => item.kind === 'material');
  const titleByMaterial = new Map(originals.map(item => [item.source!.materialId, item.title.toLocaleLowerCase()]));
  const query = filter.query.trim().toLocaleLowerCase();
  const matches = (item: LibraryItem): boolean => (filter.kind === 'all' || item.kind === filter.kind)
    && (!filter.tag || item.tags.includes(filter.tag))
    && (!query || [item.title, ...item.tags, item.chapter ?? ''].some(text => text.toLocaleLowerCase().includes(query))
      || item.materialIds.some(id => titleByMaterial.get(id)?.includes(query)));
  const visible = scoped.filter(matches);
  const matched = new Set(visible.map(item => item.ref));
  const cards = visible.filter(item => item.kind === 'card');
  const grouped = new Set<string>();
  const groups = originals.flatMap(source => {
    const children = cards.filter(card => card.materialIds.includes(source.source!.materialId));
    if (!matched.has(source.ref) && children.length === 0) return [];
    children.forEach(card => grouped.add(card.ref));
    const total = scoped.filter(item => item.kind === 'card' && item.materialIds.includes(source.source!.materialId)).length;
    return [{ source, cards: children, total }];
  });
  return { groups, cards: cards.filter(item => !grouped.has(item.ref)), knowledge: visible.filter(item => item.kind === 'knowledge'), count: visible.length };
}

export interface CatalogChapter { key: string; path: string; title: string; children: CatalogChapter[]; cards: LibraryItem[]; count: number }
/** Consume the same authoritative parent keys as the workbench. Do not guess
 * section placement by source-page overlap or by words in a card's title. */
export function catalogChapters(structure: BookStructure, cards: readonly LibraryItem[]) {
  const byRef = new Map(cards.map(card => [card.ref, card]));
  const placed = new Set<string>();
  const sections = (parent: string): CatalogChapter[] => structure.nodes.flatMap(node => {
    if (node.kind !== 'section' || node.parentKey !== parent) return [];
    const children = sections(node.key);
    const own = structure.nodes.flatMap(leaf => {
      if (leaf.kind !== 'card' || leaf.parentKey !== node.key || !byRef.has(leaf.target)) return [];
      placed.add(leaf.target); return [byRef.get(leaf.target)!];
    });
    return [{ key: node.key, path: node.path, title: node.title, children, cards: own, count: own.length + children.reduce((n, child) => n + child.count, 0) }];
  });
  const root = structure.nodes.find(node => node.kind === 'book');
  const chapters = root ? sections(root.key) : [];
  return { chapters, cards: cards.filter(card => !placed.has(card.ref)) };
}
