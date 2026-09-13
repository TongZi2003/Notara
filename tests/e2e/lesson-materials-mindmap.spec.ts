import { test, expect, enterClassroom, sendInput, openLessonSettings } from './fixtures/classroom.ts';
import { checkMapZoom } from './fixtures/mindmap.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { CardContentSchema, type CardView } from '@studyforge/contracts/cards';
import type { CourseUsage, CourseView } from '@studyforge/contracts/courses';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

/**
 * The classroom's right column, on the real page.
 *
 * The lesson really carries a book and one card that belongs to no book. The
 * column draws both as nodes of one map; the book opens along its own depth to
 * the section that points at the original, and an original and a card both open
 * *inside* the same column and come back to it. Competing rails are gone: the
 * lesson's usage, learning profile and settings are in the heading's modal, and
 * the teacher's confirmations are drawn in the dialogue.
 */
test('the lesson right column is one material map that opens originals and cards in place', async ({ page, classroom }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectRuntime(classroom);
  await page.setViewportSize({ width: 1440, height: 950 });
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '先讲定义域。');
  let sessionId = '';
  await expect.poll(async () => {
    const listed = await client.rpc<SessionListValue>('session/list', { _request: {} });
    sessionId = listed.ok ? listed.value.items.find(item => !item.blank && item.origin !== 'subagent')?.sessionId ?? '' : '';
    return sessionId;
  }, { timeout: 30_000 }).not.toBe('');
  // The first turn really settled: the reads below are measured against a quiet lesson.
  await expect.poll(async () => {
    const usage = await client.rpc<CourseUsage>('studyforgeCourses/usage', { input: { sessionId } });
    return usage.ok ? usage.value.completedTurns : -1;
  }, { timeout: 30_000 }).toBeGreaterThan(0);

  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'mind-book',
    material: { title: '函数原文', fileName: '函数.md', mediaType: 'text/markdown' }, base64: Buffer.from('# 函数\n定义域是自变量允许的范围。\n').toString('base64') } }));
  const source = { materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text' as const, start: { line: 2, column: 0 }, end: { line: 2, column: 3 } } };
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'mind-skeleton', materialId: book.materialId, expectedVersion: 0,
    change: { nodes: [{ path: '函数', sources: [source] }, { path: '函数/定义域', sources: [source] }] } } }));
  const inBook = value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'mind-inbook',
    content: CardContentSchema.parse({ title: '在书卡', front: '分式先看什么？', chapter: '函数/定义域', sources: [source] }) } }));
  // A card that belongs to no book: it has nothing to do with the book above.
  const standalone = value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'mind-standalone',
    content: CardContentSchema.parse({ title: '独立卡', front: '换元的时候先定什么？', links: [inBook.ref] }) } }));
  value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'mind-unrelated',
    content: CardContentSchema.parse({ title: '无关联卡', front: '这张卡不该出现在本课关系图。' }) } }));

  const before = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  value(await client.rpc<CourseView>('studyforgeCourses/update', { input: { sessionId, operationId: crypto.randomUUID(), expectedVersion: before.version,
    patch: { lessonMaterials: { materials: [
      { kind: 'source', source: { materialId: book.materialId, versionId: book.currentVersion.versionId } },
      { kind: 'card', cardRef: standalone.ref, cardVersion: 1 },
    ] } } } }));
  const requests = async (): Promise<string> => readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8').catch(() => '');
  const quiet = await requests();

  // The column is one container: the lesson's name and its map, nothing else.
  // Entering a lesson opens its own material map by default — never a raw
  // document preview — and the header entry is the way back to it.
  const panel = page.getByTestId('studyforge-lesson-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('lesson-materials-pane')).toHaveCount(0);
  await page.getByRole('button', { name: '本课资料', exact: true }).first().click();
  // The lesson's deck was just changed outside this pane; 刷新 is the student's
  // own re-read, and it is what makes the new rows appear without a reload.
  await page.getByTestId('lesson-materials-refresh').click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: '本课资料', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('navigation', { name: '工作台中打开的内容' })).toHaveCount(0);
  await expect(panel).not.toContainText('点便签读详情');
  await expect(panel.getByTestId('usage-totals')).toHaveCount(0);
  await expect(panel.getByTestId('lesson-memory')).toHaveCount(0);
  await expect(panel.getByTestId('lesson-adjust')).toHaveCount(0);
  const map = page.getByTestId('lesson-materials-map');
  await expect(map).toBeVisible();
  const panelBox = (await panel.boundingBox())!, mapBox = (await map.boundingBox())!;
  expect(mapBox.y - panelBox.y).toBeLessThanOrEqual(16);
  // A book is a node; a card that belongs to no book is its own node.
  const bookNode = map.locator('[data-kind="book"]').filter({ hasText: '函数原文' });
  await expect(bookNode).toHaveCount(1);
  await expect(map.locator('[data-kind="card"]').filter({ hasText: '独立卡' })).toHaveCount(1);
  expect(await panel.innerText()).not.toMatch(/studyforge\.|sessionId|schema|\/Users\/|\.jsonl/);
  await page.screenshot({ path: info.outputPath('lesson-map.png'), fullPage: true });

  // The book opens along its own depth, down to the card the book really holds.
  await bookNode.getByTestId('mindmap-expand').click();
  await expect(map.locator('[data-key$="section:函数"]')).toBeVisible();
  await expect(map.locator('[data-key$="section:函数/定义域"]')).toHaveCount(0);
  await map.locator('[data-key$="section:函数"]').getByTestId('mindmap-expand').click();
  await map.locator('[data-key$="section:函数/定义域"]').getByTestId('mindmap-expand').click();
  await expect(map.locator('[data-kind="card"]').filter({ hasText: '在书卡' })).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('lesson-map-book-open.png'), fullPage: true });
  await checkMapZoom(page, map);

  // A section with a real anchor reads the exact original in the same column.
  await map.locator('[data-key$="section:函数/定义域"]').getByTestId('lesson-resource-open').click();
  const sourcePane = page.locator('[data-testid="lesson-materials-pane"][data-pane="source"]');
  await expect(sourcePane).toBeVisible();
  await expect(sourcePane).toContainText('定义域');
  await page.screenshot({ path: info.outputPath('lesson-source-pane.png'), fullPage: true });

  // Back returns to the same map: the branch is still open and the node still picked.
  await page.getByTestId('mindmap-back').click();
  await expect(sourcePane).toHaveCount(0);
  await expect(map.locator('[data-key$="section:函数/定义域"]')).toHaveAttribute('data-selected', 'true');
  await expect(map.locator('[data-kind="card"]').filter({ hasText: '在书卡' })).toBeVisible();

  // A card node opens its detail here too, and the composer remembers it is on screen.
  await map.locator('[data-kind="card"]').filter({ hasText: '独立卡' }).getByTestId('lesson-resource-open').click();
  await expect(page.locator('[data-testid="lesson-materials-pane"][data-pane="card"]')).toBeVisible();
  await expect(page.getByTestId('card-detail-title')).toHaveText('独立卡');
  await expect(page.locator('[data-composer-chip="studyforge-source"]').filter({ hasText: '独立卡' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('lesson-card-pane.png'), fullPage: true });
  await page.getByTestId('mindmap-back').click();
  await expect(map.locator('[data-kind="card"]').filter({ hasText: '独立卡' })).toBeVisible();

  // Real relations stay separate from ownership. Two details stay open beside the map.
  await map.locator('[data-kind="card"]').filter({ hasText: '独立卡' }).getByRole('button', { name: '展开关联', exact: true }).click();
  await expect(map.getByTestId('mindmap-relation')).toHaveCount(1);
  await expect(map).not.toContainText('无关联卡');
  await map.locator('[data-kind="card"]').filter({ hasText: '在书卡' }).getByTestId('lesson-resource-open').click();
  await expect(page.locator('[data-composer-chip="studyforge-source"]').filter({ hasText: '在书卡' })).toBeVisible();
  await map.locator('[data-key$="section:函数/定义域"]').getByTestId('lesson-resource-open').click();
  await expect(page.getByTestId('lesson-materials-pane')).toHaveCount(2);
  const pages = panel.getByRole('navigation', { name: '工作台中打开的内容' });
  await pages.getByRole('button', { name: '在书卡', exact: true }).click();
  await expect(page.locator('[data-composer-chip="studyforge-source"]').filter({ hasText: '在书卡' })).toBeVisible();
  const cardPane = panel.locator('[data-pane="card"]');
  await cardPane.getByTestId('deck-parent').filter({ hasText: '函数原文' }).click();
  await expect(page.getByTestId('lesson-materials-pane')).toHaveCount(3);
  await expect(sourcePane).toHaveCount(2);
  // The native tab can be closed and reopened, keeping open pages and hierarchy.
  await page.getByRole('tab').filter({ hasText: '工作台' }).locator('[data-dockkit-tab-close]').click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: /^(打开右侧边栏|Open right sidebar)$/u }).click();
  await expect(page.getByTestId('lesson-deck-reopen')).toBeVisible();
  await page.getByRole('button', { name: '打开工作台', exact: true }).click();
  await expect(page.getByTestId('lesson-materials-pane')).toHaveCount(3);
  await expect(map.locator('[data-key$="section:函数/定义域"]')).toBeVisible();
  await page.getByRole('tab').filter({ hasText: '工作台' }).locator('[data-dockkit-tab-close]').click();
  await page.getByTestId('open-lesson').click();
  await expect(page.getByTestId('lesson-materials-pane')).toHaveCount(3);
  // The desk can spread across the screen using the native floating pane.
  await page.getByTestId('spread-lesson-deck').click();
  await expect(page.getByTestId('lesson-materials-pane')).toHaveCount(3);
  await expect.poll(async () => (await page.getByTestId('lesson-deck-surface').boundingBox())?.width ?? 0).toBeGreaterThan(900);
  await pages.getByRole('button', { name: '关系图', exact: true }).click();
  await page.screenshot({ path: info.outputPath('lesson-deck-spread.png'), fullPage: true });
  // Individual close leaves other pages on the desk.
  await cardPane.getByTestId('mindmap-back').click();
  await expect(page.getByTestId('lesson-materials-pane')).toHaveCount(2);
  for (let i = 0; i < 2; i++) await page.getByTestId('mindmap-back').first().click();
  await page.getByRole('button', { name: /^(收回到侧边栏|Send back to the sidebar)$/u }).click();

  // Reading opened no original session and called no model.
  expect(await requests()).toBe(quiet);

  // 本课设置 is reached from 开始; it still owns usage and the learning profile.
  await openLessonSettings(page);
  const modal = page.getByTestId('lesson-settings-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('本课设置');
  await expect(modal).toContainText('本课概况');
  await expect(modal.getByTestId('usage-totals')).toBeVisible();
  await modal.getByTestId('lesson-memory').click();
  await expect(page.getByTestId('memory-panel')).toBeVisible();
  await expect(modal.getByTestId('lesson-adjust')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('lesson-settings-modal.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lesson-settings-modal')).toHaveCount(0);
  await page.getByTestId('open-lesson').click();

  // Narrow: the map stays inside its own column and the page does not go wide.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(map).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('lesson-map-narrow.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(inBook.ref).not.toBe(standalone.ref);
});
