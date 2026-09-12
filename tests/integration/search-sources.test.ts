/**
 * P4.2 source fidelity of the local learning search.
 *
 * A hit has to be able to lead back to the exact text it was found in: the whole
 * Markdown file (not the first read window), one stable DOCX block with real
 * UTF-16 offsets, one real PDF page from the text layer the file carries, and a
 * typed reason when the version holds no text layer or cannot be read at all.
 * The card case pins the same rule for the private side: the teacher's own note
 * is never part of the searchable card.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { CardContentSchema, KnowledgeContentSchema } from '../../packages/contracts/src/index.ts';
import { MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { LearningSearch, indexMaterialText } from '../../packages/domain/src/materials/learning-search.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { docxWithBody } from '../fixtures/materials/docx-fixtures.ts';
import { scannedPdf } from '../fixtures/materials/synthetic-pdf.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const HOST = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'learning' as const };
const write = (operationId: string) => ({ workspaceId: 'student-a', actor: 'student' as const, purpose: 'creation' as const, operationId });
const encoded = (text: string) => new TextEncoder().encode(text);

async function open() {
  const dir = await mkdtemp(join(tmpdir(), 'sf-search-sources-'));
  roots.push(dir);
  const app = new Context(); await app.plugin(Storage);
  const owner = await openWorkspaceRecords(app, dir, 'student-a', clock);
  const materialStore = await owner.collection('material', MaterialRecordSchema);
  const cards = await owner.collection('card', CardContentSchema);
  const knowledge = await owner.collection('knowledge', KnowledgeContentSchema);
  const materials = new MaterialService(materialStore, dir, clock);
  cleanups.push(async () => { await owner.close(); await app.fiber.dispose(); });
  return { materials, cards, knowledge, root: dir, search: new LearningSearch({ materials: materialStore, resolve: materials, cards, knowledge }) };
}

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Assemble a real PDF with a correct xref table out of ready-made object bodies. */
function pdfOf(bodies: readonly (string | Buffer)[]): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')], offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(parts.reduce((total, part) => total + part.length, 0));
    parts.push(Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), typeof body === 'string' ? Buffer.from(body) : body, Buffer.from('\nendobj\n')]));
  });
  const start = parts.reduce((total, part) => total + part.length, 0);
  const table = offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(Buffer.from(`xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}
const contentStream = (text: string) => Buffer.concat([Buffer.from(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n`), Buffer.from(text), Buffer.from('\nendstream')]);

