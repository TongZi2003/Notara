import { test, expect } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, effectiveSystemText } from '../fixtures/vault-http.ts';
// @ts-expect-error Public gallery data is shipped as standalone plugin JavaScript.
import { CHARACTERS } from '../../examples/native-vault/academy.js';

test('independent gallery displays all artwork and profiles without changing the classroom', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  const watch = (target: typeof page) => {
    target.on('pageerror', error => errors.push(error.message));
    target.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  };
  watch(page); context.on('page', watch);
  try {
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 4000 }); await later.click(); } catch { /* test model configured */ }
    await page.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /academy\/notara\.svg/);
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.fill('画廊外保留的课堂草稿');
    const popup = page.waitForEvent('popup');
    await page.getByRole('link', { name: '书院画廊' }).click();
    const gallery = await popup;
    await gallery.waitForLoadState('domcontentloaded');
    await expect(gallery).toHaveTitle('书院画廊 · Notara');
    const roster = gallery.getByRole('navigation', { name: '选择角色' });
    await expect(roster.getByRole('button')).toHaveCount(9);
    for (const character of CHARACTERS) {
      await roster.getByRole('button', { name: new RegExp(character.name) }).click();
      const profile = gallery.getByRole('article', { name: `${character.name}的角色档案` });
      for (const section of character.sections) await expect(profile).toContainText(section.text);
      const art = gallery.getByRole('img', { name: `${character.name}角色原画`, exact: true });
      await expect.poll(() => art.evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 1536)).toBe(true);
      await expect(profile.locator('#art')).toHaveAttribute('height', '1024');
    }
    await expect(gallery.getByRole('heading', { name: '书院宣传画' })).toHaveCount(0);
    await expect(gallery.locator('img')).toHaveCount(11); // nine thumbnails, selected sheet, brand icon
    await roster.getByRole('button', { name: /温知秋/ }).click();
    await gallery.evaluate(() => scrollTo(0, 0));
    await gallery.screenshot({ path: testInfo.outputPath('gallery-desktop.png'), fullPage: true });
    const originalPopup = gallery.waitForEvent('popup');
    await gallery.getByRole('link', { name: '打开角色原画' }).click();
    const original = await originalPopup;
    await expect(original).toHaveURL(/wen-zhiqiu-profile\.webp/); await original.close();
    await gallery.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await roster.getByRole('button', { name: /阿米娜/ }).click();
    await expect(gallery.getByRole('heading', { name: '阿米娜·迪亚洛', exact: true })).toBeVisible();
    await gallery.evaluate(() => scrollTo(0, 0));
    await gallery.screenshot({ path: testInfo.outputPath('gallery-mobile.png'), fullPage: true });
    await gallery.close();
    await expect(composer).toHaveText('画廊外保留的课堂草稿');
    // Gallery viewing does not modify the actual default teaching identity or persisted settings.
    const sessionId = await client.createSession();
    const settings = client.value(await client.rpc<{ persona: string }>('notaraVault/teachingSettings', { input: { sessionId } }));
    expect(settings.persona).toBe('');
    const [request] = await client.ask(sessionId, '检查默认课堂');
    expect(effectiveSystemText(request!)).toContain('大肥鱼');
    expect(effectiveSystemText(request!)).not.toContain('温知秋');
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close(); await runtime.stop();
  }
});
