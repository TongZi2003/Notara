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
  await page.goto(authUrl);
  for (const name of ['Continue', 'Configure later']) {
    const button = page.getByRole('button', { name, exact: true });
    try { await button.waitFor({ state: 'visible', timeout: 3000 }); await button.click(); }
    catch { /* Returning sessions and configured test providers do not repeat onboarding. */ }
  }
  await expect(page.locator('[data-composer-input]')).toBeVisible();
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
