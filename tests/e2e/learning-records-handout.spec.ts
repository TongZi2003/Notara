/**
 * P5.6 studying one card leaves a record, and the handout only holds what is
 * really due.
 *
 * The record is written by the real `review` call behind the student's own
 * mark, so the list on the 学习记录 tab is the Host's own projection. The
 * handout is the same stored schedule filtered to today: a card that was just
 * studied is due tomorrow, so it must not appear today — and an unstudied card
 * has no schedule at all and can never appear.
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

async function createCard(page: Page, title: string, front: string): Promise<void> {
  await page.getByTestId('card-browser-create').click();
  await page.getByTestId('card-editor-title').fill(title);
  await page.getByTestId('card-editor-front').fill(front);
  await page.getByTestId('card-editor-section-add').click();
  await page.getByTestId('card-editor-section-heading').fill('解法');
  await page.getByTestId('card-editor-section-body').fill('先把条件写出来。');
  await page.getByTestId('card-editor-save').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText(title);
  await page.getByTestId('card-detail-back').click();
}

test('a real mark becomes one record, and the handout only holds what is due', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);

  await createCard(page, '分母条件', '分式先看什么？');
  // A second card is never studied, so it must never reach the handout.
  await createCard(page, '还没学的卡', '这根函数图像开口朝哪？');

  const row = page.getByTestId('card-row').filter({ hasText: '分母条件' });
  await row.getByTestId('card-row-learn').click();
  await expect(page.getByTestId('review-screen')).toBeVisible();
  await page.getByTestId('review-reveal').click();
  await page.getByTestId('review-mark-牢').click();
  await expect(page.getByTestId('review-result')).toBeVisible();
  await page.getByTestId('review-back').click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();

  // One record, from the real occurrence, and it remembers the mark and the schedule.
  const client = await connectRuntime(dsh);
  await expect.poll(async () => {
    const records = await client.rpc<LearningRecord[]>('studyforgeLearning/records', {});
    return records.ok ? records.value.length : -1;
  }, { timeout: 20_000 }).toBe(1);
  const records = await client.rpc<LearningRecord[]>('studyforgeLearning/records', {});
  const record = records.ok ? records.value[0] : undefined;
  expect(record?.title).toBe('分母条件');
  expect(record?.fact.mark).toBe('牢');
  expect(record?.fact.channel).toBe('课外');

  await page.getByTestId('cards-tab-records').click();
  await expect(page.getByTestId('learning-records')).toBeVisible();
  const shown = page.getByTestId('learning-record');
  await expect(shown).toHaveCount(1);
  await expect(shown).toContainText('分母条件');
  await expect(shown).toContainText('牢');
  await expect(shown).toContainText('课外');
  await expect(shown).toContainText(`下次 ${record?.schedule.nextDue ?? ''}`);
  await page.screenshot({ path: testInfo.outputPath('learning-records.png'), fullPage: true });

  // The handout filters the same stored schedule to today: just studied means
  // due tomorrow, and the unstudied card has no schedule to be due on.
  const cards = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
  const studied = (cards.ok ? cards.value : []).find(card => card.content.title === '分母条件');
  const today = new Date().toISOString().slice(0, 10);
  expect(studied?.review?.nextDue !== undefined && studied.review.nextDue > today).toBe(true);

  await page.getByTestId('cards-tab-handout').click();
  await expect(page.getByTestId('handout-empty')).toBeVisible();
  await expect(page.getByTestId('handout-card')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('handout-today.png'), fullPage: true });

  // Back to the library, both cards are still there and only one is studied.
  await page.getByTestId('cards-tab-cards').click();
  await expect(page.getByTestId('card-list').getByTestId('card-row')).toHaveCount(2);
  await expect(page.getByTestId('card-row').filter({ hasText: '还没学的卡' })).toContainText('还没学过');
  expect(errors).toEqual([]);
});
