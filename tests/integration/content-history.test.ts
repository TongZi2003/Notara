import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CourseView } from '@studyforge/contracts/courses';
import type { CardView } from '@studyforge/contracts/cards';
import type { ContentHistory } from '@studyforge/contracts/content-history';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { toolSession, value } from '../fixtures/tool-session.ts';
import { scannedPdf } from '../fixtures/materials/synthetic-pdf.ts';
import { readerImage } from '../fixtures/materials/reader-image.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });

test('100-page import, exact adopted pages, read coverage, pending refinement and old versions remain separate', async () => {
  runtime = await startIsolated({ testModel: true });
  let teacher = await toolSession(runtime);
  const client = teacher.client;
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'hundred-pages',
    material: { title: '百页资料', fileName: 'book.pdf', mediaType: 'application/pdf' }, base64: scannedPdf(readerImage('jpeg'), 900, 560, Array(100).fill(0)).toString('base64') } }));
  const source = { materialId: book.materialId, versionId: book.currentVersion.versionId };
  const page = (number: number) => ({ ...source, locator: { kind: 'pdf' as const, page: number } });
  value(await client.rpc('studyforgeCourses/update', { input: { sessionId: teacher.sessionId, operationId: 'attach-book', expectedVersion: 0,
    patch: { lessonMaterials: { materials: [{ kind: 'source', source }] } } } }));
  const history = (query = source) => client.rpc<ContentHistory>('studyforgeMaterials/contentHistory', { input: { source: query } }).then(value);
  expect((await history()).classrooms[0]?.occurrences.map(row => row.use)).toEqual(['declared']);
  expect((await history(page(50))).classrooms).toEqual([]);
  await teacher.call('load_tools', { names: ['cite_materials', 'propose_skeleton', 'read_skeleton', 'delegate_search'] });
  // A real isolated native child pre-reads twenty pages; none becomes classroom use.
  expect((await teacher.call('delegate_search', { task: '[child-tools]' + JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ name: 'read_material', arguments: { source: page(i + 1) } }))) })).failed).toBe(false);
  const scouted = await history();
  expect(scouted.preparation.flatMap(row => row.sources)).toHaveLength(20);
  expect(scouted.classrooms[0]?.occurrences.map(row => row.use)).toEqual(['declared']);
  expect((await teacher.call('cite_materials', { sources: [page(12)] })).failed).toBe(true); // main teacher must check it
  expect((await teacher.call('cite_materials', { sources: [page(12)] })).failed).toBe(true);
  for (const n of [12, 13, 14, 37, 81]) expect((await teacher.call('read_material', { source: page(n) })).failed).toBe(false);
  expect((await teacher.call('cite_materials', { sources: [page(12), page(13), page(14), page(37), page(81), page(12)] })).failed).toBe(false);
  let projection = await history();
  expect(projection.coverage.pageCount).toBe(100);
  expect(projection.coverage.located).toHaveLength(22);
  expect(projection.coverage.refined).toEqual([]);
  expect(new Set(projection.classrooms.flatMap(row => row.occurrences).filter(row => row.use === 'cited').map(row => JSON.stringify(row.source)))).toHaveLength(5);
  await teacher.call('read_skeleton', { materialId: book.materialId });
  expect((await teacher.call('propose_skeleton', { materialId: book.materialId, change: { nodes: [{ path: '章节', sources: [page(12)], detail: 'outline' },
    { path: '章节/例题', sources: [{ ...page(12), locator: { kind: 'pdf', page: 12, rect: [0, 0, .5, .5] } }], detail: 'refined' }] } })).failed).toBe(false);
  expect((await history()).coverage.refined).toEqual([]);
  await teacher.confirm('整理目录');
  projection = await history(); expect(projection.coverage.refined).toHaveLength(1);
  expect(projection.coverage.refined[0]?.locator).toMatchObject({ rect: [0, 0, .5, .5] });
  expect((await history(page(50))).classrooms).toEqual([]);
  const secondBook = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'second-source', material: { title: '另一份解释', fileName: '解释.md', mediaType: 'text/markdown' }, base64: Buffer.from('用图像理解变化').toString('base64') } }));
  const firstPage = JSON.parse((await teacher.call('list_materials', { limit: 1 })).text);
  expect(firstPage.hasMore).toBe(true);
  const secondPage = JSON.parse((await teacher.call('list_materials', { limit: 1, offset: firstPage.nextOffset })).text);
  expect(new Set([...firstPage.materials, ...secondPage.materials].map((row: { materialId: string }) => row.materialId)).size).toBe(2);
  const other = JSON.parse((await teacher.call('read_material', { source: { materialId: secondBook.materialId, versionId: secondBook.currentVersion.versionId } })).text).source;
  expect((await teacher.call('cite_materials', { sources: [page(12), other] })).failed).toBe(false);
  const revised = value(await client.rpc<MaterialView>('studyforgeMaterials/createVersion', { input: { operationId: 'replacement-version', expectedVersion: book.revision,
    material: { materialId: book.materialId, title: '百页资料', fileName: 'book-v2.pdf', mediaType: 'application/pdf' }, base64: scannedPdf(readerImage('jpeg'), 900, 560, [0, 90]).toString('base64') } }));
  const newHistory = await history({ materialId: book.materialId, versionId: revised.currentVersion.versionId });
  expect(newHistory.coverage.located).toEqual([]); expect(newHistory.coverage.refined).toEqual([]); expect(newHistory.classrooms).toEqual([]);
  await runtime.restart(); teacher = await toolSession(runtime, teacher.sessionId);
  const restored = value(await teacher.client.rpc<ContentHistory>('studyforgeMaterials/contentHistory', { input: { source } }));
  expect(restored.coverage.refined).toEqual(projection.coverage.refined);
  expect(restored.classrooms[0]?.occurrences.some(row => row.use === 'cited' && !!row.messageId)).toBe(true);
}, 180_000);

