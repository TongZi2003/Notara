import { openAppearance, closeAppearance } from './fixtures/classroom.ts';
import { test, expect, enterClassroom, sendInput } from './fixtures/classroom.ts';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import { connectRuntime } from '../fixtures/http-runtime.ts';

// 手帐主题入口已下线（本轮只发布极简主题）：本用例断言纸面纹理、纸色、表格字迹与
// 手帐活页确认单，全部属于手帐专属外观，待手帐主题重新开放后再启用。
test.skip('the whole conversation uses paper, wide tables stay inside, and confirmation uses the original loose slip', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterClassroom(page, classroom.authUrl);
  await openAppearance(page); await page.getByTestId('theme-notebook').click(); await closeAppearance(page);
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'propose_card', arguments: { kind: 'card', title: '[notebook-table] 和差公式', front: '先检查象限，再展开公式。' } }));
  const tables = page.locator('[data-chat-flow-kind="assistant-step"] table');
  await expect(tables).toHaveCount(3);
  const paper = page.locator('[data-sf-conversation-paper]');
  await expect(paper).toHaveCSS('background-image', /gradient/);
  await expect(page.locator('[data-chat-flow]')).toHaveCSS('box-shadow', 'none');
  async function containedTables() {
    for (const table of await tables.all()) {
      const geometry = await table.evaluate(el => {
        const wrap = el.parentElement!, text = el.closest('[data-chat-flow-kind]')!;
        const a = wrap.getBoundingClientRect(), b = text.getBoundingClientRect();
        return { left: a.left >= b.left - 1, right: a.right <= b.right + 1, overflow: getComputedStyle(wrap).overflowX, padding: getComputedStyle(wrap).padding };
      });
      expect(geometry).toEqual({ left: true, right: true, overflow: 'auto', padding: '0px' });
    }
    await expect.poll(async () => page.locator('[data-conversation-scroll]').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await containedTables();
  await expect.poll(() => tables.evaluateAll(elements => {
    const paper = document.querySelector('[data-sf-conversation-paper]')!;
    const css = getComputedStyle(paper), row = parseFloat(css.getPropertyValue('--nb-row'));
    const rule = paper.getBoundingClientRect().top + parseFloat(css.backgroundPositionY) + row;
    return Math.max(...elements.flatMap(table => [...table.querySelectorAll('th,td')].map(cell => {
      const marker = document.createElement('i');
      marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
      cell.prepend(marker); const delta = marker.getBoundingClientRect().top - rule; marker.remove();
      const mod = ((delta % row) + row) % row;
      return Math.min(mod, row - mod);
    })));
  })).toBeLessThan(0.8);
  expect(await tables.first().evaluate(el => {
    const table = el.getBoundingClientRect(), wrap = el.parentElement!.getBoundingClientRect();
    return table.width < wrap.width && Math.abs((table.left + table.right) - (wrap.left + wrap.right)) < 2;
  })).toBe(true);
  await expect(page.getByTestId('workspace-open-materials')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('[data-slot="conversation.session.header.actions"] [data-testid="open-lesson-settings"]')).toHaveCount(0);
  await expect(tables.first().locator('td').first()).toHaveCSS('font-family', /SF Long Cang/);
  const proposal = page.getByTestId('inline-proposal');
  const slip = proposal.getByTestId('proposal-slip');
  await expect(slip).toHaveCSS('border-top-style', 'dashed');
  await expect(slip).not.toHaveCSS('transform', 'none');
  await expect(proposal.getByTestId('proposal-confirm')).toHaveCSS('background-color', 'rgb(201, 58, 46)');
  await expect(proposal.getByTestId('proposal-reject')).toHaveCSS('border-top-style', 'dashed');
  await page.screenshot({ path: info.outputPath('paper-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await containedTables();
  // The final column remains reachable through the table's own scroll area.
  expect(await tables.last().evaluate(el => {
    const wrap = el.parentElement!; wrap.scrollLeft = wrap.scrollWidth;
    const last = el.querySelector('td:last-child')!.getBoundingClientRect();
    return wrap.scrollLeft > 0 && last.right <= wrap.getBoundingClientRect().right + 1;
  })).toBe(true);
  await proposal.getByTestId('proposal-confirm').click();
  await expect(proposal.locator('summary')).toContainText('已经保存');
  const client = await connectRuntime(classroom);
  await expect.poll(async () => {
    const result = await client.rpc<SessionListValue>('session/list', { _request: {} });
    return result.ok && result.value.items.every(item => !item.running);
  }).toBe(true);
  await proposal.locator('summary').click();
  await expect(slip).toHaveCSS('border-top-style', 'solid');
  expect(await slip.evaluate(el => getComputedStyle(el, '::before').content)).not.toBe('none');
  await expect(proposal.getByTestId('proposal-item-status')).toHaveCSS('width', '46px');
  await slip.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('saved-slip-mobile.png'), fullPage: true });
  await openAppearance(page);
  await page.getByTestId('notebook-tone').selectOption('white');
  await page.getByTestId('notebook-paper').selectOption('fangge');
  await page.getByTestId('notebook-table-font').selectOption('print');
  await closeAppearance(page);
  await expect(tables.first().locator('td').first()).toHaveCSS('font-family', /Songti SC/);
  await expect(paper).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(paper).toHaveCSS('background-image', /linear-gradient.*linear-gradient/);
  await page.screenshot({ path: info.outputPath('paper-white-mobile.png'), fullPage: true });
  await openAppearance(page);
  await page.getByTestId('notebook-table-font').selectOption('follow');
  await page.getByTestId('notebook-scheme').selectOption('bing');
  await page.reload();
  await openAppearance(page);
  await expect(page.getByTestId('notebook-table-font')).toHaveValue('follow');
  await closeAppearance(page);
  await expect(tables.first().locator('td').first()).toHaveCSS('font-family', /SF WenKai/);
});
