import { test, expect, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

type BoardValue = { revision: string; blocks: Array<{ id: string; title: string; body: string }> };

async function selectWord(target: Locator, word: string) {
  await target.evaluate((element, word) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(word) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index); range.setEnd(node, index + word.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`missing selection text ${word}`);
  }, word);
}

test('board highlights protect complete DOM ranges, tables keep their cells and same-path images belong to the current classroom', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const image = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`;
  const table = '| 项目 | 内容 |\n|---|---|\n| 绝对值 | $|x|$ |\n| 范数 | $\\|x\\|$ |\n| 资料 | [[资料.md|教材]] |\n| 代码 | `a|b` |\n| 转义 | a\\|b |\n| 高亮 | <mark data-color="blue">a|b</mark> |';
  const prose = '普通 x，公式 $x$。\n\n重点与链接 [[资料.md|教材]]，代码 `npm start`。\n\n<mark data-color="green">旧重点</mark>\n\n重复重复。';
  try {
    client.approvals.auto('allowed-once');
    await client.writeVaultFile('资料.md', '---\ntype: card\ntitle: 示例教材\n---\n\n这是合成教材。');
    await writeFile(join(client.vault, 'same.svg'), image('red'));
    await client.script({
      '__session-title': '内容边界课堂甲',
      '展示排版': { calls: [
        { name: 'write_lesson_board', arguments: { title: '普通与公式', size: 'wide', body: prose } },
        { name: 'write_lesson_board', arguments: { title: '表格', size: 'wide', body: table } },
        { name: 'write_lesson_board', arguments: { title: '跨公式选区', body: '左侧 $z$ 右侧' } },
        { name: 'write_lesson_board', arguments: { title: '同名图片', body: '![[same.svg]]' } },
      ], text: '回归内容已准备好。' },
    });
    await page.setViewportSize({ width: 1800, height: 1100 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('展示排版'); await input.press('Enter');
    await expect(page.getByText('回归内容已准备好。').first()).toBeVisible({ timeout: 60_000 });
    const boardTab = page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true });
    await boardTab.click();
    const board = page.locator('.nb-board');
    await expect(board.locator('.nb-block')).toHaveCount(4);
    await board.getByRole('button', { name: '全览', exact: true }).click();
    const card = board.locator('.nb-block').filter({ has: page.getByRole('heading', { name: '普通与公式', exact: true }) });
    const tableCard = board.locator('.nb-block').filter({ has: page.getByRole('heading', { name: '表格', exact: true }) });
    const cross = board.locator('.nb-block').filter({ has: page.getByRole('heading', { name: '跨公式选区', exact: true }) });
    const firstImage = board.locator('.nb-image');
    await expect(firstImage).toHaveCount(1);
    const redUrl = await firstImage.getAttribute('src');
    expect(redUrl).toBe(`data:image/svg+xml;base64,${Buffer.from(image('red')).toString('base64')}`);
    const sessions = (await client.sessions()) as Array<{ sessionId: string; blank?: boolean }>;
    const firstId = sessions.find(row => !row.blank)!.sessionId;
    const snapshot = () => client.rpc<BoardValue>('notaraVault/board', { input: { sessionId: firstId } }).then(client.value);
    const body = async () => (await snapshot()).blocks.find(block => block.title === '普通与公式')!.body;
    const blue = board.getByRole('button', { name: '蓝色高亮', exact: true });

    // Same visible word in normal prose and in math: only normal prose is editable.
    await selectWord(card.locator('.nb-md p').first(), 'x');
    await blue.click();
    const highlighted = prose.replace('普通 x', '普通 <mark data-color="blue">x</mark>');
    await expect.poll(body).toBe(highlighted);
    await expect(card.locator('.katex-html')).toHaveCount(1);
    await expect(card.locator('.katex annotation')).toHaveText('x');
    await expect(card.locator('mark').filter({ hasText: /^x$/ })).toBeVisible();

    // An entire DOM Range is checked, including syntax lying between plain endpoints.
    for (const [target, word] of [
      [card.locator('.katex-html'), 'x'],
      [card.locator('.nb-source-link'), '教材'],
      [card.locator('code'), 'npm start'],
    ] as Array<[Locator, string]>) {
      const before = await snapshot();
      await selectWord(target, word); await blue.click();
      await expect(board.locator('.nb-notice')).toHaveText('请只选择一处完整的普通文字，再添加高亮。');
      expect((await snapshot()).revision).toBe(before.revision);
      expect(await body()).toBe(highlighted);
    }
    const beforeCross = await snapshot();
    await cross.locator('.nb-md p').evaluate(paragraph => {
      const first = paragraph.firstChild!, last = paragraph.lastChild!;
      const range = document.createRange();
      range.setStart(first, 0); range.setEnd(last, last.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await blue.click();
    await expect(board.locator('.nb-notice')).toHaveText('请只选择一处完整的普通文字，再添加高亮。');
    expect((await snapshot()).revision).toBe(beforeCross.revision);

    await selectWord(card.locator('mark').filter({ hasText: '旧重点' }), '旧重点');
    await board.getByRole('button', { name: '粉色高亮', exact: true }).click();
    await expect.poll(body).toContain('<mark data-color="pink">旧重点</mark>');
    await selectWord(card.locator('mark').filter({ hasText: '旧重点' }), '旧重点');
    await board.getByRole('button', { name: '清除高亮', exact: true }).click();
    await expect.poll(body).not.toContain('>旧重点</mark>');
    await expect.poll(body).toContain('$x$');
    const beforeDuplicate = await snapshot();
    await selectWord(card.locator('.nb-md p').filter({ hasText: '重复重复' }), '重复');
    await blue.click();
    await expect(board.locator('.nb-notice')).toHaveText('请只选择一处完整的普通文字，再添加高亮。');
    expect((await snapshot()).revision).toBe(beforeDuplicate.revision);

    const rows = tableCard.locator('tbody tr');
    await expect(rows).toHaveCount(6);
    for (const row of await rows.all()) await expect(row.locator('td')).toHaveCount(2);
    await expect(tableCard.locator('.katex-html')).toHaveCount(2);
    await expect(tableCard.getByRole('button', { name: '教材', exact: true })).toHaveAttribute('data-source', '资料.md');
    await expect(tableCard.locator('code')).toHaveText('a|b');
    await expect(rows.nth(4).locator('td').nth(1)).toHaveText('a|b');
    await board.getByRole('button', { name: '导出', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await board.getByRole('dialog', { name: '导出课堂笔记' }).getByRole('button', { name: 'HTML', exact: true }).click();
    const download = await downloadPromise;
    const exportPath = testInfo.outputPath('board-content-safety.html');
    await download.saveAs(exportPath);
    const html = await readFile(exportPath, 'utf8');
    expect((html.match(/<td>/g) ?? []).length).toBe(12);
    expect(html).not.toContain('data-source=');

    // Updating the same path for another session must not reuse the previous
    // session's already-rendered image HTML from the module's shared cache.
    await writeFile(join(client.vault, 'same.svg'), image('blue'));
    await client.script({ '__session-title': '图片课堂乙', '展示图片': { calls: [{ name: 'write_lesson_board', arguments: { title: '同名图片', body: '![[same.svg]]' } }], text: '图片已准备好。' } });
    // Use the native UI entry so the new session belongs to the registered
    // workspace, just as it does when a student starts another classroom.
    await page.getByRole('button', { name: '首页', exact: true }).click();
    await page.getByRole('button', { name: '新的一课', exact: true }).click();
    await expect(input).toBeVisible();
    await input.fill('展示图片'); await input.press('Enter');
    await expect(page.getByText('图片已准备好。').first()).toBeVisible({ timeout: 60_000 });
    await boardTab.click();
    await expect(board.locator('.nb-block')).toHaveCount(1);
    await expect(firstImage).toHaveAttribute('src', `data:image/svg+xml;base64,${Buffer.from(image('blue')).toString('base64')}`);
    expect(await firstImage.getAttribute('src')).not.toBe(redUrl);
    await page.screenshot({ path: testInfo.outputPath('board-content-safety.png') });
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
  } finally {
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await client.close();
    await runtime.stop();
  }
});
