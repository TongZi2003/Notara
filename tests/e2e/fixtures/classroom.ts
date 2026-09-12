import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../../scripts/dev-isolated.ts';

export const test = base.extend<{ classroom: IsolatedRuntime }>({
  classroom: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('native-host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});
export { expect };
export async function enterClassroom(page: Page, authUrl: string): Promise<void> {
  const target = new URL(authUrl); target.hash = '#studyforge/classroom';
  await page.goto(target.href);
  for (const name of ['Continue', 'Configure later']) {
    const button = page.getByRole('button', { name, exact: true });
    try { await button.waitFor({ state: 'visible', timeout: 3000 }); await button.click(); }
    catch { /* Returning sessions and configured test providers do not repeat onboarding. */ }
  }
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  // The original notebook groups secondary destinations under “更多”. Tests
  // that cover those destinations open the same disclosure a student uses.
  const more = page.locator('.sf-side-more');
  if (await more.count() && !(await more.getAttribute('open') !== null)) await more.locator('summary').click();
}
export async function typeInput(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-composer-input]');
  await input.click();
  // Native preparation blocks (e.g. loading this message's source crops)
  // explicitly make the composer inert until its visible reference is ready.
  await expect(input).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.insertText(text);
}
export async function sendInput(page: Page, text: string): Promise<void> {
  await typeInput(page, text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
