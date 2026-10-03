import { expect, test, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

const composer = (page: Page) => page.locator('[data-composer-input][contenteditable="true"]').last();
const row = (page: Page, title: string) => page.locator('.nv-panel .nv-session-row').filter({ has: page.getByText(title, { exact: true }) });
const trigger = (page: Page, title: string) => page.getByRole('button', { name: `对话操作：${title}`, exact: true });
const menu = (page: Page) => page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: '删除对话', exact: true }) });
const current = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('notara-vault-view') ?? 'null')?.sessionId as string | undefined);

async function enter(page: Page, authUrl: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(authUrl);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await later.waitFor({ timeout: 6000 }); await later.click(); } catch { /* already acknowledged */ }
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
}

async function pick(page: Page, title: string, action: string) {
  await trigger(page, title).click();
  await menu(page).getByRole('menuitem', { name: action, exact: true }).click();
}

async function nameInHost(client: VaultHarness, id: string) {
  return (await client.sessions()).find(item => item.sessionId === id)?.projections?.values?.title;
}

test('对话三点菜单重命名同步原生标题并保留草稿，归档可撤销，菜单在列表底部和窄屏内可操作', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await client.script({ '__session-title': '改名前的课堂', '开始菜单验收': '菜单验收课堂已开始。' });
    await enter(page, runtime.authUrl);
    await composer(page).fill('开始菜单验收'); await composer(page).press('Enter');
    await expect(page.getByText('菜单验收课堂已开始。', { exact: true }).first()).toBeVisible();
    const mainId = (await client.sessions()).find(item => item.projections?.values?.title === '改名前的课堂')!.sessionId;
    await expect.poll(async () => (await client.sessions()).find(item => item.sessionId === mainId)?.running).toBe(false);
    await expect(row(page, '改名前的课堂')).toBeVisible();
    await composer(page).fill('这段草稿在改名和归档操作中保留');
    const beforeTurns = (await client.turns(mainId)).length;

    // Real keyboard navigation reaches the visible menu and returns its focus.
    await trigger(page, '改名前的课堂').focus(); await page.keyboard.press('ArrowDown');
    await expect(menu(page).getByRole('menuitem', { name: '重命名', exact: true })).toBeFocused();
    await expect(menu(page).getByRole('menuitem', { name: '删除对话', exact: true })).toBeEnabled();
    await page.keyboard.press('End'); await expect(menu(page).getByRole('menuitem', { name: '删除对话', exact: true })).toBeFocused();
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
    await expect(menu(page).getByRole('menuitem', { name: '归档对话', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(menu(page)).toHaveCount(0);
    await expect(trigger(page, '改名前的课堂')).toBeFocused();

    await pick(page, '改名前的课堂', '重命名');
    const rename = page.getByRole('dialog', { name: '重命名对话', exact: true }), name = rename.getByLabel('对话名称');
    await expect(name).toHaveValue('改名前的课堂');
    await name.fill('   '); await expect(rename.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await name.fill('中文改名验收');
    await name.dispatchEvent('compositionstart');
    await name.press('Enter');
    await expect(rename).toBeVisible(); expect(await nameInHost(client, mainId)).toBe('改名前的课堂');
    await name.dispatchEvent('compositionend'); await name.press('Enter');
    await expect(rename).toHaveCount(0);
    await expect(row(page, '中文改名验收')).toBeVisible();
    await expect(page.locator('.nv-class-native')).toContainText('中文改名验收');
    await expect(composer(page)).toHaveText('这段草稿在改名和归档操作中保留');
    expect(await current(page)).toBe(mainId);
    await page.reload();
    await expect(page.locator('.nv-class-native')).toContainText('中文改名验收');
    await expect(row(page, '中文改名验收')).toBeVisible();
    await expect(composer(page)).toHaveText('这段草稿在改名和归档操作中保留');

    // A native fork is a second, durable classroom in this directory.
    const fork = client.value(await client.rpc<{ sessionId: string }>('session/fork', { request: { sessionId: mainId } }));
    await client.rename(fork.sessionId, '后台课堂');
    await expect(row(page, '后台课堂')).toBeVisible();
    await pick(page, '后台课堂', '重命名');
    await name.fill('\u0000'); await rename.getByRole('button', { name: '保存', exact: true }).click();
    await expect(rename.getByRole('alert')).toContainText('请输入有效的对话名称');
    await expect(name).toHaveValue('\u0000');
    expect(await nameInHost(client, fork.sessionId)).toBe('后台课堂');
    await name.fill('后台课堂重新命名'); await rename.getByRole('button', { name: '保存', exact: true }).click();
    await expect(rename).toHaveCount(0); await expect(row(page, '后台课堂重新命名')).toBeVisible();
    expect(await current(page)).toBe(mainId);
    await expect(page.locator('.nv-class-native')).toContainText('中文改名验收');

    await pick(page, '后台课堂重新命名', '归档对话');
    await expect.poll(() => client.archivedSessionIds()).toContain(fork.sessionId);
    await expect(row(page, '后台课堂重新命名')).toHaveCount(0);
    expect(await current(page)).toBe(mainId);
    await expect(composer(page)).toHaveText('这段草稿在改名和归档操作中保留');
    await page.getByRole('button', { name: '撤销归档', exact: true }).click();
    await expect(row(page, '后台课堂重新命名')).toBeVisible();
    expect(await client.archivedSessionIds()).not.toContain(fork.sessionId);

    await pick(page, '中文改名验收', '归档对话');
    await expect.poll(() => client.archivedSessionIds()).toContain(mainId);
    await expect(row(page, '中文改名验收')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible();
    await expect(composer(page)).toBeVisible();
    await page.getByRole('button', { name: '撤销归档', exact: true }).click();
    await expect(row(page, '中文改名验收')).toBeVisible();
    await row(page, '中文改名验收').click();
    await expect(composer(page)).toHaveText('这段草稿在改名和归档操作中保留');
    expect((await client.turns(mainId)).length).toBe(beforeTurns);

    for (let index = 0; index < 14; index++) {
      const sibling = client.value(await client.rpc<{ sessionId: string }>('session/fork', { request: { sessionId: mainId } }));
      await client.rename(sibling.sessionId, `长列表课堂 ${index + 1}`);
    }
    for (const viewport of [{ width: 1440, height: 600 }, { width: 390, height: 650 }]) {
      await page.setViewportSize(viewport);
      const expand = page.getByRole('button', { name: '展开面板', exact: true });
      if (viewport.width < 1024) await expect(expand).toBeVisible();
      if (await expand.isVisible()) await expand.click();
      await expect(page.locator('.nv-panel-scroll .nv-session-row')).toHaveCount(16);
      await page.locator('.nv-panel-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
      const bottomTrigger = page.locator('.nv-panel-scroll .nv-session-actions button').last();
      await bottomTrigger.click();
      await expect(menu(page)).toBeVisible();
      const geometry = await menu(page).evaluate(element => {
        const box = element.getBoundingClientRect(), button = element.querySelector('button')!, point = button.getBoundingClientRect();
        return { inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, reachable: button.contains(document.elementFromPoint(point.x + point.width / 2, point.y + point.height / 2)) };
      });
      expect(geometry).toEqual({ inside: true, reachable: true });
      await page.screenshot({ path: testInfo.outputPath(`session-menu-${viewport.width}.png`) });
      await page.keyboard.press('Escape'); await expect(bottomTrigger).toBeFocused();
      await bottomTrigger.click(); await page.getByRole('heading', { name: '课堂', exact: true }).click();
      await expect(menu(page)).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } catch (error) {
    await testInfo.attach('failure-state', { body: JSON.stringify(await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], view: sessionStorage.getItem('notara-vault-view'), html: document.body.outerHTML }))), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('failure.png') });
    throw error;
  } finally {
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await page.close(); await client.close(); await runtime.stop();
  }
});

test('三点菜单归档运行中的对话需确认，取消不停止，确认后可恢复记录', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await client.script({ '__session-title': '归档运行确认', '开始': '这节课已开始。', '继续运行': { text: '稍后继续。', pauseMs: 60_000 } });
    await enter(page, runtime.authUrl);
    await composer(page).fill('开始'); await composer(page).press('Enter');
    await expect(page.getByText('这节课已开始。', { exact: true }).first()).toBeVisible();
    const id = (await client.sessions()).find(item => item.projections?.values?.title === '归档运行确认')!.sessionId;
    await composer(page).fill('继续运行'); await composer(page).press('Enter');
    await expect.poll(async () => (await client.sessions()).find(item => item.sessionId === id)?.running).toBe(true);
    await trigger(page, '归档运行确认').click();
    await expect(menu(page).getByRole('menuitem', { name: '删除对话', exact: true })).toBeDisabled();
    await expect(menu(page).getByRole('menuitem', { name: '重命名', exact: true })).toBeEnabled();
    await menu(page).getByRole('menuitem', { name: '归档对话', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '停止并归档对话？', exact: true });
    await expect(confirmation).toBeVisible();
    expect(await client.archivedSessionIds()).not.toContain(id);
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect((await client.sessions()).find(item => item.sessionId === id)?.running).toBe(true);
    await expect(row(page, '归档运行确认')).toBeVisible();
    await pick(page, '归档运行确认', '归档对话');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: '停止并归档', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect.poll(() => client.archivedSessionIds()).toContain(id);
    await expect.poll(async () => (await client.sessions()).find(item => item.sessionId === id)?.running).toBe(false);
    await page.getByRole('button', { name: '撤销归档', exact: true }).click();
    await expect(row(page, '归档运行确认')).toBeVisible();
    await row(page, '归档运行确认').click();
    await expect(page.getByText('这节课已开始。', { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await page.close(); await client.close(); await runtime.stop();
  }
});
