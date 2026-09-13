/**
 * P5.5/P5.6 one card, two writers: creation, an author edit, and the conflict
 * step a second writer really produces.
 *
 * Every number and every title here comes back from the Host: the card list is
 * `cards()`, the editor reads `card()`, and the save is a real `createCard` /
 * `editCard`. The conflict is not scripted — a second browser page edits the
 * same card first, so the first page's stale baseline is the Host's own refusal.
 * Nothing in this flow writes a review row: creating, editing and browsing are
 * not studying.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { enterClassroom, openRoot } from './fixtures/classroom.ts';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated();
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

/** The first-run dialog comes back on a reload; it is modal, so it is dismissed first. */
async function dismissNotices(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count() === 0) continue;
    try { await button.click({ timeout: 2_000 }); } catch { /* it was already gone */ }
  }
}

/** The card library, wherever the client root mounts it. */
async function openCards(page: Page): Promise<void> {
  await dismissNotices(page);
  await openRoot(page, '资料');
  await page.getByTestId('studyforge-page-studyforge.materials').getByRole('button', { name: '整理与复习', exact: true }).click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

/** Create one ordinary card through the real editor and return its title. */
async function createCard(page: Page, title: string, front: string, section: string): Promise<void> {
  await openCards(page);
  await page.getByTestId('card-browser-create').click();
  await page.getByTestId('card-editor-title').fill(title);
  await page.getByTestId('card-editor-front').fill(front);
  await page.getByTestId('card-editor-section-add').click();
  await page.getByTestId('card-editor-section-heading').fill('解法');
  await page.getByTestId('card-editor-section-body').fill(section);
  await page.getByTestId('card-editor-save').click();
  // Saving opens the card it really saved.
  await expect(page.getByTestId('card-detail-title')).toHaveText(title);
}

test('a card is created, read with the back hidden until asked, and edited', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await createCard(page, '二次函数顶点', '求 $y=x^2-4x+3$ 的顶点。', '配方法：$y=(x-2)^2-1$，顶点 $(2,-1)$。');

  // Reading the card does not show the answer, and reading is not studying.
  await expect(page.getByTestId('card-detail-front')).toContainText('求');
  await expect(page.getByTestId('card-detail-back-body')).toHaveCount(0);
  await expect(page.getByTestId('card-detail-review')).toHaveText('还没学过');
  await page.screenshot({ path: testInfo.outputPath('card-detail-face.png'), fullPage: true });

  await page.getByTestId('card-detail-reveal').click();
  await expect(page.getByTestId('card-detail-back-body')).toBeVisible();
  await expect(page.getByTestId('card-detail-back-body')).toContainText('配方法');
  // The formula really rendered as math instead of raw dollars.
  await expect(page.getByTestId('card-detail-back-body').locator('math, .katex').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('card-detail-back.png'), fullPage: true });

  // One author edit: only the face changes, and the revision really moves.
  await page.getByTestId('card-detail-edit').click();
  await page.getByTestId('card-editor-front').fill('求 $y=x^2-4x+3$ 的顶点和对称轴。');
  await expect(page.getByTestId('card-editor-version')).toContainText('第 1 版');
  await page.getByTestId('card-editor-save').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('二次函数顶点');

  // A fresh boot reads the Host again, so the saved text is not a client echo.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await expect(page.getByTestId('card-row').filter({ hasText: '二次函数顶点' })).toBeVisible();
  await page.getByTestId('card-row-open').filter({ hasText: '二次函数顶点' }).click();
  await page.getByTestId('card-detail-reveal').click();
  await expect(page.getByTestId('card-detail-back-body')).toContainText('配方法');
  await expect(page.getByTestId('card-detail-front')).toContainText('对称轴');
  await expect(page.getByTestId('card-detail-review')).toHaveText('还没学过');
  expect(errors).toEqual([]);
});

test('a second writer makes the first save a real conflict, and the draft survives a rebase', async ({ page, context, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await createCard(page, '二次函数顶点', '求 $y=x^2-4x+3$ 的顶点。', '配方法：$y=(x-2)^2-1$。');

  // This page starts editing and holds the draft at version 1.
  await page.getByTestId('card-detail-edit').click();
  await page.getByTestId('card-editor-front').fill('A 的草稿：求顶点与对称轴。');

  // A second browser page is a second writer on the same workspace.
  const other = await context.newPage();
  try {
    await enterClassroom(other, dsh.authUrl);
    await openCards(other);
    await other.getByTestId('card-row-open').filter({ hasText: '二次函数顶点' }).click();
    await other.getByTestId('card-detail-edit').click();
    await other.getByTestId('card-editor-title').fill('二次函数顶点（修正）');
    await other.getByTestId('card-editor-section-body').fill('配方法：$y=(x-2)^2-1$，对称轴 $x=2$。');
    await other.getByTestId('card-editor-save').click();
    await expect(other.getByTestId('card-detail-title')).toHaveText('二次函数顶点（修正）');

    // The stale save is refused by the Host; the draft stays and the latest
    // version is shown read-only instead of being overwritten silently.
    await page.getByTestId('card-editor-save').click();
    await expect(page.getByTestId('card-editor-conflict')).toBeVisible();
    await expect(page.getByTestId('card-editor-latest')).toContainText('二次函数顶点（修正）');
    await expect(page.getByTestId('card-editor-front')).toHaveValue('A 的草稿：求顶点与对称轴。');
    await page.screenshot({ path: testInfo.outputPath('card-editor-conflict.png'), fullPage: true });

    // Explicit rebase: the new baseline is the newest version, and A's own draft
    // is still A's. The fields A never touched keep the other writer's text.
    await page.getByTestId('card-editor-rebase').click();
    await page.getByTestId('card-editor-save').click();
    await expect(page.getByTestId('card-detail-title')).toHaveText('二次函数顶点（修正）');
    await page.getByTestId('card-detail-reveal').click();
    await expect(page.getByTestId('card-detail-front')).toContainText('A 的草稿');
    // The other writer's section really survived the rebase, formula included.
    await expect(page.getByTestId('card-detail-back-body')).toContainText('对称轴');
    await expect(page.getByTestId('card-detail-back-body').locator('math, .katex').first()).toBeVisible();
    // Editing is not studying, even after two writers touched the card.
    await expect(page.getByTestId('card-detail-review')).toHaveText('还没学过');
    await page.screenshot({ path: testInfo.outputPath('card-after-merge.png'), fullPage: true });
  } finally { await other.close(); }

  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await page.getByTestId('card-row-open').filter({ hasText: '二次函数顶点（修正）' }).click();
  await page.getByTestId('card-detail-reveal').click();
  await expect(page.getByTestId('card-detail-front')).toContainText('A 的草稿');
  await expect(page.getByTestId('card-detail-back-body')).toContainText('对称轴');
  expect(errors).toEqual([]);
});
