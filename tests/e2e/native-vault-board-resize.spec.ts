import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

const board = (page: Page) => page.locator('.nb-board');

test.describe('whiteboard card resizing', () => {
  test.use({ viewport: { width: 1400, height: 920 }, hasTouch: true });

  test('resizes at zoom with touch, reflows KaTeX, survives reload and resets to flow', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const runtime = await startVaultIsolated({ testModel: true });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const client = await connectVault(runtime);
    try {
      client.approvals.auto('allowed-once');
      await client.writeVaultFile('引用资料.md', '# 引用资料\n\n原文应保持不变。\n');
      await client.script({
        '__session-title': '白板卡片大小',
        '开始': { calls: [
          { name: 'write_lesson_board', arguments: {
            title: '可调卡片', section: '等式比较', body: '先把条件完整读一遍：当点 A、B 的中点固定时，横坐标和纵坐标的和与差分别携带不同信息，必须先标明中点，再检查两点是否都满足原来的曲线方程。\n\n因此 $a_{n+1}=a_n+\\dfrac{1}{n}$，继续沿着同一条等式逐项比较，就能看出每一步增加的量都为正。\n\n$$\\int_{-\\infty}^{\\infty}\\dfrac{x^{12}+x^{10}+x^8+x^6+x^4+x^2+1}{(x^2+1)(x^4+x^2+1)(x^6+x^4+x^2+1)}\\,dx=\\pi$$\n\n引用资料：[[引用资料.md|参考资料]]\n\n- 班平均分 $=\\dfrac{\\text{该班写 1 的人数}}{\\text{该班人数}}$\n- 全年级平均 $=\\dfrac{\\text{全体写 1 的人数}}{\\text{总人数}}$' } },
        ], text: '板书好了。' },
      });
      await page.goto(runtime.authUrl);
      const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
      try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
      const input = page.locator('[data-composer-input][contenteditable="true"]').last();
      await input.fill('开始'); await input.press('Enter');
      await expect(page.getByText('板书好了。').first()).toBeVisible({ timeout: 60_000 });
      await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true }).click();
      await expect(board(page).locator('.nb-block')).toHaveCount(1);
      const card = board(page).locator('.nb-block').first();
      await expect(card.locator('.katex-html').first()).toBeVisible();
      await expect(card.locator('.nb-keep').first()).toContainText('，');
      await board(page).locator('.nb-toolbar').getByRole('button', { name: '全览', exact: true }).click();
      const zoomOut = board(page).locator('.nb-toolbar').getByRole('button', { name: '缩小', exact: true });
      let scale = await board(page).locator('.nb-world').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
      for (let attempt = 0; scale > .8 && attempt < 12; attempt++) {
        await zoomOut.click();
        scale = await board(page).locator('.nb-world').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
      }
      expect(scale).toBeLessThan(1);
      expect(scale).toBeGreaterThan(.4);

      const before = await card.evaluate(element => {
        const paragraph = element.querySelector('.nb-md p')!;
        const card = element as HTMLElement;
        return { width: card.offsetWidth, height: card.offsetHeight, paragraphHeight: paragraph.getBoundingClientRect().height, formulas: card.querySelectorAll('.katex').length };
      });
      expect(before.width).toBe(340);
      await card.evaluate(element => {
        document.addEventListener('pointerdown', event => {
          if ((event.target as Element).closest('.nb-resize-handle')) (window as typeof window & { __resizePointerType?: string }).__resizePointerType = event.pointerType;
        }, { capture: true, once: true });
      });
      const grip = card.getByRole('button', { name: /调整大小 可调卡片/ });
      const gripBox = await grip.boundingBox();
      expect(gripBox).toBeTruthy();
      const startX = gripBox!.x + gripBox!.width / 2, startY = gripBox!.y + gripBox!.height / 2;
      const endX = startX - 80 * scale, endY = startY + 80 * scale;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: startX, y: startY }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: endX, y: endY }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __resizePointerType?: string }).__resizePointerType)).toBe('touch');
      await expect.poll(() => card.evaluate(element => (element as HTMLElement).offsetWidth)).toBeLessThan(before.width);
      await expect.poll(() => card.evaluate(element => (element as HTMLElement).offsetHeight)).toBeGreaterThan(before.height);
      await expect(card).toHaveAttribute('data-fixed-height', 'true');
      const after = await card.evaluate(element => {
        const paragraph = element.querySelector('.nb-md p')!;
        const card = element as HTMLElement;
        return { width: card.offsetWidth, height: card.offsetHeight, paragraphHeight: paragraph.getBoundingClientRect().height, formulas: card.querySelectorAll('.katex').length };
      });
      expect(before.width - after.width).toBeGreaterThanOrEqual(70);
      expect(before.width - after.width).toBeLessThanOrEqual(90);
      expect(after.height - before.height).toBeGreaterThanOrEqual(70);
      expect(after.height - before.height).toBeLessThanOrEqual(90);
      expect(after.paragraphHeight).toBeGreaterThan(before.paragraphHeight + 10);
      expect(after.formulas).toBe(before.formulas);
      await expect(card.locator('.katex-html').first()).toBeVisible();
      await expect(card).not.toContainText('$');
      await expect(board(page).locator('.nb-status')).toHaveText('已保存');
      await page.screenshot({ path: testInfo.outputPath('board-resize-reflow.png') });

      // The supported minimum still gives formulas room to wrap, and a short
      // saved height scrolls the whole card body instead of clipping it.
      await board(page).locator('.nb-toolbar').getByRole('button', { name: '全览', exact: true }).click();
      const minScale = await board(page).locator('.nb-world').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
      const minGripBox = await grip.boundingBox();
      expect(minGripBox).toBeTruthy();
      const minStartX = minGripBox!.x + minGripBox!.width / 2, minStartY = minGripBox!.y + minGripBox!.height / 2;
      const minEndX = minStartX - (after.width - 230 + 12) * minScale;
      const minEndY = minStartY - (after.height - 100 + 12) * minScale;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: minStartX, y: minStartY }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: minEndX, y: minEndY }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => card.evaluate(element => { const card = element as HTMLElement; return [card.offsetWidth, card.offsetHeight]; })).toEqual([230, 100]);
      const scroll = card.locator('.nb-card-content');
      const scrollMetrics = await scroll.evaluate(element => { const content = element as HTMLElement; return { clientWidth: content.clientWidth, scrollWidth: content.scrollWidth, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight }; });
      expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth + 1);
      expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
      const wideFormula = card.locator('.katex-display').last();
      const mathScroll = await wideFormula.evaluate(element => { const display = element as HTMLElement; return { clientWidth: display.clientWidth, scrollWidth: display.scrollWidth, overflowX: getComputedStyle(display).overflowX }; });
      expect(mathScroll.overflowX).toBe('auto');
      expect(mathScroll.scrollWidth).toBeGreaterThan(mathScroll.clientWidth);
      const world = board(page).locator('.nb-world');
      const canvasTransform = await world.evaluate(element => getComputedStyle(element).transform);
      const scrollBox = await scroll.boundingBox();
      expect(scrollBox).toBeTruthy();
      const bodyScrollTop = await scroll.evaluate(element => (element as HTMLElement).scrollTop);
      await page.mouse.move(scrollBox!.x + scrollBox!.width / 2, scrollBox!.y + scrollBox!.height / 2);
      await page.mouse.wheel(0, 120);
      await expect.poll(() => scroll.evaluate(element => (element as HTMLElement).scrollTop)).toBeGreaterThan(bodyScrollTop);
      await expect.poll(() => world.evaluate(element => getComputedStyle(element).transform)).toBe(canvasTransform);
      await wideFormula.scrollIntoViewIfNeeded();
      await wideFormula.evaluate(element => { (element as HTMLElement).scrollLeft = 0; });
      const formulaBox = await wideFormula.boundingBox();
      expect(formulaBox).toBeTruthy();
      await page.mouse.move(formulaBox!.x + formulaBox!.width / 2, formulaBox!.y + formulaBox!.height / 2);
      await page.mouse.wheel(120, 0);
      await expect.poll(() => wideFormula.evaluate(element => (element as HTMLElement).scrollLeft)).toBeGreaterThan(0);
      await expect.poll(() => world.evaluate(element => getComputedStyle(element).transform)).toBe(canvasTransform);
      await wideFormula.evaluate(element => { const display = element as HTMLElement; display.scrollLeft = display.scrollWidth; });
      await expect.poll(() => wideFormula.evaluate(element => { const display = element as HTMLElement; return display.scrollLeft + display.clientWidth; })).toBeGreaterThanOrEqual(mathScroll.scrollWidth - 1);
      await scroll.evaluate(element => { const content = element as HTMLElement; content.scrollTop = content.scrollHeight; });
      await expect(card.locator('.nb-md li').last()).toBeInViewport();
      await expect(board(page).locator('.nb-status')).toHaveText('已保存');

      const session = ((await client.sessions()) as Array<{ sessionId: string; blank?: boolean }>).find(row => !row.blank)?.sessionId;
      expect(session).toBeTruthy();
      const persisted = client.value(await client.rpc<{ blocks?: Array<{ width?: number; height?: number }> }>('notaraVault/board', { input: { sessionId: session } }));
      expect(persisted.blocks?.[0]?.width).toBe(230);
      expect(persisted.blocks?.[0]?.height).toBe(100);

      await page.reload();
      await expect(page.getByRole('tablist', { name: '课堂视图' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true }).click();
      const restored = board(page).locator('.nb-block').first();
      await expect(restored).toHaveAttribute('data-fixed-height', 'true');
      expect(await restored.evaluate(element => { const card = element as HTMLElement; return [card.offsetWidth, card.offsetHeight]; })).toEqual([230, 100]);
      const resizeHandle = restored.getByRole('button', { name: /调整大小 可调卡片/ });
      await resizeHandle.focus();
      await resizeHandle.press('ArrowRight');
      await expect.poll(() => restored.evaluate(element => (element as HTMLElement).offsetWidth)).toBe(242);
      await expect(board(page).locator('.nb-status')).toHaveText('已保存');
      await resizeHandle.press('ArrowDown');
      await expect.poll(() => restored.evaluate(element => (element as HTMLElement).offsetHeight)).toBe(112);
      await expect(board(page).locator('.nb-status')).toHaveText('已保存');
      await restored.hover();
      await restored.getByRole('button', { name: '放回排版', exact: true }).click();
      await expect(restored).not.toHaveAttribute('data-fixed-height', 'true');
      await expect.poll(() => restored.evaluate(element => (element as HTMLElement).offsetWidth)).toBe(340);
      const reset = client.value(await client.rpc<{ blocks?: Array<{ x?: number; y?: number; width?: number; height?: number }> }>('notaraVault/board', { input: { sessionId: session } }));
      expect(reset.blocks?.[0]?.x).toBeUndefined();
      expect(reset.blocks?.[0]?.y).toBeUndefined();
      expect(reset.blocks?.[0]?.width).toBeUndefined();
      expect(reset.blocks?.[0]?.height).toBeUndefined();
      const resetMath = restored.locator('.katex-display').last();
      const resetMathMetrics = await resetMath.evaluate(element => {
        const math = element as HTMLElement, content = math.closest('.nb-card-content') as HTMLElement;
        const mathBox = math.getBoundingClientRect(), contentBox = content.getBoundingClientRect();
        return { overflowX: getComputedStyle(math).overflowX, clientWidth: math.clientWidth, scrollWidth: math.scrollWidth, left: mathBox.left, right: mathBox.right, contentLeft: contentBox.left, contentRight: contentBox.right };
      });
      expect(resetMathMetrics.overflowX).toBe('auto');
      expect(resetMathMetrics.scrollWidth).toBeGreaterThan(resetMathMetrics.clientWidth);
      expect(resetMathMetrics.left).toBeGreaterThanOrEqual(resetMathMetrics.contentLeft - 1);
      expect(resetMathMetrics.right).toBeLessThanOrEqual(resetMathMetrics.contentRight + 1);
      await page.screenshot({ path: testInfo.outputPath('board-resize-reset.png') });

      // Source cards in the knowledge view get the same saved two-axis sizing.
      await board(page).getByRole('tab', { name: '知识视图', exact: true }).click();
      const sourceCard = board(page).locator('.nb-block[data-block-id="引用资料.md"]');
      await expect(sourceCard).toBeVisible();
      const sourceBefore = await sourceCard.evaluate(element => {
        const card = element as HTMLElement;
        return { width: card.offsetWidth, height: card.offsetHeight, body: card.querySelector('.nb-body')?.textContent ?? '' };
      });
      const sourceGrip = sourceCard.getByRole('button', { name: /调整大小 引用资料/ });
      await sourceGrip.focus();
      await sourceGrip.press('ArrowRight');
      await expect.poll(() => sourceCard.evaluate(element => (element as HTMLElement).offsetWidth)).toBe(sourceBefore.width + 12);
      await expect(sourceCard).toHaveAttribute('data-fixed-height', 'true');
      await sourceGrip.press('ArrowDown');
      await expect.poll(() => sourceCard.evaluate(element => (element as HTMLElement).offsetHeight)).toBe(sourceBefore.height + 12);
      await expect(board(page).locator('.nb-status')).toHaveText('已保存');
      await expect.poll(() => sourceCard.locator('.nb-body').textContent()).toBe(sourceBefore.body);
      expect(await client.readVaultFile('引用资料.md')).toContain('原文应保持不变。');
      const sourcePersisted = client.value(await client.rpc<{ sources?: Array<{ path: string; width: number; height: number }> }>('notaraVault/board', { input: { sessionId: session } }));
      expect(sourcePersisted.sources?.find(source => source.path === '引用资料.md')).toMatchObject({ width: sourceBefore.width + 12, height: sourceBefore.height + 12 });

      await page.reload();
      await expect(page.getByRole('tablist', { name: '课堂视图' })).toBeVisible({ timeout: 30_000 });
      await board(page).getByRole('tab', { name: '知识视图', exact: true }).click();
      const restoredSource = board(page).locator('.nb-block[data-block-id="引用资料.md"]');
      await expect(restoredSource).toHaveAttribute('data-fixed-height', 'true');
      expect(await restoredSource.evaluate(element => { const card = element as HTMLElement; return [card.offsetWidth, card.offsetHeight]; })).toEqual([sourceBefore.width + 12, sourceBefore.height + 12]);
      await expect(restoredSource.locator('.nb-body')).toHaveText(sourceBefore.body);
      expect(await client.readVaultFile('引用资料.md')).toContain('原文应保持不变。');

      // A tall saved source card must fit as a whole when the student chooses
      // 全览, including its lower edge and resize handle above the toolbar.
      const canvas = board(page).locator('.nb-viewport');
      const canvasHeight = await canvas.evaluate(element => (element as HTMLElement).clientHeight);
      const restoredSourceGrip = restoredSource.getByRole('button', { name: /调整大小 引用资料/ });
      await restoredSourceGrip.focus();
      let sourceHeight = sourceBefore.height + 12;
      while (sourceHeight < canvasHeight + 120) {
        await page.keyboard.press('Shift+ArrowDown');
        sourceHeight += 40;
        await expect.poll(() => restoredSource.evaluate(element => (element as HTMLElement).offsetHeight)).toBe(sourceHeight);
        await expect(board(page).locator('.nb-status')).toHaveText('已保存');
      }
      await board(page).locator('.nb-toolbar').getByRole('button', { name: '全览', exact: true }).click();
      const fitBounds = await restoredSource.evaluate(element => {
        const card = element.getBoundingClientRect();
        const canvas = element.closest('.nb-viewport')!.getBoundingClientRect();
        return { card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom }, canvas: { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom } };
      });
      await testInfo.attach('source-overview-bounds', { body: JSON.stringify(fitBounds), contentType: 'application/json' });
      await page.screenshot({ path: testInfo.outputPath('source-resize-overview.png') });
      expect(fitBounds.card.left).toBeGreaterThanOrEqual(fitBounds.canvas.left - 1);
      expect(fitBounds.card.top).toBeGreaterThanOrEqual(fitBounds.canvas.top - 1);
      expect(fitBounds.card.right).toBeLessThanOrEqual(fitBounds.canvas.right + 1);
      expect(fitBounds.card.bottom).toBeLessThanOrEqual(fitBounds.canvas.bottom - 70);
      await cdp.detach();
    } finally {
      await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
      await client.close();
      await runtime.stop();
    }
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
  });
});
