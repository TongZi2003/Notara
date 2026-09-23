/**
 * Node-only media reader for the vault teaching runtime.
 *
 * The Host owns path authorization and the tool shell; this module only turns
 * already-authorized bytes into model-readable content:
 *
 * - `readPdfPage(bytes, {page, rect, signal})` renders a real page (or a real
 *   normalized region of it) through pdf.js and returns the page text plus a
 *   bounded PNG. `rect` uses the vault `pdf-region` locator shape written by
 *   `mediaLocatorSuffix`/`parseMediaTarget`: `[x, y, width, height]` normalized
 *   to the page, origin at the top-left corner, each value in `[0, 1]`.
 * - `readImageBytes(bytes, {mime, signal})` downsizes a raster image to a
 *   model-usable PNG/JPEG/WebP through sharp.
 *
 * Both readers accept an `AbortSignal` and never touch the file system: the
 * caller passes bytes it has already authorized. A page without a text layer
 * still returns the real page image and says so through `warnings`
 * (`pdf_page_has_no_text_layer`, or `pdf_region_has_no_text` for a region).
 *
 * This file is for the Node host process. Keep it out of `client.js` and other
 * browser bundles: `pdfjs-dist/legacy/build/pdf.mjs`, `@napi-rs/canvas` and
 * `sharp` are Node entry points.
 */
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';

import { quoteFromItems } from './pdf.js';

/** Longest side of a rendered PDF page/region, in pixels. */
export const PDF_PAGE_MAX_EDGE = 1400;
/** Rendering scale bounds, matching the vault PDF reader (`clampScale`). */
export const PDF_PAGE_MAX_SCALE = 3;
export const PDF_PAGE_MIN_SCALE = 0.2;
/** Longest side of an image handed to a model. */
export const IMAGE_MAX_EDGE = 1568;
/** Decode guard: larger inputs are rejected instead of exhausting the host. */
export const IMAGE_MAX_PIXELS = 64_000_000;

function abortError() {
  const error = new Error('media_read_aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function isAbort(error) {
  return error?.name === 'AbortError' || error?.name === 'RenderingCancelledException' || error?.name === 'AbortException';
}

/**
 * pdf.js reports unusable documents through its own exception classes; the
 * tool shell needs stable, non-leaky codes instead.
 */
function documentError(error) {
  if (error?.name === 'InvalidPDFException') return new Error('pdf_document_invalid', { cause: error });
  if (error?.name === 'PasswordException') return new Error('pdf_document_password_required', { cause: error });
  return error;
}

function assertBytes(bytes, code) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error(code);
}

/**
 * Accept the vault `pdf-region` rect: four finite numbers normalized to the
 * page with a top-left origin. Values are clamped like `normalizedRect` in
 * `pdf.js` so a locator round-trips unchanged; a degenerate selection is a
 * caller error, never a silent full-page fallback.
 */
function normalizeRegion(rect) {
  if (rect === undefined || rect === null) return undefined;
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some(value => !Number.isFinite(value))) throw new Error('pdf_region_invalid');
  const region = rect.map(value => Math.round(Math.min(1, Math.max(0, value)) * 1_000_000) / 1_000_000);
  if (region[2] <= 0 || region[3] <= 0) throw new Error('pdf_region_invalid');
  return region;
}

/**
 * Text-layer items as normalized top-left rects, the coordinate system the
 * vault reader and `quoteFromItems` already use. `item.transform` is in PDF
 * user space, so it is mapped through the scale-1 page viewport.
 */
function textItemsOf(content, viewport) {
  const items = [];
  for (const item of content.items ?? []) {
    if (typeof item?.str !== 'string' || item.str.trim() === '' || !Array.isArray(item.transform)) continue;
    const transform = Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(transform[2], transform[3]);
    const width = Math.abs(item.width ?? 0) * viewport.scale;
    const left = Math.min(transform[4], transform[4] + width);
    items.push({
      rect: [left / viewport.width, (transform[5] - fontHeight) / viewport.height, width / viewport.width, fontHeight / viewport.height],
      str: item.str,
    });
  }
  return items;
}

function renderScale(targetWidth, targetHeight) {
  const scale = PDF_PAGE_MAX_EDGE / Math.max(targetWidth, targetHeight);
  return Math.min(PDF_PAGE_MAX_SCALE, Math.max(PDF_PAGE_MIN_SCALE, scale));
}

