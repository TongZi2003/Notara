/**
 * P3.1 content validation for one incoming original (CONTRACTS.md §4).
 *
 * A browser-reported MIME type alone is never trusted: the declared media type,
 * the file extension and the real bytes must all agree before anything is
 * published. Every reader is a public library API (fflate zip, sharp raster,
 * pdf.js document) and each one is bounded by MAX_MATERIAL_BYTES, so a damaged
 * or renamed file is refused at import instead of becoming a broken material.
 */
import { unzipSync } from 'fflate';
import { extname } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MAX_MATERIAL_BYTES, MaterialMediaTypeSchema, type MaterialMediaType } from '@studyforge/contracts/material-records';
import { RecordError } from '../storage/record-store.ts';
import { DOCX_MAIN_DOCUMENT_PART, indexDocx } from './docx/index-docx.ts';
import { digestOf, safeFileName } from './version-store.ts';

const DOCX: MaterialMediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** A raster bigger than this is refused before a decode allocates its pixels. */
const MAX_MATERIAL_IMAGE_PIXELS = 40_000_000;
/** Header parsing may see a little past the cap so the refusal is this store's own. */
const HEADER_PIXEL_LIMIT = MAX_MATERIAL_IMAGE_PIXELS * 4;
/** Raster formats share one decoder path; their signatures are separate below. */
const RASTER_FORMAT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif' } as const;

/** One declared type owns these extensions; anything else is a renamed file. */
const EXTENSIONS: Record<MaterialMediaType, readonly string[]> = {
  'application/pdf': ['.pdf'],
  [DOCX]: ['.docx'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg'],
  'text/markdown': ['.md', '.markdown'],
  'text/html': ['.html', '.htm'],
  // Plain text also carries source code, which is read as text everywhere else.
  'text/plain': [
    '.txt', '.text', '.log', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yml', '.yaml', '.toml', '.ini', '.csv',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.sql', '.css', '.vue', '.svelte',
  ],
};

type BinarySignature = 'pdf' | 'docx' | 'png' | 'jpeg' | 'gif' | 'webp';
/** The only declared types whose bytes are a known binary container. */
const BINARY: Partial<Record<MaterialMediaType, BinarySignature>> = {
  'application/pdf': 'pdf', [DOCX]: 'docx', 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif',
};

export interface ValidatedMaterial {
  readonly fileName: string;
  readonly mediaType: MaterialMediaType;
  readonly byteLength: number;
  readonly digest: string;
}

/**
 * Validate one original and describe exactly the bytes that were read.
 * @throws `material_too_large`, `material_name_invalid`, `material_type_mismatch`
 * or `material_content_invalid`; nothing is written on any path.
 */
export async function validateMaterial(input: { fileName: string; mediaType: string; bytes: Uint8Array }): Promise<ValidatedMaterial> {
  const { bytes } = input;
  if (bytes.byteLength === 0) throw new RecordError('material_content_invalid');
  if (bytes.byteLength > MAX_MATERIAL_BYTES) throw new RecordError('material_too_large');
  const declared = MaterialMediaTypeSchema.safeParse(input.mediaType);
  if (!declared.success) throw new RecordError('material_type_mismatch');
  const mediaType = declared.data;
  const fileName = safeFileName(input.fileName);
  if (!EXTENSIONS[mediaType].includes(extname(fileName).toLowerCase())) throw new RecordError('material_type_mismatch');
  const signature = signatureOf(bytes), expected = BINARY[mediaType];
  // A file that is visibly another format is a mismatch; one that lost its own
  // header to truncation is damage, and both are refused.
  if (signature !== null && signature !== expected) throw new RecordError('material_type_mismatch');
  if (expected !== undefined && signature === null) throw new RecordError('material_content_invalid');
  await assertContent(mediaType, bytes);
  return { fileName, mediaType, byteLength: bytes.byteLength, digest: digestOf(bytes) };
}

/** The container the first bytes really are, independent of the declared type. */
function signatureOf(bytes: Uint8Array): BinarySignature | null {
  if (asciiStartsWith(bytes, '%PDF-')) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'docx';
  if (bytes[0] === 0x89 && asciiStartsWith(bytes, 'PNG\r\n\u001a\n', 1)) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (asciiStartsWith(bytes, 'GIF87a') || asciiStartsWith(bytes, 'GIF89a')) return 'gif';
  if (asciiStartsWith(bytes, 'RIFF') && asciiStartsWith(bytes, 'WEBP', 8)) return 'webp';
  return null;
}

function asciiStartsWith(bytes: Uint8Array, text: string, offset = 0): boolean {
  if (bytes.byteLength < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  return true;
}

async function assertContent(mediaType: MaterialMediaType, bytes: Uint8Array): Promise<void> {
  if (mediaType === 'application/pdf') return parsePdf(bytes);
  if (mediaType === DOCX) return assertDocx(bytes);
  if (mediaType === 'image/svg+xml') return assertSvg(bytes);
  if (mediaType.startsWith('text/')) return assertText(bytes);
  return assertRaster(mediaType, bytes);
}

/** Real parse, no rendering: a PDF that pdf.js cannot open is not a material. */
async function parsePdf(bytes: Uint8Array): Promise<void> {
  // pdf.js transfers the buffer it is given and refuses a Buffer subclass, so
  // validating a plain copy keeps the caller's bytes intact for the digest.
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 });
  try {
    const document = await task.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1) throw new RecordError('material_content_invalid');
  } catch (error) {
    throw error instanceof RecordError ? error : new RecordError('material_content_invalid');
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/**
 * A DOCX is an OPC package whose declared main part really is WordprocessingML.
 * Presence of two zip entries is not enough — the content-type declaration has
 * to name `/word/document.xml`, the part has to be a `w:document` in the
 * WordprocessingML namespace, and the real P3.3 index has to read it.
 */
async function assertDocx(bytes: Uint8Array): Promise<void> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: file => file.name === '[Content_Types].xml' && file.originalSize <= 1024 * 1024 });
  } catch { throw new RecordError('material_content_invalid'); }
  const types = entries['[Content_Types].xml'];
  if (!types || types.byteLength > 1024 * 1024) throw new RecordError('material_content_invalid');
  if (!declaresMainDocument(decodeText(types))) throw new RecordError('material_content_invalid');
  // The canonical index owns the structural read; a partial parse is refused there.
  try { await indexDocx(bytes); }
  catch { throw new RecordError('material_content_invalid'); }
}

