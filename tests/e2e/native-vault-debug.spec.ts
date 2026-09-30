import { test, expect } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * 显示调试记录 on DSH 0.2.0: the lesson's conversation keeps one native body, so
 * the trajectory is not a pane of its own. The switch shows the native view tabs
 * and the conversation turns to the trajectory in place; switched off, the
 * conversation shows chat again even if the trajectory was the last native view.
 */
test('显示调试记录 brings the native trajectory into the lesson conversation and takes it away again', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await client.script({ '__session-title': '调试记录', '开始': '好，我们开始。' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 6000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('开始'); await input.press('Enter');
    const reply = page.getByText('好，我们开始。').first();
    await expect(reply).toBeVisible({ timeout: 30_000 });
    const trajectoryTab = page.getByRole('tab', { name: /^(Trajectory|轨迹)$/ });
    const toolbar = page.getByRole('toolbar', { name: /^(Trajectory toolbar|轨迹工具栏)$/ });
    // The chat view's own controls; the trajectory lists the same words without them.
    const chatOnly = page.getByRole('button', { name: 'Good response', exact: true }).first();
    await expect(trajectoryTab).toHaveCount(0);
    await expect(chatOnly).toBeVisible();
    const permission = page.getByRole('button', { name: /Access mode, current:|访问模式|权限模式/ });
    await expect(permission).toHaveCount(0);
    // The native compact mode shows a brief statistic, independently of debugging.
    await expect(page.locator('[data-composer-stats]')).toBeVisible();
    await expect(page.locator('[data-turn-usage]')).toHaveCount(0);
    const checkCommands = async (debug: boolean) => {
      await page.getByRole('button', { name: /^(Add files or run commands|添加文件或调用指令)$/ }).click();
      const menu = page.locator('[data-trigger-menu]');
      for (const name of [/^(Feedback|反馈)/, /^(Export|下载日志)/]) {
        await expect(menu.getByRole('option', { name })).toHaveCount(debug ? 1 : 0);
      }
      await page.keyboard.press('Escape');
    };
    await checkCommands(false);

    const setDebug = async (on: boolean) => {
      await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
      await page.getByText('学习界面', { exact: true }).first().click();
      const box = page.getByRole('checkbox', { name: '显示调试记录' });
      if (on) await box.check(); else await box.uncheck();
      await expect(box).toBeEnabled();
      await expect(page.getByRole('alert')).toHaveCount(0);
      if(on)await expect(box).toBeChecked();else await expect(box).not.toBeChecked();
      await page.keyboard.press('Escape');
      await expect(page.getByText('学习界面', { exact: true })).toHaveCount(0);
    };

    await setDebug(true);
    await expect(permission).toBeVisible();
    await checkCommands(true);
    await trajectoryTab.click();
    await expect(toolbar).toBeVisible({ timeout: 15_000 });
    await expect(chatOnly).toBeHidden();
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('debug-trajectory.png') });

    // Off again while the trajectory is the native view: the lesson reads as chat.
    await setDebug(false);
    await expect(trajectoryTab).toHaveCount(0);
    await expect(toolbar).toHaveCount(0);
    await expect(chatOnly).toBeVisible();
    await expect(permission).toHaveCount(0);
    await expect(page.locator('[data-composer-stats]')).toBeVisible();
    await checkCommands(false);
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    expect(errors.filter(text => !/favicon|net::/i.test(text))).toEqual([]);
  } finally {
    await testInfo.attach('page-state', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
    await page.screenshot({ path: testInfo.outputPath('student-defaults.png') });
    await client.close();
    await runtime.stop();
  }
});
