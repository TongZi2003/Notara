/**
 * Node-only media reader for the vault teaching runtime.
 *
 * The Host owns path authorization and the tool shell; this module only turns
 * already-authorized bytes or bounded byte-range readers into model-readable content:
 *
 * - `readPdfPage(bytes, {page, rect, signal})` renders a real page (or a real
 *   normalized region of it) through pdf.js and returns the page text plus a
 *   bounded PNG. `rect` uses the vault `pdf-region` locator shape written by
 *   `mediaLocatorSuffix`/`parseMediaTarget`: `[x, y, width, height]` normalized
 *   to the page, origin at the top-left corner, each value in `[0, 1]`.
 * - `readImageBytes(bytes, {mime, signal})` downsizes a raster image to a
 *   model-usable PNG/JPEG/WebP through sharp.
 *
 * Both readers accept an `AbortSignal` and never open document paths: the caller passes
 * bytes or a range reader it has already authorized. A page without a text layer
 * still returns the real page image and says so through `warnings`
 * (`pdf_page_has_no_text_layer`, or `pdf_region_has_no_text` for a region).
 *
 * This file is for the Node host process. Keep it out of `client.js` and other
 * browser bundles: `pdfjs-dist/legacy/build/pdf.mjs`, `@napi-rs/canvas` and
 * `sharp` are Node entry points.
 */
import { createCanvas } from '@napi-rs/canvas';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument, PDFDataRangeTransport, PDFWorker, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';

import { quoteFromItems } from './pdf.js';

// These are trusted resources from the locked dependency, never document paths
// or a remote URL. Named CMaps and JPX/JBIG2 decoders are required by real books.
const pdfjsRoot = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const resourceDirectory = name => join(pdfjsRoot, name).replaceAll('\\', '/') + '/';
const PDF_RESOURCES = Object.freeze({
  cMapUrl: resourceDirectory('cmaps'), cMapPacked: true,
  standardFontDataUrl: resourceDirectory('standard_fonts'),
  wasmUrl: resourceDirectory('wasm'),
  useWorkerFetch: false,
});

/** Longest side of a rendered PDF page/region, in pixels. */
export const PDF_PAGE_MAX_EDGE = 2048;
/** Rendering scale bounds, matching the vault PDF reader (`clampScale`). */
export const PDF_PAGE_MAX_SCALE = 3;
/** Small MediaBoxes in real scans need about 5.6x to reach a 2048 px edge.
 * Explicit user scale remains 0.2..3; automatic sizing is separately bounded. */
export const PDF_PAGE_AUTO_MAX_SCALE = 6;
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

function renderScale(targetWidth, targetHeight, requested) {
  const bounded = PDF_PAGE_MAX_EDGE / Math.max(targetWidth, targetHeight);
  return Math.min(requested === undefined ? PDF_PAGE_AUTO_MAX_SCALE : PDF_PAGE_MAX_SCALE, bounded, requested ?? bounded);
}

async function renderRegion(pdfPage, region, signal, requestedScale) {
  const page = pdfPage.getViewport({ scale: 1 });
  const target = region === undefined
    ? { x: 0, y: 0, width: page.width, height: page.height }
    : { x: region[0] * page.width, y: region[1] * page.height, width: region[2] * page.width, height: region[3] * page.height };
  const scale = renderScale(target.width, target.height, requestedScale);
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
  return { mimeType: 'image/png', data: png.toString('base64'), width, height, scale };
}

/** One document lifetime, with explicit abort/range failures. No URLs or paths
 * are accepted; range reads still belong to the Host's authorized IO seam. */
