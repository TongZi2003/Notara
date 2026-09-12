/**
 * Image selections → `image` locators (normalized [x0,y0,x1,y1] in the source).
 *
 * The picture is drawn with its own aspect ratio, so the rendered box maps
 * linearly onto the original pixels; the selection rectangles are pulled back
 * through that box. Nothing here needs the original bytes.
 */
import type { SourceLocator } from '@studyforge/contracts/materials';

/** One image locator; the union member is narrowed rather than re-declared. */
export type ImageLocator = Extract<SourceLocator, { kind: 'image' }>;
import { clampUnit, clientRects, round4, unionRects, type Rect } from './geometry.ts';

/** Convert client-space rectangles on screen into a normalized source box. */
export function imageLocator(image: HTMLImageElement, range: Range): ImageLocator | undefined {
  const box = image.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return undefined;
  const rects: Rect[] = clientRects(range).map(rect => [
    (rect.left - box.left) / box.width,
    (rect.top - box.top) / box.height,
    (rect.right - box.left) / box.width,
    (rect.bottom - box.top) / box.height,
  ] as Rect);
  const union = unionRects(rects);
  if (union === undefined) return undefined;
  const clamped = clampUnit([round4(union[0]), round4(union[1]), round4(union[2]), round4(union[3])]);
  return clamped === undefined ? undefined : { kind: 'image', rect: [clamped[0], clamped[1], clamped[2], clamped[3]] };
}
