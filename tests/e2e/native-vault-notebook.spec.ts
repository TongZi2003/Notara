import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
// @ts-expect-error untyped plugin module
import { civilDay } from '../../examples/native-vault/calendar-data.js';
// @ts-expect-error untyped plugin module
import { renderRoute } from '../../examples/native-vault/lesson-data.js';

/**
 * 手帐 over the same Native Vault: chosen in 设置 → 学习界面, applied live, kept
 * per browser, and fully undone by switching back. The handwriting face is
 * fetched from the Host route only once the notebook is chosen.
 */
const NOTE = 'rgb(255, 243, 191)', PAPER = 'rgb(251, 247, 238)', SEAL = 'rgb(192, 57, 43)';
const style = (page: Page, selector: string, property: string, pseudo?: string) =>
  page.locator(selector).first().evaluate((element, [name, before]) => getComputedStyle(element, before || null).getPropertyValue(name), [property, pseudo ?? ''] as const);

async function seed(vault: string) {
  const write = async (path: string, content: string) => { await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), content); };
  const today = civilDay(new Date());
  await write('卡片/中点弦的斜率.md', `---\ntype: card\ntags: [数学]\nlearned: true\nmastery: 2\ninterval: 3\nlast_review: ${today}\nnext_review: ${today}\n---\n# 中点弦的斜率\n\n## 内容\n\n椭圆上弦的中点已知，求弦的斜率。\n`);
  await write('卡片/椭圆的定义.md', '---\ntype: card\ntags: [数学]\n---\n# 椭圆的定义\n\n## 内容\n\n为什么距离和要大于焦距？\n');
  await write('路线/圆锥曲线.md', renderRoute({ title: '圆锥曲线', nodes: [
    { id: 'n1', title: '椭圆的定义', materials: [], stage: '定义' },
    { id: 'n2', title: '中点弦', parent: 'n1', materials: [], stage: '弦与斜率' },
  ] }));
}

