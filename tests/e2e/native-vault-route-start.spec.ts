import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// @ts-expect-error untyped plugin module
import { renderRoute } from '../../examples/native-vault/lesson-data.js';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

/**
 * 计划 → 路线 → 开始这节课 takes the student into that lesson: the main area
 * leaves the plan for the lesson's own views; once the student speaks, Home
 * lists the lesson, and the route's 回到这节课 comes back to the same lesson.
 */
test('starting a route lesson from the plan opens that lesson and Home lists it', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    await expect(page.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    const rail = page.getByRole('navigation', { name: '学习导航' });
    await rail.getByRole('button', { name: '计划', exact: true }).click();
    await page.getByRole('tablist', { name: '计划视图' }).getByRole('tab', { name: '路线', exact: true }).click();
    await page.getByRole('button', { name: '新建路线', exact: true }).first().click();
    const create = page.getByRole('dialog', { name: '新建路线' });
    await create.getByLabel('路线名称').fill('圆锥曲线');
    await create.getByLabel('课程名称').fill('第一课\n第二课');
    await create.getByRole('button', { name: '创建路线', exact: true }).click();
    const node = page.getByRole('button', { name: '路线节点 第一课', exact: true });
    await expect(node).toBeVisible({ timeout: 20_000 });
    await node.click();
    const pane = page.getByRole('complementary', { name: '课程详情' });
    await pane.getByRole('button', { name: '开始这节课', exact: true }).click();

    // The lesson is on screen, not hidden behind the plan.
    await expect(page.getByRole('tablist', { name: '课堂视图' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('region', { name: '路线区域' })).toBeHidden();
    await expect(page.locator('[data-composer-input]').first()).toBeVisible();

    // Once the student has said something, Home lists it (a lesson nobody has
    // spoken in yet is a native blank session, which Home leaves out), and the
    // route leads back to the same lesson.
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('我们开始吧'); await input.press('Enter');
    await expect(page.getByText('我们开始吧').first()).toBeVisible({ timeout: 20_000 });
    await rail.getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.locator('.nv-sidebar')).toContainText('第一课', { timeout: 20_000 });
    await rail.getByRole('button', { name: '计划', exact: true }).click();
    await page.getByRole('tablist', { name: '计划视图' }).getByRole('tab', { name: '路线', exact: true }).click();
    await page.getByRole('button', { name: '路线节点 第一课', exact: true }).click();
    await pane.getByRole('button', { name: '回到这节课', exact: true }).click();
    await expect(page.getByRole('tablist', { name: '课堂视图' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('route-lesson.png') });
  } finally {
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
});

test('a route the planner cannot read says so, and the other routes still show their lessons', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const routes = join(runtime.root, 'workspace', 'vault', '路线');
    await mkdir(routes, { recursive: true });
    await writeFile(join(routes, '好路线.md'), renderRoute({ title: '好路线', nodes: [{ id: 'a1', title: '第一课', materials: [] }] }));
    const broken = (renderRoute({ title: '坏路线', nodes: [{ id: 'b1', title: '坏的一课', materials: [], brief: '规划' }] }) as string).split('\n');
    broken.splice(broken.findIndex(line => /notara:route[^\n]*end|\/notara:route/.test(line)), 1);
    await writeFile(join(routes, '坏路线.md'), broken.join('\n'));
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const rail = page.getByRole('navigation', { name: '学习导航' });
    await rail.getByRole('button', { name: '计划', exact: true }).click();
    await page.getByRole('tablist', { name: '计划视图' }).getByRole('tab', { name: '路线', exact: true }).click();
    const panel = page.getByRole('region', { name: '路线列表' });
    await expect(panel.getByRole('button', { name: /坏路线.*格式有误/ })).toBeVisible({ timeout: 20_000 });
    await panel.getByRole('button', { name: /好路线/ }).click();
    await expect(page.getByRole('button', { name: '路线节点 第一课', exact: true })).toBeVisible({ timeout: 20_000 });
    await panel.getByRole('button', { name: /坏路线/ }).click();
    await expect(page.getByText('这条路线的格式有误', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '在 Vault 中打开', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('broken-route.png') });
  } finally { await runtime.stop(); }
  expect(errors).toEqual([]);
});
