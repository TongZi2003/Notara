import { expect, test, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

// Real write receipts and Markdown mentions, with a scripted model. No injected
// DOM/button stand-ins, and no claims about mathematical or teaching quality.
const tabs = (page: Page, side: '左侧分页' | '右侧分页') => page.getByRole('tablist', { name: side });
const editor = (page: Page) => page.locator('section[aria-label="资产区域"] .cm-editor > .cm-scroller > .cm-content');
const card = (title: string) => `---\ntype: card\ntags: [数学]\n---\n# ${title}\n\n## 内容\n\n求 $1+1$。\n\n## 参考理解\n\n独立求解：$2$。\n\n## 学生理解\n`;

test('真实课内产物打开资产分屏，草稿保留，后台预算可保存', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  let client: VaultHarness | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    client = await connectVault(runtime);
    client.approvals.auto('allowed-once');
    const session = await client.createSession();
    await client.ask(session, '创建两张示例卡和一个普通文件。', {
      '创建两张示例卡和一个普通文件。': {
        calls: [
          { name: 'write', arguments: { file_path: 'vault/卡片/基底卡.md', content: card('基底卡') } },
          { name: 'write', arguments: { file_path: 'vault/卡片/坐标卡.md', content: card('坐标卡') } },
          { name: 'write', arguments: { file_path: 'native.txt', content: '普通工作区文件' } },
        ],
        text: '已保存：`vault/卡片/基底卡.md`、`vault/卡片/坐标卡.md`、`native.txt`。',
      },
    });
    await client.rename(session, '导航回归');
    expect(await client.vaultExists('卡片/基底卡.md')).toBe(true);
    expect(await client.vaultExists('卡片/坐标卡.md')).toBe(true);
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    if (await later.isVisible()) await later.click();
    await page.getByText('导航回归', { exact: true }).first().click();
    const composer = page.locator('[data-composer-input][contenteditable="true"]');
    await expect(composer).toHaveCount(1);
    await composer.fill('保留这段未发送的课堂草稿');

    await page.locator('code button[title="vault/卡片/基底卡.md"]').click();
    await expect(tabs(page, '右侧分页').getByRole('tab', { name: '资产', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(editor(page)).toContainText('基底卡');
    await expect(composer).toHaveText('保留这段未发送的课堂草稿');
    await expect(page.getByRole('button', { name: '重新读取文件', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: '交换分屏', exact: true }).click();
    await page.locator('[data-produced-files-row] button[title="vault/卡片/坐标卡.md"]').click();
    await expect(tabs(page, '左侧分页').getByRole('tab', { name: '资产', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(editor(page)).toContainText('坐标卡');
    await expect(composer).toHaveText('保留这段未发送的课堂草稿');

    await editor(page).fill(`${card('坐标卡')}\n未保存的学生笔记\n`);
    await page.locator('code button[title="vault/卡片/基底卡.md"]').click();
    await expect(page.getByText('当前页面有未保存修改，请先保存或放弃。', { exact: true })).toBeVisible();
    await expect(editor(page)).toContainText('未保存的学生笔记');
    await expect(composer).toHaveCount(1);

    await page.locator('code button[title="native.txt"]').click();
    await expect(page.getByRole('button', { name: '重新读取文件', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click();
    await tabs(page, '左侧分页').getByRole('tab', { name: '教室', exact: true }).click();
    await page.getByRole('button', { name: '教室设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '教室设置' });
    await expect(settings.getByLabel('每次分析的生成上限')).toHaveValue('32768');
    await settings.getByLabel('每次分析的生成上限').fill('49152');
    await settings.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('已保存，下一次后台分析会用这个模型。').first()).toBeVisible();
    const saved = client.value(await client.rpc<{ solver: { route: { maxTokens: number } } }>('notaraVault/classroom', { input: { sessionId: session } }));
    expect(saved.solver.route.maxTokens).toBe(49152);
    await page.screenshot({ path: testInfo.outputPath('assets-routing-and-budget.png') });
    expect(errors).toEqual([]);
  } finally {
    await client?.close();
    await runtime.stop();
  }
});
