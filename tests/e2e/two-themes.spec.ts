import { test, expect, enterClassroom, sendInput, typeInput, openRoot, openCards, openAppearance, closeAppearance } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };

// 手帐主题入口已下线（本轮只发布极简主题）：外观面板只保留已发布主题的说明，
// 旧的浏览器偏好也不能把手帐主题拉回来；手帐专属外观由 notebook-*.spec.ts 的 deferred 用例覆盖。
test('the released minimal theme is the only appearance and offers no switcher', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1117, height: 747 });
  await enterClassroom(page, classroom.authUrl);
  await expect(page.locator('body')).toHaveAttribute('data-sf-style', 'modern');
  await expect(page.locator('[data-composer-input]')).toHaveCSS('font-family', /system-ui/);
  await expect(page.locator('[data-composer-card]')).toHaveCSS('border-top-left-radius', '22px');
  const home = page.getByTestId('notebook-sidebar').getByRole('button', { name: '首页', exact: true });
  await home.hover(); await expect(home).toHaveCSS('background-color', 'rgb(229, 231, 235)');
  await page.screenshot({ path: info.outputPath('minimal-home.png'), fullPage: true });
  await typeInput(page, '打开外观面板后仍保留这条草稿');
  await openAppearance(page);
  await expect(page.getByRole('radiogroup', { name: '界面主题' })).toHaveCount(0);
  await expect(page.getByTestId('theme-modern')).toHaveCount(0);
  await expect(page.getByTestId('theme-notebook')).toHaveCount(0);
  await expect(page.getByTestId('notebook-style')).toHaveText('当前主题：极简');
  await expect(page.getByTestId('notebook-tone')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('minimal-appearance.png'), fullPage: true });
  await closeAppearance(page);
  await expect(page.locator('[data-composer-input]')).toContainText('打开外观面板后仍保留这条草稿');
  await expect(page.locator('[data-composer-input]')).toHaveCSS('background-image', 'none');
  await expect(page.locator('[data-composer-input]')).toHaveCSS('font-family', /system-ui/);
  await page.getByTestId('agent-role').click();
  await expect(page.getByRole('dialog', { name: '智能体身份' })).toHaveCSS('border-top-left-radius', '14px');
  await page.keyboard.press('Escape');
  // 旧的浏览器偏好不能把已下线的手帐主题拉回来。
  await page.evaluate(() => localStorage.setItem('studyforge.notebook.appearance', JSON.stringify({ style: 'notebook', tone: 'white', paper: 'fangge', scheme: 'bing', size: 'l' })));
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-sf-style', 'modern');
  await expect(page.locator('[data-composer-input]')).toHaveCSS('font-family', /system-ui/);
  await page.setViewportSize({ width: 390, height: 844 }); await openAppearance(page);
  await expect.poll(async () => page.getByTestId('notebook-appearance').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.getByTestId('theme-modern')).toHaveCount(0); await expect(page.getByTestId('theme-notebook')).toHaveCount(0);
  await expect(page.getByTestId('notebook-paper')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('minimal-appearance-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('the released minimal theme covers every root page, real card editor, material reader and workbench nodes', async ({ page, classroom }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 }); await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '从三角函数开始学习');
  await expect(page.getByText('已收到：从三角函数开始学习', { exact: true })).toBeVisible();
  const client = await connectRuntime(classroom);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'theme-book', material: { title: '三角函数讲义', fileName: '三角函数.md', mediaType: 'text/markdown' }, base64: Buffer.from('# 两角和差公式\n观察角之间的关系。\n').toString('base64') } }));
  value(await client.rpc('studyforgeOrganization/createSet', { input: { operationId: 'theme-set', set: { name: '高考数学', subjects: ['数学'] } } }));
  value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'theme-card', content: { title: '先观察角之间的关系', front: '如何选择合适的两角和差公式？', sources: [{ materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 9 } } }] } } }));
  // 手帐主题入口已下线（本轮只发布极简主题）。
  for (const style of ['modern'] as const) {
    await openAppearance(page); await closeAppearance(page);
    for (const [label, route] of [['课程','courses'],['资料','materials'],['学习集','sets'],['日历','calendar'],['学情','memory']] as const) {
      await openRoot(page, label); const root = page.getByTestId(`studyforge-page-studyforge.${route}`);
      await expect(root).toBeVisible();
      await expect(page.getByTestId('notebook-sidebar').getByRole('button', { name: label, exact: true })).toHaveClass(/\bon\b/);
      if (route === 'materials') { await expect(root.getByTestId('material-row')).toHaveCount(1); await expect(root.locator('.sf-library-source-open')).toHaveAttribute('aria-expanded', 'false'); }
      if (route === 'sets') await expect(root).toContainText('高考数学');
      if (route === 'courses') await expect(root.locator('.sf-map-card')).toHaveCount(1);
      if (route === 'memory') await expect.poll(async () => (await root.innerText()).includes('正在读')).toBe(false);
      if (style === 'modern') {
        await expect(root).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        const fonts = await root.locator('h1,h2,button,select').evaluateAll(els => els.filter(el => el.getClientRects().length).map(el => getComputedStyle(el).fontFamily));
        expect(fonts.every(font => !/SF Long Cang|SF WenKai|Songti|Kaiti/.test(font))).toBe(true);
      }
      // Check the student-facing typography, not just the existence of a page.
      const type = await root.locator('h1,h2,h3,button,select,.sf-meta,.sf-note,.mini-note').evaluateAll(els => els
        .filter(el => el.getClientRects().length && el.textContent?.trim())
        .map(el => ({ text: el.textContent?.trim().slice(0, 35), font: getComputedStyle(el).fontFamily, size: parseFloat(getComputedStyle(el).fontSize) })));
      expect(type.filter(item => item.size > 22), `${style} ${route}: oversized interface text`).toEqual([]);
      if (route === 'calendar') {
        await root.locator('.cal-c.today').click();
        const detail = page.getByTestId('calendar-detail');
        await expect(page.getByTestId('calendar-day')).toBeVisible();
        await expect(detail.locator('header h2')).toHaveCSS('font-size', style === 'modern' ? '16px' : '18px');
        const sectionSize = await detail.locator('h3').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        const rowSizes = await detail.locator('.cal-lrow').evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).fontSize)));
        expect(rowSizes.every(size => size <= sectionSize)).toBe(true);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${style}-calendar-detail-mobile.png`), fullPage: true });
        await page.setViewportSize({ width: 1440, height: 960 });
        await detail.getByRole('button', { name: '关闭日期详情' }).click();
      }
      await page.screenshot({ path: info.outputPath(`${style}-${route}.png`), fullPage: true });
    }
    await openCards(page); const row = page.getByTestId('card-row').first(); await expect(row).toBeVisible();
    await row.getByTestId('card-row-open').click(); await expect(page.getByTestId('card-detail')).toBeVisible();
    await page.getByTestId('card-detail-edit').click(); await expect(page.getByTestId('card-editor')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${style}-card-editor.png`), fullPage: true });
    await openRoot(page, '首页');
    await page.getByTestId('workspace-open-materials').click();
    await page.getByTestId('lesson-materials-refresh').click();
    const map = page.getByTestId('lesson-materials-map'), node = map.locator('[data-kind=book]').first();
    await expect(node).toBeVisible();
    if (style === 'modern') { await expect(node).toHaveCSS('background-color', 'rgb(255, 255, 255)'); await expect(node).toHaveCSS('border-top-left-radius', '14px'); }
    else { await expect(node).toHaveCSS('background-color', 'rgb(253, 241, 176)'); await expect(node.locator('.sf-mind-title')).toHaveCSS('font-size', '16px'); }
    // Nodes keep their centre coordinate in both appearances; this transform
    // is graph geometry, not a notebook decoration.
    await expect.poll(() => node.evaluate(el => Math.abs(el.getBoundingClientRect().width / 2 + new DOMMatrix(getComputedStyle(el).transform).m41) < 1)).toBe(true);
    await node.getByTestId('lesson-resource-open').click(); await expect(page.getByTestId('lesson-materials-pane')).toContainText('观察角之间的关系');
    await page.screenshot({ path: info.outputPath(`${style}-reader-workbench.png`), fullPage: true });
    await page.getByTestId('lesson-materials-pane').getByTestId('mindmap-back').click();
  }
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('minimal conversation and pending/saved confirmation do not inherit paper or handwriting', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1117, height: 747 }); await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'propose_card', arguments: { kind: 'card', title: '角度转换', front: '| 条件 | 结论 |\n|---|---|\n| 两角之和 | 使用和角公式 |\n\n$\\sin(\\alpha+\\beta)$' } }));
  const proposal = page.getByTestId('inline-proposal').filter({ hasText: '角度转换' });
  await expect(proposal.getByTestId('proposal-slip')).toHaveCSS('border-top-left-radius', '14px');
  await expect(proposal.getByTestId('proposal-slip')).toHaveCSS('transform', 'none');
  await expect(proposal.getByTestId('proposal-content')).toHaveCSS('font-family', /system-ui/);
  await page.screenshot({ path: info.outputPath('modern-confirmation.png'), fullPage: true });
  await proposal.getByTestId('proposal-confirm').click(); await expect(proposal).not.toHaveAttribute('open');
  await proposal.locator('summary').click();
  await expect(proposal.getByTestId('proposal-item-status')).toHaveCSS('transform', 'none');
  // 手帐主题入口已下线（本轮只发布极简主题）：确认单不随已下线的主题变化。
  await expect(proposal.getByTestId('proposal-item-status')).toHaveCSS('transform', 'none');
  await expect(proposal.getByTestId('proposal-content')).toHaveCSS('font-family', /system-ui/);
  await expect.poll(async () => page.locator('[data-chat-flow] [style*="--sf-ink-shift"]').count()).toBe(0);
});