async function renderRegion(pdfPage, region, signal) {
  const page = pdfPage.getViewport({ scale: 1 });
  const target = region === undefined
    ? { x: 0, y: 0, width: page.width, height: page.height }
    : { x: region[0] * page.width, y: region[1] * page.height, width: region[2] * page.width, height: region[3] * page.height };
  const scale = renderScale(target.width, target.height);
  const viewport = pdfPage.getViewport({ scale, offsetX: -target.x * scale, offsetY: -target.y * scale });
  const width = Math.max(1, Math.round(target.width * scale)), height = Math.max(1, Math.round(target.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  const task = pdfPage.render({ canvasContext: context, viewport, canvas });
  const cancel = () => task.cancel();
  signal?.addEventListener?.('abort', cancel, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener?.('abort', cancel);
  }
  throwIfAborted(signal);
  const png = await canvas.encode('png');
  return { mimeType: 'image/png', data: png.toString('base64'), width, height };
}

/**
 * Read one page of an authorized PDF.
 *
 * @param {Uint8Array} bytes authorized PDF bytes; never read from disk here.
 * @param {{page?: number, rect?: number[], signal?: AbortSignal}} [options]
 *   `page` is 1-based and must exist; an out-of-range page throws
 *   `pdf_page_invalid` instead of clamping. `rect` is the normalized
 *   `[x, y, width, height]` vault locator described above.
 * @returns {Promise<{page: number, pageCount: number, text: string,
 *   image: {mimeType: 'image/png', data: string, width: number, height: number},
 *   warnings: string[]}>}
 */
export async function readPdfPage(bytes, { page = 1, rect, signal } = {}) {
  assertBytes(bytes, 'pdf_bytes_invalid');
  const region = normalizeRegion(rect);
  throwIfAborted(signal);
  // pdf.js may transfer the buffer it is handed, so give it a private copy:
  // caller-owned bytes must survive a read.
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    // pdf.js logs benign "standardFontDataUrl" warnings in Node; real failures
    // still surface as rejections.
    verbosity: 0,
  });
  try {
    const pdf = await loadingTask.promise;
    throwIfAborted(signal);
    const pageCount = pdf.numPages;
    if (!Number.isInteger(page) || page < 1 || page > pageCount) throw new Error('pdf_page_invalid');
    const pdfPage = await pdf.getPage(page);
    throwIfAborted(signal);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const items = textItemsOf(await pdfPage.getTextContent(), viewport);
    const text = quoteFromItems(items, region ?? [0, 0, 1, 1]);
    const warnings = [];
    if (text === '') warnings.push(region === undefined ? 'pdf_page_has_no_text_layer' : 'pdf_region_has_no_text');
    const image = await renderRegion(pdfPage, region, signal);
    throwIfAborted(signal);
    return { page, pageCount, text, image, warnings };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw isAbort(error) ? abortError() : documentError(error);
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

function outputFormat(mime, detected) {
  const formats = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
  if (formats[mime]) return formats[mime];
  return detected === 'jpeg' || detected === 'png' || detected === 'webp' ? detected : 'png';
}

/**
 * Compress an authorized raster image until it fits a model.
 *
 * @param {Uint8Array} bytes authorized image bytes.
 * @param {{mime?: string, signal?: AbortSignal}} [options] `mime` is the source
 *   mime reported by the shell; it also selects the output format when it is
 *   png/jpeg/webp. Metadata decides otherwise.
 * @returns {Promise<{image: {mimeType: string, data: string, width: number, height: number}}>}
 */
export async function readImageBytes(bytes, { mime, signal } = {}) {
  assertBytes(bytes, 'image_bytes_invalid');
  throwIfAborted(signal);
  let pipeline;
  try {
    pipeline = sharp(Buffer.from(bytes), { limitInputPixels: IMAGE_MAX_PIXELS });
    const metadata = await pipeline.metadata();
    const format = outputFormat(mime, metadata.format);
    pipeline = pipeline.rotate().resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true });
    if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
    else if (format === 'webp') pipeline = pipeline.webp({ quality: 82 });
    else pipeline = pipeline.jpeg({ quality: 82 });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    throwIfAborted(signal);
    const mimeType = info.format === 'jpeg' ? 'image/jpeg' : `image/${info.format}`;
    return { image: { mimeType, data: data.toString('base64'), width: info.width, height: info.height } };
  } catch (error) {
    if (signal?.aborted || isAbort(error)) throw abortError();
    // sharp messages leak decoder internals; the shell gets one stable code.
    throw new Error('image_bytes_unsupported', { cause: error });
  }
}