/** A two-page PDF whose pages really draw the given text in a built-in font. */
function textPdf(pages: readonly string[]): Uint8Array {
  const pageIds = pages.map((_, index) => 5 + index * 2);
  const bodies: (string | Buffer)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, index) => {
    bodies.push(contentStream(`BT /F1 14 Tf 40 100 Td (${text}) Tj ET`));
    bodies.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${4 + index * 2} 0 R >>`);
  });
  return pdfOf(bodies);
}

test('a Markdown match far beyond the first read window is found at its real line', async () => {
  const { materials, search } = await open();
  const filler = Array.from({ length: 1200 }, (_, index) => `第 ${index} 行 ${'填充内容'.repeat(4)}`).join('\n');
  const text = `${filler}\n远处的 needle 在这里\n`;
  const material = await materials.import(write('m-long'), { title: '长讲义', fileName: '长讲义.md', mediaType: 'text/markdown', bytes: encoded(text) });
  const at = text.indexOf('needle');
  expect(text.length).toBeGreaterThan(30_000);
  expect(at).toBeGreaterThan(30_000);

  const result = await search.search(HOST, { query: 'needle' });
  expect(result.notes).toEqual([]);
  const hit = result.hits[0]!;
  const line = text.slice(0, at).split('\n').length;
  expect(hit.source).toMatchObject({
    materialId: material.materialId, versionId: material.currentVersion.versionId,
    locator: { kind: 'text', start: { line, column: 4 } },
  });
  const snippet = hit.snippets[0]!;
  expect(snippet.text.slice(snippet.start!, snippet.end!)).toBe('needle');
});

test('a DOCX hit keeps the stable block id and the real UTF-16 offsets', async () => {
  const { materials, search } = await open();
  const bytes = docxWithBody('<w:p><w:r><w:t>第一段 无关</w:t></w:r></w:p><w:p><w:r><w:t>第二段 needle 之后</w:t></w:r></w:p>');
  await materials.import(write('m-docx'), { title: '教案', fileName: '教案.docx', mediaType: DOCX, bytes });
  const hit = (await search.search(HOST, { query: 'needle' })).hits[0]!;
  expect(hit.snippets[0]).toMatchObject({ field: 'word/document.xml#body/p[1]' });
  // The second paragraph, its own block, the offsets inside that block's text.
  expect(hit.source?.locator).toEqual({ kind: 'docx', part: 'word/document.xml', blockId: 'body/p[1]', start: 4, end: 10 });
});

test('a PDF text layer is indexed page by page and never invented', async () => {
  const { materials, search } = await open();
  await materials.import(write('m-pdf'), { title: '真题', fileName: '真题.pdf', mediaType: 'application/pdf', bytes: textPdf(['alpha first page', 'bravo second page']) });
  const second = await search.search(HOST, { query: 'bravo' });
  expect(second.notes).toEqual([]);
  expect(second.hits[0]).toMatchObject({ corpus: 'material', source: { locator: { kind: 'pdf', page: 2 } } });
  const first = await search.search(HOST, { query: 'alpha' });
  expect(first.hits[0]!.source?.locator).toEqual({ kind: 'pdf', page: 1 });
});

test('a scan without a text layer is a typed reason, not an empty result', async () => {
  const { materials, search } = await open();
  const raster = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const material = await materials.import(write('m-scan'), { title: '扫描卷', fileName: '扫描卷.pdf', mediaType: 'application/pdf', bytes: new Uint8Array(scannedPdf(raster, 80, 40)) });
  const result = await search.search(HOST, { query: 'needle' });
  expect(result.hits).toEqual([]);
  expect(result.notes).toEqual([{ code: 'material_no_text_layer', materialId: material.materialId, versionId: material.currentVersion.versionId }]);
});

test('a damaged version reports a read failure instead of no matches', async () => {
  const { materials, search, root } = await open();
  const material = await materials.import(write('m-broken'), { title: '会被改坏', fileName: '会被改坏.md', mediaType: 'text/markdown', bytes: encoded('needle 原文\n') });
  const path = (await materials.resolve(HOST, { materialId: material.materialId, versionId: material.currentVersion.versionId })).absolutePath;
  // The bytes no longer match the digest the version recorded, so the read fails.
  await writeFile(path, new Uint8Array([0xff, 0xfe, 0x00, 0x01]));
  const result = await search.search(HOST, { query: 'needle' });
  expect(result.hits).toEqual([]);
  expect(result.notes).toEqual([{
    code: 'material_unreadable', materialId: material.materialId,
    versionId: material.currentVersion.versionId, detail: 'material_digest_mismatch',
  }]);

  // The indexer refuses real bytes that are not text, so resolve is not the only guard.
  const broken = join(root, 'broken.md');
  await writeFile(broken, new Uint8Array([0xff, 0xfe]));
  const indexed = await indexMaterialText({ materialId: 'mat_x', versionId: 'ver_y', mediaType: 'text/markdown', absolutePath: broken });
  expect(indexed.state).toBe('unreadable');
});

test('a card hit names the real field, skips the teacher note, and an image is not a failure', async () => {
  const { materials, cards, search } = await open();
  await cards.create(write('c-1'), 'notes-card', {
    title: '概念卡', front: '公开卡面', notes: '老师私有备注 needle',
    sections: [{ heading: '背面', body: '函数 needle 在背面' }],
  });
  const png = new Uint8Array(await sharp({ create: { width: 20, height: 10, channels: 3, background: '#fff' } }).png().toBuffer());
  await materials.import(write('m-img'), { title: '插图', fileName: '插图.png', mediaType: 'image/png', bytes: png });

  const result = await search.search(HOST, { query: 'needle' });
  // An image simply has no text to search; that is a format fact, not a read failure.
  expect(result.notes).toEqual([]);
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]).toMatchObject({ corpus: 'card', ref: 'card:notes-card', revision: 1 });
  expect(result.hits[0]!.snippets.map(snippet => snippet.field)).toEqual(['sections[0].body']);
  expect(result.hits[0]!.snippets.map(snippet => snippet.text).join('')).not.toContain('老师私有备注');
});