test('content scout can opt into this card activity without receiving another card or global learner memory', async () => {
  runtime = await startIsolated({ testModel: true });
  const teacher = await toolSession(runtime), client = teacher.client;
  const card = value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'card-only', content: {
    title: '无原书的方法卡', front: '先确定定义域', sections: [{ heading: '解释', body: '再讨论单调区间' }], notes: '学生私人批注', tags: ['函数'] } } }));
  value(await client.rpc('studyforgeLearning/review', { input: { operationId: 'actual-study', target: card.ref, mark: '初', note: '本次看过示范' } }));
  await teacher.call('load_tools', { names: ['read_content', 'cite_materials', 'delegate_search'] });
  const plain = await teacher.call('read_content', { target: card.ref });
  expect(plain.failed).toBe(false); expect(plain.text).not.toContain('学生私人批注');
  expect(JSON.parse(plain.text)).not.toHaveProperty('activity');
  const detailed = JSON.parse((await teacher.call('read_content', { target: card.ref, includeActivity: true })).text);
  expect(detailed.activity.reviews).toHaveLength(1);
  expect(detailed.activity.reviews[0].mark).toBe('初');
  expect(detailed.activity.browsing).toBe('not_recorded');
  expect((await teacher.call('delegate_search', { task: '[child-tool]' + JSON.stringify({ name: 'read_content', arguments: { target: card.ref, includeActivity: true } }) })).failed).toBe(false);
  const log = (await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { sessionId: string; toolNames: string[]; messages: unknown[] });
  const childRequests = log.filter(row => row.sessionId !== teacher.sessionId && row.toolNames.includes('read_content'));
  expect(childRequests.length).toBeGreaterThan(0);
  expect(childRequests.every(row => !row.toolNames.includes('read_memory') && !row.toolNames.includes('query_evidence'))).toBe(true);
  expect(JSON.stringify(childRequests)).toContain('not_recorded');
  expect(JSON.stringify(childRequests)).not.toContain('学生私人批注');
  expect((await teacher.call('cite_materials', { target: card.ref })).failed).toBe(false);
  const saved = value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } }));
  expect(saved.history).toHaveLength(1); // reads/cites neither duplicate the card nor advance its ladder
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))).toHaveLength(1);
  const history = value(await client.rpc<ContentHistory>('studyforgeMaterials/contentHistory', { input: { target: card.ref } }));
  expect(history.classrooms.some(row => row.occurrences.some(use => use.use === 'cited' && use.version === saved.version))).toBe(true);
}, 90_000);
