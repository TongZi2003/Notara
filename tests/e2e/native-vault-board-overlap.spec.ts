import { test, expect } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

test('resized board cards reserve space across sections and growing content pushes automatic cards away', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    client.approvals.auto('allowed-once');
    const flow = '```flow\ndirection right\na[阅读条件] --> b[分析关系]\nb --> c[核对结论]\n```';
    const prose = '比较两个分类标准，先写出各自的含义，再检查条件。$a^2+b^2=c^2$\n\n';
    await client.script({
      '__session-title': '板书避让验收',
      '开始排版': { calls: [
        { name: 'write_lesson_board', arguments: { title: '加宽的板书', section: '第一部分', body: prose + flow } },
        { name: 'write_lesson_board', arguments: { title: '相邻板块', section: '第二部分', body: flow + '\n\n| 维度 | 标准 |\n|---|---|\n| 关系 | 比较与说明 |' } },
        { name: 'write_lesson_board', arguments: { title: '后续补充', section: '第一部分', body: '这段不能压住加宽的板书。' } },
      ], text: '排版内容已准备好。' },
    });
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('开始排版'); await input.press('Enter');
    await expect(page.getByText('排版内容已准备好。').first()).toBeVisible({ timeout: 60_000 });
    const boardTab = page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true });
    await boardTab.click();
    const board = page.locator('.nb-board'), cards = board.locator('.nb-block');
    await expect(cards).toHaveCount(3);
    const sessionId = ((await client.sessions()) as Array<{ sessionId: string; blank?: boolean }>).find(row => !row.blank)!.sessionId;
    const snapshot = () => client.rpc<{ revision: string; blocks: Array<{ id: string; title: string }> }>('notaraVault/board', { input: { sessionId } }).then(client.value);
    const state = await snapshot();
    const pinnedId = state.blocks.find(card => card.title === '加宽的板书')!.id;
    client.value(await client.rpc('notaraVault/mutateBoard', { input: { sessionId, expectedRevision: state.revision, blockId: pinnedId, patch: { x: 60, y: 124, width: 1092 } } }));
    const pinned = cards.filter({ has: page.getByRole('heading', { name: '加宽的板书', exact: true }) });
    await expect(pinned).toHaveAttribute('data-pinned', 'true');
    await expect.poll(() => pinned.evaluate(element => (element as HTMLElement).offsetWidth)).toBe(1092);
    const overlapPairs = () => cards.evaluateAll(elements => {
      const rects = elements.map(element => ({ title: element.querySelector('h2')?.textContent, rect: element.getBoundingClientRect() }));
      return rects.flatMap((a, i) => rects.slice(i + 1).filter(b => a.rect.left < b.rect.right - 1 && a.rect.right > b.rect.left + 1 && a.rect.top < b.rect.bottom - 1 && a.rect.bottom > b.rect.top + 1).map(b => [a.title, b.title]));
    });
    await expect.poll(overlapPairs).toEqual([]);
    await expect(pinned.locator('.katex')).toHaveCount(1);
    await expect(pinned.locator('.nb-flow-host svg')).toHaveCount(1);
    const bounds = () => cards.evaluateAll(elements => elements.map(element => {
      const card = element as HTMLElement;
      return { title: card.querySelector('h2')?.textContent, x: card.offsetLeft, y: card.offsetTop, width: card.offsetWidth, height: card.offsetHeight };
    }));
    const before = await bounds();
    await client.ask(sessionId, '补充内容', { '补充内容': { calls: [{ name: 'write_lesson_board', arguments: { title: '加宽的板书', body: prose.repeat(12) + flow } }], text: '补充完成。' } });
    await expect(pinned.locator('.katex')).toHaveCount(12);
    await expect.poll(overlapPairs).toEqual([]);
    await expect.poll(async () => (await bounds()).find(card => card.title === '后续补充')!.y).toBeGreaterThan(before.find(card => card.title === '后续补充')!.y);
    await expect.poll(async () => (await bounds()).find(card => card.title === '加宽的板书')!.x).toBe(60);
    await board.getByRole('button', { name: '全览', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('board-no-overlap.png') });
    await page.reload();
    await expect(boardTab).toBeVisible();
    await boardTab.click();
    await expect(cards).toHaveCount(3);
    await expect(pinned).toHaveAttribute('data-pinned', 'true');
    await expect.poll(overlapPairs).toEqual([]);
    await expect(pinned.locator('.katex')).toHaveCount(12);
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
  } finally {
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await client.close();
    await runtime.stop();
  }
});
