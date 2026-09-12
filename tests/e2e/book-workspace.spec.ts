import { test, expect, enterClassroom } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { CardContentSchema, type CardView } from '@studyforge/contracts/cards';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CourseView } from '@studyforge/contracts/courses';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

/**
 * The book's own structure area, on the real page.
 *
 * One book is imported and really broken down twice, one card is filed under
 * its second section, and the whole flow is read in the browser: the map opens
 * with the book root alone, expands along the real depth to the card, opens the
 * card's detail *in the structural area*, locates the exact original on the
 * left, and comes back with every branch still open. Reading writes nothing —
 * no card change, no model request — and only 继续拆解 leaves the page, through
 * the existing organization Remote.
 */
test('book expands along its real tree, opens a card and its original in place, and returns without writing', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'book', material: { title: '函数原文', fileName: '函数.md', mediaType: 'text/markdown' }, base64: Buffer.from('定义域\n单调性\n').toString('base64') } }));
  const source = { materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text' as const, start: { line: 1, column: 0 }, end: { line: 1, column: 3 } } };
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'skeleton', materialId: book.materialId, expectedVersion: 0,
    change: { nodes: [{ path: '函数', sources: [source] }, { path: '函数/定义域', sources: [source] }] } } }));
  const card = value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'card',
    content: CardContentSchema.parse({ title: '定义域卡片', front: '自变量允许的范围', chapter: '函数/定义域', sources: [source] }) } }));
  await page.setViewportSize({ width: 1440, height: 950 });
  await enterClassroom(page, classroom.authUrl);
  await page.getByTestId('notebook-settings').click();
  await page.getByTestId('notebook-tone').selectOption('white');
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-row').filter({ hasText: '函数原文' }).getByRole('button').first().click();

  // A real map: the book root alone, with the breakdown action on it.
  const nodes = page.getByTestId('book-nodes');
  await expect(nodes).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(nodes).toHaveCSS('background-image', 'none');
  await expect(nodes.locator('[data-kind]')).toHaveCount(1);
  await expect(nodes.locator('[data-kind="book"]')).toContainText('函数原文');
  await expect(nodes.locator('[data-kind="book"]')).toHaveCSS('background-color', 'rgb(253, 241, 176)');
  await expect(nodes.getByRole('button', { name: '继续拆解', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '刷新结构', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('book-map-root.png'), fullPage: true });

  // Expansion follows the depth the book really has, node by node.
  await nodes.locator('[data-kind="book"]').getByTestId('mindmap-expand').click();
  await expect(nodes.locator('[data-key="section:函数"]')).toBeVisible();
  await nodes.locator('[data-key="section:函数"]').getByTestId('mindmap-expand').click();
  await nodes.locator('[data-key="section:函数/定义域"]').getByTestId('mindmap-expand').click();
  const cardNode = nodes.locator('[data-kind="card"]').filter({ hasText: '定义域卡片' });
  await expect(cardNode).toHaveCount(1);
  await expect(cardNode).toBeVisible();
  await page.screenshot({ path: info.outputPath('book-map-expanded.png'), fullPage: true });

  // The card opens its detail in the structural area, not on top of the page.
  await cardNode.getByTestId('mindmap-node').click();
  const detail = page.getByTestId('book-node-detail');
  await expect(detail).toBeVisible();
  await expect(page.getByTestId('card-detail-title')).toHaveText('定义域卡片');
  // Its source locates the exact original on the left, and the map stays open.
  await detail.getByRole('button', { name: '定位原文', exact: true }).click();
  await expect(page.getByTestId('source-highlight').first()).toBeVisible();
  await expect(nodes.locator('[data-key="section:函数/定义域"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('book-card-detail.png'), fullPage: true });

  // 收起 comes back to the structure with the same branches and the same pick.
  await detail.getByTestId('book-detail-back').click();
  await expect(page.getByTestId('book-node-detail')).toHaveCount(0);
  await expect(cardNode).toHaveAttribute('data-selected', 'true');
  // The list view shares that state instead of starting over.
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.getByTestId('book-nodes').locator('[data-kind="card"]').filter({ hasText: '定义域卡片' })).toHaveAttribute('data-selected', 'true');
  await page.getByRole('button', { name: '脑图', exact: true }).click();
  await expect(page.getByTestId('book-nodes').locator('[data-key="section:函数/定义域"]')).toBeVisible();

  // Reading wrote nothing: no card change, and no model request at all yet.
  expect(value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } })).history).toEqual([]);
  expect((await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).trim()).toBe('');

  // Narrow: the structure keeps its own scroll instead of pushing the page wide.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await page.getByTestId('material-reader').boundingBox())?.width ?? 0).toBeGreaterThan(290);
  await page.getByRole('button', { name: '结构', exact: true }).click();
  await expect(page.getByTestId('book-nodes')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('book-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 950 });

  // Only 继续拆解 leaves the page: the selected section is the scope, and the
  // real organization lesson opens from it.
  await nodes.locator('[data-key="section:函数/定义域"]').getByRole('button', { name: '继续拆解', exact: true }).click();
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await expect.poll(async () => {
    const listed = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
    return listed.items.filter(item => !item.blank && item.origin !== 'subagent').length;
  }).toBe(1);
  const session = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => !item.blank && item.origin !== 'subagent')!;
  const course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId: session.sessionId } }));
  expect(course.data.teachingRef).toBe('organize');
  expect(course.data.lessonMaterials.materials[0]).toMatchObject({ kind: 'source', source: { materialId: book.materialId, versionId: book.currentVersion.versionId } });
});
