import { test, expect } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

/**
 * The PDF reader is not in the startup bundle: the first PDF shown fetches the
 * reader and its worker from the Host lazy route, then renders the page on a
 * canvas. Nothing is fetched before a PDF is opened.
 */
test('opening a PDF loads the reader from the lazy route and draws the page', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [], lazy: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.url().includes('/notara/vault/lazy/')) lazy.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  try {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }

    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    expect(lazy, 'nothing lazy is fetched before a PDF is opened').toEqual([]);
    await page.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /向量讲义\.pdf$/ }).click();
    const canvas = page.locator('canvas[aria-label="向量讲义.pdf"]');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => canvas.evaluate((element: HTMLCanvasElement) => element.width), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('lazy-pdf.png') });
    expect(lazy).toEqual(expect.arrayContaining(['200 /notara/vault/lazy/pdf.min.mjs', '200 /notara/vault/lazy/pdf.worker.min.mjs']));
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