test('the notebook look is chosen in settings, loads its face on demand and switches back cleanly', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [], fontRequests: Array<{ url: string; status: number }> = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.url().includes('/notara/vault/fonts/')) fontRequests.push({ url: new URL(response.url()).pathname, status: response.status() }); });
  try {
    await seed(join(runtime.root, 'workspace/vault'));
    const trigger = '椭圆中点弦的斜率怎么求？';
    await writeFile(join(runtime.root, 'teacher-replies.json'), `${JSON.stringify({ [trigger]: '把两个端点代入椭圆方程，再把两式**相减**。\n\n- 和对应中点\n- 差的比对应斜率\n\n你先试试看？' })}\n`);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }

    // The minimal theme is the default and never asks for the notebook face.
    await expect(page.locator('.nv-home')).toBeVisible();
    await expect(page.locator('body')).not.toHaveAttribute('data-notara-style', /.*/);
    await page.waitForTimeout(800);
    expect(fontRequests).toEqual([]);

    // 设置 → 学习界面 → 外观 · 手帐, live.
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText('学习界面', { exact: true }).first().click();
    await expect(page.getByRole('radio', { name: /^极简/ })).toBeChecked();
    await page.getByRole('radio', { name: /^手帐/ }).check();
    await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook');
    await expect(page.locator('style[data-notara-theme=notebook]')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('notara.vault.appearance'))).toBe('notebook');
    expect(await page.evaluate(async () => { await document.fonts.load('16px "Notara WenKai"'); return document.fonts.check('16px "Notara WenKai"'); })).toBe(true);
    await expect.poll(() => fontRequests).toContainEqual({ url: '/notara/vault/fonts/wenkai.woff2', status: 200 });
    await page.screenshot({ path: testInfo.outputPath('notebook-settings.png') });
    await page.keyboard.press('Escape');

    // 侧栏与首页：装订孔、便签、波浪线、手写字体。
    expect(await style(page, '.nv-sidebar', 'font-family')).toMatch(/^"Notara WenKai"/);
    expect(await style(page, '.nv-sidebar', 'background-image')).toContain('radial-gradient');
    expect(await style(page, '.nv-new-lesson', 'background-color')).toBe(NOTE);
    expect(await style(page, '.nv-home-welcome h1', 'text-decoration-style')).toBe('wavy');
    expect(await style(page, '.nv-today', 'background-color')).toBe(PAPER);
    await page.screenshot({ path: testInfo.outputPath('notebook-home.png') });

    // 课堂：学生便签，老师的回复写在 32px 横线上，页边有红线。
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill(trigger); await input.press('Enter');
    await expect(page.locator('.hWmORq_body').last()).toContainText('差的比对应斜率', { timeout: 30_000 });
    expect(await style(page, '.Sixlwa_bubble', 'background-color')).toBe(NOTE);
    expect(await style(page, '.Sixlwa_bubble', 'transform')).not.toBe('none');
    expect(await style(page, '.hWmORq_body p', 'line-height')).toBe('32px');
    expect(await style(page, '.hWmORq_body p', 'background-image')).toContain('linear-gradient');
    expect(await style(page, '[data-conversation-scroll]', 'background-image')).toContain('linear-gradient');
    await page.screenshot({ path: testInfo.outputPath('notebook-lesson.png') });
    const classViews = page.getByRole('tablist', { name: '课堂视图' });
    await classViews.getByRole('tab', { name: '白板', exact: true }).click();
    expect(await style(page, '.nb-board', 'background-color')).toBe(PAPER);
    await classViews.getByRole('tab', { name: '对话', exact: true }).click();

    // 资料库：索引卡、纸上的森林。
    await page.getByRole('button', { name: '资料库', exact: true }).click();
    await page.getByRole('tab', { name: '卡片', exact: true }).click();
    await expect(page.locator('.nv-card').first()).toBeVisible();
    expect(await style(page, '.nv-card', 'border-top-color')).toBe('rgb(240, 194, 187)');
    await page.getByRole('tab', { name: '图谱', exact: true }).click();
    await page.getByRole('group', { name: '图谱视图' }).getByRole('button', { name: '森林', exact: true }).click();
    await expect(page.getByRole('group', { name: '知识森林' })).toBeVisible();
    expect(await style(page, '.nv-star-board[data-sky=forest]', 'background-color')).toBe(PAPER);

    // 计划：日历里的今天用红笔圈出。
    await page.getByRole('button', { name: '计划', exact: true }).click();
    await page.getByRole('tab', { name: '日历', exact: true }).click();
    await expect(page.locator('.nv-month-day[aria-current=date]')).toBeVisible();
    expect(await style(page, '.nv-month-day[aria-current=date]', 'border-top-color', '::before')).toBe(SEAL);
    await page.screenshot({ path: testInfo.outputPath('notebook-calendar.png') });

    // Dark keeps the notebook, with its own paper; the board stays a light sheet.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', /.*/);
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect.poll(() => style(page, '.nv-today', 'background-color')).toBe('rgb(35, 33, 28)');
    expect(await style(page, '.nv-new-lesson', 'background-color')).toBe('rgb(74, 65, 40)');
    await page.screenshot({ path: testInfo.outputPath('notebook-home-dark.png') });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    expect(await style(page, '.nv-new-lesson', 'transition-duration')).toBe('0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // 801px stays within the viewport.
    await page.setViewportSize({ width: 801, height: 900 });
    await page.getByRole('button', { name: '资料库', exact: true }).click();
    await page.getByRole('tab', { name: '卡片', exact: true }).click();
    const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('notebook-801.png') });
    await page.setViewportSize({ width: 1360, height: 900 });

    // The choice survives a reload in this browser.
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook');

    // Switching back restores the minimal theme completely.
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText('学习界面', { exact: true }).first().click();
    await page.getByRole('radio', { name: /^极简/ }).check();
    await expect(page.locator('body')).not.toHaveAttribute('data-notara-style', /.*/);
    await expect(page.locator('style[data-notara-theme=notebook]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('notara.vault.appearance'))).toBe('minimal');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect.poll(() => style(page, '.nv-today', 'background-color')).not.toBe(PAPER);
    expect(await style(page, '.nv-new-lesson', 'background-color')).not.toBe(NOTE);
    expect(await style(page, '.nv-sidebar', 'font-family')).not.toContain('Notara WenKai');
    await page.screenshot({ path: testInfo.outputPath('minimal-restored.png') });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
