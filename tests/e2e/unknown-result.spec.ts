/**
 * P5 a write whose answer got lost is retried as the *same* write.
 *
 * Both cases let the Host really commit the call and then drop the response on
 * the way back (`route.fetch()` then `route.abort`), which is the only honest
 * way to produce an unknown outcome: the server state is already changed, so a
 * retry with a fresh identity would duplicate a record or a card. The UI must
 * keep the same attempt — the same grade, the same draft — and the Host's own
 * operation id must make the retry land on the first write.
 */
import { expect, type Page, type Route } from '@playwright/test';
import { enterClassroom, test, openRoot } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { CardView } from '@studyforge/contracts/cards';
import type { LearningRecord } from '@studyforge/domain/learning-records';

/** Answer the request for real, then lose the answer exactly once. */
async function dropNextResponse(page: Page, endpoint: string): Promise<void> {
  let drops = 0;
  await page.route(`**/api/${endpoint}`, async (route: Route) => {
    if (drops > 0) { await route.continue(); return; }
    drops += 1;
    await route.fetch();
    await route.abort('failed');
  });
}

/** Every real write the page sent: what a retry must repeat verbatim. */
function recordWrites(page: Page, endpoint: string): string[] {
  const writes: string[] = [];
  page.on('request', request => {
    if (!request.url().endsWith(`/api/${endpoint}`)) return;
    const body = JSON.parse(request.postData() ?? 'null') as { payload?: { args?: unknown } } | null;
    if (body?.payload?.args !== undefined) writes.push(JSON.stringify(body.payload.args));
  });
  return writes;
}

async function openCards(page: Page): Promise<void> {
  await openRoot(page, '资料');
  await page.getByTestId('studyforge-page-studyforge.materials').getByTestId('materials-open-cards').click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

test('a lost review answer keeps one grade, and the same retry is not a second record', async ({ page, classroom }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, classroom.authUrl);
  const client = await connectRuntime(classroom);
  const created = await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: crypto.randomUUID(),
    content: {
      title: '一次函数顶点', presentation: 'problem', front: '求 $y=x^2-4x+3$ 的顶点。',
      sections: [{ heading: '解法', body: '配方法：$y=(x-2)^2-1$，顶点 $(2,-1)$。' }],
      notes: '', sources: [], tags: [], links: [],
    },
  } });
  expect(created.ok).toBe(true);

  await openCards(page);
  await page.getByTestId('card-row-learn').first().click();
  await expect(page.getByTestId('review-screen')).toBeVisible();
  await page.getByTestId('review-reveal').click();
  await expect(page.getByTestId('review-back-body')).toBeVisible();
  const reviewWrites = recordWrites(page, 'studyforgeLearning/review');
  await dropNextResponse(page, 'studyforgeLearning/review');

  await page.getByTestId('review-mark-牢').click();

  // The answer never arrived: the grade stays locked and the student is told
  // that repeating it repeats the same attempt, not a new one.
  await expect(page.getByTestId('review-notice')).toContainText('不会记两次');
  await expect(page.getByTestId('review-mark-牢')).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('review-mark-糊')).toHaveAttribute('data-locked', 'false');
  await expect(page.getByTestId('review-mark-糊')).toBeDisabled();
  await expect(page.getByTestId('review-result')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('review-unknown.png'), fullPage: true });

  // The Host really stored it — the write is not what was lost.
  await expect.poll(async () => {
    const rows = await client.rpc<LearningRecord[]>('studyforgeLearning/records', {});
    return rows.ok ? rows.value.length : -1;
  }, { timeout: 20_000 }).toBe(1);

  // Same grade again — and the retry really is the same request, not a new one.
  await page.getByTestId('review-mark-牢').click();
  await expect(page.getByTestId('review-result')).toBeVisible();
  expect(reviewWrites).toHaveLength(2);
  expect(reviewWrites[1]).toBe(reviewWrites[0]);
  const rows = await client.rpc<LearningRecord[]>('studyforgeLearning/records', {});
  expect(rows.ok ? rows.value.length : -1).toBe(1);
  expect(rows.ok ? rows.value[0]?.fact.mark : '').toBe('牢');
  const cards = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
  expect(cards.ok ? cards.value[0]?.review?.reviewCount : -1).toBe(1);
  expect(errors).toEqual([]);
});

test('a lost create answer is retried as the same write, not a second card', async ({ page, classroom }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, classroom.authUrl);
  await openCards(page);
  const client = await connectRuntime(classroom);
  const cardWrites = recordWrites(page, 'studyforgeLearning/createCard');
  await dropNextResponse(page, 'studyforgeLearning/createCard');

  await page.getByTestId('card-browser-create').click();
  await page.getByTestId('card-editor-title').fill('未知结果卡');
  await page.getByTestId('card-editor-front').fill('先写条件。');
  await page.getByTestId('card-editor-save').click();

  // The editor keeps the draft and says what a second click will do. With the
  // answer missing the form freezes: a changed draft would be a different
  // operation and a second card.
  await expect(page.getByTestId('card-editor-notice')).toContainText('不会重复保存');
  await expect(page.getByTestId('card-editor')).toHaveAttribute('data-frozen', 'true');
  await expect(page.getByTestId('card-editor-retry')).toBeVisible();
  await expect(page.getByTestId('card-editor-save')).toHaveCount(0);
  expect(await page.getByTestId('card-editor-title').evaluate((element: HTMLInputElement) => element.closest('fieldset')?.disabled === true)).toBe(true);

  // A real typing attempt cannot reach the frozen payload.
  await page.getByTestId('card-editor-title').evaluate((element: HTMLInputElement) => { element.focus(); });
  await page.keyboard.type('改过');
  await expect(page.getByTestId('card-editor-title')).toHaveValue('未知结果卡');
  await page.screenshot({ path: testInfo.outputPath('card-unknown.png'), fullPage: true });

  // It already landed: exactly one card, even though the answer was lost.
  await expect.poll(async () => {
    const rows = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
    return rows.ok ? rows.value.filter(view => view.content.title === '未知结果卡').length : -1;
  }, { timeout: 20_000 }).toBe(1);

  // The retry repeats the frozen request: same operation, same payload.
  await page.getByTestId('card-editor-retry').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('未知结果卡');
  expect(cardWrites).toHaveLength(2);
  expect(cardWrites[1]).toBe(cardWrites[0]);
  const rows = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
  expect(rows.ok ? rows.value.filter(view => view.content.title === '未知结果卡').length : -1).toBe(1);
  expect(errors).toEqual([]);
});
