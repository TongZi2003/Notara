import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * The board as lecture and practice sheet: the teacher writes a section of
 * blocks laid out by their measured heights; the student answers a choice, an
 * ordering and a blank right on the board; each answer is stored first and then
 * arrives in the same lesson as the student's own message, which the teacher
 * answers. A reload keeps every answer, and a narrow board reads as one column.
 */
const board = (page: Page) => page.locator('.nb-board');
test('the student answers on the board and the teacher receives it as the student’s message', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectVault(runtime);
  try {
    client.approvals.auto('allowed-once');
    const section = '第1题 中点弦的斜率';
    const choiceMessage = '〔白板｜第1题 中点弦的斜率｜这条弦的斜率是正还是负？〕我选：B 负。理由：M 在第一象限，弦往下倾斜';
    await client.script({
      '__session-title': '白板练习',
      '开始上课': { calls: [
        { name: 'write_lesson_board', arguments: { title: '题目', kind: 'question', section, body: '椭圆 $\\frac{x^2}{4}+y^2=1$ 的弦 AB 以 $M(1,\\tfrac12)$ 为中点，求 AB 的斜率。' } },
        { name: 'write_lesson_board', arguments: { title: '先判断', placement: { relativeTo: '题目', position: 'beside' }, body: '```choice\n这条弦的斜率是正还是负？\n- 正\n- 负\n- 取决于 M 在哪个象限\n```' } },
        { name: 'write_lesson_board', arguments: { title: '排好步骤', body: '```order\n把点差法的步骤排好\n- 两式相减\n- 设 A、B 的坐标\n- 代入椭圆方程\n```' } },
        { name: 'write_lesson_board', arguments: { title: '补一步', size: 'wide', body: '```blank\n两式相减后得到 {{ 用 x、y 的和与差表示 }}\n```' } },
      ], text: '白板上有三道小题，先判断方向。' },
      [choiceMessage]: '说说为什么往下倾斜？',
    });

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('开始上课'); await input.press('Enter');
    // Each board write asks once unless the harness already answered it.
    const reply = page.getByText('白板上有三道小题，先判断方向。').first();
    for (let round = 0; round < 40 && !(await reply.isVisible()); round++) {
      const allow = page.getByRole('button', { name: 'Allow once', exact: true });
      if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(500);
    }
    await expect(reply).toBeVisible({ timeout: 30_000 });
    const session = ((await client.sessions()) as Array<{ sessionId: string; blank?: boolean }>).find(row => !row.blank)?.sessionId;
    expect(session).toBeTruthy();
    await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true }).click();
    await expect(board(page).locator('.nb-section-title', { hasText: section })).toBeVisible();
    await expect(board(page).locator('.nb-block')).toHaveCount(4);

    // Laid out by measured height: no two blocks overlap.
    await page.waitForTimeout(400);
    const boxes = await board(page).locator('.nb-block').evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; }));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const one = boxes[a]!, two = boxes[b]!;
      expect(one.right <= two.left + 1 || two.right <= one.left + 1 || one.bottom <= two.top + 1 || two.bottom <= one.top + 1, `blocks ${a} and ${b} overlap`).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('board-section.png') });
    // 全览 fits the whole board above the floating toolbar.
    await board(page).getByRole('button', { name: '全览', exact: true }).click();

    // Choice: pick, give a reason, hand it in.
    const choice = board(page).locator('.nb-q[data-type=choice]');
    await choice.getByRole('radio', { name: /负/ }).click();
    await choice.getByLabel('理由').fill('M 在第一象限，弦往下倾斜');
    await choice.getByRole('button', { name: '交给老师' }).click();
    await expect(choice.locator('.nb-q-badge')).toHaveText('已交给老师');
    await expect(choice).toContainText('我选：B 负');

    // Ordering and blank.
    const order = board(page).locator('.nb-q[data-type=order]');
    await order.getByRole('button', { name: '上移“设 A、B 的坐标”' }).click();
    await order.getByRole('button', { name: '交给老师' }).click();
    await expect(order).toContainText('我的顺序：1. 设 A、B 的坐标 2. 两式相减 3. 代入椭圆方程');
    const blank = board(page).locator('.nb-q[data-type=blank]');
    // A LaTeX command previews even without dollars.
    await blank.getByLabel(/第1空/).fill('\\frac{1}{2}');
    await expect(blank.locator('.nb-q-preview .katex')).toBeVisible();
    await blank.getByLabel(/第1空/).fill('$(x_1+x_2)(x_1-x_2)/4+(y_1+y_2)(y_1-y_2)=0$');
    await expect(blank.locator('.nb-q-preview .katex')).toBeVisible();
    await blank.getByRole('button', { name: '交给老师' }).click();
    await expect(blank.locator('.nb-q-badge')).toBeVisible();
    // The handed-in summary renders its formula instead of showing the dollars.
    await expect(blank.locator('.nb-q-done .katex').first()).toBeVisible();
    await expect(blank.locator('.nb-q-done')).not.toContainText('$');
    await page.screenshot({ path: testInfo.outputPath('board-answered.png') });

    // The answers are the student's messages in this lesson, and the teacher answered.
    await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '对话', exact: true }).click();
    await expect(page.getByText(choiceMessage, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('说说为什么往下倾斜？').first()).toBeVisible({ timeout: 30_000 });

    // 追问这块 quotes the block into the one composer without sending it.
    await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true }).click();
    const question = board(page).locator('.nb-block[data-kind=question]');
    await question.hover();
    await question.getByRole('button', { name: '追问这块' }).click();
    await expect(page.locator('[data-composer-input][contenteditable="true"]').last()).toContainText('〔白板｜第1题 中点弦的斜率｜题目〕');

    // A reload keeps the answers on the board.
    // The reloaded tab comes back to this lesson by itself (the board folds the panel away).
    await page.reload();
    await expect(page.getByRole('tablist', { name: '课堂视图' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true }).click();
    await expect(board(page).locator('.nb-q[data-type=choice] .nb-q-badge')).toHaveText('已交给老师');
    const saved = JSON.stringify(await client.rpc('notaraVault/board', { input: { sessionId: session } }));
    expect(saved).toContain('"pick":[1]');

    // A narrow board is one readable column.
    await page.setViewportSize({ width: 560, height: 900 });
    await expect(board(page).locator('.nb-reading')).toBeVisible();
    await expect(board(page).locator('.nb-reading .nb-block')).toHaveCount(4);
    await page.screenshot({ path: testInfo.outputPath('board-reading.png') });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
