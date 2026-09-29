import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * Board figures and diagrams: the figure engine loads from the lazy route only
 * when a figure is shown; a slider redraws the curve; an explored state can be
 * brought into the conversation; a point clicked on the figure and a filled gap
 * in a flow diagram each arrive as the student's own message.
 */
const board = (page: Page) => page.locator('.nb-board');
/** Go to one section through the board's own outline, the way a student moves between sections. */
async function goSection(page: Page, name: string): Promise<void> {
  await page.locator('.nb-board .nb-toolbar').getByRole('button', { name: '板块', exact: true }).click();
  await page.locator('.nb-board .nb-outline button', { hasText: name }).click();
}
const lessonTab = (page: Page, name: string) => page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name, exact: true });
test('figures and flow diagrams render, explore and take answers on the board', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [], lazy: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.url().includes('/notara/vault/lazy/')) lazy.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const client = await connectVault(runtime);
  try {
    client.approvals.auto('allowed-once');
    await client.script({
      '__session-title': '图与关系',
      '看图': { calls: [
        { name: 'write_lesson_board', arguments: { title: '开口与参数', section: '第2题 抛物线', size: 'wide', body: '拖动滑块，看开口怎样变。\n\n```figure\naxes x -4..4 y -3..3\nparam σ = 1 in -3..3\nfunction f(x) = σ(x-1)^2 - 2\npoint A = (2, 0) drag\n```' } },
        { name: 'write_lesson_board', arguments: { title: '顶点在哪', body: '```figure\naxes x -4..4 y -3..3\nfunction f(x) = (x-1)^2 - 2\nask point "点出这条抛物线的顶点"\n```' } },
        { name: 'write_lesson_board', arguments: { title: '交子的因果', section: '第3题 交子', size: 'wide', body: '```flow\ndirection right\nA[官营交子] --> B[发行过量]\nB --> E[?]\nE -.-> D((为什么不能停发？))\n```' } },
      ], text: '白板上有两张图和一张关系图。' },
    });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('看图'); await input.press('Enter');
    const reply = page.getByText('白板上有两张图和一张关系图。').first();
    for (let round = 0; round < 40 && !(await reply.isVisible()); round++) {
      const allow = page.getByRole('button', { name: 'Allow once', exact: true });
      if (await allow.isVisible()) await allow.click(); else await page.waitForTimeout(500);
    }
    await expect(reply).toBeVisible({ timeout: 30_000 });
    expect(lazy.filter(entry => entry.includes('jsxgraph')), 'the figure engine is not fetched before a figure is shown').toEqual([]);

    await lessonTab(page, '白板').click();
    // Opening the board lands on the latest block the teacher wrote (the flow diagram in the second section).
    const latestBlock = board(page).locator('.nb-block', { hasText: '交子的因果' });
    await expect(latestBlock).toBeVisible();
    await expect.poll(async () => {
      const [block, pane] = await Promise.all([latestBlock.boundingBox(), board(page).boundingBox()]);
      return !!block && !!pane && block.x >= pane.x - 1 && block.x < pane.x + pane.width && block.y >= pane.y - 1 && block.y < pane.y + pane.height;
    }, { timeout: 10_000 }).toBe(true);
    await board(page).getByRole('button', { name: '全览', exact: true }).click();
    // 全览 never shrinks below half size.
    expect(parseInt(await board(page).locator('.nb-toolbar').getByText(/^\d+%$/).textContent() ?? '0', 10)).toBeGreaterThanOrEqual(50);
    // …and keeps the latest block wholly in view, with earlier sections to its left.
    await expect.poll(async () => {
      const [block, pane] = await Promise.all([latestBlock.boundingBox(), board(page).boundingBox()]);
      return !!block && !!pane && block.x >= pane.x - 1 && block.x + block.width <= pane.x + pane.width + 1;
    }, { timeout: 10_000 }).toBe(true);
    await goSection(page, '第2题 抛物线');
    const explore = board(page).locator('.nb-figure-view');
    await expect(explore.locator('.nb-figure[data-status=ready]')).toBeVisible({ timeout: 30_000 });
    expect(lazy).toContain('200 /notara/vault/lazy/jsxgraph.mjs');
    // The function graph is the path drawn in the board's line colour.
    const curve = async () => explore.locator('.nb-figure-board svg path[stroke="#4d7aa6"]').first().getAttribute('d').then(value => value ?? '');
    const before = await curve();
    expect(before.length).toBeGreaterThan(20);
    // A Greek parameter name reads as itself on the slider and in the conversation.
    await explore.getByLabel('参数 σ').fill('2.5');
    await expect.poll(curve).not.toBe(before);
    await explore.getByRole('button', { name: '带入对话' }).click();
    await expect(page.locator('[data-composer-input][contenteditable="true"]').last()).toContainText('〔白板｜第2题 抛物线｜开口与参数〕图：σ = 2.5');
    await lessonTab(page, '白板').click();

    // 在图上作答: click near the vertex, hand it in.
    const asked = board(page).locator('.nb-q[data-type=figure]');
    await expect(asked.locator('.nb-figure[data-status=ready]')).toBeVisible();
    const figure = asked.locator('.nb-figure-board');
    const box = await figure.boundingBox();
    // Vertex (1, -2) in the frame x -4..4, y -3..3.
    await figure.click({ position: { x: box!.width * (5 / 8), y: box!.height * (5 / 6) } });
    await expect(asked.getByText(/你点的位置：\(/)).toBeVisible();
    const placed = await asked.getByText(/你点的位置：\(/).textContent();
    const [, px = NaN, py = NaN] = placed!.match(/\((-?[\d.]+), (-?[\d.]+)\)/)!.map(Number);
    expect(Math.abs(px - 1)).toBeLessThan(0.4);
    expect(Math.abs(py + 2)).toBeLessThan(0.4);
    await asked.getByLabel('看到了什么').fill('顶点在最低处');
    await asked.getByRole('button', { name: '交给老师' }).click();
    await expect(asked.locator('.nb-q-badge')).toHaveText('已交给老师');

    // A gap in the flow diagram.
    await goSection(page, '第3题 交子');
    const flow = board(page).locator('.nb-q[data-type=flow]');
    await expect(flow.locator('svg.nb-flow .nb-flow-node')).toHaveCount(4);
    await flow.getByLabel('补上节点 E').fill('币值下跌');
    await flow.getByRole('button', { name: '交给老师' }).click();
    await expect(flow.locator('.nb-q-badge')).toHaveText('已交给老师');
    await page.screenshot({ path: testInfo.outputPath('board-figures.png') });

    // Export draws both figures from their live drawing, the answered one included, and the flow as SVG.
    await board(page).getByRole('button', { name: '导出', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'HTML', exact: true }).click()]);
    const html = await readFile((await download.path())!, 'utf8');
    expect(html.match(/<figure class="nb-export-figure"><svg/g) ?? []).toHaveLength(3);
    expect(html).not.toContain('图：函数');

    await lessonTab(page, '对话').click();
    await expect(page.getByText(/^〔白板｜第2题 抛物线｜点出这条抛物线的顶点〕我在图上点了 \(.*\)。我看到：顶点在最低处$/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('〔白板｜第3题 交子｜关系图〕（接在“发行过量”之后）我填：币值下跌').first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
