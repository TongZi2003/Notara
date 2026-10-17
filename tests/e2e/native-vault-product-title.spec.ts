import { expect, test } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

test('Notara「拾页」 brands the initial page and native classroom titles across rename, switch and reload', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  let client: VaultHarness | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    client = await connectVault(runtime);
    await client.script({ '__session-title': '拾页标题验收', '开始标题验收': '标题验收课堂已开始。' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8_000 }); await later.click(); } catch { /* already acknowledged */ }
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveTitle('Notara「拾页」');
    const initial = await page.request.get(client.origin);
    expect(initial.status()).toBe(200);
    expect(await initial.text()).toContain('<title>Notara「拾页」</title>');
    const manifest = await page.request.get(`${client.origin}/manifest.webmanifest`);
    expect(manifest.status()).toBe(200);
    expect(await manifest.json()).toMatchObject({ name: 'Notara「拾页」', short_name: 'Notara「拾页」' });

    await composer.fill('开始标题验收');
    await composer.press('Enter');
    await expect(page.getByText('标题验收课堂已开始。', { exact: true }).first()).toBeVisible();
    await expect(page).toHaveTitle('拾页标题验收 — Notara「拾页」');
    const sessionId = (await client.sessions()).find(row => row.projections?.values?.title === '拾页标题验收')!.sessionId;
    await client.rename(sessionId, '继续学习');
    await expect(page).toHaveTitle('继续学习 — Notara「拾页」');
    await expect.poll(async () => (await client!.sessions()).find(row => row.sessionId === sessionId)?.running).toBe(false);
    const sibling = client.value(await client.rpc<{ sessionId: string }>('session/fork', { request: { sessionId } }));
    await client.rename(sibling.sessionId, '另一课堂');
    const row = (title: string) => page.locator('.nv-panel .nv-session-row').filter({ has: page.getByText(title, { exact: true }) });
    await row('另一课堂').click();
    await expect(page).toHaveTitle('另一课堂 — Notara「拾页」');
    await row('继续学习').click();
    await expect(page).toHaveTitle('继续学习 — Notara「拾页」');
    await page.reload();
    await expect(composer).toBeVisible();
    await expect(page).toHaveTitle('继续学习 — Notara「拾页」');
    await page.screenshot({ path: testInfo.outputPath('notara-product-title.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await client?.close();
    await runtime.stop();
  }
});
