import { test as base, expect } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { enterClassroom, enableDebug, sendInput } from './fixtures/classroom.ts';
const test = base.extend<{ dsh: IsolatedRuntime }>({ dsh: async ({}, use) => {
  const runtime = await startIsolated({ testModel: true });
  try { await use(runtime); } finally { await runtime.stop(); }
} });

test('proposals stay with their own reply, scroll with chat, and never cover the trajectory tab', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await enterClassroom(page, dsh.authUrl);
  const card = (title: string) => ({ name: 'propose_card', arguments: { kind: 'card', title, front: '先观察条件。\n'.repeat(12) } });
  await sendInput(page, '[tools]' + JSON.stringify([card('第一轮甲'), card('第一轮乙')]));
  const turns = page.getByTestId('inline-proposal-turn');
  try { await expect(turns).toHaveCount(1); }
  catch (error) { throw new Error(JSON.stringify({ errors, page: (await page.locator('body').innerText()).slice(-3500) }), { cause: error }); }
  await expect(turns.first().getByTestId('proposal-card')).toHaveCount(2);
  await sendInput(page, '[tool]' + JSON.stringify(card('第二轮')));
  await expect(turns).toHaveCount(2);
  await expect(turns.first()).not.toContainText('第二轮');
  await expect(turns.last().getByTestId('proposal-card')).toHaveCount(1);
  await expect(page.getByTestId('proposal-inbox')).toHaveCount(0);
  expect(await turns.last().evaluate(el => {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return true;
    }
    return false;
  })).toBe(true);
  const first = turns.first().getByTestId('inline-proposal').first();
  await first.getByTestId('proposal-confirm').click();
  await expect(first.locator('summary')).toContainText('已经保存');
  await expect(first).not.toHaveAttribute('open');
  // Trajectory is a debug view; the ordinary classroom hides it until the
  // Settings → General switch turns debug surfaces on.
  await enableDebug(page);
  await page.getByRole('tab', { name: 'Trajectory', exact: true }).click();
  await expect(turns.first()).toBeHidden();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  // A desktop-open reader becomes a native modal overlay at phone width.
  // Close that separate reader before testing the phone's conversation area.
  const rightbar = page.getByRole('button', { name: 'Collapse right sidebar', exact: true });
  if (await rightbar.count() > 0) await rightbar.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Trajectory', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Trajectory', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('inline-proposals-mobile.png'), fullPage: true });
  await enterClassroom(page, dsh.authUrl);
  await expect(turns).toHaveCount(2);
  await expect(turns.first().getByTestId('inline-proposal').first().locator('summary')).toContainText('已经保存');
});
