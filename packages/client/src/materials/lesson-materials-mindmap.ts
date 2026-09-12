/**
 * The two projections the shared map draws, as pure functions.
 *
 * A book's map is its own real tree: the root, the skeleton sections it was
 * really read at, and the cards and knowledge that really point at this book.
 * A lesson's map is the lesson's own material projection — the deck the Host
 * read for *this* Session — so a card that belongs to no book stays its own
 * node instead of being filed under a book nobody recorded.
 *
 * Nothing here invents an owner: a lesson row is expandable only when the file
 * really is a book, and its children come from that book's own read.
 */
import type { BookNode, BookStructure } from '@studyforge/contracts/book-exploration';
import type { SourceLocator } from '@studyforge/contracts/materials';
import type { LessonResource } from '@studyforge/domain/lesson-resources';
import { isBookFormat } from './book-format.ts';
import type { MindNode } from './mindmap-model.ts';

/** One book's whole tree, as map nodes. `book` is the structure's own root. */
export function bookMindNodes(structure: BookStructure): MindNode[] {
  return structure.nodes.map(node => ({
    key: node.key,
    title: node.title,
    kind: node.kind,
    hint: bookHint(node),
    parent: node.parentKey,
    children: node.children,
  }));
}

/** What one book node says under its title, in the student's own words. */
export function bookHint(node: BookNode): string {
  switch (node.kind) {
    case 'book': return '书';
    case 'section': return node.sources.length > 0 ? '原文' : '章节';
    case 'card': return '卡片';
    case 'knowledge': return '知识';
  }
}

export interface LessonMindProjection {
  readonly nodes: readonly MindNode[];
  /** The lesson row each top-level node came from. */
  readonly rows: ReadonlyMap<string, LessonResource>;
  /** The book node each expanded book key stands for. */
  readonly books: ReadonlyMap<string, BookNode>;
}

export interface LessonMindInput {
  readonly rows: readonly LessonResource[];
  /**
   * The book trees read so far, keyed by `versionKeyOf` — one immutable version
   * is one tree, so two versions of the same book never share one read.
   */
  readonly structures: ReadonlyMap<string, BookStructure>;
  /** The file type of one material, so only a real book offers to open; unknown means "ask the book read". */
  readonly mediaTypeOf: (materialId: string) => string | undefined;
  /**
   * The library's own names. A lesson's projection names an original by its
   * identity, not by a title (the title belongs to the shelf), so the map asks
   * the same library the shelf does instead of drawing "资料" twice.
   */
  readonly materialTitleOf?: ((materialId: string) => string | undefined) | undefined;
  /** The card library's own names, for the cards this lesson really used. */
  readonly cardTitleOf?: ((target: string, version?: number) => string | undefined) | undefined;
}

/** The lesson's materials as map nodes: one node per real row, books open into their own tree. */
export function lessonMindProjection(input: LessonMindInput): LessonMindProjection {
  const nodes: MindNode[] = [], rows = new Map<string, LessonResource>(), books = new Map<string, BookNode>(), taken = new Map<string, number>();
  for (const row of input.rows) {
    // Settings, plans and closeout belong to the lesson overview. Only
    // readable learning material becomes a node in this map.
    if (!['material', 'card', 'knowledge', 'diagram'].includes(row.kind)) continue;
    // Two rows are two identities (the projection already collapsed the same
    // one); a repeated key would be the same row read twice, so it is kept apart.
    const base = rowKey(row);
    const seen = taken.get(base) ?? 0;
    taken.set(base, seen + 1);
    const key = seen === 0 ? base : `${base}#${String(seen)}`;
    rows.set(key, row);
    const mediaType = row.source === null ? undefined : input.mediaTypeOf(row.source.materialId);
    const structure = row.source === null ? undefined : input.structures.get(versionKeyOf(row.source.materialId, row.source.versionId));
    const book = row.source !== null && (mediaType === undefined || isBookFormat(mediaType));
    const children = structure === undefined ? [] : openBook(nodes, books, structure, key, `${key}/`);
    nodes.push({
      key, title: row.title ?? libraryTitle(row, input) ?? kindLabel(row.kind), kind: rowKind(row, book), hint: rowHint(row),
      parent: undefined, children: [...children], ...(book && structure === undefined ? { expandable: true } : {}),
    });
  }
  return { nodes, rows, books };
}

