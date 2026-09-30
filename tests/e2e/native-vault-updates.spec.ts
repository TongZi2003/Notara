import { test, expect } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

test('the update notice survives an action error and the settings can check again', async ({ page }, testInfo) => {
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = []; let applied = 0, checked = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/notaraVault/*', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1);
    if (method === 'updateStatus' || method === 'checkUpdate') {
      if (method === 'checkUpdate') checked++;
      await route.fulfill({ json: { result: { ok: true, value: { phase: 'ready', currentVersion: '0.22.0', latestVersion: '0.22.1', message: '新版已准备好，课堂空闲时可以重启更新。' } } } });
    } else if (method === 'applyUpdate') {
      applied++;
      await route.fulfill({ json: { result: { ok: false, error: { message: '课堂或后台任务还在进行，请等结束后再更新。' } } } });
    } else await route.fallback();
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 5000 }); await later.click(); } catch { /* not shown */ }
    await expect(page.getByText('有新版本 0.22.1')).toBeVisible();
    await page.getByRole('button', { name: '重启并更新', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('课堂或后台任务还在进行，请等结束后再更新。');
    expect(applied).toBe(1);
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText('更新', { exact: true }).click();
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(checked).toBe(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('update-settings.png') });
  } finally { await runtime.stop(); }
});
