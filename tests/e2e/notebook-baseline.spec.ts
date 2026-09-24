import { openAppearance, closeAppearance } from './fixtures/classroom.ts';
import { test, expect, enterClassroom, sendInput, typeInput } from './fixtures/classroom.ts';

// 手帐主题入口已下线（本轮只发布极简主题）：本用例度量的是手帐横线纸的行基线，
// 属于手帐专属外观，待手帐主题重新开放后再启用。
test.skip('written baselines follow the ruled page through scrolling, font changes and expansion', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterClassroom(page, classroom.authUrl);
  await openAppearance(page); await page.getByTestId('theme-notebook').click(); await closeAppearance(page);
  await sendInput(page, '[markdown]');
  const paragraphs = page.locator('[data-chat-flow-kind="assistant-step"] p');
  await expect(paragraphs.last()).toContainText('阅读后请写出下一步');
  const measure = () => page.evaluate(() => {
    const paper = document.querySelector<HTMLElement>('[data-sf-conversation-paper]')!;
    const css = getComputedStyle(paper), row = parseFloat(css.getPropertyValue('--nb-row'));
    const line = paper.getBoundingClientRect().top + parseFloat(css.backgroundPositionY) + row;
    return [...document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="assistant-step"] p')]
      .filter(p => p.textContent?.includes('阅读后') && p.getClientRects().length)
      .map(p => {
        // A zero-sized inline box sits on the browser's actual text baseline.
        const mark = document.createElement('i');
        mark.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
        p.prepend(mark);
        const delta = mark.getBoundingClientRect().top - line;
        mark.remove();
        const mod = ((delta % row) + row) % row;
        return Math.min(mod, row - mod);
      });
  });
  const aligned = async () => {
    await expect.poll(async () => {
      const errors = await measure();
      return errors.length ? Math.max(...errors) : 999;
    }).toBeLessThan(0.8);
  };
  await aligned();
  await page.locator('[data-conversation-scroll]').evaluate(el => { el.scrollTop -= 113; });
  await aligned();
  await openAppearance(page);
  await page.getByTestId('notebook-scheme').selectOption('bing');
  await page.getByTestId('notebook-size').selectOption('l');
  await closeAppearance(page);
  await aligned();
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'propose_card', arguments: { kind: 'card', title: '小便签', front: '纸张与字迹对齐' } }));
  await expect(page.getByTestId('inline-proposal')).toBeVisible();
  await page.getByTestId('inline-proposal').locator('summary').click();
  await aligned();
  await page.getByTestId('inline-proposal').locator('summary').click();
  await aligned();
  await paragraphs.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('aligned-page.png'), fullPage: true });
  await typeInput(page, '我先检查定义域。');
  await expect(page.locator('[data-composer-input]')).not.toHaveCSS('padding-top', '0px');
});