async function withPdf(source, signal, operation) {
  const ranged = !(source instanceof Uint8Array);
  if (ranged) {
    if (!Number.isSafeInteger(source?.length) || source.length <= 0 || typeof source.readRange !== 'function') throw new Error('pdf_bytes_invalid');
  } else assertBytes(source, 'pdf_bytes_invalid');
  throwIfAborted(signal);
  const controller = new AbortController(), failure = Promise.withResolvers();
  const rangeSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let worker, loadingTask, cleanup, closed = false, failed = false;
  const disposeDocument = () => cleanup ??= loadingTask ? loadingTask.destroy().catch(() => {}) : Promise.resolve();
  const reject = error => {
    if (closed) return;
    failed = true;
    failure.reject(error);
    controller.abort();
    void disposeDocument();
    worker?.destroy();
  };
  const abort = () => reject(abortError());
  signal?.addEventListener('abort', abort, {once: true});
  const checkedBytes = (bytes, length) => {
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new Error('pdf_range_invalid');
    return new Uint8Array(bytes);
  };
  try {
    return await Promise.race([failure.promise, (async () => {
      let input;
      if (ranged) {
        const initialLength = Math.min(65536, source.length);
        const initial = checkedBytes(await source.readRange(0, initialLength, rangeSignal), initialLength);
        throwIfAborted(rangeSignal);
        const transport = new PDFDataRangeTransport(source.length, initial, true);
        transport.requestDataRange = (begin, end) => {
          if (closed || rangeSignal.aborted) return;
          Promise.resolve().then(() => source.readRange(begin, end, rangeSignal)).then(bytes => {
            if (!closed && !rangeSignal.aborted) transport.onDataRange(begin, checkedBytes(bytes, end - begin));
          }).catch(reject);
        };
        transport.abort = () => controller.abort();
        input = {range: transport, length: source.length, rangeChunkSize: 65536, disableStream: true, disableAutoFetch: true};
      } else input = {data: new Uint8Array(source)};
      // Own the public worker handle so range failures can stop it without
      // waiting for a Terminate reply from a page task awaiting missing bytes.
      worker = PDFWorker.create({});
      loadingTask = getDocument({...input, ...PDF_RESOURCES, worker, isEvalSupported: false, verbosity: 0, stopAtErrors: true});
      const pdf = await loadingTask.promise;
      throwIfAborted(rangeSignal);
      return await operation(pdf);
    })()]);
  } catch (error) {
    failed = true;
    if (signal?.aborted) throw abortError();
    throw isAbort(error) ? abortError() : documentError(error);
  } finally {
    closed = true;
    signal?.removeEventListener('abort', abort);
    controller.abort();
    const finishing = disposeDocument();
    // A failed range can leave pdf.js's graceful destroy pending. Preserve
    // the original error and stop our worker; never await that failed RPC.
    try { if (!failed) await finishing; }
    finally { worker?.destroy(); }
  }
}

/**
 * Read one page of an authorized PDF.
 *
 * @param {Uint8Array | {length: number, readRange: Function}} bytes
 *   authorized PDF bytes or a Host-owned range reader; never open paths here.
 * @param {{page?: number, rect?: number[], signal?: AbortSignal, scale?: number}} [options]
 *   `page` is 1-based and must exist; an out-of-range page throws
 *   `pdf_page_invalid` instead of clamping. `rect` is the normalized
 *   `[x, y, width, height]` vault locator described above.
 * @returns {Promise<{page: number, pageCount: number, text: string,
 *   image: {mimeType: 'image/png', data: string, width: number, height: number, scale: number},
 *   warnings: string[]}>}
 */
export async function readPdfPage(bytes, { page = 1, rect, signal, scale } = {}) {
  if(scale!==undefined&&(!Number.isFinite(scale)||scale<PDF_PAGE_MIN_SCALE||scale>PDF_PAGE_MAX_SCALE))throw new Error('pdf_render_scale_invalid');
  const region = normalizeRegion(rect);
  return withPdf(bytes,signal,async pdf=>{
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
    const image = await renderRegion(pdfPage, region, signal, scale);
    if(scale!==undefined&&image.scale<scale)warnings.push('pdf_render_scale_limited');
    throwIfAborted(signal);
    return { page, pageCount, text, image, warnings };
  });
}

/** Only the number of pages: nothing is rendered and no text is extracted. */
export async function readPdfPageCount(bytes, { signal } = {}) {
  return withPdf(bytes,signal,async pdf=>pdf.numPages);
}

/** Bookmarks resolve to physical (1-based) pages. Printed labels remain labels;
 * unresolved/external destinations never silently become page 1. */
export async function readPdfOutline(bytes,{signal}={}) {
  return withPdf(bytes,signal,async pdf=>{
    const warnings=new Set(),labels=pdf.numPages<=10000?await pdf.getPageLabels():null;
    if(pdf.numPages>10000)warnings.add('pdf_page_labels_omitted');
    let count=0,truncated=false;
    const visit=async(rows,depth=0)=>{
      const result=[];
      for(const row of rows??[]){
        throwIfAborted(signal);
        if(count>=500||depth>=20){truncated=true;break;}count++;
        let page=null;
        try{
          const dest=typeof row.dest==='string'?await pdf.getDestination(row.dest):row.dest;
          if(Array.isArray(dest)){
            const index=Number.isInteger(dest[0])?dest[0]:dest[0]&&typeof dest[0]==='object'?await pdf.getPageIndex(dest[0]):null;
            if(Number.isInteger(index)&&index>=0&&index<pdf.numPages)page=index+1;
          }
        }catch{warnings.add('pdf_outline_destination_unresolved');}
        if(page===null)warnings.add('pdf_outline_destination_unresolved');
        result.push({title:String(row.title??'').slice(0,1000),page,...(page!==null&&labels?{pageLabel:labels[page-1]}:{}),items:await visit(row.items,depth+1)});
      }return result;
    };
    const items=await visit(await pdf.getOutline());
    if(!items.length)warnings.add('pdf_outline_missing');
    return {pageCount:pdf.numPages,...(labels?{pageLabels:labels}:{}),items,truncated,warnings:[...warnings]};
  });
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
