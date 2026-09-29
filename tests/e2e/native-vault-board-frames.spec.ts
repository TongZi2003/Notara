import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * 逐帧演示: the student steps through frames; a covered frame opens only after a
 * prediction is handed in (arriving as the student's message) or after 直接看,
 * which is recorded but sends nothing. The revealed frame shows the student's
 * own prediction beside it.
 */
const board = (page: Page) => page.locator('.nb-board');
const lessonTab = (page: Page, name: string) => page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name, exact: true });
const frames = '```frames\ntitle 调用 roll_dice(3)\nframe 调用前\n| 帧 | 绑定 |\n|---|---|\n| Global | roll_dice → 函数 |\npredict\nframe 进入 roll_dice\n| 帧 | 绑定 |\n|---|---|\n| roll_dice | num_rolls → <mark data-color="orange">3</mark> |\nframe 返回\n- 返回值 6\n```';
const motion = '```frames\ntitle 竖直上抛\nframe 抛出瞬间\n速度向上，$v=v_0$\npredict\nframe 最高点\n速度为 $0$，加速度仍为 $g$\n```';

test('frames step, cover the predicted frame and reveal it after a prediction or 直接看', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectVault(runtime);
  try {
    client.approvals.auto('allowed-once');
    const prediction = '我预测第2帧（进入 roll_dice）：roll_dice 的帧里 num_rolls 绑定到 3';
    await client.script({
      '__session-title': '逐帧演示',
      '看过程': { calls: [
        { name: 'write_lesson_board', arguments: { title: '环境图', section: '第4题 函数调用', size: 'wide', body: frames } },
        { name: 'write_lesson_board', arguments: { title: '上抛过程', body: motion } },
      ], text: '白板上有两段逐帧演示。' },
      [`〔白板｜第4题 函数调用｜调用 roll_dice(3)〕${prediction}`]: '对，参数先绑定。',
    });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('看过程'); await input.press('Enter');
    const reply = page.getByText('白板上有两段逐帧演示。').first();
    for (let round = 0; round < 40 && !(await reply.isVisible()); round++) {
      const allow = page.getByRole('button', { name: 'Allow once', exact: true });
      if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(500);
    }
    await expect(reply).toBeVisible({ timeout: 30_000 });
    await lessonTab(page, '白板').click();
    await board(page).getByRole('button', { name: '全览', exact: true }).click();

    const env = board(page).locator('.nb-frames', { hasText: '调用 roll_dice(3)' });
    await expect(env.locator('.nb-frames-caption')).toHaveText('第 1/3 帧 · 调用前');
    await expect(env.getByRole('button', { name: '下一帧' })).toBeDisabled();
    await env.getByPlaceholder('写下你的预测，交给老师后揭开这一帧').fill('roll_dice 的帧里 num_rolls 绑定到 3');
    await env.getByRole('button', { name: '交给老师' }).click();
    await expect(env.locator('.nb-frames-caption')).toHaveText('第 2/3 帧 · 进入 roll_dice');
    await expect(env.locator('.nb-frames-stage mark[data-color=orange]')).toHaveText('3');
    await expect(env.getByText('你的预测：roll_dice 的帧里 num_rolls 绑定到 3')).toBeVisible();
    await env.getByRole('button', { name: '下一帧' }).click();
    await expect(env.locator('.nb-frames-caption')).toHaveText('第 3/3 帧 · 返回');

    const up = board(page).locator('.nb-frames', { hasText: '竖直上抛' });
    await up.getByRole('button', { name: '直接看' }).click();
    await expect(up.locator('.nb-frames-caption')).toHaveText('第 2/2 帧 · 最高点');
    await expect(up.getByText('这一帧你没有预测，直接看了。')).toBeVisible();
    await expect(up.locator('.nb-frames-stage .katex').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('board-frames.png') });

    await lessonTab(page, '对话').click();
    await expect(page.getByText(`〔白板｜第4题 函数调用｜调用 roll_dice(3)〕${prediction}`).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('对，参数先绑定。').first()).toBeVisible({ timeout: 30_000 });
    // 直接看 sends nothing: no student message carries it (the board itself still says so).
    await expect(page.getByText(/^〔白板｜[^〕]*〕第2帧（最高点）没有预测/)).toHaveCount(0);

    // Both are on the board file; the teacher's overview names the skipped frame.
    const saved = JSON.stringify(await client.rpc('notaraVault/board', { input: { sessionId: ((await client.sessions()) as Array<{ sessionId: string; blank?: boolean }>).find(row => !row.blank)!.sessionId } }));
    expect(saved).toContain('"skipped":true');
    expect(saved).toContain('num_rolls 绑定到 3');
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
