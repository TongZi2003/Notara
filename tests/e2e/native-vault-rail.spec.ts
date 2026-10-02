import { test, expect, type Page, type Route } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * The icon rail: 首页 / 计划 / Vault with their panels, the main area following
 * the panel, folding (by hand, for the board, on a narrow screen), the reload
 * coming back to the same section, and the empty states pointing back to the
 * conversation — in both looks.
 */
const rail = (page: Page) => page.getByRole('navigation', { name: '学习导航' });
const panel = (page: Page) => page.locator('.nv-panel');
const lessonTab = (page: Page, name: string) => page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name, exact: true });
const planTab = (page: Page, name: string) => page.getByRole('tablist', { name: '计划视图' }).getByRole('tab', { name, exact: true });
const vaultTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Vault 视图' }).getByRole('tab', { name, exact: true });
const composer = (page: Page) => page.locator('[data-composer-input][contenteditable="true"]').last();
/** Make one Vault read fail (or wait) in the browser, matching the method in the URL or the body. */
const vaultCall = (page: Page, method: string, answer: (route: Route) => Promise<void>) => page.route('**/api/**', async (route, request) => {
  if (new RegExp(`notaraVault[./]${method}\\b`).test(`${request.url()} ${request.postData() ?? ''}`)) await answer(route); else await route.fallback();
});

