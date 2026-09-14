import { test, expect, enterClassroom, sendInput, typeInput, openRoot, openCards, openAppearance, closeAppearance } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };

test('two complete themes preserve paper preferences, native drafts, menus and responsive settings', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1117, height: 747 });
  await enterClassroom(page, classroom.authUrl);
  await expect(page.locator('body')).toHaveAttribute('data-sf-style', 'modern');
  await expect(page.locator('[data-composer-input]')).toHaveCSS('font-family', /system-ui/);
  await expect(page.locator('[data-composer-card]')).toHaveCSS('border-top-left-radius', '22px');
  const home = page.getByTestId('notebook-sidebar').getByRole('button', { name: '首页', exact: true });
  await home.hover(); await expect(home).toHaveCSS('background-color', 'rgb(229, 231, 235)');
  await page.screenshot({ path: info.outputPath('modern-home.png'), fullPage: true });
  await typeInput(page, '主题切换时保留这条草稿');
  await openAppearance(page);
  await expect(page.getByRole('radiogroup', { name: '界面主题' }).getByRole('radio')).toHaveCount(2);
  await expect(page.getByTestId('notebook-tone')).toHaveCount(0);
  await page.getByTestId('theme-notebook').click();
  await page.getByTestId('notebook-tone').selectOption('yellow');
  await page.getByTestId('notebook-paper').selectOption('fangge');
  await page.getByTestId('notebook-scheme').selectOption('bing');
  await page.screenshot({ path: info.outputPath('theme-settings.png'), fullPage: true });
  await closeAppearance(page);
  await expect(page.locator('[data-composer-input]')).toContainText('主题切换时保留这条草稿');
  await expect(page.locator('[data-composer-input]')).toHaveCSS('font-family', /SF WenKai/);
  await openAppearance(page); await page.getByTestId('theme-modern').click(); await closeAppearance(page);
  await expect(page.locator('[data-composer-input]')).toContainText('主题切换时保留这条草稿');
  await expect(page.locator('[data-composer-input]')).toHaveCSS('background-image', 'none');
  await expect(page.locator('[data-composer-input]')).toHaveCSS('font-family', /system-ui/);
  await page.getByTestId('agent-role').click();
  await expect(page.getByRole('dialog', { name: '智能体身份' })).toHaveCSS('border-top-left-radius', '14px');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 }); await openAppearance(page);
  await expect.poll(async () => page.getByTestId('notebook-appearance').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.getByTestId('theme-modern')).toBeVisible(); await expect(page.getByTestId('theme-notebook')).toBeVisible();
  await page.screenshot({ path: info.outputPath('modern-settings-mobile.png'), fullPage: true });
  await page.reload(); await openAppearance(page);
  await expect(page.getByTestId('theme-modern')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('theme-notebook').click();
  await expect(page.getByTestId('notebook-paper')).toHaveValue('fangge'); await expect(page.getByTestId('notebook-scheme')).toHaveValue('bing');
  expect(errors).toEqual([]);
});

test('both themes cover every root page, real card editor, material reader and workbench nodes', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 }); await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '从三角函数开始学习');
  await expect(page.getByText('已收到：从三角函数开始学习', { exact: true })).toBeVisible();
  const client = await connectRuntime(classroom);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'theme-book', material: { title: '三角函数讲义', fileName: '三角函数.md', mediaType: 'text/markdown' }, base64: Buffer.from('# 两角和差公式\n观察角之间的关系。\n').toString('base64') } }));
  value(await client.rpc('studyforgeOrganization/createSet', { input: { operationId: 'theme-set', set: { name: '高考数学', subjects: ['数学'] } } }));
  value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'theme-card', content: { title: '先观察角之间的关系', front: '如何选择合适的两角和差公式？', sources: [{ materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 9 } } }] } } }));
  for (const style of ['modern', 'notebook'] as const) {
    await openAppearance(page); await page.getByTestId(`theme-${style}`).click(); await closeAppearance(page);
    for (const [label, route] of [['课程','courses'],['资料','materials'],['学习集','sets'],['日历','calendar'],['学情','memory']] as const) {
      await openRoot(page, label); const root = page.getByTestId(`studyforge-page-studyforge.${route}`);
      await expect(root).toBeVisible();
      await expect(page.getByTestId('notebook-sidebar').getByRole('button', { name: label, exact: true })).toHaveClass(/\bon\b/);
      if (route === 'materials') await expect(root.getByTestId('material-row')).toHaveCount(2);
      if (route === 'sets') await expect(root).toContainText('高考数学');
      if (route === 'courses') await expect(root.locator('.sf-map-card')).toHaveCount(1);
      if (route === 'memory') await expect.poll(async () => (await root.innerText()).includes('正在读')).toBe(false);
      if (style === 'modern') {
        await expect(root).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        const fonts = await root.locator('h1,h2,button,select').evaluateAll(els => els.filter(el => el.getClientRects().length).map(el => getComputedStyle(el).fontFamily));
        expect(fonts.every(font => !/SF Long Cang|SF WenKai|Songti|Kaiti/.test(font))).toBe(true);
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
    else await expect(node).toHaveCSS('background-color', 'rgb(253, 241, 176)');
    await node.getByTestId('lesson-resource-open').click(); await expect(page.getByTestId('lesson-materials-pane')).toContainText('观察角之间的关系');
    await page.screenshot({ path: info.outputPath(`${style}-reader-workbench.png`), fullPage: true });
    await page.getByTestId('lesson-materials-pane').getByTestId('mindmap-back').click();
  }
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('modern conversation and pending/saved confirmation do not inherit paper or handwriting', async ({ page, classroom }, info) => {
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
  await openAppearance(page); await page.getByTestId('theme-notebook').click(); await closeAppearance(page);
  await expect(proposal.getByTestId('proposal-item-status')).not.toHaveCSS('transform', 'none');
  await openAppearance(page); await page.getByTestId('theme-modern').click(); await closeAppearance(page);
  await expect.poll(async () => page.locator('[data-chat-flow] [style*="--sf-ink-shift"]').count()).toBe(0);
});
