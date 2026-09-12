/**
 * P5.3 one real confirmation, from the teacher's proposal to the saved card.
 *
 * The proposal is not seeded: the isolated test model really calls the Host's
 * `propose_card` tool, so what the student sees is the stored item list. The
 * assertions pin the properties the confirmation exists for — nothing is saved
 * before the student decides, a rewritten draft keeps the teacher's original
 * beside it, confirming saves exactly one card, and a rejected item saves none.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, sendInput, openRoot } from './fixtures/classroom.ts';
import type { CardView } from '@studyforge/contracts/cards';
import type { ProposalView } from '@studyforge/contracts/proposals';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
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
  await page.getByTestId('studyforge-page-studyforge.materials').getByRole('button', { name: '卡片与笔记', exact: true }).click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

/** Have the real Host propose one card through the scripted test model. */
async function proposeCard(page: Page, dsh: IsolatedRuntime, title: string): Promise<void> {
  await enterClassroom(page, dsh.authUrl);
  const scripted = { name: 'propose_card', arguments: { kind: 'card', title, front: '分母不能为零', presentation: 'flashcard' } };
  await sendInput(page, '[tool]' + JSON.stringify(scripted));
  const client = await connectRuntime(dsh);
  await expect.poll(async () => {
    const list = await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: {} });
    return list.ok ? list.value.length : -1;
  }, { timeout: 40_000 }).toBe(1);
  const cards = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
  // Proposing is not saving: the card does not exist until the student decides.
  expect(cards.ok ? cards.value : []).toEqual([]);
}

test('a proposed card waits, keeps the teacher original beside the student draft, and saves once', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await proposeCard(page, dsh, '请你检查分母');

  await openCards(page);
  // The lesson panel mounts its own copy of this inbox; this spec drives the library's.
  const lib = page.getByTestId('studyforge-page-studyforge.cards');
  const inbox = lib.getByTestId('proposal-inbox');
  await expect(inbox).toBeVisible();
  await expect(inbox).toContainText('等你确认');
  await expect(lib.getByTestId('proposal-item-status')).toHaveText('等你决定');
  await expect(lib.getByTestId('proposal-front')).toContainText('分母不能为零');
  // The card list itself is still empty: the proposal is not a card.
  await expect(page.getByTestId('card-list').getByTestId('card-row')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('proposal-waiting.png'), fullPage: true });

  // The student rewrites the draft; the teacher's original stays readable.
  await lib.getByTestId('proposal-edit').click();
  await lib.getByTestId('proposal-editor-front').fill('分母不能为零：先写条件，再化简。');
  await lib.getByTestId('proposal-editor-save').click();
  await expect(lib.getByTestId('proposal-front')).toContainText('先写条件');
  await lib.getByTestId('proposal-show-original').click();
  await expect(lib.getByTestId('proposal-original')).toContainText('分母不能为零');
  await page.screenshot({ path: testInfo.outputPath('proposal-rewritten.png'), fullPage: true });

  await lib.getByTestId('proposal-confirm').click();
  await expect(lib.getByTestId('proposal-item-status')).toHaveText('已经保存');
  await expect(lib.getByTestId('proposal-receipt')).toContainText('已经保存');
  await expect(lib.getByTestId('proposal-done')).toBeVisible();

  // One confirmation, one real card, and it is not "studied" by being saved.
  const rows = page.getByTestId('card-list').getByTestId('card-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('请你检查分母');
  await expect(rows.first()).toContainText('还没学过');
  await expect(inbox.getByRole('heading', { name: '提案记录', exact: true })).toBeVisible();
  await expect(inbox.getByRole('heading', { name: '等你确认', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('proposal-confirmed.png'), fullPage: true });

  // A fresh boot reads the Host again: the receipt and the card both persist.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await expect(lib.getByTestId('proposal-item-status')).toHaveText('已经保存');
  await expect(page.getByTestId('card-list').getByTestId('card-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a rejected proposal saves nothing at all', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await proposeCard(page, dsh, '不要这张卡');

  await openCards(page);
  // The lesson panel mounts its own copy of this inbox; this spec drives the library's.
  const lib = page.getByTestId('studyforge-page-studyforge.cards');
  await expect(lib.getByTestId('proposal-item-status')).toHaveText('等你决定');
  await lib.getByTestId('proposal-reject').click();
  await expect(lib.getByTestId('proposal-item-status')).toHaveText('已经不要了');
  await expect(page.getByTestId('card-list').getByTestId('card-row')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('proposal-rejected.png'), fullPage: true });

  // Rejecting is durable, and it never becomes a card on the next boot either.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await expect(lib.getByTestId('proposal-item-status')).toHaveText('已经不要了');
  await expect(page.getByTestId('card-list').getByTestId('card-row')).toHaveCount(0);
  expect(errors).toEqual([]);
});