/** The package declaration must name the main document part as a WORD document. */
function declaresMainDocument(types: string): boolean {
  const namespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
  let invalid = false;
  try {
    const document = new DOMParser({ onError: (level) => { if (level !== 'warning') invalid = true; } }).parseFromString(types, 'application/xml');
    const root = document.documentElement;
    if (invalid || root?.namespaceURI !== namespace || root.localName !== 'Types') return false;
    for (const node of Array.from(root.getElementsByTagNameNS(namespace, 'Override'))) {
      if (node.getAttribute('PartName') === '/' + DOCX_MAIN_DOCUMENT_PART && node.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') return true;
    }
  } catch { return false; }
  return false;
}

/** Header facts within this store's pixel budget, or a refusal. */
async function describeImage(bytes: Uint8Array): Promise<{ format?: string; width?: number; height?: number }> {
  let metadata;
  try { metadata = await sharp(Buffer.from(bytes), { limitInputPixels: HEADER_PIXEL_LIMIT }).metadata(); }
  catch { throw new RecordError('material_content_invalid'); }
  if (!metadata.width || !metadata.height) throw new RecordError('material_content_invalid');
  if (metadata.width * metadata.height > MAX_MATERIAL_IMAGE_PIXELS) throw new RecordError('material_too_large');
  return metadata;
}

async function assertRaster(mediaType: MaterialMediaType, bytes: Uint8Array): Promise<void> {
  const format = RASTER_FORMAT[mediaType as keyof typeof RASTER_FORMAT];
  if ((await describeImage(bytes)).format !== format) throw new RecordError('material_content_invalid');
  // A header alone still parses a truncated image, so the pixels are really decoded.
  try {
    await sharp(Buffer.from(bytes), { limitInputPixels: MAX_MATERIAL_IMAGE_PIXELS, failOn: 'error' })
      .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true }).raw().toBuffer();
  } catch { throw new RecordError('material_content_invalid'); }
}

async function assertSvg(bytes: Uint8Array): Promise<void> {
  let metadata;
  try {
    if (!/<svg[\s>]/i.test(decodeText(bytes))) throw new RecordError('material_content_invalid');
    metadata = await describeImage(bytes);
  } catch (error) { throw error instanceof RecordError ? error : new RecordError('material_content_invalid'); }
  if (metadata.format !== 'svg') throw new RecordError('material_content_invalid');
  // Rasterize once at a bounded size: unrenderable SVG is not an image.
  try {
    await sharp(Buffer.from(bytes), { limitInputPixels: MAX_MATERIAL_IMAGE_PIXELS, failOn: 'error' })
      .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch { throw new RecordError('material_content_invalid'); }
}

function assertText(bytes: Uint8Array): void {
  try { if (decodeText(bytes).includes('\u0000')) throw new Error('nul'); }
  catch { throw new RecordError('material_content_invalid'); }
}

/** Text must be real UTF-8; a binary file renamed `.md` is not text. */
function decodeText(bytes: Uint8Array): string { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
