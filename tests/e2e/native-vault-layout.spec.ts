import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

/**
 * Migrated to the minimal-split contract: the reader tab is gone, the file rail
 * is collapsed until 展开文件栏, the native chat keeps the only composer (hidden
 * outside its tab) and creating a page goes through the 新建页面 dialog. The
 * narrow-viewport containment checks of the pre-migration spec are unchanged.
 */
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const detailsPane = (page: Page) => page.getByRole('complementary', { name: '节点详情' });

test('keeps narrow vault views, the collapsed file rail and the 新建页面 dialog inside the native viewport', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated();
  try {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    // Expand the native sidebar to select this fresh workspace on a narrow screen.
    const sidebar = page.getByRole('button', { name: 'Open sidebar', exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await page.getByText('Notara Vault', { exact: true }).first().click();
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.fill('打开图谱'); await composer.press('Enter');

    await tab(page, '图谱').click();
    // Outside the chat tab the single composer stays mounted but hidden.
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeHidden();
    await page.getByRole('button', { name: '图谱节点 向量讲义.pdf', exact: true }).click();
    const pane = detailsPane(page);
    await expect(pane).toBeVisible();
    await expect(page.locator('.nv-graph-board')).toBeHidden();
    const layout = await pane.evaluate(element => {
      const values = [];
      for (let current: Element | null = element; current; current = current.parentElement) values.push({ tag: current.tagName, className: current.className, left: current.getBoundingClientRect().left, width: current.clientWidth, scrollWidth: current.scrollWidth, scrollLeft: current.scrollLeft, overflowX: getComputedStyle(current).overflowX });
      return values;
    });
    await testInfo.attach('layout', { body: JSON.stringify(layout), contentType: 'application/json' });
    expect(layout.filter(item => ['hidden', 'clip'].includes(item.overflowX)).every(item => item.scrollLeft === 0)).toBe(true);
    expect((await pane.boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await expect(pane.getByRole('button', { name: '带入对话拆分', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('narrow.png') });

    // The assets rail stays collapsed on a narrow screen, and the new-page
    // dialog stays inside the viewport.
    await tab(page, '资产').click();
    await expect(page.getByRole('button', { name: '展开文件栏', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新建页面', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('模板').first()).toBeVisible();
    await expect(dialog.getByLabel('页面标题')).toBeVisible();
    await expect(dialog.getByLabel('目标路径')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '创建 Markdown 页面', exact: true })).toBeVisible();
    const dialogBox = (await dialog.boundingBox())!;
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(601);
    await page.screenshot({ path: testInfo.outputPath('new-page-dialog.png') });
  } finally { await runtime.stop(); }
});
