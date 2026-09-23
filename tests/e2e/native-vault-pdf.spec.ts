import { test, expect, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';

/**
 * The vault PDF surface must render pages on canvas, let the reader drag a
 * rectangle on the page, and reference the original visual region in a card — all
 * without the browser's own PDF plugin or a frozen main thread.
 *
 * Migrated to the minimal-split contract (docs/dev-log/2026-09-21-vault-minimal-split.md):
 * the reader is no longer its own tab; it is the assets view's PDF surface,
 * reached through the file rail that starts collapsed behind 展开文件栏. The
 * reference-card flow saves a highlight first and never splits raw page text.
 */
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
// The wording of the card-creation action inside 打开摘录工具 is still moving.
const createCard = (page: Page) => page.getByRole('button', { name: '创建区域引用卡片', exact: true });

test.describe('native vault PDF reader', () => {
  let runtime: VaultRuntime;
  test.beforeAll(async () => { runtime = await startVaultIsolated(); });
  test.afterAll(async () => { await runtime?.stop(); });

  test('opens a PDF in the assets view, selects a region, and extracts a Markdown card', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
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
    // conversation.view slots exist. The model run will fail without a key, but
    // the session and its views are still created.
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

    // PDF and Markdown share the assets view: there is no reader tab left.
    await expect(tab(page, '阅读器')).toHaveCount(0);
    await tab(page, '资产').click();
    await page.screenshot({ path: testInfo.outputPath('assets.png') });

    // The file rail is collapsed by default.
    await expect(page.getByRole('button', { name: '展开文件栏', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '展开文件栏', exact: true }).click();
    try {
      await page.getByRole('button', { name: /向量讲义\.pdf/ }).first().waitFor({ state: 'visible', timeout: 20_000 });
    } catch (error) {
      const body = await page.locator('body').innerText().catch(() => '');
      console.log('VAULT BODY >>>', body.slice(0, 2000));
      console.log('PAGE ERRORS >>>', JSON.stringify(errors.slice(0, 20)));
      throw error;
    }
    await page.getByRole('button', { name: /向量讲义\.pdf/ }).first().click();
    await page.screenshot({ path: testInfo.outputPath('pdf.png') });

    // Original mathematical typesetting stays on a canvas, without a text layer.
    const canvas = page.locator('canvas[aria-label="向量讲义.pdf"]');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    await expect(page.locator('.nv-pdf-text')).toHaveCount(0);
    await expect(page.getByText('/ 2', { exact: false })).toBeVisible();

    // Drag a rectangle across the first page's text block.
    const stage = await canvas.evaluate(node => (node.parentElement as HTMLElement).getBoundingClientRect());
    await page.mouse.move(stage.x + stage.width * 0.06, stage.y + stage.height * 0.06);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * 0.9, stage.y + stage.height * 0.2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText(/第 \d+ 页原始区域/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('selection.png') });

    // Extract the selection into a real Markdown card: the action lives inside
    // 打开摘录工具 instead of a toolbar of its own.
    if (!(await createCard(page).isVisible())) await page.getByRole('button', { name: '框选原文区域', exact: true }).click();
    await page.getByLabel('批注', { exact: true }).fill('公式请对照原版阅读。');
    await page.getByLabel('卡片标题', { exact: true }).fill('基底区域摘录');
    await createCard(page).click();
    await expect(page.getByText(/已创建区域引用卡片/).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath('card.png') });

    const cardsDir = join(runtime.root, 'workspace', 'vault', '卡片');
    const [cardName, ...extraCards] = await readdir(cardsDir);
    expect(extraCards).toEqual([]);
    expect(cardName).toBeTruthy();
    const card = await readFile(join(cardsDir, cardName!), 'utf8');
    expect(card).toContain('媒体/向量讲义.pdf');
    expect(card).toMatch(/!\[\[媒体\/向量讲义\.pdf#page=1&rect=[\d.,]+&annotation=[\w-]+&revision=[a-f0-9]{24}\]\]/);
    expect(card).not.toContain('A basis gives a coordinate language.');
    expect(card).toContain('公式请对照原版阅读。');
    expect(card).not.toContain('此区域没有可提取的文字');

    // 复制嵌入标记 stays a real button on the same asset page.
    await page.getByRole('button', { name: /向量讲义\.pdf/ }).first().click();
    await expect(canvas).toBeVisible();
    await page.getByRole('button', { name: '复制嵌入标记', exact: true }).click();
    await expect(page.getByText(/已复制/).first()).toBeVisible();

    await expect(page.getByRole('button', { name: '按页拆成卡片', exact: true })).toHaveCount(0);
    expect((await readdir(cardsDir)).length).toBe(1);
    await page.getByRole('button', { name: '图层与标注', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'PDF 图层与标注' })).toContainText('公式请对照原版阅读。');

    // The page stayed alive the whole time: no uncaught errors from the iframe
    // boot path or the reader, and no request flood from the list effect.
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
    expect(listCalls).toBeLessThan(40);
  });
});
