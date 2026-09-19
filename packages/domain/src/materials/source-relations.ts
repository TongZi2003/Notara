import type { MaterialContext, SourceAnchor, SourceLocator, NormalizedRect } from '@studyforge/contracts/materials';
const rect = (value?: NormalizedRect): NormalizedRect => value ?? [0, 0, 1, 1];
const point = (a: { line: number; column: number }, b: { line: number; column: number }): number => a.line - b.line || a.column - b.column;
/** Fixed versions never overlap by title or by a replacement file's coordinates. */
export function sourceOverlaps(a: MaterialContext, b: MaterialContext): boolean {
  if (a.materialId !== b.materialId || a.versionId !== b.versionId) return false;
  return !a.locator || !b.locator || locatorRelation(a.locator, b.locator, false);
}
export function sourceContains(a: MaterialContext, b: MaterialContext): boolean {
  return a.materialId === b.materialId && a.versionId === b.versionId && !!a.locator && !!b.locator && locatorRelation(a.locator, b.locator, true);
}
function locatorRelation(a: SourceLocator, b: SourceLocator, contains: boolean): boolean {
  if (a.kind === 'text' && b.kind === 'text') return contains ? point(a.start, b.start) <= 0 && point(a.end, b.end) >= 0 : point(a.start, b.end) < 0 && point(b.start, a.end) < 0;
  if (a.kind === 'docx' && b.kind === 'docx') return a.part === b.part && a.blockId === b.blockId && (contains ? a.start <= b.start && a.end >= b.end : a.start < b.end && b.start < a.end);
  if (a.kind === 'pdftext' && b.kind === 'pdftext' && a.page === b.page) {
    const aStart = a.start ?? 0, bStart = b.start ?? 0;
    const aEnd = a.end ?? Number.POSITIVE_INFINITY, bEnd = b.end ?? Number.POSITIVE_INFINITY;
    return contains ? aStart <= bStart && aEnd >= bEnd : aStart < bEnd && bStart < aEnd;
  }
  if ((a.kind === 'pdf' && b.kind === 'pdf' && a.page === b.page) || (a.kind === 'image' && b.kind === 'image')) {
    const x = rect(a.rect), y = rect(b.rect);
    return contains ? x[0] <= y[0] && x[1] <= y[1] && x[2] >= y[2] && x[3] >= y[3] : x[0] < y[2] && y[0] < x[2] && x[1] < y[3] && y[1] < x[3];
  }
  return false;
}
export function uniqueSources<T extends MaterialContext>(sources: readonly T[]): T[] {
  const seen = new Set<string>();
  return sources.filter(source => { const key = JSON.stringify([source.materialId, source.versionId, source.locator]); if (seen.has(key)) return false; seen.add(key); return true; });
}

/** Subtract confirmed text/block ranges; gaps and partial lines stay addressable. */
export function unrefinedRanges(whole: readonly SourceAnchor[], refined: readonly SourceAnchor[]): SourceAnchor[] {
  let ranges = [...whole];
  for (const cut of refined) ranges = ranges.flatMap(source => {
    if (!sourceOverlaps(source, cut)) return [source];
    if (sourceContains(cut, source)) return [];
    const a = source.locator, b = cut.locator;
    if (a.kind === 'text' && b.kind === 'text') return [
      ...(point(a.start, b.start) < 0 ? [{ ...source, locator: { ...a, end: b.start } }] : []),
      ...(point(b.end, a.end) < 0 ? [{ ...source, locator: { ...a, start: b.end } }] : []),
    ];
    if (a.kind === 'docx' && b.kind === 'docx') return [
      ...(a.start < b.start ? [{ ...source, locator: { ...a, end: b.start } }] : []),
      ...(b.end < a.end ? [{ ...source, locator: { ...a, start: b.end } }] : []),
    ];
    return [source];
  });
  return ranges;
}
