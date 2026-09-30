import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

async function enter(page: Page, authUrl: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(authUrl);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await later.waitFor({ timeout: 6000 }); await later.click(); } catch { /* already acknowledged */ }
}

test('performance and usage follow their own setting with debugging off, including after reload', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await client.script({ '__session-title': '用量验收', '开始': '我们来检查用量。' });
    await enter(page, runtime.authUrl);
    await expect(page.locator('[data-composer-stats]')).toHaveCount(0);
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('开始'); await input.press('Enter');
    await expect(page.getByText('我们来检查用量。').first()).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-notara-debug', 'false');
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText(/^(General|通用设置)$/).first().click();
    const selector = page.getByText(/^(Performance & usage|性能与用量)$/).locator('..').locator('..').getByRole('button');
    await selector.click();
    await page.getByRole('menuitem', { name: /^(Detailed|详细)$/ }).click();
    await expect(selector).toHaveText(/Detailed|详细/);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-composer-stats]')).toBeVisible();
    await expect(page.locator('[data-turn-usage]')).toBeVisible();
    const usage = page.locator('[data-composer-stats]').getByRole('button').last();
    await usage.click();
    await expect(page.getByRole('dialog', { name: /^(Token usage|Token 用量)$/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.locator('[data-turn-usage]')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-notara-debug', 'false');
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText(/^(General|通用设置)$/).first().click();
    await selector.click();
    await page.getByRole('menuitem', { name: /^(Compact|简洁)$/ }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-composer-stats]')).toBeVisible();
    await expect(page.locator('[data-turn-usage]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('page-state', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'text/plain' });
    await page.screenshot({ path: testInfo.outputPath('usage.png') });
    await client.close(); await runtime.stop();
  }
});

test('the native archive action archives without another model turn and can be undone', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await client.script({ '__session-title': '归档验收', '开始': '这一课已经结束。' });
    await enter(page, runtime.authUrl);
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('开始'); await input.press('Enter');
    await expect(page.getByText('这一课已经结束。').first()).toBeVisible();
    const id = (await client.requests()).find(request => request.purpose === null)?.sessionId;
    expect(id).toBeTruthy();
    const before = (await client.turns(id!)).length;
    const row = page.locator('.nv-session-row').getByText('归档验收', { exact: true });
    await row.click();
    await expect(page.getByText('这一课已经结束。').first()).toBeVisible();
    await page.getByRole('button', { name: '管理课堂', exact: true }).click();
    const manager = page.getByRole('dialog', { name: '管理课堂', exact: true });
    const lesson = manager.getByRole('treeitem').filter({ hasText: '归档验收' });
    await lesson.hover();
    await lesson.getByRole('button', { name: /^(Archive session|归档会话)$/ }).click();
    await expect.poll(() => client.archivedSessionIds()).toContain(id);
    await expect(row).toHaveCount(0);
    expect((await client.turns(id!)).length).toBe(before);
    await page.getByRole('button', { name: /^(undo|撤销)$/ }).click();
    await expect(row).toBeVisible();
    await manager.getByRole('button', { name: '关闭', exact: true }).click();
    await row.click();
    await expect(page.getByText('这一课已经结束。').first()).toBeVisible();
    // Restore through the native list after the original toast is gone.
    await page.getByRole('button', { name: '管理课堂', exact: true }).click();
    await lesson.hover();
    await lesson.getByRole('button', { name: /^(Archive session|归档会话)$/ }).click();
    await expect.poll(() => client.archivedSessionIds()).toContain(id);
    await page.reload();
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: '管理课堂', exact: true }).click();
    await manager.getByRole('button', { name: /^(View options|视图选项)$/ }).click();
    await page.getByRole('menuitem', { name: /^(All conversations \(show archived\)|全部对话（显示已归档）)$/ }).click();
    await lesson.hover();
    await lesson.getByRole('button', { name: /^(Unarchive session|取消归档)$/ }).click();
    await expect.poll(() => client.archivedSessionIds()).not.toContain(id);
    await manager.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText('这一课已经结束。').first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('page-state', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
    await page.screenshot({ path: testInfo.outputPath('archive.png') });
    await client.close(); await runtime.stop();
  }
});

test('archiving a running lesson confirms first and keeps the native stop-and-archive behavior', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await client.script({ '__session-title': '运行中归档', '开始': '已开始。' });
    await enter(page, runtime.authUrl);
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('开始'); await input.press('Enter');
    await expect(page.getByText('已开始。').first()).toBeVisible();
    const id = (await client.requests()).find(request => request.purpose === null)?.sessionId;
    expect(id).toBeTruthy();
    // Keep one real Host turn running; the adapter is the only synthetic part.
    await client.scriptOne('继续', { text: '稍后继续。', pauseMs: 30_000 });
    await input.fill('继续'); await input.press('Enter');
    await expect.poll(async () => (await client.sessions()).find(row => row.sessionId === id)?.running).toBe(true);
    await page.getByRole('button', { name: '管理课堂', exact: true }).click();
    const manager = page.getByRole('dialog', { name: '管理课堂', exact: true });
    const lesson = manager.getByRole('treeitem').filter({ hasText: '运行中归档' });
    await lesson.hover();
    const archive = lesson.getByRole('button', { name: /^(Archive session|归档会话)$/ });
    await archive.click();
    const dialog = page.getByRole('dialog', { name: /^(Stop and archive this session\?|停止并归档此会话？)$/ });
    await expect(dialog).toBeVisible();
    expect(await client.archivedSessionIds()).not.toContain(id);
    await dialog.getByRole('button', { name: /^(Cancel|取消)$/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(lesson).toBeVisible();
    await lesson.hover();
    await archive.click();
    await dialog.getByRole('button', { name: /^(Stop and archive|停止并归档)$/ }).click();
    await expect.poll(() => client.archivedSessionIds()).toContain(id);
    await expect(lesson).toHaveCount(0);
    await expect.poll(async () => (await client.sessions()).find(row => row.sessionId === id)?.running).not.toBe(true);
    expect((await client.turns(id!)).length).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('page-state', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
    await page.screenshot({ path: testInfo.outputPath('active-archive.png') });
    await client.close(); await runtime.stop();
  }
});
