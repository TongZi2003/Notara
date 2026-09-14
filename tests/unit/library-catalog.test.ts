import { expect, test } from 'vitest';
import { catalogChapters, libraryCatalog, type LibraryItem } from '../../packages/client/src/materials/library-catalog.ts';
import type { BookStructure } from '@studyforge/contracts/book-exploration';
const book = (id: string): LibraryItem => ({ ref: 'material:' + id, title: id, kind: 'material', version: 1, tags: [], materialIds: [id], source: { materialId: id, versionId: 'v1' } });
const card = (id: string, materialIds: string[], tags: string[]): LibraryItem => ({ ref: id, title: id, kind: 'card', version: 1, materialIds, tags });
const a = book('三角讲义'), b = book('公式手册'), shared = card('跨书题', ['三角讲义', '三角讲义', '公式手册'], ['和差公式']), solo = card('独立题', [], ['易错点']);
const items = [a, b, shared, solo];
test('source groups keep cross-book card identity without duplicate children or dropping independent cards', () => {
  const result = libraryCatalog(items, items, { kind: 'all', query: '', tag: '' });
  expect(result.groups.map(group => group.cards.map(item => item.ref))).toEqual([['跨书题'], ['跨书题']]);
  expect(result.cards).toEqual([solo]);
  expect(result.count).toBe(4);
});
test('exact tag and source-title search preserve the source parent while counting only matching entries', () => {
  const result = libraryCatalog(items, items, { kind: 'card', query: '三角', tag: '和差公式' });
  expect(result.count).toBe(1);
  expect(result.groups).toHaveLength(2);
  expect(result.groups[0]!.source.ref).toBe(a.ref);
  expect(libraryCatalog(items, items, { kind: 'all', query: '', tag: '和差' }).count).toBe(0);
});
test('explicit set membership keeps external-source context and unavailable-source cards remain visible', () => {
  const lost = card('旧来源题', ['不在当前资料库'], []);
  const knowledge: LibraryItem = { ref: 'knowledge:k', title: '共同方法', kind: 'knowledge', version: 1, tags: ['和差公式'], materialIds: [] };
  const all = [...items, lost, knowledge], scoped = [shared, lost, knowledge];
  const result = libraryCatalog(all, scoped, { kind: 'all', query: '', tag: '' });
  expect(result.groups.map(group => group.source.ref)).toEqual([a.ref, b.ref]);
  expect(result.cards).toEqual([lost]);
  expect(result.knowledge).toEqual([knowledge]);
  expect(result.count).toBe(3);
});
test('chapter nesting consumes authoritative parent keys and leaves unassigned cards in their own group', () => {
  const structure: BookStructure = { material: { materialId: 'm1', versionId: 'v1' }, title: '三角', nodes: [
    { key: 'book', kind: 'book', title: '三角', children: ['s1'], sources: [] },
    { key: 's1', kind: 'section', title: '公式', path: '公式', parentKey: 'book', children: ['s2'], sources: [] },
    { key: 's2', kind: 'section', title: '和差', path: '公式/和差', parentKey: 's1', children: ['c1'], sources: [] },
    { key: 'c1', kind: 'card', target: shared.ref, title: shared.title, parentKey: 's2', children: [], sources: [] },
  ] };
  const tree = catalogChapters(structure, [shared, solo]);
  expect(tree.chapters[0]!.cards).toEqual([]);
  expect(tree.chapters[0]!.children[0]!.cards).toEqual([shared]);
  expect(tree.chapters[0]!.count).toBe(1);
  expect(tree.cards).toEqual([solo]);
});
