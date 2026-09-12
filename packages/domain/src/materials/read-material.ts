import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { HostContext, MaterialContext, NormalizedRect, SourceAnchor } from '@studyforge/contracts';
import { MaterialContextSchema, SourceAnchorSchema } from '@studyforge/contracts';
import type { MaterialRead } from '@studyforge/contracts/material-read';
import { indexDocx } from './docx/index-docx.ts';

export interface ReadableMaterial {
  version: { title: string; mediaType: string; fileName: string };
  absolutePath: string;
}
export interface MaterialResolver {
  resolve(ctx: HostContext, source: { materialId: string; versionId: string }): Promise<ReadableMaterial>;
}
export class MaterialReadError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'MaterialReadError'; }
}
const MAX_TEXT = 30_000;
const MAX_RASTER_EDGE = 2400;
const require = createRequire(import.meta.url);
const fonts = new URL('./standard_fonts/', 'file://' + require.resolve('pdfjs-dist/package.json')).pathname;

/** Exact version reads; never OCR or guess text/coordinates for a missing layer. */
export async function readMaterial(resolver: MaterialResolver, ctx: HostContext, sourceInput: MaterialContext): Promise<MaterialRead> {
  const source = MaterialContextSchema.parse(sourceInput);
  const base = { materialId: source.materialId, versionId: source.versionId };
  const { version, absolutePath } = await resolver.resolve(ctx, base);
  const bytes = await readFile(absolutePath);
  const { locator } = source;
  if (version.mediaType === 'application/pdf') {
    if (locator && locator.kind !== 'pdf') throw new MaterialReadError('locator_format_mismatch');
    const loading = getDocument({ data: Uint8Array.from(bytes), standardFontDataUrl: fonts, useSystemFonts: true });
    const document = await loading.promise;
    try {
      const number = locator?.page ?? 1;
      if (number > document.numPages) throw new MaterialReadError('source_page_out_of_range');
      const page = await document.getPage(number);
      // Canonical PDF coordinates use the crop box with rotation=0. Display
      // rotation and zoom are inverted by the client before producing an anchor.
      const unit = page.getViewport({ scale: 1, rotation: 0 });
      const scale = Math.min(2, MAX_RASTER_EDGE / Math.max(unit.width, unit.height));
      const viewport = page.getViewport({ scale, rotation: 0 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      // PDF.js accepts the Node canvas adapter at runtime; its upstream public
      // declaration names only the DOM canvas interface.
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
      const text = await page.getTextContent();
      const layer = text.items.flatMap(item => 'str' in item ? [item.str] : []);
      const anchor: SourceAnchor = { ...base, locator: { kind: 'pdf', page: number, ...(locator?.rect ? { rect: locator.rect } : {}) } };
      const image = await cropImage(canvas.toBuffer('image/png'), locator?.rect);
      // A region image is exact; full-page text must not be mislabelled as its
      // selected text. Region callers receive the pixels without a fake quote.
      return { title: version.title, source: anchor, image, pageCount: document.numPages, textLayer: layer.length > 0,
        ...(!locator?.rect && layer.length ? { text: layer.join('\n').slice(0, MAX_TEXT) } : {}),
        truncated: !locator?.rect && layer.join('\n').length > MAX_TEXT };
    } finally { await loading.destroy(); }
  }
  if (version.mediaType.startsWith('image/')) {
    if (locator && locator.kind !== 'image') throw new MaterialReadError('locator_format_mismatch');
    // Canonical image coordinates are EXIF-normalized, independent of CSS size.
    const normalized = await sharp(bytes).rotate().png().toBuffer();
    const image = await cropImage(normalized, locator?.rect);
    return { title: version.title, source: { ...base, locator: { kind: 'image', ...(locator?.rect ? { rect: locator.rect } : {}) } }, image, truncated: false };
  }
  if (version.mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    if (locator && locator.kind !== 'docx') throw new MaterialReadError('locator_format_mismatch');
    const { blocks } = await indexDocx(bytes);
    const block = locator ? blocks.find(item => item.part === locator.part && item.blockId === locator.blockId) : blocks.find(item => item.text.length > 0);
    if (!block) throw new MaterialReadError('source_block_missing');
    const start = locator?.start ?? 0, end = locator?.end ?? Math.min(block.text.length, MAX_TEXT);
    if (start >= end || end > block.text.length) throw new MaterialReadError('source_offset_out_of_range');
    return { title: version.title, source: { ...base, locator: { kind: 'docx', part: block.part, blockId: block.blockId, start, end } },
      text: block.text.slice(start, end), truncated: locator === undefined && (end < block.text.length || blocks.length > 1) };
  }
  if (locator && locator.kind !== 'text') throw new MaterialReadError('locator_format_mismatch');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.length) throw new MaterialReadError('source_empty');
  const lines = text.split('\n');
  const offset = (point: { line: number; column: number }): number => {
    const line = lines[point.line - 1];
    if (line === undefined || point.column > line.length) throw new MaterialReadError('source_offset_out_of_range');
    return lines.slice(0, point.line - 1).reduce((size, value) => size + value.length + 1, 0) + point.column;
  };
  let start = 0, end = Math.min(text.length, MAX_TEXT);
  if (locator) { start = offset(locator.start); end = offset(locator.end); }
  const point = (position: number) => { const prefix = text.slice(0, position).split('\n'); return { line: prefix.length, column: prefix.at(-1)!.length }; };
  const anchor = SourceAnchorSchema.parse({ ...base, locator: { kind: 'text', start: point(start), end: point(end) } });
  return { title: version.title, source: anchor, text: text.slice(start, end), truncated: locator === undefined && end < text.length };
}

/** Crop the actual normalized raster. Pixel rounding covers the requested box. */
async function cropImage(bytes: Buffer, rect: NormalizedRect = [0, 0, 1, 1]): Promise<NonNullable<MaterialRead['image']>> {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new MaterialReadError('source_image_invalid');
  const left = Math.floor(rect[0] * meta.width), top = Math.floor(rect[1] * meta.height);
  const width = Math.ceil(rect[2] * meta.width) - left, height = Math.ceil(rect[3] * meta.height) - top;
  const { data, info } = await sharp(bytes).extract({ left, top, width, height })
    .resize({ width: MAX_RASTER_EDGE, height: MAX_RASTER_EDGE, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { mediaType: 'image/png', base64: data.toString('base64'), width: info.width, height: info.height };
}

/** Validates both locator geometry and its actual immutable source extent. */
export async function resolveAnchor(resolver: MaterialResolver, ctx: HostContext, anchor: SourceAnchor): Promise<MaterialRead> {
  const { quote, ...source } = SourceAnchorSchema.parse(anchor);
  const reading = await readMaterial(resolver, ctx, source);
  if (quote !== undefined && (source.locator.kind === 'text' || source.locator.kind === 'docx') && quote !== reading.text) throw new MaterialReadError('source_quote_mismatch');
  return reading;
}
