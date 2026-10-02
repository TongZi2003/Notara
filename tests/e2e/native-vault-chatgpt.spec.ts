import { test, expect } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

test('ChatGPT settings start the official PKCE login and cancel without exposing credentials', async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Stop at the real authorization boundary: this test never uses a personal account.
  await context.route('https://auth.openai.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>测试授权页面</p>' }));
  try {
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* acknowledged */ }
    await expect(page.locator('.nv-home')).toBeVisible();
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText('ChatGPT 账号', { exact: true }).first().click();
    const settings = page.locator('.nv-chatgpt-settings');
    await expect(settings.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
    await expect(settings.getByText('正在读取登录状态…')).toBeHidden();
    const popupPromise = page.waitForEvent('popup');
    await settings.getByRole('button', { name: 'Continue with ChatGPT' }).click();
    const popup = await popupPromise;
    await popup.waitForURL('https://auth.openai.com/**');
    const authorization = new URL(popup.url());
    expect(authorization.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(authorization.searchParams.get('agent_name_hint')).toBe('Notara');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(authorization.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    await expect(settings.getByRole('button', { name: '取消登录' })).toBeVisible();
    await settings.getByRole('button', { name: '取消登录' }).click();
    await expect(settings.getByRole('button', { name: '取消登录' })).toBeHidden();
    await expect(settings.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
    await popup.close();
    await expect(settings.getByRole('link', { name: '管理 ChatGPT 用量与授权' })).toHaveAttribute('href', 'https://chatgpt.com/settings/usage');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /chatgpt|access_token|refresh_token/i.test(key)))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('chatgpt-settings.png') });
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await testInfo.attach('runtime-log', { body: runtime.log(), contentType: 'text/plain' });
    await runtime.stop();
  }
});
