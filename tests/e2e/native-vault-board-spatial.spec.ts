import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

const board = (page: Page) => page.locator('.nb-board');

test('spatial figures rotate, zoom, reset, and export as SVG', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectVault(runtime);
  try {
    client.approvals.auto('allowed-once');
    await client.script({
      '__session-title': '空间图',
      '空间图': { calls: [{ name: 'write_lesson_board', arguments: {
        title: '空间坐标', body: '旋转视角观察长方体。\n\n```figure\naxes x -4..4 y -3..3 z -2..4\npoint A = (-1, -1, 0)\npoint B = (1, -1, 0)\npoint C = (1, 1, 0)\npoint D = (-1, 1, 0)\npoint E = (-1, -1, 2)\npoint F = (1, -1, 2)\npoint G = (1, 1, 2)\npoint H = (-1, 1, 2)\ncuboid box = A B C D E F G H\npoint P = (2, 0, 0)\ncone C2 = vertex P axis (0, 0, 1) radius 1 height 2\nvector v = A -> (1, 2, 3) "方向"\n```',
      } }], text: '空间图已写好。' },
    });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('空间图'); await input.press('Enter');
    const reply = page.getByText('空间图已写好。').first();
    for (let round = 0; round < 40 && !(await reply.isVisible()); round++) {
      const allow = page.getByRole('button', { name: 'Allow once', exact: true });
      if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(500);
    }
    await expect(reply).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true }).click();
    const spatial = board(page).locator('.nb-space-figure');
    await expect(spatial.locator('svg.nb-space-svg')).toBeVisible();
    await expect(spatial.locator('polygon.nb-space-face')).toHaveCount(7);
    const svg = spatial.locator('svg');
    await expect(svg).toHaveCSS('touch-action','none');
    await expect(spatial.locator('.nb-space-controls')).toHaveCSS('display','flex');
    await expect(svg.locator('[data-spatial-object="cone-C2"]')).toBeVisible();
    const coneApex = await svg.locator('.nb-space-point').nth(8).evaluate(element => ({ x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')) }));
    const coneSides = await svg.locator('[data-spatial-object="cone-C2"] line').evaluateAll(lines => lines.map(line => ({ x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) })));
    expect(coneSides.every(point => Math.hypot(point.x - coneApex.x, point.y - coneApex.y) < 0.01)).toBe(true);
    const initial = await svg.innerHTML();
    const box = await svg.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 75, box!.y + box!.height / 2 + 28, { steps: 4 });
    await page.mouse.up();
    const rotated = await svg.innerHTML();
    expect(rotated).not.toBe(initial);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => svg.innerHTML()).not.toBe(rotated);
    await spatial.getByRole('button', { name: '重置视角' }).click();
    await expect.poll(() => svg.innerHTML()).toBe(initial);
    await testInfo.attach('spatial-board-preview', { body: await page.screenshot({path: testInfo.outputPath('spatial-board-preview.png')}), contentType: 'image/png' });

    await board(page).getByRole('button', { name: '导出', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'HTML', exact: true }).click()]);
    const { readFile } = await import('node:fs/promises');
    const html = await readFile((await download.path())!, 'utf8');
    expect(html).toContain('class="nb-export-figure"><svg');
    expect(html).toContain('class="nb-space-face"');
    expect(html).toContain('data-spatial-object="cone-C2"');
    await testInfo.attach('spatial-board', { body: html, contentType: 'text/html' });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
