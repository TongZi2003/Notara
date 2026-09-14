import { test, expect, enterClassroom, sendInput } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { CardContentSchema } from '@studyforge/contracts/cards';
import type { CourseView } from '@studyforge/contracts/courses';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { scannedPdf } from '../fixtures/materials/synthetic-pdf.ts';
import sharp from 'sharp';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('a book has one tree, cards stay inside collapsed chapters, and page references open their own page', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const client = await connectRuntime(classroom);
  await page.setViewportSize({ width: 1117, height: 747 });
  await enterClassroom(page, classroom.authUrl); await sendInput(page, '看看原文');
  await expect(page.getByText('已收到：看看原文', { exact: true })).toBeVisible();
  const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'hierarchy-book',
    material: { title: '三角讲义', fileName: '三角讲义.pdf', mediaType: 'application/pdf' }, base64: scannedPdf(jpeg, 200, 100, [0, 0, 0]).toString('base64') } }));
  const source = (page: number) => ({ materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'pdf' as const, page } });
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'hierarchy-skeleton', materialId: book.materialId, expectedVersion: 0,
    change: { nodes: [{ path: '三角', sources: [source(1), source(3)] }, { path: '三角/和差公式', sources: [source(1)] }] } } }));
  for (const [index, title] of ['展开两角和', '配角求值'].entries()) value(await client.rpc('studyforgeLearning/createCard', { input: { operationId: `tree-card-${index}`,
    content: CardContentSchema.parse({ title, front: '原题', chapter: '三角/和差公式', sources: [source(index === 0 ? 1 : 3)] }) } }));
  const sessionId = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => !row.blank && row.origin !== 'subagent')!.sessionId;
  const course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  value(await client.rpc('studyforgeCourses/update', { input: { sessionId, operationId: 'tree-positions', expectedVersion: course.version,
    patch: { lessonMaterials: { materials: [1, 3].map(page => ({ kind: 'source', source: source(page) })) } } } }));
  await page.getByTestId('workspace-open-materials').click();
  await page.getByTestId('lesson-materials-refresh').click();
  const map = page.getByTestId('lesson-materials-map');
  await expect(map.locator('[data-kind="book"]')).toHaveCount(1);
  await expect(map.locator('[data-kind="card"]')).toHaveCount(0);
  const root = map.locator('[data-kind="book"]');
  await root.getByTestId('mindmap-expand').click();
  const chapter = map.locator('[data-key$="/section:三角"]');
  await expect(chapter).toBeVisible();
  await expect(chapter).toContainText('第 1 页、第 3 页');
  await expect(map.locator('[data-kind="card"]')).toHaveCount(0);
  await chapter.getByTestId('mindmap-expand').click();
  const part = map.locator('[data-key$="/section:三角/和差公式"]');
  await expect(part).toBeVisible(); await expect(map.locator('[data-kind="card"]')).toHaveCount(0);
  await part.getByTestId('mindmap-expand').click();
  await expect(map.locator('[data-kind="card"]')).toHaveCount(2);
  await chapter.getByTestId('mindmap-expand').click();
  await expect(map.locator('[data-kind="card"]')).toHaveCount(0);
  await expect(part).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('collapsed-chapter.png'), fullPage: true });
  for (const position of [1, 3]) {
    const leaf = map.locator('[data-kind="material"]').filter({ has: page.getByRole('button', { name: new RegExp(`^第 ${position} 页`) }) });
    await leaf.getByTestId('lesson-resource-open').click();
    const pane = page.getByTestId('lesson-materials-pane').filter({ hasText: `第 ${position} 页` });
    await expect(pane.getByTestId('pdf-page')).toHaveText(`第 ${position} / 3 页`);
    await pane.getByTestId('mindmap-back').click();
  }
  await root.getByTestId('mindmap-expand').click();
  await expect(map.locator('[data-kind="book"]')).toHaveCount(1);
  await expect(map.locator('[data-kind="material"]')).toHaveCount(0);
  await expect(map.locator('[data-kind="section"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
