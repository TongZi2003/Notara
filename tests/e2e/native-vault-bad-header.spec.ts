import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

/**
 * A Vault carried over from Obsidian: list properties written as block lists
 * read as lists, and one page whose header the Vault cannot read still leaves
 * the file tree, the cards and search working. That page opens, and saving it
 * while the header is still unreadable says so instead of blaming another editor.
 */
test('one unreadable page header does not take the Vault down, and saving it names the header', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const vault = join(runtime.root, 'workspace', 'vault');
    await writeFile(join(vault, '列表页头.md'), '---\ntype: card\ntags:\n  - 解析几何\n  - 中点弦\n---\n# 列表页头\n\n正文\n');
    await writeFile(join(vault, '坏页头.md'), '---\nlessons:\n  - id: n1\n    title: 第一课\n---\n# 坏页头\n\n正文里的独特词语\n');
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }

    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    const files = page.getByRole('group', { name: '文件列表' });
    await expect(files.getByRole('button', { name: /坏页头/ })).toBeVisible({ timeout: 20_000 });
    await expect(files.getByRole('button', { name: /列表页头/ })).toBeVisible();
    await expect(page.getByText('文件树暂时无法读取。')).toHaveCount(0);

    // The block-list tags are real tags: the card view shows the page as a card.
    await page.getByRole('tab', { name: '卡片', exact: true }).click();
    await expect(page.getByText('列表页头').first()).toBeVisible({ timeout: 20_000 });

    // The unreadable page opens; saving it with the header unchanged names the header.
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await files.getByRole('button', { name: /坏页头/ }).click();
    const editor = page.locator('.cm-content').first();
    await expect(editor).toContainText('正文里的独特词语');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('补一句');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '页头' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('页面已经被别人改过', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('bad-header.png') });
  } finally {
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await runtime.stop();
  }
  expect(errors).toEqual([]);
});
