import { describe, expect, it } from 'vitest';
import { CardContentSchema, type CardView } from '@studyforge/contracts/cards';
import { closeSheet, emptyDeck, lessonRelations, openSheet, parentTrail } from '../../packages/client/src/materials/lesson-deck.ts';
import type { LessonMindProjection } from '../../packages/client/src/materials/lesson-materials-mindmap.ts';
import { visibleMindNodes } from '../../packages/client/src/materials/mindmap-model.ts';
import type { LessonResource } from '@studyforge/domain/lesson-resources';
const card = (ref: string, links: string[] = [], version = 1): CardView => ({ ref, version, history: [], content: CardContentSchema.parse({ title: ref, links }) });
const base = (view: CardView, pinned?: number): LessonMindProjection => ({
  nodes: [{ key: 'root', title: '书', kind: 'book', hint: '', children: ['card'] }, { key: 'card', title: view.ref, kind: 'card', hint: '', parent: 'root', children: [] }],
  books: new Map(), rows: new Map([['card', { kind: 'card', target: view.ref, title: view.ref, tabKey: 'card', source: null, quote: null, origins: [], ...(pinned === undefined ? {} : { cardVersion: pinned }) }]]),
});
describe('lesson deck navigation', () => {
  it('saved outputs stay inside collapsed books, while fixed old cards retain their reading references', () => {
    const a = card('card:a'), original = base(a);
    const row = original.rows.get('card')!;
    const projection: LessonMindProjection = { nodes: [...original.nodes, { key: 'output', kind: 'card', title: 'A', hint: '', children: [] }],
      books: new Map([['card', { key: a.ref, kind: 'card', target: a.ref, title: 'A', children: [], sources: [] }]]),
      rows: new Map([['output', { ...row, origins: [{ from: 'output', operationId: 'o1', revision: 1 }] }]]),
    };
    const graph = (hierarchy: string[]) => lessonRelations(projection, new Map([[a.ref, a]]), new Map(), [], () => undefined, hierarchy);
    expect(graph([]).nodes.map(n => n.key)).not.toContain('output');
    expect(visibleMindNodes(graph([]).nodes, []).map(n => n.key)).toEqual(['root']);
    expect(graph(['root']).nodes.map(n => n.key)).not.toContain('output');
    const fixed = { ...projection, rows: new Map([['output', { ...row, cardVersion: 1, origins: [{ from: 'course' as const }] }]]) };
    expect(lessonRelations(fixed, new Map([[a.ref, a]]), new Map(), [], () => undefined).nodes.map(n => n.key)).toContain('output');
  });
  it('source-bound inventory cards wait under unopened books; independent cards remain roots', () => {
    const a = card('card:a'), standalone = card('card:independent');
    const source = { materialId: 'm1', versionId: 'v1', locator: { kind: 'pdf' as const, page: 3 } };
    const anchored = { ...a, content: { ...a.content, sources: [source] } };
    const projection: LessonMindProjection = {
      nodes: ['book', a.ref, standalone.ref].map(key => ({ key, title: key, kind: key === 'book' ? 'book' : 'card', hint: '', children: [] })), books: new Map(),
      rows: new Map<string, LessonResource>([
        ['book', { kind: 'material', tabKey: 'book', source: { materialId: 'm1', versionId: 'v1' }, target: null, title: '原文', quote: null, origins: [] }],
        ...[a, standalone].map(view => [view.ref, { kind: 'card' as const, tabKey: view.ref, source: null, target: view.ref, title: view.ref, quote: null, origins: [] }] as const),
      ]),
    };
    const graph = lessonRelations(projection, new Map([[a.ref, anchored], [standalone.ref, standalone]]), new Map(), [], () => undefined, []);
    expect(visibleMindNodes(graph.nodes, []).map(n => n.key)).toEqual(['book', standalone.ref]);
    expect(visibleMindNodes(graph.nodes, ['book']).map(n => n.key)).toEqual(['book', a.ref, standalone.ref]);
    expect(parentTrail(graph.nodes, a.ref).map(n => n.key)).toEqual(['book']);
  });
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
