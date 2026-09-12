import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readMaterial, type MaterialResolver } from '../../packages/domain/src/materials/read-material.ts';
import { scannedPdf } from '../fixtures/materials/synthetic-pdf.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const context = { workspaceId: 'reader', actor: 'student' as const, purpose: 'learning' as const };
const source = { materialId: 'math', versionId: 'v1' };
async function fixture(bytes: Uint8Array, mediaType: string, fileName: string): Promise<{ resolver: MaterialResolver; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'sf-read-')); roots.push(root);
  const path = join(root, fileName); await writeFile(path, bytes);
  return { path, resolver: { resolve: async (_context, query) => {
    if (query.versionId !== 'v1') throw new Error('material_version_missing');
    return { version: { title: '实际原件', mediaType, fileName }, absolutePath: path };
  } } };
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('text offsets remain source UTF16 positions through repeated lines, emoji and newlines', async () => {
  const text = '相同文字\n中文😀公式\n相同文字\n';
  const { resolver } = await fixture(Buffer.from(text), 'text/markdown', '数学.md');
  const result = await readMaterial(resolver, context, { ...source, locator: { kind: 'text', start: { line: 2, column: 2 }, end: { line: 3, column: 4 } } });
  expect(result.text).toBe('😀公式\n相同文字');
  expect(result.source.locator).toEqual({ kind: 'text', start: { line: 2, column: 2 }, end: { line: 3, column: 4 } });
  await expect(readMaterial(resolver, context, { ...source, locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 3, column: 40 } } })).rejects.toMatchObject({ code: 'source_offset_out_of_range' });
  await expect(readMaterial(resolver, context, { ...source, versionId: 'missing' })).rejects.toThrow('material_version_missing');
});

test('image regions return actual cropped pixels, preserve original bytes and normalize EXIF', async () => {
  const bytes = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#ff0000' } })
    .composite([{ input: await sharp({ create: { width: 50, height: 60, channels: 3, background: '#0000ff' } }).png().toBuffer(), left: 50, top: 0 }]).png().toBuffer();
  const { resolver, path } = await fixture(bytes, 'image/png', '图.png');
  const result = await readMaterial(resolver, context, { ...source, locator: { kind: 'image', rect: [0.5, 0, 1, 1] } });
  expect(result.image).toMatchObject({ width: 50, height: 60, mediaType: 'image/png' });
  const { data } = await sharp(Buffer.from(result.image!.base64, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([...data.subarray(0, 3)]).toEqual([0, 0, 255]);
  expect(digest(await readFile(path))).toBe(digest(bytes));
  const oriented = await sharp(bytes).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const exif = await fixture(oriented, 'image/jpeg', '旋转.jpg');
  expect((await readMaterial(exif.resolver, context, source)).image).toMatchObject({ width: 60, height: 100 });
});

test('scanned PDF physical pages and regions return images without inventing text or changing the PDF', async () => {
  const raster = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  const bytes = scannedPdf(raster, 200, 100);
  const { resolver, path } = await fixture(bytes, 'application/pdf', '试卷.pdf');
  const result = await readMaterial(resolver, context, { ...source, locator: { kind: 'pdf', page: 2, rect: [0.25, 0, 0.75, 1] } });
  expect(result).toMatchObject({ textLayer: false, pageCount: 2, truncated: false, source: { locator: { kind: 'pdf', page: 2, rect: [0.25, 0, 0.75, 1] } } });
  expect(result.text).toBeUndefined();
  expect(result.image).toMatchObject({ width: 200, height: 200 });
  const mean = await sharp(Buffer.from(result.image!.base64, 'base64')).stats();
  expect(mean.channels[0]!.mean).toBeGreaterThan(245);
  expect(mean.channels[1]!.mean).toBeLessThan(10);
  expect(digest(await readFile(path))).toBe(digest(bytes));
  await expect(readMaterial(resolver, context, { ...source, locator: { kind: 'pdf', page: 3 } })).rejects.toMatchObject({ code: 'source_page_out_of_range' });
});
