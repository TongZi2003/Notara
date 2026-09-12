import { expect, test } from 'vitest';
import { CardRecordSchema, CardBatchReadInputSchema } from '../../packages/contracts/src/cards.ts';
import type { SetView } from '../../packages/contracts/src/sets.ts';
import { listCardSummaries } from '../../packages/domain/src/cards/card-service.ts';

const row = (ref: string, nextDue?: string, chapter = '数学/函数', tags = ['函数']) => ({
  ref, version: 1, duplicate: false, data: CardRecordSchema.parse({ content: { title: ref, chapter, tags },
    ...(nextDue ? { review: { lastAccessed: '2026-09-01', nextDue, reviewCount: 1 } } : {}) }),
});
const rows = [row('card:fresh'), row('card:today', '2026-09-12'), row('card:late', '2026-09-11'),
  row('card:future', '2026-09-13'), row('card:other', undefined, '数学/函数值', ['代数'])];

test('due lists actual learned cards, oldest first, without activating unseen cards or binding a version', () => {
  const before = structuredClone(rows);
  const result = listCardSummaries(rows, { state: 'due' }, '2026-09-12');
  expect(result.cards.map(card => card.ref)).toEqual(['card:late', 'card:today']);
  expect(result.cards.every(card => card.state === 'due' && !('version' in card))).toBe(true);
  expect(listCardSummaries(rows, { state: 'unlearned' }, '2026-09-12').cards).toHaveLength(2);
  expect(rows).toEqual(before);
});

test('chapter boundaries, all selected tags and pagination preserve the query', () => {
  const query = { chapter: '数学/函数', tags: ['函数'], limit: 2 };
  const first = listCardSummaries(rows, query, '2026-09-12');
  expect(first.nextOffset).toBe(2);
  const second = listCardSummaries(rows, { ...query, offset: first.nextOffset! }, '2026-09-12');
  expect(second.nextOffset).toBeNull();
  expect(new Set([...first.cards, ...second.cards].map(card => card.ref)).size).toBe(4);
  expect(listCardSummaries(rows, { tags: ['函数', '代数'] }, '2026-09-12').cards).toEqual([]);
});

test('explicit set membership is a filter, an unknown set is an error rather than an empty answer', () => {
  const set: SetView = { ref: 'set:math', version: 1, name: '数学', subjects: [], ladder: null,
    materials: [], members: ['card:today'], createdAt: '2026-09-01T00:00:00Z' };
  expect(listCardSummaries(rows, { learningSetRef: set.ref }, '2026-09-12', [set]).cards.map(card => card.ref)).toEqual(['card:today']);
  expect(() => listCardSummaries(rows, { learningSetRef: 'set:absent' }, '2026-09-12', [set])).toThrow('card_list_set_missing');
});

test('batch reads reject empty, repeated and oversized requests before reading', () => {
  expect(CardBatchReadInputSchema.safeParse({ targets: [] }).success).toBe(false);
  expect(CardBatchReadInputSchema.safeParse({ targets: ['card:a', 'card:a'] }).success).toBe(false);
  expect(CardBatchReadInputSchema.safeParse({ targets: Array.from({ length: 21 }, (_, i) => 'card:' + i) }).success).toBe(false);
});

test('a real source derives set membership, and a chapter matches its descendants but not a same-prefix sibling', () => {
  const materialId = 'mat_' + 'a'.repeat(16), otherMaterial = 'mat_' + 'b'.repeat(16);
  const sourced = row('card:sourced', undefined, '数学/函数/定义域');
  sourced.data.content.sources = [{ materialId, versionId: 'ver_' + 'c'.repeat(16),
    locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } } }];
  const set: SetView = { ref: 'set:book', version: 1, name: '书', subjects: [], ladder: null,
    materials: [materialId], members: [], createdAt: '2026-09-01T00:00:00Z' };
  const sourceRows = [sourced, row('card:sibling', undefined, '数学/函数值')];
  expect(listCardSummaries(sourceRows, { learningSetRef: set.ref, chapter: '数学/函数', materialId }, '2026-09-12', [set]).cards.map(card => card.ref)).toEqual([sourced.ref]);
  expect(listCardSummaries(sourceRows, { materialId: otherMaterial }, '2026-09-12', [set]).cards).toEqual([]);
});
