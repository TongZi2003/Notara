import { expect, test, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
// @ts-expect-error board-runtime.js is covered by its sibling JavaScript tests.
import { boardPath } from '../../examples/native-vault/board-runtime.js';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

const ROOT_TITLE = '待删除的向量课堂';
const CHILD_TITLE = '需要同时删除的关联课堂';
const SEARCH_MARKER = 'SESSION-DELETE-SEARCH-MARKER-58B2';
const BOARD_PROMPT = `请把白板留存测试写进板书，材料标记 ${SEARCH_MARKER}。`;
const ACTIVE_PROMPT = '再检查一次删除保护。';
const railPanel = (page: Page) => page.locator('.nv-panel');
const sessionRow = (page: Page, title: string) => railPanel(page).locator('.nv-session-row').filter({ hasText: title });
const composer = (page: Page) => page.locator('[data-composer-input][contenteditable="true"]').last();

async function openVault(page: Page, runtime: VaultRuntime): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.goto(runtime.authUrl);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
}

test('永久删除要求双重确认，级联移除关联会话并在重启后保持删除，同时保留 Vault 内容', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  let runtime = await startVaultIsolated({ testModel: true });
  let client: VaultHarness | undefined = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    client.approvals.auto('allowed-once');
    await client.writeVaultFile('保留的课堂资料.md', '# 删除后仍须保留\n\n这不是课堂日志。\n');
    await client.script({
      '__session-title': ROOT_TITLE,
      [BOARD_PROMPT]: { calls: [{ name: 'write_lesson_board', arguments: { title: '留存检查', section: '材料归属', body: `这份白板属于 Vault。${SEARCH_MARKER}` } }], text: '这份白板已经记下来了。' },
      [ACTIVE_PROMPT]: { text: '保护检查已完成。', pauseMs: 4500 },
    });
    await openVault(page, runtime);
    await composer(page).fill(BOARD_PROMPT);
    await composer(page).press('Enter');
    await expect(page.getByText('这份白板已经记下来了。').first()).toBeVisible({ timeout: 45_000 });

    const main = (await client.sessions()).find(row => row.projections?.values?.title === ROOT_TITLE);
    expect(main?.sessionId).toBeTruthy();
    const rootId = main!.sessionId;
    await client.rename(rootId, ROOT_TITLE);
    const boardRelativePath = boardPath(rootId);
    await expect.poll(() => readFile(join(runtime.root, 'workspace', 'vault', boardRelativePath), 'utf8')).toContain(SEARCH_MARKER);

    const fork = client.value(await client.rpc<{ sessionId: string }>('session/fork', { request: { sessionId: rootId } }));
    const childId = fork.sessionId;
    await client.rename(childId, CHILD_TITLE);
    await expect(sessionRow(page, ROOT_TITLE)).toBeVisible({ timeout: 20_000 });
    await expect(sessionRow(page, CHILD_TITLE)).toBeVisible({ timeout: 20_000 });
    let listedIds = (await client.sessions()).map(row => row.sessionId);
    expect(listedIds).toEqual(expect.arrayContaining([rootId, childId]));

    // A live turn cannot be previewed for deletion even if a caller bypasses the disabled UI affordance.
    await composer(page).fill(ACTIVE_PROMPT);
    await composer(page).press('Enter');
    await expect.poll(async () => (await client!.sessions()).find(row => row.sessionId === rootId)?.running).toBe(true);
    const activePreview = await client.rpc('notaraSession/previewDeletion', { input: { sessionId: rootId } });
    expect(activePreview.ok).toBe(false);
    if (!activePreview.ok) expect(activePreview.error.message).toContain('session_delete_active');
    await expect(page.getByText('保护检查已完成。').first()).toBeVisible({ timeout: 20_000 });

    // Deleting the selected Session first leaves its native history observation before preview opens.
    const rootDelete = railPanel(page).getByRole('button', { name: `删除课堂：${ROOT_TITLE}` });
    await expect(rootDelete).toBeEnabled();
    await rootDelete.click();
    const dialog = page.getByRole('dialog', { name: '永久删除课堂' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(CHILD_TITLE)).toBeVisible();
    await expect(dialog.getByText(/Vault 资料、白板、路线和卡片会保留/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: '永久删除', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('deletion-confirmation.png'), fullPage: true });

    // The first dialog can be canceled without changing list or disk state.
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(sessionRow(page, ROOT_TITLE)).toBeVisible();
    listedIds = (await client.sessions()).map(row => row.sessionId);
    expect(listedIds).toEqual(expect.arrayContaining([rootId, childId]));

    await railPanel(page).getByRole('button', { name: `删除课堂：${ROOT_TITLE}` }).click();
    const confirmed = page.getByRole('dialog', { name: '永久删除课堂' });
    const titleInput = confirmed.getByLabel('输入课堂名称以确认删除');
    const acknowledge = confirmed.getByRole('checkbox');
    const remove = confirmed.getByRole('button', { name: '永久删除', exact: true });
    await titleInput.fill(`${ROOT_TITLE} `);
    await acknowledge.check();
    await expect(remove).toBeDisabled();
    await titleInput.fill(ROOT_TITLE);
    await expect(remove).toBeEnabled();
    await remove.click();
    await expect(confirmed).toHaveCount(0, { timeout: 45_000 });
    await expect(sessionRow(page, ROOT_TITLE)).toHaveCount(0);
    await expect(sessionRow(page, CHILD_TITLE)).toHaveCount(0);
    expect(await client.vaultExists('保留的课堂资料.md')).toBe(true);
    expect(await readFile(join(runtime.root, 'workspace', 'vault', boardRelativePath), 'utf8')).toContain(SEARCH_MARKER);
    let visibleIds = (await client.sessions()).map(row => row.sessionId);
    expect(visibleIds).not.toContain(rootId);
    expect(visibleIds).not.toContain(childId);
    for (const sessionId of [rootId, childId]) {
      const missingPage = await client.rpc('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: 100, maxMessages: 10 } });
      expect(missingPage.ok).toBe(false);
    }
    const runtimeEntries = await readdir(runtime.root, { recursive: true });
    const stagingEntries = runtimeEntries.filter(entry => entry.split(/[\\/]/).includes('.notara-session-deletion-staging'));
    // The private parent directory may remain empty after cleanup; no transaction or manifest may remain in it.
    expect(stagingEntries.filter(entry => !entry.endsWith('.notara-session-deletion-staging'))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('deletion-list-cleared.png'), fullPage: true });

    // The next process has fresh query and persistence caches; deleted logs do not return.
    await client.close();
    client = undefined;
    // Detach the old document before intentionally taking its server offline.
    await page.goto('about:blank');
    await runtime.restart();
    client = await connectVault(runtime);
    const afterRestart = await client.sessions();
    visibleIds = afterRestart.map(row => row.sessionId);
    expect(visibleIds).not.toContain(rootId);
    expect(visibleIds).not.toContain(childId);
    for (const sessionId of [rootId, childId]) {
      const missingPage = await client.rpc('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: 100, maxMessages: 10 } });
      expect(missingPage.ok).toBe(false);
    }
    await page.goto(runtime.authUrl);
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    await expect(sessionRow(page, ROOT_TITLE)).toHaveCount(0);
    await expect(sessionRow(page, CHILD_TITLE)).toHaveCount(0);
  } finally {
    // The native client can still be registering inspection providers after Home
    // appears. Close its document before stopping the server used by those RPCs.
    try { await page.close(); }
    finally {
      await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
      await testInfo.attach('runtime-log', { body: runtime.log(), contentType: 'text/plain' });
      try { await client?.close(); }
      finally { await runtime.stop(); }
    }
  }
  expect(errors.filter(message => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(message))).toEqual([]);
});
