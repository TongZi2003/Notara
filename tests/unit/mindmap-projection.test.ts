/**
 * The shared material map's own pure layer: which nodes a map shows, where a
 * node sits, and how a lesson's material projection becomes nodes.
 *
 * These are the claims a browser test cannot isolate: that an unexpanded map
 * shows only its roots, that a node's position depends on the tree rather than
 * on what is open, and that a lesson node only opens into a book when the row
 * really is a book — a card that belongs to no book stays its own node.
 */
import { expect, test } from 'vitest';
import { layoutMind, visibleMindNodes, type MindNode } from '../../packages/client/src/materials/mindmap-model.ts';
import { bookHint, bookMindNodes, lessonMindProjection } from '../../packages/client/src/materials/lesson-materials-mindmap.ts';
import type { BookStructure } from '../../packages/contracts/src/book-exploration.ts';
import type { LessonResource } from '../../packages/domain/src/courses/lesson-resource-projection.ts';

const tree: MindNode[] = [
  { key: 'book', title: '函数', kind: 'book', hint: '书', children: ['section:函数/定义域', 'section:函数/单调性'] },
  { key: 'section:函数/定义域', title: '定义域', kind: 'section', hint: '原文', parent: 'book', children: ['card:1'] },
  { key: 'section:函数/单调性', title: '单调性', kind: 'section', hint: '章节', parent: 'book', children: [] },
  { key: 'card:1', title: '定义域卡片', kind: 'card', hint: '卡片', parent: 'section:函数/定义域', children: [] },
];

test('an unexpanded map shows only its roots, and expansion walks the real children', () => {
  expect(visibleMindNodes(tree, []).map(node => node.key)).toEqual(['book']);
  expect(visibleMindNodes(tree, ['book']).map(node => node.key)).toEqual(['book', 'section:函数/定义域', 'section:函数/单调性']);
  expect(visibleMindNodes(tree, ['book', 'section:函数/定义域']).map(node => node.key))
    .toEqual(['book', 'section:函数/定义域', 'card:1', 'section:函数/单调性']);
});

test('a node sits over its own leaves in the tree it is given', () => {
  const layout = layoutMind(tree);
  expect(layout.rows).toBe(3);
  expect(layout.leaves).toBe(2);
  // 定义域 carries the card and 单调性 is a leaf: the root sits over both.
  expect(layout.centre.get('book')).toBeCloseTo(0.5, 5);
  expect(layout.centre.get('section:函数/定义域')).toBeCloseTo(0.25, 5);
  expect(layout.centre.get('section:函数/单调性')).toBeCloseTo(0.75, 5);
  // Expansion is a drawing decision, not part of the layout: same positions.
  expect(layoutMind(tree).depth.get('card:1')).toBe(layout.depth.get('card:1'));
});

test('a collapsed book lays out only what is shown, however large its hidden subtree is', () => {
  const many: MindNode[] = [{ key: 'book', title: '函数', kind: 'book', hint: '书', children: Array.from({ length: 300 }, (_, i) => `section:s${String(i)}`) }];
  for (let i = 0; i < 300; i++) many.push({ key: `section:s${String(i)}`, title: `第${String(i)}节`, kind: 'section', hint: '章节', parent: 'book', children: [] });
  // Collapsed: the root is the only node, so it takes one leaf and sits centred.
  const collapsed = layoutMind(visibleMindNodes(many, []));
  expect(collapsed.leaves).toBe(1);
  expect(collapsed.rows).toBe(1);
  expect(collapsed.centre.get('book')).toBeCloseTo(0.5, 5);
  // Open: only the branch that was really opened spreads.
  const open = layoutMind(visibleMindNodes(many, ['book']));
  expect(open.leaves).toBe(300);
  expect(open.rows).toBe(2);
});

test('a forest lays each root beside the other', () => {
  const forest: MindNode[] = [
    { key: 'row:material', title: '函数原文', kind: 'book', hint: '书', children: [] },
    { key: 'row:card', title: '独立卡', kind: 'card', hint: '卡片', children: [] },
  ];
  const layout = layoutMind(forest);
  expect(layout.leaves).toBe(2);
  expect(layout.centre.get('row:material')).toBeCloseTo(0.25, 5);
  expect(layout.centre.get('row:card')).toBeCloseTo(0.75, 5);
});

test('a book structure becomes nodes that keep their own parents, kinds and positions', () => {
  const nodes = bookMindNodes(structure());
  expect(nodes.map(node => node.key)).toEqual(['book', 'section:函数/定义域', 'card:定义域卡片']);
  expect(nodes[0]).toMatchObject({ kind: 'book', hint: '书 · 1 张题卡', parent: undefined });
  expect(nodes[1]).toMatchObject({ kind: 'section', hint: '原文 · 1 张题卡', parent: 'book' });
  expect(nodes[2]).toMatchObject({ kind: 'card', hint: '卡片', parent: 'section:函数/定义域' });
});

test('a chapter count includes cards in its child sections, and empty chapters say so', () => {
  const nodes = structure().nodes;
  expect(bookHint({ key: 'section:函数', kind: 'section', path: '函数', title: '函数', children: ['section:函数/定义域'], sources: [] }, nodes)).toBe('章节 · 1 张题卡');
  expect(bookHint({ key: 'section:别处', kind: 'section', path: '别处', title: '别处', children: [], sources: [] }, nodes)).toBe('章节 · 尚无题卡');
});

