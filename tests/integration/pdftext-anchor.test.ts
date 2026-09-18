/**
 * `pdftext` anchors against a real extractable text layer: span slices come
 * back byte-exact, quote-only anchors resolve to the one place they name,
 * and every dishonest anchor (misquote, ambiguity, missing layer, wrong
 * format) is refused with its own code — never a nearby guess.
 */
import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { readMaterial, resolveAnchor, type MaterialResolver } from '../../packages/domain/src/materials/read-material.ts';
import { scannedPdf, textPdf } from '../fixtures/materials/synthetic-pdf.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const context = { workspaceId: 'reader', actor: 'student' as const, purpose: 'learning' as const };
const source = { materialId: 'calculus', versionId: 'v1' };

async function fixture(bytes: Uint8Array, mediaType = 'application/pdf', fileName = 'calculus.pdf'): Promise<MaterialResolver> {
  const root = await mkdtemp(join(tmpdir(), 'sf-pdftext-')); roots.push(root);
  const path = join(root, fileName); await writeFile(path, bytes);
  return { resolve: async (_context, query) => {
    if (query.versionId !== 'v1') throw new Error('material_version_missing');
    return { version: { title: '微积分讲义', mediaType, fileName }, absolutePath: path };
  } };
}
const pdf = textPdf([
  ['The derivative of x squared is two x.', 'Product rule doubles back.', 'The derivative repeats here.'],
  ['Second page carries its own text.'],
]);

test('span anchors slice the page text layer byte-exact and quote-verify', async () => {
  const resolver = await fixture(pdf);
  const layer = (await readMaterial(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1 } }));
  expect(layer.text).toContain('Product rule doubles back.');
  const start = layer.text!.indexOf('Product rule doubles back.');
  const read = await readMaterial(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1, start, end: start + 26 } });
  expect(read.text).toBe('Product rule doubles back.');
  expect(read.source.locator).toEqual({ kind: 'pdftext', page: 1, start, end: start + 26 });
  expect(read.image).toBeUndefined();
  const resolved = await resolveAnchor(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1, start, end: start + 26 }, quote: 'Product rule doubles back.' });
  expect(resolved.text).toBe('Product rule doubles back.');
  await expect(resolveAnchor(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1, start, end: start + 26 }, quote: 'Chain rule instead.' }))
    .rejects.toMatchObject({ code: 'source_quote_mismatch' });
  await expect(readMaterial(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1, start: 5, end: layer.text!.length + 1 } }))
    .rejects.toMatchObject({ code: 'source_offset_out_of_range' });
});

test('quote-only anchors resolve their single occurrence and refuse ambiguity or absence', async () => {
  const resolver = await fixture(pdf);
  const resolved = await resolveAnchor(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1 }, quote: 'Product rule doubles back.' });
  expect(resolved.text).toBe('Product rule doubles back.');
  const locator = resolved.source.locator;
  expect(locator.kind).toBe('pdftext');
  if (locator.kind === 'pdftext') {
    const layer = (await readMaterial(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1 } })).text!;
    expect(layer.slice(locator.start, locator.end)).toBe('Product rule doubles back.');
  }
  await expect(resolveAnchor(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1 }, quote: 'The derivative' }))
    .rejects.toMatchObject({ code: 'source_quote_ambiguous' });
  await expect(resolveAnchor(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1 }, quote: 'not on this page' }))
    .rejects.toMatchObject({ code: 'source_quote_mismatch' });
  await expect(resolveAnchor(resolver, context, { ...source, locator: { kind: 'pdftext', page: 1 } }))
    .rejects.toMatchObject({ code: 'source_locator_incomplete' });
  await expect(resolveAnchor(resolver, context, { ...source, locator: { kind: 'pdftext', page: 2 }, quote: 'Second page carries its own text.' }))
    .resolves.toMatchObject({ text: 'Second page carries its own text.' });
});

test('scanned pages, wrong formats and out-of-range pages refuse with their own codes', async () => {
  const raster = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const scanned = await fixture(scannedPdf(raster, 60, 40), 'application/pdf', '扫描.pdf');
  await expect(resolveAnchor(scanned, context, { ...source, locator: { kind: 'pdftext', page: 1 }, quote: 'anything' }))
    .rejects.toMatchObject({ code: 'source_text_layer_missing' });
  const markdown = await fixture(Buffer.from('plain text'), 'text/markdown', 'notes.md');
  await expect(resolveAnchor(markdown, context, { ...source, locator: { kind: 'pdftext', page: 1 }, quote: 'plain' }))
    .rejects.toMatchObject({ code: 'locator_format_mismatch' });
  const resolver = await fixture(pdf);
  await expect(resolveAnchor(resolver, context, { ...source, locator: { kind: 'pdftext', page: 9 }, quote: 'x' }))
    .rejects.toMatchObject({ code: 'source_page_out_of_range' });
  await expect(resolveAnchor(resolver, context, { ...source, locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 3 } } }))
    .rejects.toMatchObject({ code: 'locator_format_mismatch' });
});
