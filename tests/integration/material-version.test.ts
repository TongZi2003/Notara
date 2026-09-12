/**
 * P3.1 original materials against the real storage medium (CONTRACTS.md §4).
 *
 * Every original in this file is a real file: a real zip DOCX, a real raster
 * produced by sharp, a real parseable PDF and real text. The record store, the
 * workspace lock and the immutable version directory are the production ones;
 * only the caller is scripted. The test pins the properties this task exists
 * for: bytes are published before metadata, an accepted operation has one
 * effect on retry, an old anchor keeps its own bytes, and nothing half-visible
 * appears when a file is renamed, damaged or interrupted.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { MAX_MATERIAL_BYTES, MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import type { Clock } from '../../packages/domain/src/clock.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { buildDocx, docxWithBody, documentXml } from '../fixtures/materials/docx-fixtures.ts';

// A real clock moves between attempts; a replay must not depend on that.
let now = '2026-09-12T00:00:00Z';
const clock: Clock = { timeZone: 'Asia/Shanghai', now: () => now };
const at = (instant: string) => { now = instant; };
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Import needs no learning set and no native session: creating a material is
// not a classroom action, so the write context carries no sessionId.
const WRITE = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'creation' as const };
const READ = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'learning' as const };
const write = (operationId: string, expectedVersion?: number) => ({ ...WRITE, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });

async function open(root?: string) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-material-'));
  if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const service = new MaterialService(await owner.collection('material', MaterialRecordSchema), dir, clock);
  // `close` is idempotent, so a test may close early to prove a restart.
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { ctx, owner, service, root: dir };
}
afterEach(async () => {
  now = '2026-09-12T00:00:00Z';
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const encoded = (text: string) => new TextEncoder().encode(text);
const bytesAt = async (path: string) => digest(new Uint8Array(await readFile(path)));

/** One page with a correct xref table, so pdf.js really parses it. */
function minimalPdf(): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')], offsets: number[] = [];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>'];
  objects.forEach((body, index) => {
    offsets.push(parts.reduce((total, part) => total + part.length, 0));
    parts.push(Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`));
  });
  const start = parts.reduce((total, part) => total + part.length, 0);
  const table = offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
/** A zip that carries a main part but no content-type declaration for it. */
const undeclaredDocx = () => zipSync({
  '[Content_Types].xml': encoded(`<Types xmlns="${CONTENT_TYPES_NS}"/>`),
  'word/document.xml': encoded(documentXml('<w:p><w:r><w:t>x</w:t></w:r></w:p>')),
});

test('an imported original keeps its bytes and identity across a restart', async () => {
  const { service, owner, root } = await open();
  const bytes = encoded('# 三角函数\n\n第一段\n');
  const view = await service.import(write('import-1'), { title: '三角函数讲义', fileName: '三角函数.md', mediaType: 'text/markdown', bytes });
  expect(view).toMatchObject({ revision: 1, title: '三角函数讲义', fileName: '三角函数.md', mediaType: 'text/markdown' });
  expect(view.materialId).toMatch(/^mat_[a-z0-9]{16,}$/);
  expect(view.currentVersion.versionId).toMatch(/^ver_[a-z0-9]{16,}$/);
  expect(view.currentVersion).toMatchObject({ digest: digest(bytes), byteLength: bytes.byteLength, importedAt: '2026-09-12T00:00:00Z' });
  // Importing creates the original only: no card, skeleton, route or lesson.
  const resolved = await service.resolve(READ, { materialId: view.materialId, versionId: view.currentVersion.versionId });
  expect(await bytesAt(resolved.absolutePath)).toBe(digest(bytes));
  expect(await service.list(READ)).toHaveLength(1);

  await owner.close();
  const reopened = await open(root);
  expect(await reopened.service.get(READ, view.materialId)).toEqual(view);
  const again = await reopened.service.resolve(READ, { materialId: view.materialId, versionId: view.currentVersion.versionId });
  expect(await bytesAt(again.absolutePath)).toBe(digest(bytes));
});

test('the declared type, the file name and the real bytes must all agree', async () => {
  const { service } = await open();
  const png = new Uint8Array(await sharp({ create: { width: 200, height: 150, channels: 3, background: '#0f0' } }).png().toBuffer());
  const svg = encoded('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>');
  expect((await service.import(write('png-1'), { title: '示意图', fileName: '图.png', mediaType: 'image/png', bytes: png })).mediaType).toBe('image/png');
  expect((await service.import(write('svg-1'), { title: '矢量图', fileName: '图.svg', mediaType: 'image/svg+xml', bytes: svg })).mediaType).toBe('image/svg+xml');
  expect((await service.import(write('pdf-1'), { title: '试卷', fileName: '试卷.pdf', mediaType: 'application/pdf', bytes: minimalPdf() })).mediaType).toBe('application/pdf');
  // The real P3.3 fixture: an OPC package whose main part is WordprocessingML.
  expect((await service.import(write('docx-1'), { title: '教案', fileName: '教案.docx', mediaType: DOCX, bytes: docxWithBody('<w:p><w:r><w:t>第一段</w:t></w:r></w:p>') })).mediaType).toBe(DOCX);
  const accepted = (await service.list(READ)).length;

  const rejects = [
    ['material_type_mismatch', { title: '假PDF', fileName: '假.pdf', mediaType: 'application/pdf', bytes: png }],
    ['material_type_mismatch', { title: '改名', fileName: '图.md', mediaType: 'image/png', bytes: png }],
    ['material_type_mismatch', { title: '无后缀', fileName: '无后缀', mediaType: 'text/plain', bytes: encoded('x') }],
    ['material_content_invalid', { title: '坏图', fileName: '坏.png', mediaType: 'image/png', bytes: png.subarray(0, 12) }],
    // A header alone still parses; only a real decode refuses a truncated body.
    ['material_content_invalid', { title: '截断图', fileName: '截断.png', mediaType: 'image/png', bytes: png.subarray(0, Math.floor(png.byteLength * 0.85)) }],
    ['material_too_large', { title: '超大图', fileName: '超大.svg', mediaType: 'image/svg+xml', bytes: encoded('<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="6000"><rect width="7000" height="6000" fill="#000"/></svg>') }],
    ['material_content_invalid', { title: '坏PDF', fileName: '坏.pdf', mediaType: 'application/pdf', bytes: encoded('%PDF-1.4\n这不是一份PDF') }],
    ['material_content_invalid', { title: '坏DOCX', fileName: '坏.docx', mediaType: DOCX, bytes: new Uint8Array(zipSync({ 'word/styles.xml': encoded('<w:styles/>') })) }],
    // Two zip entries and a well-formed XML lookalike without the WML namespace.
    ['material_content_invalid', { title: '假DOCX', fileName: '假.docx', mediaType: DOCX, bytes: buildDocx([{ path: 'word/document.xml', xml: '<?xml version="1.0" encoding="UTF-8"?><document><body><p>正文</p></body></document>' }]) }],
    // A declared main part is as necessary as the part itself.
    ['material_content_invalid', { title: '无声明DOCX', fileName: '无声明.docx', mediaType: DOCX, bytes: new Uint8Array(undeclaredDocx()) }],
    ['material_content_invalid', { title: '坏XML', fileName: '坏XML.docx', mediaType: DOCX, bytes: docxWithBody('<w:p><w:r><w:t>未闭合') }],
    ['material_content_invalid', { title: '二进制', fileName: '二进制.md', mediaType: 'text/markdown', bytes: new Uint8Array([0x00, 0xff, 0xfe, 0x01]) }],
    ['material_content_invalid', { title: '空文件', fileName: '空.txt', mediaType: 'text/plain', bytes: new Uint8Array() }],
    ['material_name_invalid', { title: '越界', fileName: '../越界.md', mediaType: 'text/markdown', bytes: encoded('x') }],
    ['material_too_large', { title: '太大', fileName: '大文件.txt', mediaType: 'text/plain', bytes: Buffer.alloc(MAX_MATERIAL_BYTES + 1) }],
  ] as const;
  for (const [code, input] of rejects) await expect(service.import(write(`bad-${code}-${input.fileName}`), input)).rejects.toMatchObject({ code });
  // A refused import leaves nothing behind, not even an unreachable row.
  expect(await service.list(READ)).toHaveLength(accepted);
});

test('one accepted operation is one effect and a name is never overwritten', async () => {
  const { service } = await open();
  const input = { title: '错题', fileName: '错题.md', mediaType: 'text/markdown', bytes: encoded('题目') } as const;
  const first = await service.import(write('op-once'), input);
  at('2026-09-12T04:00:00Z');
  expect(await service.import(write('op-once'), input)).toEqual(first);
  expect(await service.list(READ)).toHaveLength(1);
  // Same bytes under a new operation may not reuse another material's name.
  await expect(service.import(write('op-other'), { ...input, title: '另一份' })).rejects.toMatchObject({ code: 'material_name_exists' });

  const race = { title: '并发', fileName: '并发.md', mediaType: 'text/markdown', bytes: encoded('并发') } as const;
  const results = await Promise.allSettled([service.import(write('race-a'), race), service.import(write('race-b'), race)]);
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'material_name_exists' });
  expect(await service.list(READ)).toHaveLength(2);
});

test('a replayed operation answers with its own revision and still obeys authority', async () => {
  const { service } = await open();
  const input = { title: '原件', fileName: '原件.md', mediaType: 'text/markdown', bytes: encoded('第一版') } as const;
  const first = await service.import(write('import-v1'), input);
  at('2026-09-12T02:00:00Z');
  const second = await service.createVersion(write('import-v2', first.revision), { materialId: first.materialId, title: '原件', fileName: '原件.md', mediaType: 'text/markdown', bytes: encoded('第二版') });
  expect(second.currentVersion.digest).not.toBe(first.currentVersion.digest);

  // Replaying the accepted import after a later version is neither a conflict
  // nor a second import: it is that operation's own revision, and the material
  // the caller reads now still points at the newer version.
  at('2026-09-12T03:00:00Z');
  expect(await service.import(write('import-v1'), input)).toEqual(first);
  expect(await service.get(READ, first.materialId)).toEqual(second);
  expect(await service.list(READ)).toHaveLength(1);
  // Replaying the accepted append is likewise one version, not two.
  expect(await service.createVersion(write('import-v2', first.revision), { materialId: first.materialId, title: '原件', fileName: '原件.md', mediaType: 'text/markdown', bytes: encoded('第二版') })).toEqual(second);
  expect((await service.list(READ))[0]!.versions).toHaveLength(2);

  // The record store still owns the decision: the same operation id under other
  // authority is a conflict, not a fast path around the conditional write.
  await expect(service.import({ ...WRITE, operationId: 'import-v1', actor: 'teacher' }, input)).rejects.toMatchObject({ code: 'record_exists' });
  await expect(service.createVersion({ ...WRITE, operationId: 'import-v2', sessionId: 'lesson-x', expectedVersion: first.revision },
    { materialId: first.materialId, title: '原件', fileName: '原件.md', mediaType: 'text/markdown', bytes: encoded('第二版') })).rejects.toMatchObject({ code: 'operation_conflict' });
  await expect(service.import({ ...WRITE, purpose: 'learning', operationId: 'import-v1' }, input)).rejects.toMatchObject({ code: 'record_exists' });
});

test('an explicit new version moves the current pointer and keeps the old anchor', async () => {
  const { service, owner, root } = await open();
  const original = encoded('第一版');
  const first = await service.import(write('v1'), { title: '讲义', fileName: '讲义.md', mediaType: 'text/markdown', bytes: original });
  const next = { materialId: first.materialId, title: '讲义', fileName: '讲义.md', mediaType: 'text/markdown' } as const;
  await expect(service.createVersion(write('no-expected'), { ...next, bytes: encoded('x') })).rejects.toMatchObject({ code: 'material_expected_version_required' });

  const revised = encoded('第二版\n加了内容');
  const second = await service.createVersion(write('v2', first.revision), { ...next, bytes: revised });
  expect(second).toMatchObject({ revision: 2, currentVersion: { digest: digest(revised) } });
  expect(second.versions).toHaveLength(2);
  expect(await service.get(READ, first.materialId)).toEqual(second);
  // A stale confirmation must not append a third version.
  await expect(service.createVersion(write('stale', first.revision), { ...next, bytes: encoded('第三版') })).rejects.toMatchObject({ code: 'version_conflict' });

  const old = await service.resolve(READ, { materialId: first.materialId, versionId: first.currentVersion.versionId });
  const now = await service.resolve(READ, { materialId: first.materialId, versionId: second.currentVersion.versionId });
  expect(old.absolutePath).not.toBe(now.absolutePath);
  expect(await bytesAt(old.absolutePath)).toBe(digest(original));
  expect(await bytesAt(now.absolutePath)).toBe(digest(revised));

  // Replaying the accepted new-version operation is still one appended version.
  expect((await service.createVersion(write('v2', first.revision), { ...next, bytes: revised })).revision).toBe(2);
  expect((await service.list(READ))[0]!.versions).toHaveLength(2);
  await owner.close();
  const reopened = await open(root);
  expect((await reopened.service.get(READ, first.materialId)).versions).toHaveLength(2);
});

test('workspace, identity and the real digest are enforced on every read', async () => {
  const { service, root } = await open();
  const bytes = encoded('原件');
  const view = await service.import(write('secure'), { title: '原件', fileName: '原件.md', mediaType: 'text/markdown', bytes });
  const ref = { materialId: view.materialId, versionId: view.currentVersion.versionId };
  const resolved = await service.resolve(READ, ref);

  const other = { workspaceId: 'student-b', actor: 'student' as const, purpose: 'learning' as const };
  await expect(service.get(other, view.materialId)).rejects.toMatchObject({ code: 'workspace_mismatch' });
  await expect(service.list(other)).rejects.toMatchObject({ code: 'workspace_mismatch' });
  await expect(service.resolve(READ, { materialId: view.materialId, versionId: `ver_${'0'.repeat(20)}` })).rejects.toMatchObject({ code: 'material_version_missing' });
  await expect(service.get(READ, 'not-an-id')).rejects.toThrow();

  // The medium cannot be swapped underneath a saved digest.
  await writeFile(resolved.absolutePath, encoded('被改过'));
  await expect(service.resolve(READ, ref)).rejects.toMatchObject({ code: 'material_digest_mismatch' });
});

test('a redirected store, material directory or version directory is refused', async () => {
  const { service, root } = await open();
  const bytes = encoded('原件');
  const view = await service.import(write('redirect'), { title: '原件', fileName: '原件.md', mediaType: 'text/markdown', bytes });
  const ref = { materialId: view.materialId, versionId: view.currentVersion.versionId };
  const materials = join(root, 'materials');
  const versionDir = join(materials, view.materialId, view.currentVersion.versionId);
  const other = await mkdtemp(join(tmpdir(), 'sf-material-other-'));
  roots.push(other);
  const mirror = join(other, view.materialId, view.currentVersion.versionId);
  await mkdir(mirror, { recursive: true });
  await writeFile(join(mirror, '原件.md'), bytes);

  // The version directory itself is a link into another tree: the real bytes
  // exist there, and a store that followed the link would hand them out.
  await rm(versionDir, { recursive: true });
  await symlink(mirror, versionDir);
  await expect(service.resolve(READ, ref)).rejects.toMatchObject({ code: 'material_path_unsafe' });

  // The material directory is a link: the read is refused and so is the publish
  // that would otherwise have created the next version directory through it.
  await rm(join(materials, view.materialId), { recursive: true });
  await symlink(join(other, view.materialId), join(materials, view.materialId));
  const beforeDirectories = await readdir(join(other, view.materialId));
  await expect(service.resolve(READ, ref)).rejects.toMatchObject({ code: 'material_path_unsafe' });
  await expect(service.createVersion(write('redirect-v2', view.revision),
    { materialId: view.materialId, title: '原件', fileName: '原件.md', mediaType: 'text/markdown', bytes: encoded('第二版') }))
    .rejects.toMatchObject({ code: 'material_path_unsafe' });
  expect(await readdir(join(other, view.materialId))).toEqual(beforeDirectories);

  // The store itself is a link to another workspace: nothing is read from or
  // written into the tree it points at.
  const storeLink = await mkdtemp(join(tmpdir(), 'sf-material-store-'));
  roots.push(storeLink);
  await rm(materials, { recursive: true, force: true });
  await symlink(storeLink, materials);
  await expect(service.resolve(READ, ref)).rejects.toMatchObject({ code: 'material_path_unsafe' });
  await expect(service.import(write('redirect-new'), { title: '新原件', fileName: '新原件.md', mediaType: 'text/markdown', bytes: encoded('新') }))
    .rejects.toMatchObject({ code: 'material_path_unsafe' });
  expect(await readdir(storeLink)).toEqual([]);
});

test('a symlink in the version path cannot redirect a read outside the store', async () => {
  const { service, root } = await open();
  const view = await service.import(write('link'), { title: '链接', fileName: '链接.md', mediaType: 'text/markdown', bytes: encoded('链接') });
  const ref = { materialId: view.materialId, versionId: view.currentVersion.versionId };
  const path = (await service.resolve(READ, ref)).absolutePath;
  const outside = join(root, 'outside.md');
  await writeFile(outside, encoded('不在材料库里'));
  await rm(path);
  await symlink(outside, path);
  await expect(service.resolve(READ, ref)).rejects.toMatchObject({ code: 'material_path_unsafe' });
});
