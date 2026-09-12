/**
 * Coordinate helpers shared by the selection adapters.
 *
 * A selection becomes a locator in the *source*'s own coordinates, never in
 * CSS pixels: the client rects are pulled back through whatever transform the
 * renderer really used. Every helper here is pure and total — a shape that
 * cannot be computed returns `undefined` instead of a guess.
 */

/** A normalized [x0,y0,x1,y1] box inside the source, always with positive area. */
export type Rect = readonly [number, number, number, number];

/** The affine transform pdf.js publishes for one rendered page, `[a,b,c,d,e,f]`. */
export type Affine = readonly [number, number, number, number, number, number];

/** Union of boxes in one coordinate space; `undefined` when nothing was selected. */
export function unionRects(rects: readonly Rect[]): Rect | undefined {
  const first = rects[0];
  if (first === undefined) return undefined;
  let [x0, y0, x1, y1] = first;
  for (const [ax0, ay0, ax1, ay1] of rects.slice(1)) {
    x0 = Math.min(x0, ax0); y0 = Math.min(y0, ay0);
    x1 = Math.max(x1, ax1); y1 = Math.max(y1, ay1);
  }
  return x1 - x0 > 0 && y1 - y0 > 0 ? [x0, y0, x1, y1] : undefined;
}

/** Clamp one normalized box into the unit square; `undefined` when it has no area. */
export function clampUnit(rect: Rect): Rect | undefined {
  const [x0, y0, x1, y1] = rect;
  const clamped: Rect = [Math.min(Math.max(x0, 0), 1), Math.min(Math.max(y0, 0), 1),
    Math.min(Math.max(x1, 0), 1), Math.min(Math.max(y1, 0), 1)];
  return clamped[2] - clamped[0] > 0 && clamped[3] - clamped[1] > 0 ? clamped : undefined;
}

/** Apply an affine transform to one point. */
export function applyTransform(transform: Affine, x: number, y: number): readonly [number, number] {
  const [a, b, c, d, e, f] = transform;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Invert an affine transform; `undefined` for a degenerate one. */
export function invertTransform(transform: Affine): Affine | undefined {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  if (determinant === 0 || !Number.isFinite(determinant)) return undefined;
  return [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

/** Round to the spec's own tolerance so a stored locator is stable across reloads. */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** The client rectangles of a range, ignoring sub-pixel empties. */
export function clientRects(range: Range): readonly DOMRect[] {
  return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
}
