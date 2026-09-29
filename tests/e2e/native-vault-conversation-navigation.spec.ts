import { expect, test } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

// Real write receipts and file mentions, with a scripted model. No injected
// DOM/button stand-ins, and no claims about mathematical or teaching quality.
// The teacher writes Markdown through write-batch, which the native transcript
// does not record as produced files, so the produced files here are code files
// written with the native write tool (the one file kind the teacher writes that
// way). Paths outside vault/ keep the native route: see
// examples/native-vault/conversation-file-navigation.test.js.
const panelTabs = (page: import('@playwright/test').Page) => page.getByRole('tablist', { name: '资料面板视图' });
const codeEditor = (page: import('@playwright/test').Page) => page.getByRole('region', { name: /代码编辑：/ }).locator('.cm-content');

test('课内产物在资料面板打开，草稿保留，未保存的修改不被切走', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  let client: VaultHarness | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    client = await connectVault(runtime);
    client.approvals.auto('allowed-once');
    await client.script({
      '__session-title': '导航回归',
      '写两个示例程序。': { calls: [
        { name: 'write', arguments: { file_path: 'vault/代码/基底.py', content: 'print("基底")\n' } },
        { name: 'write', arguments: { file_path: 'vault/代码/坐标.py', content: 'print("坐标")\n' } },
      ], text: '已保存：`vault/代码/基底.py` 和 `vault/代码/坐标.py`。' },
    });
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.fill('写两个示例程序。'); await composer.press('Enter');
    await expect(page.getByText(/已保存：/).first()).toBeVisible({ timeout: 60_000 });
    expect(await client.vaultExists('代码/基底.py')).toBe(true);
    expect(await client.vaultExists('代码/坐标.py')).toBe(true);
    await composer.fill('保留这段未发送的课堂草稿');

    // A file mention opens the lesson's materials panel on that file.
    await page.locator('code button[title="vault/代码/基底.py"]').first().click();
    await expect(panelTabs(page).getByRole('tab', { name: '文件', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(codeEditor(page)).toContainText('基底');
    await expect(composer).toHaveText('保留这段未发送的课堂草稿');

    // The other file's mention opens it in the same panel.
    await page.locator('code button[title="vault/代码/坐标.py"]').first().click();
    await expect(codeEditor(page)).toContainText('坐标');
    await expect(composer).toHaveText('保留这段未发送的课堂草稿');

    // An unsaved edit is not switched away from.
    await codeEditor(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n# 未保存的学生笔记');
    await page.locator('code button[title="vault/代码/基底.py"]').first().click();
    await expect(page.getByText('当前页面有未保存修改，请先保存或放弃。', { exact: true })).toBeVisible();
    await expect(codeEditor(page)).toContainText('未保存的学生笔记');
    await expect(composer).toHaveCount(1);
    await expect(composer).toHaveText('保留这段未发送的课堂草稿');
    await page.screenshot({ path: testInfo.outputPath('materials-panel.png') });
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
  } finally {
    await client?.close();
    await runtime.stop();
  }
});