test('a lesson row is a book node only when the file really is a book, and cards stay their own nodes', () => {
  const rows: LessonResource[] = [
    { kind: 'material', tabKey: 'material:m1@v1', source: { materialId: 'm1', versionId: 'v1' }, target: null, title: '函数原文', quote: null, origins: [{ from: 'course' }] },
    { kind: 'card', tabKey: 'card:standalone', source: null, target: 'card:standalone', title: '独立卡', quote: null, origins: [{ from: 'output', operationId: 'o1', revision: 1 }] },
    { kind: 'material', tabKey: 'material:m2@v2', source: { materialId: 'm2', versionId: 'v2', locator: { kind: 'pdf', page: 4 } }, target: null, title: '试卷', quote: null, origins: [{ from: 'message', messageId: 'e1' }] },
  ];
  const types = new Map([['m1', 'text/markdown'], ['m2', 'application/pdf']]);
  const closed = lessonMindProjection({ rows, structures: new Map(), mediaTypeOf: id => types.get(id) });
  expect(closed.nodes.map(node => [node.key, node.kind, node.expandable])).toEqual([
    ['row:material:material:m1@v1', 'book', true],
    ['row:card:card:standalone', 'card', undefined],
    ['row:material:material:m2@v2', 'book', true],
  ]);
  // The book is only a book because the library says so; a plain file never offers to open.
  const image = lessonMindProjection({ rows: [rows[2]!], structures: new Map(), mediaTypeOf: () => 'image/png' });
  expect(image.nodes[0]).toMatchObject({ kind: 'material', children: [] });
  expect(image.nodes[0]?.expandable).toBeUndefined();
  // An open book hangs its real sections under the row that opened it, keeping the row as the parent.
  const open = lessonMindProjection({ rows: [rows[0]!], structures: new Map([['m1@v1', structure()]]), mediaTypeOf: id => types.get(id) });
  const section = open.nodes.find(node => node.key === 'row:material:material:m1@v1/section:函数/定义域');
  expect(section).toMatchObject({ kind: 'section', hint: '原文 · 1 张题卡', parent: 'row:material:material:m1@v1' });
  expect(open.nodes.find(node => node.key === 'row:material:material:m1@v1')?.children)
    .toEqual(['row:material:material:m1@v1/section:函数/定义域']);
  // The card inside the book is the book's own node, with its own target.
  expect(open.books.get('row:material:material:m1@v1/card:定义域卡片')).toMatchObject({ kind: 'card', target: 'card:定义域卡片' });
});

test('lesson settings and closeout stay out of the material map', () => {
  const rows: LessonResource[] = ['course', 'handoff', 'plan'].map(kind => ({
    kind: kind as LessonResource['kind'], tabKey: kind, source: null, target: `${kind}:1`, title: kind, quote: null, origins: [],
  }));
  expect(lessonMindProjection({ rows, structures: new Map(), mediaTypeOf: () => undefined }).nodes).toEqual([]);
});

test('two immutable versions of one book are two trees, never one shared read', () => {
  const rows: LessonResource[] = [
    { kind: 'material', tabKey: 'material:m1@v1', source: { materialId: 'm1', versionId: 'v1' }, target: null, title: null, quote: null, origins: [{ from: 'course' }] },
    { kind: 'material', tabKey: 'material:m1@v2', source: { materialId: 'm1', versionId: 'v2' }, target: null, title: null, quote: null, origins: [{ from: 'course' }] },
  ];
  const only = new Map([['m1@v1', structure()]]);
  const projection = lessonMindProjection({ rows, structures: only, mediaTypeOf: () => 'text/markdown' });
  const first = projection.nodes.find(node => node.key === 'row:material:material:m1@v1');
  const second = projection.nodes.find(node => node.key === 'row:material:material:m1@v2');
  // v1 opened into the tree that was really read from v1…
  expect(first?.children).toEqual(['row:material:material:m1@v1/section:函数/定义域']);
  // …and v2 has no read of its own yet, so it stays closed instead of borrowing v1's.
  expect(second?.children).toEqual([]);
  expect(second?.expandable).toBe(true);
  expect(projection.books.has('row:material:material:m1@v2/section:函数/定义域')).toBe(false);
});

/** One real read: a book root, one section it was read at, and the card filed there. */
function structure(): BookStructure {
  return {
    material: { materialId: 'm1', versionId: 'v1' },
    title: '函数原文',
    nodes: [
      { key: 'book', kind: 'book', title: '函数原文', children: ['section:函数/定义域'], sources: [] },
      { key: 'section:函数/定义域', kind: 'section', title: '定义域', path: '函数/定义域', parentKey: 'book', children: ['card:定义域卡片'],
        sources: [{ materialId: 'm1', versionId: 'v1', locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 3 } } }] },
      { key: 'card:定义域卡片', kind: 'card', title: '定义域卡片', target: 'card:定义域卡片', parentKey: 'section:函数/定义域', children: [], sources: [] },
    ],
  };
}
