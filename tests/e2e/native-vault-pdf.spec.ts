import { test, expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-native-vault.ts';

/** The vault PDF reader must render pages on canvas, let the reader drag a
 * rectangle on the page, and turn the covered text into a Markdown card —
 * all without the browser's own PDF plugin or a frozen main thread. */
test.describe('native vault PDF reader', () => {
  let runtime: VaultRuntime;
  test.beforeAll(async () => { runtime = await startVaultIsolated(); });
  test.afterAll(async () => { await runtime?.stop(); });

  test('opens a PDF without crashing, selects a region, and extracts a Markdown card', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    // Regression guard: an unstable Remote proxy used to re-run the list effect
    // every render, flooding /api/notaraVault/list (thousands of calls) until
    // clicks starved. Healthy usage is a handful of calls for the whole test.
    let listCalls = 0;
    page.on('request', request => { if (request.url().includes('/api/notaraVault/list')) listCalls += 1; });

    await page.goto(runtime.authUrl);
    await page.screenshot({ path: testInfo.outputPath('landing.png') });

    // First boot shows the provider onboarding modal asynchronously; wait for
    // it briefly and skip it like a local evaluation install would.
    const configureLater = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await configureLater.waitFor({ state: 'visible', timeout: 8_000 }); await configureLater.click(); }
    catch { /* already acknowledged on this install */ }
    await expect(page.locator('div[role="presentation"] [aria-hidden="true"]')).toHaveCount(0, { timeout: 5_000 }).catch(() => {});

    // Enter the pre-registered workspace and open a session so the
    // conversation.view slots (聊天 / 资产) exist. The model run will fail
    // without a key, but the session and its views are still created.
    await page.getByText('Notara Vault').first().click();
    // The composer starts `contenteditable="false"` until a workspace is
    // attached; wait for the editable one instead of racing the mount.
    const composer = page.locator('[data-composer-input][contenteditable="true"], textarea[placeholder]').last();
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.click();
    await composer.fill('打开资产页');
    await composer.press('Enter');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: testInfo.outputPath('session.png') });

    await page.getByText('资产', { exact: true }).first().click();
    await page.screenshot({ path: testInfo.outputPath('assets.png') });
    try {
      await page.getByRole('button', { name: /向量讲义\.pdf/ }).waitFor({ state: 'visible', timeout: 20_000 });
    } catch (error) {
      const body = await page.locator('body').innerText().catch(() => '');
      console.log('VAULT BODY >>>', body.slice(0, 2000));
      console.log('PAGE ERRORS >>>', JSON.stringify(errors.slice(0, 20)));
      throw error;
    }
    // The conversation panel's width-drag handle overlays the rail's right
    // edge; aim at the row's left side like a real click would.
    await page.getByRole('button', { name: /向量讲义\.pdf/ }).click({ position: { x: 16, y: 12 } });
    await page.screenshot({ path: testInfo.outputPath('pdf.png') });

    // The reader paints the page onto a canvas and lays an invisible text layer
    // on top of it; neither the <object> plugin nor a blank shell is acceptable.
    const canvas = page.locator('canvas[aria-label="向量讲义.pdf"]');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(await page.locator('.nv-pdf-text span').count()).toBeGreaterThanOrEqual(3);
    await expect(page.getByText('/ 2', { exact: false })).toBeVisible();

    // Drag a rectangle across the first page's text block.
    const stage = await canvas.evaluate(node => (node.parentElement as HTMLElement).getBoundingClientRect());
    await page.mouse.move(stage.x + stage.width * 0.06, stage.y + stage.height * 0.06);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * 0.9, stage.y + stage.height * 0.2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText(/已框选第 \d+ 页区域/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('selection.png') });

    // Extract the selection into a real Markdown card in the vault.
    await page.getByRole('button', { name: '提取为 Markdown 卡片' }).click();
    await expect(page.getByText(/已提取为 Markdown 卡片：/)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath('card.png') });

    const cards = await readdir(join(runtime.root, 'workspace', 'vault', '卡片'));
    expect(cards.length).toBe(1);
    const card = await readFile(join(runtime.root, 'workspace', 'vault', '卡片', cards[0]), 'utf8');
    expect(card).toContain('媒体/向量讲义.pdf');
    expect(card).toMatch(/!\[\[媒体\/向量讲义\.pdf#page=1&rect=\d*\.\d+(?:,\d*\.\d+){3}\]\]/);
    expect(card).toContain('A basis gives a coordinate language.');
    expect(card).not.toContain('此区域没有可提取的文字');

    // The page stayed alive the whole time: no uncaught errors from the iframe
    // boot path or the reader, and no request flood from the list effect.
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
    expect(listCalls).toBeLessThan(40);
  });
});
