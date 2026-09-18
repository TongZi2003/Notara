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
/** Byte-level text locator; start/end are UTF-16 offsets into the Host's own
 * newline-joined page text (`read-material` joins `str` items with '\n'). */
export type PdfTextLocator = Extract<SourceLocator, { kind: 'pdftext' }>;
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

/**
 * Text-layer selections → `pdftext` locators. The viewer stamps every text
 * item span with `data-sf-base`, the span's own offset inside the Host's
 * newline-joined page text; a DOM point is therefore converted by walking the
 * items in document order instead of guessing from pixels. Points that fall
 * between items clamp to the next item's start, points past the last item to
 * the joined text's end — the returned span always names real joined text.
 */
export function pdfTextLocator(layer: HTMLElement, range: Range): PdfTextLocator | undefined {
  if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) return undefined;
  const page = Number(layer.dataset.sfPage);
  if (!Number.isInteger(page) || page < 1) return undefined;
  const spans = [...layer.querySelectorAll<HTMLElement>('[data-sf-base]')];
  if (spans.length === 0) return undefined;
  const start = joinedOffset(spans, range.startContainer, range.startOffset);
  const end = joinedOffset(spans, range.endContainer, range.endOffset);
  if (start === undefined || end === undefined || start >= end) return undefined;
  return { kind: 'pdftext', page, start, end };
}

/**
 * Screen rectangles covering `[start,end)` inside the layer — the same spans
 * the locator was computed from, so highlights and anchors can never disagree.
 */
export function pdftextRects(layer: HTMLElement, start: number, end: number): DOMRect[] {
  const rects: DOMRect[] = [];
  for (const span of layer.querySelectorAll<HTMLElement>('[data-sf-base]')) {
    const base = Number(span.dataset.sfBase);
    const length = span.textContent?.length ?? 0;
    const s = Math.max(start, base), e = Math.min(end, base + length);
    if (!Number.isInteger(base) || s >= e) continue;
    const range = rangeWithin(span, s - base, e - base);
    if (range !== undefined) rects.push(...range.getClientRects());
  }
  return rects;
}

/** The joined-text offset of one DOM boundary point, in document order. */
function joinedOffset(spans: readonly HTMLElement[], node: Node, offset: number): number | undefined {
  let base = 0;
  for (const span of spans) {
    const spanBase = Number(span.dataset.sfBase);
    const length = span.textContent?.length ?? 0;
    if (!Number.isInteger(spanBase) || spanBase < base) return undefined;
    const contents = span.ownerDocument.createRange();
    contents.selectNodeContents(span);
    let compared: number;
    try { compared = contents.comparePoint(node, offset); } catch { return undefined; }
    if (compared === 0) {
      const probe = span.ownerDocument.createRange();
      probe.selectNodeContents(span);
      try { probe.setEnd(node, offset); } catch { return undefined; }
      // A boundary point can leak a sibling's text; never past this item.
      return spanBase + Math.min(probe.toString().length, length);
    }
    if (compared < 0) return Math.min(base, spanBase);
    base = spanBase + length + 1;
  }
  // Past the last item: the joined text carries no trailing newline.
  return base === 0 ? undefined : base - 1;
}

/** A DOM range covering `[start,end)` of one span's own text, wherever its text nodes sit. */
function rangeWithin(root: HTMLElement, start: number, end: number): Range | undefined {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = root.ownerDocument.createRange();
  let count = 0, began = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!began && start <= count + length) { range.setStart(node, start - count); began = true; }
    if (began && end <= count + length) { range.setEnd(node, end - count); return range; }
    count += length;
  }
  return undefined;
}