/**
 * One immutable version's own identity. A book's tree and its anchors belong to
 * the version that was read, so keying by the material alone would let a second,
 * newer version reuse the first one's tree.
 */
export function versionKeyOf(materialId: string, versionId: string): string {
  return `${materialId}@${versionId}`;
}

/** One row's own name, when the library the row points at can supply it. */
function libraryTitle(row: LessonResource, input: LessonMindInput): string | undefined {
  if (row.source !== null) return input.materialTitleOf?.(row.source.materialId);
  if (row.target !== null && (row.kind === 'card' || row.kind === 'knowledge')) return input.cardTitleOf?.(row.target, row.cardVersion);
  return undefined;
}

/** Every node of one book under the lesson row that opened it; the book's own root is the row. */
function openBook(nodes: MindNode[], books: Map<string, BookNode>, structure: BookStructure, parent: string, prefix: string): readonly string[] {
  const byKey = new Map(structure.nodes.map(node => [node.key, node]));
  const root = structure.nodes.find(node => node.kind === 'book');
  if (root === undefined) return [];
  const build = (node: BookNode, above: string): void => {
    const key = prefix + node.key;
    books.set(key, node);
    const children = node.children.filter(child => byKey.has(child));
    nodes.push({ key, title: node.title, kind: node.kind, hint: bookHint(node), parent: above, children: children.map(child => prefix + child) });
    for (const child of children) { const found = byKey.get(child); if (found !== undefined) build(found, key); }
  };
  const children = root.children.filter(child => byKey.has(child));
  for (const child of children) { const found = byKey.get(child); if (found !== undefined) build(found, parent); }
  return children.map(child => prefix + child);
}

/** One row's key: its own identity, never its position, so a re-read keeps the same node. */
export function rowKey(row: LessonResource): string {
  return `row:${row.kind}:${row.tabKey}`;
}

/** The student-facing name of a saved object kind. */
export function kindLabel(kind: LessonResource['kind']): string {
  switch (kind) {
    case 'material': return '资料';
    case 'card': return '卡片';
    case 'knowledge': return '知识';
    default: return '学习产出';
  }
}

/** Where inside the original one row points, in the student's words. */
export function positionLabel(locator: SourceLocator): string {
  switch (locator.kind) {
    case 'text': return `第 ${String(locator.start.line)} 行`;
    case 'pdf': return `第 ${String(locator.page)} 页`;
    case 'image': return '图上选区';
    case 'docx': return '选段';
  }
}

/** Where one row came from, in the student's words; the ids stay inside. */
export function originLabel(row: LessonResource): string {
  const from = new Set(row.origins.map(origin => origin.from));
  const parts: string[] = [];
  if (from.has('course')) parts.push('本节课安排');
  if (from.has('message')) parts.push('对话里引用过');
  if (from.has('output')) parts.push('课上产出');
  return parts.join(' · ');
}

/** One row's node kind, so the map can tell a book from a card at a glance. */
function rowKind(row: LessonResource, book: boolean): string {
  if (book) return 'book';
  return row.kind === 'material' ? 'material' : row.kind;
}

/** What the node says under its title: where it points, and where the row came from. */
function rowHint(row: LessonResource): string {
  const parts: string[] = [];
  if (row.source?.locator !== undefined) parts.push(positionLabel(row.source.locator));
  const origin = originLabel(row);
  if (origin !== '') parts.push(origin);
  if (row.kind === 'card' || row.kind === 'knowledge') parts.push(kindLabel(row.kind));
  return parts.length > 0 ? parts.join(' · ') : kindLabel(row.kind);
}
