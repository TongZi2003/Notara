import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';

/**
 * Migrated to the minimal-split contract (docs/dev-log/2026-09-21-vault-minimal-split.md):
 * the standalone reader tab is deleted and PDF/Markdown both open inside the assets
 * view; the tabs are 对话/文件/图谱/卡片; the file rail starts collapsed behind
 * 展开文件栏; graph details list child cards instead of the full excerpt; card
 * creation lives inside 打开摘录工具; splitting is 带入对话拆分 and walks into the
 * native chat split pane instead of a dialog. Every behaviour assertion of the
 * pre-migration spec is kept — only the entry points moved.
 */
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const detailsPane = (page: Page) => page.getByRole('complementary', { name: '节点详情' });
// The wording of the card-creation action inside 打开摘录工具 is still moving.
const createCard = (page: Page) => page.getByRole('button', { name: /创建摘录卡片|提取为 Markdown 卡片|提取段落为卡片/ });
const cardCreated = /已(?:提取|创建)/;

test('vault views keep file facts, node-centred graph details and one chat mount', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime: VaultRuntime = await startVaultIsolated();
  await testInfo.attach('isolated-runtime', { body: JSON.stringify({ root: runtime.root, workspace: join(runtime.root, 'workspace'), url: new URL(runtime.authUrl).origin, node: process.version }), contentType: 'application/json' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const expandRail = async () => {
    const toggle = page.getByRole('button', { name: '展开文件栏', exact: true }).first();
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
  };
  try {
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already configured */ }
    await page.getByText('Notara Vault', { exact: true }).first().click();
    const composer = page.locator('[data-composer-input][contenteditable="true"], textarea[placeholder]').last();
    await composer.fill('打开知识库'); await composer.press('Enter');

    // One unified tab strip; the reader tab is deleted and the composer is the
    // native chat's single instance, hidden outside the chat tab.
    await expect(tab(page, '对话')).toBeVisible();
    await expect(tab(page, '文件')).toBeVisible();
    await expect(tab(page, '图谱')).toBeVisible();
    await expect(tab(page, '卡片')).toBeVisible();
    await expect(tab(page, '阅读器')).toHaveCount(0);

    await tab(page, '卡片').click();
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeHidden();
    await expect(page.getByText(/还没有卡片/)).toBeVisible();
    await tab(page, '对话').click();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    await tab(page, '卡片').click();

    // The native shell sidebar keeps its own controls.
    await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse right sidebar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open right sidebar', exact: true })).toBeVisible();

    // External writes are file facts. Both views must refresh without a reload.
    const cards = join(runtime.root, 'workspace/vault/卡片');
    await mkdir(cards, { recursive: true });
    await writeFile(join(cards, '坐标卡.md'), '---\ntype: card\n---\n# 坐标卡\n\n![[媒体/向量讲义.pdf#page=2&rect=0.1,0.1,0.8,0.2]]\n\n> A point can be described by its coordinates.\n');
    await expect(page.getByRole('button', { name: '打开卡片 坐标卡', exact: true })).toBeVisible();
    await page.getByPlaceholder('搜索卡片…').fill('不存在');
    await expect(page.getByText('没有符合条件的卡片。')).toBeVisible();
    await page.getByPlaceholder('搜索卡片…').fill('');

    // A card source now lands in the assets view, on the original page and region.
    await page.getByRole('button', { name: /媒体\/向量讲义\.pdf · 第 2 页/ }).click();
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2');
    await expect(page.getByText(/已框选第 2 页区域/)).toBeVisible();

    // Switching views keeps that locate target without a second reader tab.
    await tab(page, '图谱').click();
    await tab(page, '文件').click();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2');

    // The file rail starts collapsed and 展开文件栏 reveals the file list.
    await expect(page.getByRole('button', { name: '展开文件栏', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /向量讲义\.pdf/ }).first()).toBeHidden();
    await page.getByRole('button', { name: '展开文件栏', exact: true }).click();
    await expect(page.getByRole('button', { name: /向量讲义\.pdf/ }).first()).toBeVisible();

    // 新建页面 opens a dialog; the Markdown page lands in the vault.
    await page.getByRole('button', { name: '新建页面', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('模板').first()).toBeVisible();
    await dialog.getByLabel('页面标题').fill('我的摘录');
    await dialog.getByLabel('目标路径').fill('卡片/我的摘录.md');
    await expect(dialog.getByRole('button', { name: '创建 Markdown 页面', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: '创建 Markdown 页面', exact: true }).click();
    await expect(page.getByRole('heading', { name: '我的摘录', exact: true })).toBeVisible();
    expect(await readFile(join(cards, '我的摘录.md'), 'utf8')).toContain('# 我的摘录');

    // Double-clicking a graph node opens the file in the assets view: one reader.
    await tab(page, '图谱').click();
    const pdfNode = page.getByRole('button', { name: '图谱节点 向量讲义.pdf', exact: true });
    await pdfNode.dblclick();
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toBeVisible();

    await tab(page, '图谱').click();
    const node = page.getByRole('button', { name: '图谱节点 坐标卡', exact: true });
    await expect(node).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath('graph-before.png') });
    await node.click();
    const pane = detailsPane(page);
    await expect(pane).toContainText('叶子卡片');
    await expect(pane).toContainText('第 2 页');
    // Details carry the child-card roll-up, never the document body.
    await expect(pane).toContainText(/子卡片\s*[:：]?\s*0/);
    await expect(pane).not.toContainText('A point can be described by its coordinates.');
    // A listed source navigates into the assets view at its own page.
    await pane.getByText('来源', { exact: true }).click();
    await pane.getByRole('button', { name: /媒体\/向量讲义\.pdf/ }).first().click();
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2');

    // 打开摘录工具 creates the child card with its parent and anchor.
    await tab(page, '卡片').click();
    await page.getByRole('button', { name: '打开卡片 坐标卡', exact: true }).click();
    await page.getByRole('button', { name: '打开摘录工具', exact: true }).click();
    await page.getByLabel('卡片标题', { exact: true }).fill('坐标子卡');
    await createCard(page).click();
    await expect(page.getByText(cardCreated).first()).toBeVisible();
    const child = await readFile(join(cards, '坐标子卡.md'), 'utf8');
    expect(child).toContain('parent: 卡片/坐标卡.md');
    expect(child).toContain('![[卡片/坐标卡.md#anchor=');

    // The same tool extracts a heading-anchored card from a Markdown page.
    await tab(page, '文件').click();
    await expandRail();
    await page.getByRole('button', { name: /向量\.md/ }).first().click();
    await expect(page.getByLabel('Markdown Live Preview 编辑器')).toBeVisible();
    await page.getByRole('button', { name: '打开摘录工具', exact: true }).click();
    await page.getByLabel('摘录段落').selectOption('关键联系');
    await page.getByLabel('卡片标题', { exact: true }).fill('基底摘录');
    await createCard(page).click();
    await expect(page.getByText(cardCreated).first()).toBeVisible();
    expect(await readFile(join(cards, '基底摘录.md'), 'utf8')).toContain('#anchor=%E5%85%B3%E9%94%AE%E8%81%94%E7%B3%BB');
    expect((await readdir(cards)).length).toBe(4);

    // The child card now shows up as a name in the graph details.
    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '图谱节点 坐标卡', exact: true }).click();
    await expect(detailsPane(page)).toContainText('中间卡片');
    await expect(detailsPane(page)).toContainText(/子卡片\s*[:：]?\s*1/);
    await expect(detailsPane(page).getByRole('button', { name: '坐标子卡', exact: true })).toBeVisible();
    expect((await page.locator('.nv-views:visible').boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('graph.png') });

    // Card library filters by source and keeps the parent out of the result.
    await tab(page, '卡片').click();
    await page.getByLabel('来源过滤').selectOption('卡片/坐标卡.md');
    await expect(page.getByRole('button', { name: '打开卡片 坐标子卡', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '打开卡片 坐标卡', exact: true })).toHaveCount(0);
    expect((await page.locator('.nv-views:visible').boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('cards.png') });

    // A heading locator survives content inserted before its source section.
    await writeFile(join(runtime.root, 'workspace/vault/知识/向量.md'), '# 向量\n\n新增前言。\n\n## 关键联系\n基底仍是坐标的语言。\n');
    await page.getByLabel('来源过滤').selectOption('知识/向量.md');
    await page.getByRole('button', { name: '打开卡片 基底摘录', exact: true }).click();
    await page.getByRole('button', { name: /知识\/向量\.md · 关键联系/ }).click();
    await page.getByRole('button', { name: '打开摘录工具', exact: true }).click();
    await expect(page.getByLabel('摘录段落')).toHaveValue('关键联系');
    await expect(page.getByLabel('摘录内容')).toHaveValue(/基底仍是坐标的语言/);
    await page.getByRole('button', { name: '打开摘录工具', exact: true }).click();
    const editor = page.getByLabel('Markdown Live Preview 编辑器').locator('.cm-content');
    await expect(editor).toBeVisible();
    await editor.press('ControlOrMeta+End');
    await editor.press('Enter'); await editor.pressSequentially('保留的草稿');
    await tab(page, '图谱').click();
    await tab(page, '文件').click();
    await expect(editor).toContainText('保留的草稿');
    await page.getByRole('button', { name: '文件操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '放弃修改', exact: true }).click();

    // Graph interactions: pin, zoom, pan, camera reset and detail width.
    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '图谱节点 向量讲义.pdf', exact: true }).click();
    const separator = page.getByRole('separator', { name: '调整详情宽度' });
    const before = Number(await separator.getAttribute('aria-valuenow'));
    const handle = (await separator.boundingBox())!;
    await page.mouse.move(handle.x + 3, handle.y + 70); await page.mouse.down();
    await page.mouse.move(handle.x - 50, handle.y + 70, { steps: 5 }); await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', String(before + 53));
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();

    const board = page.locator('.nv-graph-board');
    const boardBox = (await board.boundingBox())!;
    expect(boardBox.x).toBeGreaterThanOrEqual(0);
    await page.mouse.move(boardBox.x + 50, boardBox.y + 60); await page.mouse.wheel(0, -200);
    await expect(board.getByText('100%', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '居中', exact: true }).click();
    const camera = page.locator('.nv-graph-svg > g');
    const cameraBefore = await camera.getAttribute('transform');
    await page.mouse.move(boardBox.x + 30, boardBox.y + 30); await page.mouse.down();
    await page.mouse.move(boardBox.x + 60, boardBox.y + 50, { steps: 5 }); await page.mouse.up();
    await expect(camera).not.toHaveAttribute('transform', cameraBefore!);
    await page.getByRole('button', { name: '居中', exact: true }).click();
    await pdfNode.click();
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await pdfNode.hover();
    const point = (await pdfNode.boundingBox())!;
    await page.mouse.move(point.x + point.width / 2, point.y + 23); await page.mouse.down();
    await page.mouse.move(point.x + point.width / 2 + 40, point.y + 43, { steps: 6 }); await page.mouse.up();
    await expect(pdfNode).toHaveAttribute('data-fixed', 'true');
    await tab(page, '卡片').click();
    await tab(page, '图谱').click();
    await expect(pdfNode).toHaveAttribute('data-fixed', 'true');

    // 带入对话拆分 pre-fills the native split instead of opening a dialog, and
    // it never sends: the reference and the intent stay an editable draft.
    await page.getByRole('button', { name: '图谱节点 向量', exact: true }).click();
    await expect(page.getByRole('button', { name: '继续拆分', exact: true })).toHaveCount(0);
    await detailsPane(page).getByRole('button', { name: '带入对话拆分', exact: true }).click();
    await expect(page.locator('[data-nv-split]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    const chatBox = (await page.getByRole('region', { name: '对话区域' }).boundingBox())!;
    const inputBox = (await page.locator('[data-composer-input]').boundingBox())!;
    expect(inputBox.x).toBeGreaterThanOrEqual(chatBox.x);
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(chatBox.x + chatBox.width + 1);
    await expect(page.locator('[data-composer-input]')).toContainText('拆分');
    await expect(page.locator('[data-composer-input]')).toContainText('基底摘录');
    await expect(page.locator('[data-nv-split]')).toContainText('向量');
    await page.getByRole('tablist', { name: '左侧分页' }).getByRole('tab', { name: '卡片', exact: true }).click();
    await page.getByRole('tablist', { name: '左侧分页' }).getByRole('tab', { name: '对话', exact: true }).click();
    await expect(page.locator('[data-composer-input]')).toContainText('拆分');
    await page.screenshot({ path: testInfo.outputPath('split.png') });

    // Browser reload reconstructs the projection solely from the saved files.
    await page.reload();
    await tab(page, '卡片').click();
    await expect(page.getByRole('button', { name: /^打开卡片 / })).toHaveCount(4);
    await page.setViewportSize({ width: 600, height: 900 });
    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '图谱节点 坐标卡', exact: true }).click();
    await expect(detailsPane(page)).toBeVisible();
    await expect(page.locator('.nv-graph-board')).toBeHidden();
    expect((await detailsPane(page).boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await expect(detailsPane(page).getByRole('button', { name: '带入对话', exact: true })).toBeVisible();
    await expect(detailsPane(page).getByRole('button', { name: '带入对话拆分', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('narrow.png') });

    await writeFile(join(cards, '失效来源.md'), '---\ntype: card\n---\n# 失效来源\n\n![[媒体/不存在.pdf#page=3]]\n');
    await tab(page, '卡片').click();
    await page.getByRole('button', { name: /媒体\/不存在\.pdf/ }).click();
    await expect(page.getByRole('alert')).toContainText('无法打开这个文件');

    // An empty vault still renders explicit empty states in every view.
    await rm(join(runtime.root, 'workspace/vault'), { recursive: true });
    await tab(page, '图谱').click();
    await expect(page.getByText('还没有文件。在资产页导入资料或创建页面。')).toBeVisible();
    await expect(page.locator('[data-node]')).toHaveCount(0);
    await tab(page, '卡片').click();
    await expect(page.getByText(/还没有卡片/)).toBeVisible();
    await tab(page, '文件').click();
    await expect(page.getByRole('button', { name: '展开文件栏', exact: true })).toBeVisible();
    await expect(page.locator('canvas[aria-label]')).toHaveCount(0);
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
  } finally {
    await testInfo.attach('console-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('final-state.png') });
    await testInfo.attach('graph-geometry', { body: JSON.stringify(await page.locator('.nv-graph-board, .nv-graph-layout, .nv-views').evaluateAll(nodes => nodes.map(node => ({ className: node.className, box: node.getBoundingClientRect().toJSON() })))), contentType: 'application/json' });
    await runtime.stop();
  }
});