test('the rail switches sections, folds for the board and narrow screens, and comes back after a reload', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectVault(runtime);
  try {
    client.approvals.auto('allowed-once');
    await client.script({
      '__session-title': '导航栏验收',
      '上板': { calls: [{ name: 'write_lesson_board', arguments: { title: '先想一想', section: '第1题', body: '先想一想怎么分类。' } }], text: '白板上放好了。' },
    });
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }

    // 首页: the rail, the 课堂 panel, the greeting, the composer and the rotating reminders.
    for (const name of ['首页', '计划', 'Vault']) await expect(rail(page).getByRole('button', { name, exact: true })).toBeVisible();
    await expect(rail(page).getByRole('button', { name: '首页', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(panel(page).getByRole('heading', { name: '课堂' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('今日学习')).toBeVisible();

    // A lesson appears under 今天 and is highlighted; 首页 goes back to Home's own composer.
    await composer(page).fill('上板'); await composer(page).press('Enter');
    const reply = page.getByText('白板上放好了。').first();
    for (let round = 0; round < 40 && !(await reply.isVisible()); round++) {
      const allow = page.getByRole('button', { name: 'Allow once', exact: true });
      if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(500);
    }
    await expect(reply).toBeVisible({ timeout: 30_000 });
    const lessonRow = panel(page).getByRole('region', { name: '今天' }).getByRole('button', { name: /^导航栏验收/ });
    await expect(lessonRow).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
    await rail(page).getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    // A draft already in Home's composer stays when 去对话里规划 adds its sentence later.
    await composer(page).fill('先说一句');
    // Panel search: lessons by title.
    await panel(page).getByRole('button', { name: '搜索', exact: true }).click();
    await panel(page).getByLabel('搜索课堂').fill('导航栏');
    await expect(panel(page).getByRole('button', { name: /^导航栏验收/ })).toBeVisible();
    await panel(page).getByLabel('搜索课堂').fill('没有这节课的名字');
    await expect(panel(page).getByText('没有找到这节课')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page).getByLabel('搜索课堂')).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: /^导航栏验收/ })).toBeVisible();

    // 计划: 日历 first; 定时任务 is a placeholder with nothing to press.
    await rail(page).getByRole('button', { name: '计划', exact: true }).click();
    await expect(planTab(page, '日历')).toHaveAttribute('aria-selected', 'true');
    await planTab(page, '定时任务').click();
    const scheduled = page.getByRole('region', { name: '定时任务区域' });
    await expect(scheduled.getByText('还在准备中，暂时还不能用')).toBeVisible();
    await expect(scheduled.getByRole('button')).toHaveCount(0);
    // 路线 that cannot be read says so and offers 重试, never "no routes yet".
    await vaultCall(page, 'routes', route => route.abort('failed'));
    await planTab(page, '路线').click();
    const routeArea = page.getByRole('region', { name: '路线区域' });
    await expect(routeArea.getByRole('alert').getByText('暂时无法读取学习路线')).toBeVisible({ timeout: 15_000 });
    await expect(routeArea.locator('.nv-empty')).toHaveCount(0);
    await expect(routeArea.getByText('这条路线还没有课程')).toHaveCount(0);
    await page.unroute('**/api/**');
    await routeArea.getByRole('button', { name: '重试', exact: true }).click();
    // 路线: the panel lists the seeded route; with none left, the page sends the student to the conversation.
    await expect(panel(page).getByRole('button', { name: /向量学习路线/ })).toBeVisible({ timeout: 20_000 });
    await expect(panel(page).getByRole('button', { name: /向量学习路线/ })).toHaveAttribute('aria-current', 'page');
    await rm(join(runtime.root, 'workspace/vault/路线/向量路线.md'));
    await planTab(page, '日历').click(); await planTab(page, '路线').click();
    await page.evaluate(() => window.dispatchEvent(new Event('notara-vault-changed')));
    const empty = page.getByRole('region', { name: '路线区域' });
    await expect(empty.locator('.nv-empty').getByText('还没有学习路线')).toBeVisible({ timeout: 20_000 });
    await empty.getByRole('button', { name: '去对话里规划', exact: true }).click();
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    await expect(composer(page)).toContainText('帮我规划一条学习路线', { timeout: 15_000 });
    await expect(composer(page)).toContainText('先说一句');
    await page.waitForTimeout(1500);
    // Not sent: Home still shows its greeting instead of moving into a lesson.
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible();
    await composer(page).fill('');

    // Vault: a list that cannot be read says so instead of "the library is empty", and 重试 reads it again.
    let releaseList = () => {};
    const listHeld = new Promise<void>(resolve => { releaseList = resolve; });
    await vaultCall(page, 'list', async route => { await listHeld; await route.abort('failed'); });
    await rail(page).getByRole('button', { name: 'Vault', exact: true }).click();
    await expect(vaultTab(page, '文件')).toHaveAttribute('aria-selected', 'true');
    const library = page.locator('.nv-assets').first();
    await expect(library.getByText('正在读取…').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('资料库还是空的')).toHaveCount(0);
    releaseList();
    await expect(library.getByRole('alert').getByText('文件列表暂时读不出来')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('资料库还是空的')).toHaveCount(0);
    await page.unroute('**/api/**');
    await library.getByRole('button', { name: '重试', exact: true }).click();
    // Vault: the panel tree opens a file; with unsaved edits another file is refused.
    const files = page.getByRole('group', { name: '文件列表' });
    await expect(files.getByRole('button', { name: '向量.md', exact: true })).toBeVisible({ timeout: 20_000 });
    await files.getByRole('button', { name: '向量.md', exact: true }).click();
    const editor = page.locator('.nv-assets .cm-content').first();
    await expect(editor).toContainText('向量', { timeout: 15_000 });
    await editor.click(); await page.keyboard.type('改');
    await files.getByRole('button', { name: /^[0-9a-f]{8,}.*\.md$/ }).first().click();
    await expect(page.getByText('当前页面有未保存修改，请先保存或放弃。').first()).toBeVisible();
    await expect(page.locator('.nv-breadcrumb').first()).toHaveText('知识/向量.md');
    await page.getByRole('button', { name: '文件操作' }).click();
    await page.getByRole('menuitem', { name: '放弃修改' }).click();
    // Panel search: titles, text and paths, opened from the results.
    await panel(page).getByRole('button', { name: '搜索', exact: true }).click();
    await panel(page).getByLabel('搜索文件').fill('基底');
    const hit = panel(page).getByRole('group', { name: '搜索结果' }).getByRole('button', { name: /知识\/向量\.md/ });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await expect(files).toHaveCount(0);
    await hit.click();
    await expect(page.locator('.nv-breadcrumb').first()).toHaveText('知识/向量.md');
    await panel(page).getByRole('button', { name: '搜索', exact: true }).click();
    await expect(files).toBeVisible();
    // The page no longer keeps its own search beside the panel.
    await expect(page.locator('.nv-assets').getByRole('button', { name: '搜索文件', exact: true })).toHaveCount(0);

    // Folding by hand: only the rail stays; the current icon unfolds it again.
    await rail(page).getByRole('button', { name: '收起面板', exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(rail(page)).toBeVisible();
    await rail(page).getByRole('button', { name: 'Vault', exact: true }).click();
    await expect(panel(page)).toBeVisible();

    // The board folds the panel; back on 对话 it returns.
    await rail(page).getByRole('button', { name: '首页', exact: true }).click();
    await panel(page).getByRole('button', { name: /^导航栏验收/ }).click();
    await lessonTab(page, '白板').click();
    await expect(panel(page)).toHaveCount(0);
    await lessonTab(page, '对话').click();
    await expect(panel(page)).toBeVisible();
    // From a lesson with the panel folded, 首页 goes Home; a second press unfolds the panel.
    await rail(page).getByRole('button', { name: '收起面板', exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await rail(page).getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    await expect(panel(page)).toHaveCount(0);
    await rail(page).getByRole('button', { name: '首页', exact: true }).click();
    await expect(panel(page)).toBeVisible();

    // A reload comes back to 计划 → 复习.
    await rail(page).getByRole('button', { name: '计划', exact: true }).click();
    await planTab(page, '复习').click();
    await page.reload();
    await expect(planTab(page, '复习')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('rail-minimal.png') });
    // 技能: the fourth section; its panel search filters every group.
    await rail(page).getByRole('button', { name: '技能', exact: true }).click();
    await panel(page).getByRole('button', { name: '搜索', exact: true }).click();
    await panel(page).getByLabel('搜索技能').fill('板书');
    await expect(panel(page).getByRole('button', { name: '板书', exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: '苏格拉底', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await rail(page).getByRole('button', { name: '计划', exact: true }).click();

    // Narrow: the panel starts folded, covers the page when opened, and folds after a choice.
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(panel(page)).toHaveCount(0);
    await rail(page).getByRole('button', { name: '展开面板', exact: true }).click();
    await expect(panel(page)).toBeVisible();
    await planTab(page, '日历').click();
    await expect(panel(page)).toHaveCount(0);
    // A lesson, a file and the file menu chosen in the panel fold it as well.
    await rail(page).getByRole('button', { name: '首页', exact: true }).click();
    await rail(page).getByRole('button', { name: '首页', exact: true }).click();
    await panel(page).getByRole('button', { name: /^导航栏验收/ }).click();
    await expect(panel(page)).toHaveCount(0);
    await rail(page).getByRole('button', { name: 'Vault', exact: true }).click();
    await rail(page).getByRole('button', { name: 'Vault', exact: true }).click();
    await files.getByRole('button', { name: '向量.md', exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await rail(page).getByRole('button', { name: '展开面板', exact: true }).click();
    await files.getByRole('button', { name: '向量.md', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '在图谱中查看', exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await rail(page).getByRole('button', { name: '计划', exact: true }).click();

    // 极简 in dark, then 手帐: the same rail and panels in the other look, light and dark.
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath('rail-minimal-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => localStorage.setItem('notara.vault.appearance', 'notebook'));
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook', { timeout: 30_000 });
    await expect(rail(page).getByRole('button', { name: '计划', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(planTab(page, '日历')).toHaveAttribute('aria-selected', 'true');
    expect(await page.locator('.nv-rail').evaluate(node => getComputedStyle(node).backgroundImage)).toContain('radial-gradient');
    await planTab(page, '定时任务').click();
    await expect(page.getByRole('region', { name: '定时任务区域' }).getByText('还在准备中，暂时还不能用')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('rail-notebook.png') });
    await rail(page).getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    await expect(panel(page).getByRole('heading', { name: '课堂' })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: /^导航栏验收/ })).toBeVisible();
    await rail(page).getByRole('button', { name: '计划', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath('rail-notebook-dark.png') });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
