import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * The lesson reads as a whole (the native normal transcript, no folded process),
 * a reloaded tab returns to its lesson and view while a new tab opens Home, a
 * lesson board opened in the library is a read-only archive that leads back to
 * the classroom board, and the library creates an empty code file.
 */
const board = (page: Page) => page.locator('.nb-board');
const lessonTab = (page: Page, name: string) => page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name, exact: true });
test('normal transcript, reload back to the lesson, board archive in the library and a new code file', async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectVault(runtime);
  try {
    client.approvals.auto('allowed-once');
    await client.script({
      '__session-title': '续学与资料库',
      '上板': { calls: [
        { name: 'skill', arguments: { name: 'notara-board' } },
        { name: 'write_lesson_board', arguments: { title: '先判断', section: '第1题 条件概率', kind: 'question', body: '```choice\n甲先摸、乙后摸，谁摸到红球的机会大？\n- 甲大\n- 一样大\n- 乙大\n```' } },
        { name: 'write_lesson_board', arguments: { title: '下一题', section: '第2题 全概率', body: '先想一想怎么分类：$P(A)=\\frac{1}{2}$。' } },
      ], text: '白板上放了一道判断题。' },
    });
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('上板'); await input.press('Enter');
    const reply = page.getByText('白板上放了一道判断题。').first();
    for (let round = 0; round < 40 && !(await reply.isVisible()); round++) {
      const allow = page.getByRole('button', { name: 'Allow once', exact: true });
      if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(500);
    }
    await expect(reply).toBeVisible({ timeout: 30_000 });
    // Normal transcript: the finished turn keeps its steps in view, no folded "N 次工具调用".
    await page.waitForTimeout(1500);
    await expect(page.getByText(/\d+ 次工具调用/)).toHaveCount(0);
    // The Skill row names the skill by its title, not its id.
    await expect(page.getByText('读取技能：板书').first()).toBeVisible();
    await expect(page.getByText('notara-board')).toHaveCount(0);

    // Reload on the board: the tab comes back to this lesson and its board view.
    await lessonTab(page, '白板').click();
    await expect(board(page).getByText('甲先摸、乙后摸，谁摸到红球的机会大？')).toBeVisible();
    // A section with one short block keeps one column once the next section begins (three columns were 1092px wide).
    const titles = await board(page).locator('.nb-section-title').evaluateAll(nodes => nodes.map(node => parseFloat((node as HTMLElement).style.left)));
    expect(titles).toHaveLength(2);
    expect(titles[1]! - titles[0]!).toBeLessThan(500);
    await page.reload();
    await expect(lessonTab(page, '白板')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
    await expect(board(page).getByText('甲先摸、乙后摸，谁摸到红球的机会大？')).toBeVisible({ timeout: 30_000 });
    // A new tab has its own session storage: it opens Home.
    const other = await context.newPage();
    await other.goto(new URL(runtime.authUrl).origin);
    await expect(other.getByRole('heading', { name: /今天想学点什么/ })).toBeVisible({ timeout: 30_000 });
    await expect(other.getByRole('tablist', { name: '课堂视图' })).toHaveCount(0);
    await other.close();

    // The board file in the library is a read-only archive that leads back to the classroom board.
    await lessonTab(page, '对话').click();
    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    // The Vault panel holds the file tree.
    const files = page.getByRole('group', { name: '文件列表' });
    await files.getByRole('button', { name: /\.md$/ }).filter({ hasText: /^[0-9a-f]{8,}/ }).first().click();
    const archive = page.getByRole('region', { name: '课堂白板存档' });
    await expect(archive).toBeVisible();
    await expect(archive.frameLocator('iframe').getByText('甲先摸、乙后摸，谁摸到红球的机会大？')).toBeVisible();
    // A tab that has drawn no formula yet still shows the archive's formulas once (KaTeX styles travel with it).
    const fresh = await context.newPage();
    await fresh.goto(new URL(runtime.authUrl).origin);
    await fresh.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: 'Vault', exact: true }).click();
    await fresh.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /\.md$/ }).filter({ hasText: /^[0-9a-f]{8,}/ }).first().click();
    const freshFrame = fresh.getByRole('region', { name: '课堂白板存档' }).frameLocator('iframe');
    await expect(freshFrame.locator('.katex-html').first()).toBeVisible({ timeout: 15_000 });
    expect(await freshFrame.locator('.katex-mathml').first().evaluate(node => getComputedStyle(node).position)).toBe('absolute');
    await fresh.close();
    await archive.getByRole('button', { name: '在课堂白板中打开' }).click();
    await expect(lessonTab(page, '白板')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
    await expect(board(page).getByText('甲先摸、乙后摸，谁摸到红球的机会大？')).toBeVisible();

    // A new, empty code file opens in the code editor.
    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.getByRole('menuitem', { name: '新建代码文件' }).click();
    await page.getByLabel('代码文件路径').fill('代码/传球.py');
    await page.getByRole('button', { name: '创建代码文件' }).click();
    await expect(page.getByRole('region', { name: '代码编辑：代码/传球.py' })).toBeVisible({ timeout: 15_000 });
    // The panel's file tree learns about a file the page created.
    await expect(files.getByRole('button', { name: /传球\.py$/ })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath('resume-library.png') });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
