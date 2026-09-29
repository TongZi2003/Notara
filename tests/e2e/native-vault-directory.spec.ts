import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * The learning directory from the Home panel: the picker opens a folder by its
 * path, which becomes the current directory on Home with its own (still empty)
 * lessons and learning set; that empty set can inherit another set's skill; the
 * picker's list switches back, and a switch that fails keeps the picker open
 * with the reason. A new tab never flashes 还没选学习目录 while the native
 * list is still arriving. (The steady 还没选学习目录 is not staged: with rc.2
 * the native opens a lesson in the newest directory as soon as the page loads.)
 */
const rail = (page: Page) => page.getByRole('navigation', { name: '学习导航' });
const panel = (page: Page) => page.locator('.nv-panel');
const skill = (id: string, title: string, body: string) =>
  `---\ntype: skill\nid: ${id}\ntitle: ${title}\ndescription: ${title}：本测试用的说明。\nstatus: active\n---\n${body}\n`;

test('the directory picker switches learning sets, and an empty set can inherit a skill', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectVault(runtime);
  try {
    const setRoot = join(runtime.root, 'workspace', 'vault', '技能');
    await mkdir(setRoot, { recursive: true });
    await writeFile(join(setRoot, 'conic-points.md'), skill('conic-points', '解析几何要点', '# 解析几何要点\n\n## 要点\n\n- 圆都过同一定点时，可以考虑反演。'));
    const second = join(runtime.root, '第二学习集');
    await mkdir(second);

    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }

    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });

    // The Home panel's picker opens another folder by its path.
    await panel(page).getByRole('button', { name: /^选择目录，当前：/ }).click();
    const dialog = page.getByRole('dialog', { name: '选择学习目录' });
    await dialog.getByLabel('目录路径').fill(second);
    await dialog.getByRole('button', { name: '打开目录', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: '选择目录，当前：第二学习集' })).toBeVisible({ timeout: 20_000 });
    await expect(panel(page).getByText('还没有课堂，在右边说说今天想学什么吧')).toBeVisible();
    // A directory chosen on Home stays on Home: greeting, composer and reminders.
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('今日学习')).toBeVisible();

    // 技能: the new set comes first and holds only its missing overview; it can
    // still inherit the other set's skill as its own draft.
    await rail(page).getByRole('button', { name: '技能', exact: true }).click();
    const list = page.getByRole('group', { name: '技能列表' }), view = page.locator('.nv-skill-page');
    const group = list.getByRole('region', { name: '学习集 · 第二学习集' });
    await expect(group.getByRole('button', { name: /学习集梗概/ })).toContainText('未创建', { timeout: 15_000 });
    await group.getByRole('button', { name: /学习集梗概/ }).click();
    await expect(view.getByRole('button', { name: '创建学习集梗概' })).toBeVisible();
    const inherit = view.getByLabel('为第二学习集继承技能');
    await expect(inherit.locator('option', { hasText: '解析几何要点' })).toHaveCount(1);
    await inherit.selectOption({ index: 1 });
    await view.getByRole('button', { name: '继承为草稿', exact: true }).click();
    await expect(group.getByRole('button', { name: /解析几何要点/ })).toContainText('草稿', { timeout: 15_000 });
    const inherited = await readFile(join(second, '技能', 'conic-points.md'), 'utf8');
    expect(inherited).toMatch(/^status: draft$/m);
    expect(inherited).toMatch(/^inherits:/m);

    // Back on Home, the picker's list switches to the first directory again.
    await rail(page).getByRole('button', { name: '首页', exact: true }).click();
    await panel(page).getByRole('button', { name: /^选择目录，当前：/ }).click();
    await expect(panel(page).getByRole('button', { name: '选择目录，当前：第二学习集' })).toBeVisible();
    await dialog.getByRole('button', { name: /Notara Vault/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: '选择目录，当前：Notara Vault' })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath('directory-picked.png') });

    // A switch the native cannot complete keeps the picker open and says why.
    const blocked = join(runtime.root, '打不开的学习集');
    await mkdir(blocked);
    client.value(await client.rpc('workspace/create', { request: { path: blocked } }));
    await page.route('**/api/**', async (route, request) => {
      if (/session[./]create\b/.test(`${request.url()} ${request.postData() ?? ''}`)) await route.abort('failed'); else await route.fallback();
    });
    await panel(page).getByRole('button', { name: /^选择目录，当前：/ }).click();
    await dialog.getByRole('button', { name: /打不开的学习集/ }).click();
    await expect(dialog.getByRole('alert')).toHaveText('目录没有打开，请重新选择。', { timeout: 20_000 });
    await page.unroute('**/api/**');
    await dialog.getByRole('button', { name: /Notara Vault/ }).click();
    await expect(dialog).toHaveCount(0);

    // A new tab: until the native list arrives, Home does not claim there is no directory.
    const other = await page.context().newPage();
    await other.addInitScript(() => {
      const seen = () => { if (document.body?.innerText.includes('还没选学习目录')) (window as unknown as { noDirectorySeen?: boolean }).noDirectorySeen = true; };
      new MutationObserver(seen).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await other.setViewportSize({ width: 1360, height: 900 });
    await other.goto(runtime.authUrl);
    await expect(other.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    await other.waitForTimeout(1000);
    expect(await other.evaluate(() => (window as unknown as { noDirectorySeen?: boolean }).noDirectorySeen === true)).toBe(false);
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
