/**
 * P3.4 skeleton read / validate / merge against the real storage medium.
 *
 * Every book here is a real imported original (a real Markdown file, a real
 * DOCX zip, a real parseable PDF) served by the production `MaterialService`
 * from its own immutable version directory; the skeleton rows live in a real
 * record store. Nothing is a stand-in for a page, and no fake resolver hands
 * back bytes the workspace does not hold, because the property under test is
 * exactly that a draft only becomes credible after the reader has really read
 * the version it cites.
 *
 * This task owns the read/check side only. The tests seed a skeleton row
 * directly through the store the future P6 writer will use, and assert that
 * `read`, `validate` and `merge` never write one themselves.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRecordSchema, type MaterialMediaType } from '../../packages/contracts/src/material-records.ts';
import { SkeletonRecordSchema, type SkeletonNode } from '../../packages/contracts/src/skeleton.ts';
import type { SourceAnchor, SourceLocator } from '../../packages/contracts/src/materials.ts';
import type { Clock } from '../../packages/domain/src/clock.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { SKELETON_KIND, SkeletonService } from '../../packages/domain/src/materials/skeleton-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { docxWithBody } from '../fixtures/materials/docx-fixtures.ts';

let now = '2026-09-12T00:00:00Z';
const clock: Clock = { timeZone: 'Asia/Shanghai', now: () => now };
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const READ = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'learning' as const };
const WRITE = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'creation' as const };
const write = (operationId: string, expectedVersion?: number) => ({
  ...WRITE, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }),
});
const MARKDOWN = '# 三角函数\n\n第一段\n第二段\n';
const SERIES = '# 数列\n\n通项公式\n';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const encoded = (text: string) => new TextEncoder().encode(text);

afterEach(async () => {
  now = '2026-09-12T00:00:00Z';
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function open() {
  const dir = await mkdtemp(join(tmpdir(), 'sf-skeleton-'));
  roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), dir, clock);
  const records = await owner.collection(SKELETON_KIND, SkeletonRecordSchema);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { materials, records, service: new SkeletonService(records, materials) };
}

interface Book { readonly materialId: string; readonly versionId: string; }

async function importBook(
  materials: MaterialService,
  operationId: string,
  fileName: string,
  mediaType: MaterialMediaType,
  bytes: Uint8Array,
): Promise<Book> {
  const view = await materials.import(write(operationId), { title: fileName, fileName, mediaType, bytes });
  return { materialId: view.materialId, versionId: view.currentVersion.versionId };
}

const anchor = (book: Book, locator: SourceLocator): SourceAnchor => ({
  materialId: book.materialId, versionId: book.versionId, locator,
});
const node = (path: string, ...sources: SourceAnchor[]): SkeletonNode => ({ path, sources });
const lineAnchor = (book: Book, line: number, endLine = line): SourceAnchor =>
  anchor(book, { kind: 'text', start: { line, column: 0 }, end: { line: endLine, column: 3 } });

/** One page with a correct xref table, so pdf.js really parses it. */
function onePagePdf(): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>'];
  objects.forEach((body, index) => {
    offsets.push(parts.reduce((total, part) => total + part.length, 0));
    parts.push(Buffer.from(`${String(index + 1)} 0 obj\n${body}\nendobj\n`));
  });
  const start = parts.reduce((total, part) => total + part.length, 0);
  const table = offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(Buffer.from(`xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${table}trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(start)}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

function codeOf(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.name : 'unknown';
}

async function refusalOf(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (error) {
    return { code: codeOf(error), message: error instanceof Error ? error.message : '' };
  }
  throw new Error('the skeleton side accepted something it must refuse');
}

test('reading a book that was never split returns no nodes and writes nothing', async () => {
  const { materials, records, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  expect(await service.read(READ, book.materialId)).toEqual({ materialId: book.materialId, nodes: [] });
  // The empty answer left no row behind: reading is not a reason to grow a skeleton.
  expect(records.list(READ)).toEqual([]);
  expect(() => records.read(READ, `${SKELETON_KIND}:${book.materialId}`)).toThrowError(/record_missing/);
});

test('a skeleton answers for one book in one workspace only', async () => {
  const { materials, records, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const other = await importBook(materials, 'import-2', '数列.md', 'text/markdown', encoded(SERIES));
  const nodes = [node('第一章', lineAnchor(book, 3))];
  const saved = await records.create(write('save-1'), book.materialId, { materialId: book.materialId, nodes });
  expect(await service.read(READ, book.materialId)).toEqual({ materialId: book.materialId, revision: saved.version, nodes });
  expect(await service.read(READ, other.materialId)).toEqual({ materialId: other.materialId, nodes: [] });
  expect((await refusalOf(() => service.read(READ, `mat_${'0'.repeat(24)}`))).code).toBe('material_missing');
  expect((await refusalOf(() => service.read({ ...READ, workspaceId: 'student-b' }, book.materialId))).code).toBe('workspace_mismatch');
});

test('read returns a stored skeleton with its revision and never revises it', async () => {
  const { materials, records, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const nodes = [node('第一章/1.1 角的概念', lineAnchor(book, 3, 4))];
  const saved = await records.create(write('save-1'), book.materialId, { materialId: book.materialId, nodes });
  const first = await service.read(READ, book.materialId);
  const second = await service.read(READ, book.materialId);
  expect(first).toEqual({ materialId: book.materialId, revision: saved.version, nodes });
  expect(second.revision).toBe(first.revision);
  // A row whose content claims another book is corrupt data, not that book's structure.
  const other = await importBook(materials, 'import-2', '数列.md', 'text/markdown', encoded(SERIES));
  await records.create(write('save-2'), other.materialId, { materialId: book.materialId, nodes });
  expect((await refusalOf(() => service.read(READ, other.materialId))).code).toBe('skeleton_record_mismatch');
});

test('validate reads every real anchor, non-contiguous sources included', async () => {
  const { materials, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const nodes = [
    node('第一章/1.1 角的概念',
      anchor(book, { kind: 'text', start: { line: 3, column: 0 }, end: { line: 3, column: 3 } }),
      anchor(book, { kind: 'text', start: { line: 4, column: 0 }, end: { line: 4, column: 3 } })),
    node('第一章/1.2 弧度制', lineAnchor(book, 4)),
  ];
  const checked = await service.validate(READ, book.materialId, nodes);
  expect(checked).toEqual({ materialId: book.materialId, nodes, versionIds: [book.versionId] });
});

test('validate refuses anchors outside the version they pin', async () => {
  const { materials, service } = await open();
  const markdown = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const docx = await importBook(materials, 'import-2', '试卷.docx', DOCX_TYPE, docxWithBody('<w:p><w:r><w:t>甲</w:t></w:r></w:p>'));
  const pdf = await importBook(materials, 'import-3', '试卷.pdf', 'application/pdf', onePagePdf());
  const markdownNode = (locator: SourceLocator) => [node('第一章', anchor(markdown, locator))];
  const lineBeyondEnd = await refusalOf(() => service.validate(READ, markdown.materialId, markdownNode({ kind: 'text', start: { line: 9, column: 0 }, end: { line: 9, column: 1 } })));
  expect(lineBeyondEnd.code).toBe('source_offset_out_of_range');
  const columnBeyondLine = await refusalOf(() => service.validate(READ, markdown.materialId, markdownNode({ kind: 'text', start: { line: 3, column: 0 }, end: { line: 3, column: 9 } })));
  expect(columnBeyondLine.code).toBe('source_offset_out_of_range');
  const missingBlock = await refusalOf(() => service.validate(READ, docx.materialId, [node('第一章', anchor(docx, { kind: 'docx', part: 'word/document.xml', blockId: 'body/p[9]', start: 0, end: 1 }))]));
  expect(missingBlock.code).toBe('source_block_missing');
  const blockBeyondEnd = await refusalOf(() => service.validate(READ, docx.materialId, [node('第一章', anchor(docx, { kind: 'docx', part: 'word/document.xml', blockId: 'body/p[0]', start: 0, end: 99 }))]));
  expect(blockBeyondEnd.code).toBe('source_offset_out_of_range');
  const pageBeyondEnd = await refusalOf(() => service.validate(READ, pdf.materialId, [node('第一章', anchor(pdf, { kind: 'pdf', page: 2 }))]));
  expect(pageBeyondEnd.code).toBe('source_page_out_of_range');
  const missingVersion = await refusalOf(() => service.validate(READ, markdown.materialId, [node('第一章', { materialId: markdown.materialId, versionId: `ver_${'0'.repeat(24)}`, locator: { kind: 'text', start: { line: 3, column: 0 }, end: { line: 3, column: 3 } } })]));
  expect(missingVersion.code).toBe('material_version_missing');
  // The anchors that do resolve stay accepted, so the refusals above are about extent.
  expect((await service.validate(READ, pdf.materialId, [node('第一章', anchor(pdf, { kind: 'pdf', page: 1 }))])).versionIds).toEqual([pdf.versionId]);
});

test('an anchor of another book is refused as a foreign book, not a missing one', async () => {
  const { materials, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const other = await importBook(materials, 'import-2', '数列.md', 'text/markdown', encoded(SERIES));
  const failure = await refusalOf(() => service.validate(READ, book.materialId, [node('第一章', lineAnchor(other, 3))]));
  expect(failure.code).toBe('skeleton_wrong_book');
  expect(failure.message).toContain('第一章');
  // Quoting the book that really owns the anchor is accepted, so the rule is ownership.
  expect((await service.validate(READ, other.materialId, [node('第一章', lineAnchor(other, 3))])).versionIds).toEqual([other.versionId]);
});

test('two versions of one book are still one book', async () => {
  const { materials, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const second = await materials.createVersion(write('version-2', 1), {
    materialId: book.materialId, title: '三角函数.md', fileName: '三角函数.md', mediaType: 'text/markdown', bytes: encoded(`${MARKDOWN}\n第三段\n`),
  });
  const version2 = second.currentVersion.versionId;
  expect(version2).not.toBe(book.versionId);
  const checked = await service.validate(READ, book.materialId, [
    node('第一章/1.1', lineAnchor(book, 3)),
    node('第三章', lineAnchor({ materialId: book.materialId, versionId: version2 }, 6)),
  ]);
  expect(checked.versionIds).toEqual([book.versionId, version2]);
});

test('a quoted anchor must quote the text really at that range', async () => {
  const { materials, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const docx = await importBook(materials, 'import-2', '试卷.docx', DOCX_TYPE, docxWithBody('<w:p><w:r><w:t>甲</w:t></w:r></w:p>'));
  const pdf = await importBook(materials, 'import-3', '试卷.pdf', 'application/pdf', onePagePdf());
  const range = { kind: 'text' as const, start: { line: 3, column: 0 }, end: { line: 3, column: 3 } };
  const quoted = { ...anchor(book, range), quote: '第一段' };
  expect((await service.validate(READ, book.materialId, [node('第一章', quoted)])).nodes[0]?.sources[0]?.quote).toBe('第一段');
  const misquoted = await refusalOf(() => service.validate(READ, book.materialId, [node('第一章', { ...anchor(book, range), quote: '第二段' })]));
  expect(misquoted.code).toBe('source_quote_mismatch');
  // One call may cite the same range twice with different quotes; the second is
  // checked on its own instead of being skipped as an already-read position.
  const both = [node('第一章', quoted), node('第二章', { ...anchor(book, range), quote: '第二段' })];
  expect((await refusalOf(() => service.validate(READ, book.materialId, both))).code).toBe('source_quote_mismatch');
  // The same rule covers DOCX blocks, whose text comes from the OOXML index.
  const block = { ...anchor(docx, { kind: 'docx' as const, part: 'word/document.xml', blockId: 'body/p[0]', start: 0, end: 1 }), quote: '甲' };
  expect((await service.validate(READ, docx.materialId, [node('第一章', block)])).nodes[0]?.sources[0]?.quote).toBe('甲');
  expect((await refusalOf(() => service.validate(READ, docx.materialId, [node('第一章', { ...block, quote: '乙' })]))).code).toBe('source_quote_mismatch');
  // Pixels are never read as text, so a page quote is not "verified" by OCR either.
  const page = { ...anchor(pdf, { kind: 'pdf' as const, page: 1 }), quote: '这一页没有文字层' };
  expect((await service.validate(READ, pdf.materialId, [node('第一章', page)])).versionIds).toEqual([pdf.versionId]);
});

test('malformed and duplicated paths are refused before any confirmation', async () => {
  const { materials, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const source = lineAnchor(book, 3);
  for (const path of ['', '   ', '/第一章', '第一章/', '第一章//1.1', '第一章\n1.1']) {
    const failure = await refusalOf(() => service.validate(READ, book.materialId, [node(path, source)]));
    expect([path, failure.code]).toEqual([path, 'skeleton_draft_invalid']);
  }
  expect((await refusalOf(() => service.validate(READ, book.materialId, [{ path: '第一章', sources: [] }]))).code)
    .toBe('skeleton_draft_invalid');
  const duplicated = await refusalOf(() => service.validate(READ, book.materialId, [node('第一章', source), node(' 第一章 ', source)]));
  expect(duplicated.code).toBe('skeleton_duplicate_path');
  expect(duplicated.message).toContain('第一章');
  expect((await service.validate(READ, book.materialId, [node('第一章', source), node('第二章', source)])).nodes.map(item => item.path))
    .toEqual(['第一章', '第二章']);
});

test('merge keeps every other chapter and only touches the drafted paths', async () => {
  const { materials, service } = await open();
  const book = await importBook(materials, 'import-1', '三角函数.md', 'text/markdown', encoded(MARKDOWN));
  const first = node('第一章', lineAnchor(book, 3));
  const second = node('第二章', lineAnchor(book, 4));
  const third = node('第三章', lineAnchor(book, 3, 4));
  const rewritten = node('第一章', lineAnchor(book, 3), lineAnchor(book, 4));
  const merged = service.merge([first, second], [rewritten, third]);
  expect(merged.nodes.map(item => item.path)).toEqual(['第一章', '第二章', '第三章']);
  expect(merged.nodes[0]).toStrictEqual(rewritten);
  expect(merged.nodes[1]).toStrictEqual(second);
  // A replacement, not a union: the chapter's node is exactly what the draft said.
  expect(merged.nodes[0]?.sources).toStrictEqual(rewritten.sources);
  expect(merged.nodes[1]).not.toBe(first);
  expect(merged.added).toEqual(['第三章']);
  expect(merged.replaced).toEqual(['第一章']);
  expect(service.merge([first, second], []).nodes).toStrictEqual([first, second]);
  expect(service.merge([], [third, first]).nodes.map(item => item.path)).toEqual(['第三章', '第一章']);
  expect((await refusalOf(async () => service.merge([first], [third, node('第三章', lineAnchor(book, 4))]))).code)
    .toBe('skeleton_duplicate_path');
});
