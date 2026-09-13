import { expect, test } from 'vitest';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { sourceContains, sourceOverlaps, uniqueSources, unrefinedRanges } from '../../packages/domain/src/materials/source-relations.ts';
const page = (p: number, rect?: [number, number, number, number]): SourceAnchor => ({ materialId: 'book', versionId: 'v1', locator: { kind: 'pdf', page: p, ...(rect ? { rect } : {}) } });
test('coverage keeps exact versions and regions, deduplicates only the same position', () => {
  expect(sourceContains(page(12), page(12, [0, 0, .5, .5]))).toBe(true);
  expect(sourceContains(page(12, [0, 0, .5, .5]), page(12))).toBe(false);
  expect(sourceOverlaps(page(12, [0, 0, .5, .5]), page(12, [.6, .6, 1, 1]))).toBe(false);
  expect(sourceOverlaps(page(12), { ...page(12), versionId: 'v2' })).toBe(false);
  expect(uniqueSources([page(12), page(14), page(12), page(37), page(81)])).toHaveLength(4);
});
test('text and Word positions use half-open ranges without filling gaps', () => {
  const a: SourceAnchor = { materialId: 'text', versionId: 'v1', locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 3, column: 0 } } };
  const b: SourceAnchor = { ...a, locator: { kind: 'text', start: { line: 3, column: 0 }, end: { line: 4, column: 2 } } };
  expect(sourceOverlaps(a, b)).toBe(false);
  expect(sourceContains(a, { materialId: a.materialId, versionId: a.versionId })).toBe(false);
  const cut: SourceAnchor = { ...a, locator: { kind: 'text', start: { line: 2, column: 1 }, end: { line: 2, column: 3 } } };
  expect(unrefinedRanges([a], [cut]).map(item => item.locator)).toEqual([
    { kind: 'text', start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
    { kind: 'text', start: { line: 2, column: 3 }, end: { line: 3, column: 0 } },
  ]);
});
