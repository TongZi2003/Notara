/**
 * P5.7 the red pen over a card that was really edited twice.
 *
 * The change comes from the Host: the test edits a stored card through the real
 * editor, and the projection is read back with `cardChanges`. What the
 * assertions pin is the reading rule — the old line is struck through and the
 * new line is marked, the current body is untouched by that decoration, the
 * technical view holds the stored bytes, and a change to the back cannot be
 * read before the student opens the back.
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

async function dismissNotices(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count() === 0) continue;
    try { await button.click({ timeout: 2_000 }); } catch { /* it was already gone */ }
  }
}

async function openCards(page: Page): Promise<void> {
  await dismissNotices(page);
  await openRoot(page, '资料');
  await page.getByTestId('studyforge-page-studyforge.materials').getByRole('button', { name: '整理与复习', exact: true }).click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

/** One card written by the student, then edited once with the same real editor. */
async function createAndEdit(page: Page): Promise<void> {
  await openCards(page);
  await page.getByTestId('card-browser-create').click();
  await page.getByTestId('card-editor-title').fill('二次函数顶点');
  await page.getByTestId('card-editor-front').fill('求 $y=x^2-4x+3$ 的顶点。');
  await page.getByTestId('card-editor-section-add').click();
  await page.getByTestId('card-editor-section-heading').fill('解法');
  // The heading is added by the editor itself, so the stored field is
  // `## 解法` plus these lines: one line the edit replaces, one it keeps.
  await page.getByTestId('card-editor-section-body').fill('先配方\n第二步：对称轴 $x=2$');
  await page.getByTestId('card-editor-save').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('二次函数顶点');

  await page.getByTestId('card-detail-edit').click();
  // One line is replaced and one line is new, so the projection really has a
  // removed line and an added line instead of a whole-section rewrite.
  await page.getByTestId('card-editor-section-body').fill('先把平方配出来 $(x-2)^2-1$\n第二步：对称轴 $x=2$');
  await page.getByTestId('card-editor-save').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('二次函数顶点');
}

test('an edited card reads as red pen over the old line, and the back waits for the student', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await createAndEdit(page);

  // Reopen the card so its change list is read fresh, with the back still shut.
  await page.getByTestId('card-detail-back').click();
  await page.getByTestId('card-row-open').filter({ hasText: '二次函数顶点' }).click();
  await expect(page.getByTestId('card-detail')).toBeVisible();
  await expect(page.getByTestId('card-change')).toHaveCount(1);
  await expect(page.getByTestId('card-change')).toContainText('你自己改的');
  // The back changed, and a closed back never renders its own diff.
  await expect(page.getByTestId('change-hidden-back')).toBeVisible();
  await expect(page.getByTestId('card-redline')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('redline-hidden-back.png'), fullPage: true });

  await page.getByTestId('card-detail-reveal').click();
  await expect(page.getByTestId('card-redline')).toBeVisible();
  const removed = page.getByTestId('card-redline-removed');
  const added = page.getByTestId('card-redline-added');
  await expect(removed).toContainText('先配方');
  await expect(added).toContainText('先把平方配出来');
  // The line the edit kept is context, and it still renders as real math.
  const kept = page.getByTestId('card-redline-same').filter({ hasText: '第二步' });
  await expect(kept).toContainText('对称轴');
  await expect(kept.locator('math, .katex').first()).toBeVisible();
  await expect(added.locator('math, .katex').first()).toBeVisible();
  // The old line is really struck through, not only coloured.
  const decoration = await removed.locator('del').evaluate(node => getComputedStyle(node).textDecorationLine);
  expect(decoration).toContain('line-through');

  // The card itself still reads as it is stored: no struck line inside the body.
  await expect(page.getByTestId('card-detail-back-body')).toContainText('先把平方配出来');
  await expect(page.getByTestId('card-detail-back-body').locator('del')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('redline-open.png'), fullPage: true });

  // The technical view is the same projection without interpretation.
  await page.getByTestId('change-technical-toggle').click();
  await expect(page.getByTestId('diff-text-before')).toContainText('先配方');
  await expect(page.getByTestId('diff-text-after')).toContainText('先把平方配出来');
  await expect(page.getByTestId('technical-diff')).toContainText('你自己改的');
  await page.screenshot({ path: testInfo.outputPath('redline-technical.png'), fullPage: true });

  // A fresh boot reads the same redline out of the stored revisions.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await page.getByTestId('card-row-open').filter({ hasText: '二次函数顶点' }).click();
  await page.getByTestId('card-detail-reveal').click();
  await expect(page.getByTestId('card-redline-removed')).toContainText('先配方');
  expect(errors).toEqual([]);
});
