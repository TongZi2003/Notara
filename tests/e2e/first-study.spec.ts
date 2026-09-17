/**
 * P5.6 one unstudied card, studied for real.
 *
 * The point of this flow is the boundary the product must not blur: opening a
 * card, looking at its back and leaving writes nothing, and only the student's
 * own mark after a recall attempt becomes a learning record. The record is read
 * back through the Host (`records()` and the card's own schedule), so the next
 * due date on screen is the stored one rather than a client guess.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, openRoot } from './fixtures/classroom.ts';
import type { CardView } from '@studyforge/contracts/cards';
import type { LearningRecord } from '@studyforge/domain/learning-records';

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
  await page.getByTestId('studyforge-page-studyforge.materials').getByTestId('materials-open-cards').click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

test('an unstudied card is learnable right away, and only a real mark is recorded', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);

  // One real card through the editor.
  await page.getByTestId('card-browser-create').click();
  await page.getByTestId('card-editor-title').fill('二次函数顶点');
  await page.getByTestId('card-editor-front').fill('求 $y=x^2-4x+3$ 的顶点。');
  await page.getByTestId('card-editor-section-add').click();
  await page.getByTestId('card-editor-section-heading').fill('解法');
  await page.getByTestId('card-editor-section-body').fill('配方法：$y=(x-2)^2-1$，顶点 $(2,-1)$。');
  await page.getByTestId('card-editor-save').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('二次函数顶点');
  await page.getByTestId('card-detail-back').click();

  const row = page.getByTestId('card-list').getByTestId('card-row');
  await expect(row.first()).toContainText('还没学过');

  // Studying it: the face first, the back only when asked.
  await page.getByTestId('card-row-learn').first().click();
  await expect(page.getByTestId('review-screen')).toBeVisible();
  await expect(page.getByTestId('review-front')).toContainText('顶点');
  await expect(page.getByTestId('review-back-body')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('study-face.png'), fullPage: true });

  // Reading the card and leaving is not studying: nothing was written.
  await page.getByTestId('review-back').click();
  await expect(row.first()).toContainText('还没学过');
  const client = await connectRuntime(dsh);
  const before = await client.rpc<LearningRecord[]>('studyforgeLearning/records', {});
  expect(before.ok ? before.value : []).toEqual([]);
  const untouched = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
  expect(untouched.ok ? untouched.value[0]?.review : 'missing').toBeUndefined();

  // Now a real attempt: back, then the student's own mark.
  await page.getByTestId('card-row-learn').first().click();
  await page.getByTestId('review-reveal').click();
  await expect(page.getByTestId('review-back-body')).toContainText('配方法');
  await page.getByTestId('review-mark-牢').click();
  await expect(page.getByTestId('review-result')).toContainText('下次');
  await page.screenshot({ path: testInfo.outputPath('study-recorded.png'), fullPage: true });
  await page.getByTestId('review-next').click();
  await page.getByTestId('review-back').click();
  await expect(row.first()).toContainText('下次');
  await expect(row.first()).not.toContainText('还没学过');

  // The Host's own projection agrees: one record, and it is this card's.
  const listed = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
  const card = listed.ok ? listed.value[0] : undefined;
  expect(card?.review?.reviewCount).toBeGreaterThan(0);
  const records = await client.rpc<LearningRecord[]>('studyforgeLearning/records', {});
  const rows = records.ok ? records.value : [];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ target: card?.ref, title: '二次函数顶点' });
  expect(rows[0]?.fact.mark).toBe('牢');
  expect(rows[0]?.fact.channel).toBe('课外');
  const due = card?.review?.nextDue;

  // A fresh boot reads the same schedule back.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await expect(page.getByTestId('card-list').getByTestId('card-row').first()).toContainText(String(due));
  expect(errors).toEqual([]);
});
