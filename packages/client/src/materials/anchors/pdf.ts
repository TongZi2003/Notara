/**
 * PDF selections → `pdf` locators (1-based page, normalized rect).
 *
 * The viewer publishes the geometry it really drew with: the page's own
 * unrotated box, the base viewport transform (rotation and translation
 * included) and the displayed size. A screen rectangle is therefore pulled back
 * through the displayed scale, then through the inverse transform, into the
 * page's own coordinates — so zoom, pan and any page rotation all land on the
 * same stored box. Nothing here reads CSS pixels as the stored value.
 */
import type { SourceLocator } from '@studyforge/contracts/materials';

/** One PDF locator; the union member is narrowed rather than re-declared. */
export type PdfLocator = Extract<SourceLocator, { kind: 'pdf' }>;
import { applyTransform, clampUnit, clientRects, invertTransform, round4, unionRects, type Affine, type Rect } from './geometry.ts';

/** What the viewer publishes for the page it finished drawing. */
export interface PdfPageGeometry {
  /** 1-based page number, exactly as the viewer reported it. */
  readonly page: number;
  /** Page rotation in degrees as pdf.js applied it (0/90/180/270). */
  readonly rotate: number;
  /** The page's own box `[x0,y0,x1,y1]` in unrotated user space. */
  readonly view: readonly [number, number, number, number];
  /** Page-coordinate → viewport transform at scale 1, including rotation. */
  readonly transform: Affine;
  /** Displayed size of the canvas in CSS pixels. */
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  /** Viewport size at scale 1, i.e. the rotated page's own extent. */
  readonly baseWidth: number;
  readonly baseHeight: number;
}

/** Read the geometry the viewer stamped on the page box, if it is intact. */
export function pdfGeometryOf(viewer: HTMLElement): PdfPageGeometry | undefined {
  const raw = viewer.dataset.sfPdfPage;
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as PdfPageGeometry;
    if (typeof parsed.page !== 'number' || !Array.isArray(parsed.view) || !Array.isArray(parsed.transform)) return undefined;
    if (parsed.renderedWidth <= 0 || parsed.renderedHeight <= 0 || parsed.baseWidth <= 0 || parsed.baseHeight <= 0) return undefined;
    return parsed;
  } catch { return undefined; }
}

/** Pull one screen rectangle back into the page's own normalized box. */
export function pdfLocator(viewer: HTMLElement, canvas: HTMLCanvasElement, range: Range): PdfLocator | undefined {
  return pdfLocatorRects(viewer, canvas, clientRects(range));
}

export function pdfLocatorRects(viewer: HTMLElement, canvas: HTMLCanvasElement, rectsIn: readonly { left: number; top: number; right: number; bottom: number }[]): PdfLocator | undefined {
  const geometry = pdfGeometryOf(viewer);
  if (geometry === undefined) return undefined;
  const box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return undefined;
  const inverse = invertTransform(geometry.transform);
  if (inverse === undefined) return undefined;
  const [x0, y0, x1, y1] = geometry.view;
  const width = x1 - x0, height = y1 - y0;
  if (width <= 0 || height <= 0) return undefined;
  // Displayed pixels → viewport points at scale 1 → page coordinates.
  const toPage = (clientX: number, clientY: number): readonly [number, number] => {
    const viewX = (clientX - box.left) * geometry.baseWidth / box.width;
    const viewY = (clientY - box.top) * geometry.baseHeight / box.height;
    const [px, py] = applyTransform(inverse, viewX, viewY);
    return [(px - x0) / width, (y1 - py) / height];
  };
  const rects: Rect[] = rectsIn.map(rect => {
    const [ax, ay] = toPage(rect.left, rect.top);
    const [bx, by] = toPage(rect.right, rect.bottom);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)] as Rect;
  });
  const union = unionRects(rects);
  if (union === undefined) return undefined;
  const clamped = clampUnit([round4(union[0]), round4(union[1]), round4(union[2]), round4(union[3])]);
  return clamped === undefined ? undefined : { kind: 'pdf', page: geometry.page, rect: [clamped[0], clamped[1], clamped[2], clamped[3]] };
}
