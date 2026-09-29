import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * Board typesetting in a real browser: fractions with Chinese text inside
 * stand taller than KaTeX's font metrics say, so two such lines must not run
 * into each other; and a comma right after inline math stays on the math's line.
 */
const board = (page: Page) => page.locator('.nb-board');
test('fractions with Chinese text keep their lines apart and a comma never starts a line after math', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectVault(runtime);
  try {
    client.approvals.auto('allowed-once');
    await client.script({
      '__session-title': '白板排版',
      '开始上课': { calls: [
        { name: 'write_lesson_board', arguments: { title: '两行分式：$P(B)$', size: 'wide', section: '证明 $14<a_{100}<18$', body: '- 班平均分 $=\\dfrac{\\text{该班写 1 的人数}}{\\text{该班人数}}=P(B\\mid A_i)$\n- 全年级平均 $=\\dfrac{\\text{全体写 1 的人数}}{\\text{总人数}}=P(B)$' } },
        { name: 'write_lesson_board', arguments: { title: '标点', body: '因为 $\\dfrac{1}{a_n}>0$，所以 $a_{n+1}>a_n$，数列递增；又 $a_1=1>0$，故 $a_n\\ge 1$（各项都为正）。' } },
        { name: 'write_lesson_board', arguments: { title: '长公式', body: '展开得 $a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}=b_1+b_2+b_3+b_4+b_5+b_6+b_7+b_8+b_9+b_{10}$，这一行要能折开。' } },
      ], text: '板上写好了。' },
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('开始上课'); await input.press('Enter');
    await expect(page.getByText('板上写好了。').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true }).click();
    await expect(board(page).locator('.nb-block')).toHaveCount(3);
    await expect(board(page).locator('.nb-block .katex').first()).toBeVisible();
    await page.waitForTimeout(400);

    // Titles carry formulas the same way the body does, and show no source.
    const sectionTitle = board(page).locator('.nb-section-title').first();
    await expect(sectionTitle.locator('.katex')).toHaveCount(1);
    await expect(sectionTitle).not.toContainText('$');
    await expect(sectionTitle).toHaveAttribute('title', '证明 $14<a_{100}<18$');
    await expect(board(page).locator('.nb-block h2').first().locator('.katex')).toHaveCount(1);
    // What the eye sees: the drawn glyphs of one line end above the next line's.
    const extents = await board(page).locator('.nb-block li').evaluateAll(items => items.map(item => {
      let top = Infinity, bottom = -Infinity;
      for (const leaf of item.querySelectorAll('.katex-html *')) {
        if (leaf.children.length || !leaf.textContent?.trim()) continue;
        const rect = leaf.getBoundingClientRect();
        if (rect.height) { top = Math.min(top, rect.top); bottom = Math.max(bottom, rect.bottom); }
      }
      return { top, bottom };
    }));
    expect(extents).toHaveLength(2);
    const [first, second] = extents as [{ top: number; bottom: number }, { top: number; bottom: number }];
    expect(first.bottom, 'the first fraction runs into the second line').toBeLessThanOrEqual(second.top);

    // Sweep the sentence through many widths: wherever the line breaks, the
    // punctuation after a formula stays on the line of the formula's last piece.
    const stranded = await board(page).locator('.nb-block p', { hasText: '各项都为正' }).evaluate(paragraph => {
      const probe = paragraph.cloneNode(true) as HTMLElement;
      probe.style.cssText = 'position:absolute;left:0;top:0;margin:0;visibility:hidden';
      paragraph.parentElement!.appendChild(probe);
      const found: string[] = [];
      let checked = 0;
      for (let width = 160; width <= 520; width += 3) {
        probe.style.width = `${width}px`;
        for (const math of probe.querySelectorAll('.katex')) {
          const next = math.nextSibling;
          // An invisible word joiner may sit between the formula and its punctuation.
          const lead = next?.textContent?.startsWith('\u2060') ? 1 : 0;
          if (!next || next.nodeType !== Node.TEXT_NODE || !/^[，。；、]/.test(next.textContent!.slice(lead))) continue;
          checked += 1;
          const range = document.createRange(); range.setStart(next, lead); range.setEnd(next, lead + 1);
          const mark = range.getBoundingClientRect(), last = [...math.querySelectorAll('.katex-html > .base')].at(-1)!.getBoundingClientRect();
          if (!(mark.top < last.bottom && mark.bottom > last.top)) found.push(`${width}px: ${next.textContent!.slice(lead, lead + 2)}`);
        }
      }
      probe.remove();
      return { found, checked };
    });
    expect(stranded.checked, 'the sweep found the punctuation after each formula').toBeGreaterThan(300);
    expect(stranded.found, 'punctuation after a formula starts a new line').toEqual([]);
    // Keeping the comma with the formula still lets a long formula break between its terms.
    const long = await board(page).locator('.nb-block p', { hasText: '这一行要能折开' }).evaluate(paragraph => {
      const probe = paragraph.cloneNode(true) as HTMLElement;
      probe.style.cssText = 'position:absolute;left:0;top:0;margin:0;visibility:hidden;width:180px';
      paragraph.parentElement!.appendChild(probe);
      const lines = new Set([...probe.querySelectorAll('.katex-html > .base')].map(piece => Math.round(piece.getBoundingClientRect().top))).size;
      const overflow = probe.scrollWidth - 180;
      probe.remove();
      return { lines, overflow };
    });
    expect(long.lines, 'the long formula stays on one line').toBeGreaterThan(1);
    expect(long.overflow, 'the long formula runs out of its block').toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('board-typesetting.png') });

    // On a narrow screen the board and the conversation take turns: 追问这块
    // turns to the conversation, where the draft waits in the one input.
    await page.setViewportSize({ width: 560, height: 900 });
    const views = page.getByRole('tablist', { name: '课堂视图' });
    await expect(views.getByRole('tab', { name: '白板', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.locator('.nb-block', { hasText: '各项都为正' }).getByRole('button', { name: '追问这块', exact: true }).click();
    await expect(views.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute('aria-selected', 'true');
    const draft = page.locator('[data-composer-input][contenteditable="true"]').last();
    await expect(draft).toBeVisible();
    await expect(draft).toContainText('｜标点〕');
    await page.screenshot({ path: testInfo.outputPath('narrow-ask.png') });
  } finally {
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
});
