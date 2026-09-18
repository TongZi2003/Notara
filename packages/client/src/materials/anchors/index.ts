/**
 * One entry point for "what is selected in this original".
 *
 * The caller hands in the element the reader is looking at; the format that
 * element renders decides which coordinate math runs. Every path fails closed:
 * a selection that cannot be expressed in the source's own coordinates returns
 * nothing, and the composer then has nothing to freeze — never a nearby guess.
 */
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { DOCX_MEDIA_TYPE } from '../files.ts';
import { docxLocators } from './docx.ts';
import { imageLocator } from './image.ts';
import { pdfLocator, pdfTextLocator } from './pdf.ts';
import { markdownSpan, plainTextSpan, stableSpan, textLocator } from './text.ts';

/** The preview surface one selection is being read from. */
export interface CaptureTarget {
  readonly materialId: string;
  readonly versionId: string;
  readonly mediaType: string;
  /** The element that owns the selected DOM. */
  readonly root: HTMLElement;
  /** The material's own text when the renderer holds it (plain text and Markdown). */
  readonly source: string | undefined;
  /** Present for a PDF page; the canvas that carries the drawn page. */
  readonly canvas?: HTMLCanvasElement | undefined;
  /** Present for an image. */
  readonly image?: HTMLImageElement | undefined;
}

/** Every anchor the current selection really names, in the source's coordinates. */
export function captureAnchors(target: CaptureTarget, range: Range): readonly SourceAnchor[] {
  if (!target.root.contains(range.startContainer) || !target.root.contains(range.endContainer)) return [];
  if (target.mediaType.startsWith('image/')) {
    if (target.image === undefined) return [];
    const locator = imageLocator(target.image, range);
    return locator === undefined ? [] : [anchor(target, locator)];
  }
  if (target.mediaType === 'application/pdf') {
    // A text-layer selection resolves to byte offsets first; only when it
    // misses the layer entirely does the geometric rectangle speak.
    const layer = target.root.querySelector<HTMLElement>('.sf-pdf-text');
    if (layer !== null) {
      const located = pdfTextLocator(layer, range);
      if (located !== undefined) return [{ ...anchor(target, located), quote: range.toString() }];
    }
    if (target.canvas === undefined) return [];
    const locator = pdfLocator(target.root, target.canvas, range);
    return locator === undefined ? [] : [anchor(target, locator)];
  }
  if (target.mediaType === DOCX_MEDIA_TYPE) {
    return docxLocators(target.root, range).map(locator => anchor(target, locator));
  }
  if (target.source === undefined) return [];
  // Plain text: the element's text *is* the source, so the DOM span is exact.
  const direct = plainTextSpan(target.root, range);
  const span = direct !== undefined && target.root.textContent === target.source
    ? direct
    : markdownSpan(target.source, range.toString(), renderedPrefix(target.root, range));
  if (span === undefined) return [];
  const locator = textLocator(target.source, stableSpan(span));
  return locator === undefined ? [] : [{ ...anchor(target, locator), quote: range.toString() }];
}

/** The quote a text locator was taken from, so a message can show what it cited. */
function anchor(target: CaptureTarget, locator: SourceAnchor['locator']): SourceAnchor {
  return { materialId: target.materialId, versionId: target.versionId, locator };
}

/** Rendered text before the selection, used to tell identical quotes apart. */
function renderedPrefix(root: HTMLElement, range: Range): string {
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString();
}
