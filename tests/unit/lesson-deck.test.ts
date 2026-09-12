import { describe, expect, it } from 'vitest';
import { CardContentSchema, type CardView } from '@studyforge/contracts/cards';
import { closeSheet, emptyDeck, lessonRelations, openSheet, parentTrail } from '../../packages/client/src/materials/lesson-deck.ts';
import type { LessonMindProjection } from '../../packages/client/src/materials/lesson-materials-mindmap.ts';
const card = (ref: string, links: string[] = [], version = 1): CardView => ({ ref, version, history: [], content: CardContentSchema.parse({ title: ref, links }) });
const base = (view: CardView, pinned?: number): LessonMindProjection => ({
  nodes: [{ key: 'root', title: '书', kind: 'book', hint: '', children: ['card'] }, { key: 'card', title: view.ref, kind: 'card', hint: '', parent: 'root', children: [] }],
  books: new Map(), rows: new Map([['card', { kind: 'card', target: view.ref, title: view.ref, tabKey: 'card', source: null, quote: null, origins: [], ...(pinned === undefined ? {} : { cardVersion: pinned }) }]]),
});
describe('lesson deck navigation', () => {
  it('keeps concurrent pages, deduplicates exact addresses, and closes only the chosen page', () => {
    const a = { kind: 'card' as const, target: 'card:a', title: 'A', version: 1 };
    const b = { ...a, target: 'card:b', title: 'B' };
    const first = openSheet(openSheet(emptyDeck(), a), b);
    expect(openSheet(first, a).sheets).toHaveLength(2);
    expect(openSheet(first, { ...a, version: 2 }).sheets).toHaveLength(3);
    const next = closeSheet(first, first.sheets[1]!.id);
    expect(next.sheets.map(sheet => sheet.content.title)).toEqual(['A']);
    expect(next.active).toBe(next.sheets[0]!.id);
  });
  it('expands recorded outgoing and incoming links, without importing unrelated cards or cycling', () => {
    const a = card('card:a', ['card:b']), b = card('card:b', ['card:a']), c = card('card:c', ['card:a']), other = card('card:other');
    const projection = base(a), cards = new Map([a,b,c,other].map(view => [view.ref, view]));
    const collapsed = lessonRelations(projection, cards, new Map(), [], () => undefined);
    expect(collapsed.nodes).toHaveLength(2);
    const graph = lessonRelations(projection, cards, new Map(), ['card', 'related:card:b@1'], () => undefined);
    expect(graph.nodes.map(node => node.title)).toEqual(['书', 'card:a', 'card:b', 'card:c']);
    expect(graph.edges).toHaveLength(3);
    expect(parentTrail(graph.nodes, 'card').map(node => node.key)).toEqual(['root']);
    expect(parentTrail(graph.nodes, 'related:card:b@1')).toEqual([]);
  });
  it('uses the pinned card links, never the current revision as its outgoing links', () => {
    const a = card('card:a', ['card:c'], 2), original = card('card:a', ['card:b']), b = card('card:b'), c = card('card:c');
    const graph = lessonRelations(base(original, 1), new Map([a,b,c].map(view => [view.ref, view])), new Map([['card:a@1', original]]), ['card'], () => undefined);
    expect(graph.nodes.map(node => node.title)).toContain('card:b');
    expect(graph.nodes.map(node => node.title)).not.toContain('card:c');
    expect(lessonRelations(base(original, 1), new Map([[a.ref, a]]), new Map(), ['card'], () => undefined).edges).toEqual([]);
  });
  it('shows a linked card even inside a collapsed book and retains exact source positions', () => {
    const a = card('card:a'), b = card('card:b', ['card:a']);
    const source = { materialId: 'mat_original', versionId: 'ver_original', locator: { kind: 'pdf' as const, page: 3, rect: [.1,.2,.4,.6] as [number, number, number, number] } };
    const anchored = { ...a, content: { ...a.content, sources: [source] } };
    const original = base(a), projection: LessonMindProjection = {
      ...original, nodes: [...original.nodes, { key: 'b', title: 'B', kind: 'card', hint: '', children: [] }],
      rows: new Map([...original.rows, ['b', { ...original.rows.get('card')!, target: b.ref }]]),
    };
    const graph = lessonRelations(projection, new Map([[a.ref, anchored], [b.ref, b]]), new Map(), ['b', 'related:card:a@1'], () => '原书', []);
    const linked = graph.nodes.find(node => node.key === 'related:card:a@1');
    expect(linked?.parent).toBeUndefined();
    expect(graph.edges.some(edge => edge.from === 'b' && edge.to === linked?.key)).toBe(true);
    expect([...graph.requests.values()].find(request => request.kind === 'source')).toEqual({ kind: 'source', title: '原书', anchors: [source] });
  });
});
