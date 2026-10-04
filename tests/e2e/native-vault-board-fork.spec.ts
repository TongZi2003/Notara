import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

const composer = (page: Page) => page.locator('[data-composer-input][contenteditable="true"]').last();
const tabs = (page: Page) => page.getByRole('tablist', { name: '课堂视图', exact: true });
const current = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('notara-vault-view') ?? 'null')?.sessionId as string | undefined);
interface BoardValue { revision: string; sections: unknown[]; blocks: Array<{ id: string; title: string; body: string; x?: number; y?: number; width?: number; height?: number }> }

test('the native message branch inherits visible board content and keeps later classroom updates independent', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const readBoard = async (sessionId: string) => client.value(await client.rpc<BoardValue>('notaraVault/board', { input: { sessionId } }));
  try {
    client.approvals.auto('rejected');
    await client.script({ '__session-title': '白板分支验收', '建立白板': { calls: [
      { name: 'write_lesson_board', arguments: { title: '遗传推导', section: '分支前的板书', body: '设正常基因为 $A$，致病基因为 $a$。保留已讨论的条件。' } },
      { name: 'write_lesson_board', arguments: { title: '判断方向', body: '```choice\n判断方向\n- 正\n- 负\n```' } },
    ], text: '这两块板书应进入新分支。' }, '继续分支': { calls: [{ name: 'write_lesson_board', arguments: { title: '遗传推导', body: '新分支独立增加一个假设。' } }], text: '已在新分支继续学习。' } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 5000 }); await later.click(); } catch { /* configured synthetic model */ }
    await expect(composer(page)).toBeVisible({ timeout: 30_000 });
    await composer(page).fill('建立白板'); await composer(page).press('Enter');
    await expect(page.getByText('这两块板书应进入新分支。', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const parent = (await current(page))!;
    await expect.poll(async () => (await client.sessions()).find(row => row.sessionId === parent)?.running).toBe(false);
    let original = await readBoard(parent);
    original = client.value(await client.rpc<BoardValue>('notaraVault/mutateBoard', { input: { sessionId: parent, expectedRevision: original.revision, blockId: original.blocks[0]!.id, patch: { x: 30, y: 50, width: 420, height: 350 } } }));
    await tabs(page).getByRole('tab', { name: '白板', exact: true }).click();
    await expect(page.locator('.nb-board .nb-block')).toHaveCount(2);
    await expect(page.locator('.nb-board')).toContainText('保留已讨论的条件');
    await page.screenshot({ path: testInfo.outputPath('parent-board.png') });
    await tabs(page).getByRole('tab', { name: '对话', exact: true }).click();
    const branch = page.getByRole('button', { name: /^(在新对话中分支|Branch into a new conversation)$/ }).last();
    await expect(branch).toBeEnabled(); await branch.click();
    await expect.poll(() => current(page)).not.toBe(parent);
    const child = (await current(page))!;
    expect(child).toBeTruthy();
    await client.rename(child, '继承白板的新分支');
    await tabs(page).getByRole('tab', { name: '白板', exact: true }).click();
    await expect(page.locator('.nb-board .nb-block')).toHaveCount(2);
    await expect(page.locator('.nb-board')).toContainText('保留已讨论的条件');
    await expect(page.locator('.nb-board .nb-q[data-type=choice]')).toBeVisible();
    expect((await readBoard(child)).blocks).toEqual(original.blocks);
    expect((await readBoard(child)).sections).toEqual(original.sections);
    await page.screenshot({ path: testInfo.outputPath('fork-board.png') });
    await page.reload();
    await expect(page.locator('.nb-board')).toContainText('保留已讨论的条件', { timeout: 30_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.nb-board .nb-reading')).toBeVisible();
    await expect(page.locator('.nb-board')).toContainText('判断方向');
    await page.screenshot({ path: testInfo.outputPath('fork-board-phone.png') });
    await tabs(page).getByRole('tab', { name: '对话', exact: true }).click();
    await composer(page).fill('继续分支'); await composer(page).press('Enter');
    await expect(page.getByText('已在新分支继续学习。', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await readBoard(child)).blocks[0]!.body).toBe('新分支独立增加一个假设。');
    expect((await readBoard(parent)).blocks).toEqual(original.blocks);
    const changed = await readBoard(child);
    await page.goto('about:blank');
    await client.close(); await runtime.restart();
    await page.goto(runtime.authUrl);
    await expect(composer(page)).toBeVisible({ timeout: 30_000 });
    const expand = page.getByRole('button', { name: '展开面板', exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.locator('.nv-panel .nv-session-row').filter({ has: page.getByText('继承白板的新分支', { exact: true }) }).click();
    await expect(tabs(page)).toBeVisible({ timeout: 30_000 });
    await tabs(page).getByRole('tab', { name: '白板', exact: true }).click();
    await expect(page.locator('.nb-board')).toContainText('新分支独立增加一个假设');
    const fresh = await connectVault(runtime);
    try { expect((fresh.value(await fresh.rpc<BoardValue>('notaraVault/board', { input: { sessionId: child } }))).blocks).toEqual(changed.blocks); }
    finally { await fresh.close(); }
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('fork-board-restarted.png') });
  } finally { await client.close(); await runtime.stop(); }
});
