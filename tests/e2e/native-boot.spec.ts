import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/dsh.ts';

/** First-run notices are modal and ordered; a returning boot shows none. */
async function settle(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    try {
      await button.waitFor({ state: 'visible', timeout: 5_000 });
      await button.click();
    } catch { /* onboarding is a one-time surface */ }
  }
}

test('native classroom survives refresh, HMR and Client lifecycle without a placeholder shell', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  const hmrFrames: string[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.eventSourceMessageReceived', (event: { data: string }) => {
    const value: unknown = JSON.parse(event.data);
    if (value && typeof value === 'object' && 'type' in value) {
      if (value.type === 'rebuilt') hmrFrames.push(JSON.stringify(value));
      else if (value.type === 'graph') hmrFrames.push('graph');
    }
  });
  let revisionBefore = '';
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(dsh.authUrl);
    await settle(page);
    await expect(page.getByTestId('studyforge-page-studyforge.home')).toBeVisible();
    await page.getByTestId('open-classroom').click();

    // The native Conversation owns `main`/`conversation`; this client only adds seats.
    await expect(page.locator('[data-conversation-scroll]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    await expect(page.getByTestId('studyforge-shell')).toHaveCount(0);
    await expect(page.getByTestId('probe-panel')).toHaveCount(0);
    await expect(page.locator('[data-studyforge-style="p2"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '首页', exact: true })).toBeVisible();

    // Student surfaces keep the paper-and-ink copy free of internals.
    await page.getByRole('button', { name: '资料', exact: true }).click();
    const materials = page.getByTestId('studyforge-page-studyforge.materials');
    await expect(materials).toBeVisible();
    await expect(page.locator('[data-conversation-scroll]')).toHaveCount(0);
    expect(await materials.innerText()).not.toMatch(/probe|sessionId|schema|\/Users\/|\.jsonl|studyforge\./);
    await page.screenshot({ path: testInfo.outputPath('student-page.png') });
    await page.getByRole('button', { name: '首页', exact: true }).click();
    await page.getByTestId('open-classroom').click();
    await expect(page.locator('[data-conversation-scroll]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('native-classroom.png') });

    // Refresh rebuilds the client contributions without touching the native side.
    await page.reload();
    await settle(page);
    await expect(page.locator('[data-studyforge-style="p2"]')).toHaveCount(1);
    await expect(page.locator('[data-conversation-scroll]')).toBeVisible();

    // HMR swaps our style tag in place; the shell handle is replaced without a navigation.
    const oldStyle = await page.locator('[data-studyforge-style="p2"]').elementHandle();
    let navigations = 0;
    const onNavigation = (): void => { navigations += 1; };
    page.on('framenavigated', onNavigation);
    revisionBefore = /"id":"@studyforge\/dsh-client"[^}]*"rev":"([^"]+)"/.exec(await (await page.request.get(new URL(dsh.authUrl).origin)).text())?.[1] ?? 'missing';
    await dsh.rebuildClient();
    await expect.poll(async () => ({ style: await oldStyle?.evaluate(element => element.isConnected) })).toEqual({ style: false });
    await expect(page.locator('[data-studyforge-style="p2"]')).toHaveCount(1);
    await expect(page.locator('[data-conversation-scroll]')).toBeVisible();
    page.off('framenavigated', onNavigation);
    expect(navigations).toBe(0);
    // Replacing the sidebar presentation can remount native onboarding when
    // this model-free fixture chose Configure later. No credential is invented.
    await settle(page);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await dsh.setClientEnabled(false);
    await expect.poll(async () => (await page.request.get(new URL(dsh.authUrl).origin)).text()).not.toContain('@studyforge/dsh-client');
    await page.reload();
    await settle(page);
    await expect(page.locator('[data-studyforge-style="p2"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '首页', exact: true })).toHaveCount(0);
    // Uninstalling the client leaves the classroom itself fully intact.
    await expect(page.locator('[data-conversation-scroll]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('native-ui-restored.png') });

    await dsh.setClientEnabled(true);
    await expect.poll(async () => (await page.request.get(new URL(dsh.authUrl).origin)).text()).toContain('@studyforge/dsh-client');
    await page.reload();
    await settle(page);
    await expect(page.locator('[data-studyforge-style="p2"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '日历', exact: true })).toBeVisible();

    // The smallest supported viewport keeps the entries reachable and unclipped.
    await page.setViewportSize({ width: 390, height: 844 });
    const calendarRow = page.getByTestId('notebook-sidebar').getByRole('button', { name: '日历', exact: true });
    await expect(calendarRow).toBeVisible();
    await calendarRow.click();
    const calendar = page.getByTestId('studyforge-page-studyforge.calendar');
    await expect(calendar).toBeVisible();
    await expect.poll(async () => (await calendar.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('narrow.png') });
    expect(errors).toEqual([]);
  } finally {
    const revisionAfter = /"id":"@studyforge\/dsh-client"[^}]*"rev":"([^"]+)"/.exec(await (await page.request.get(new URL(dsh.authUrl).origin)).text())?.[1] ?? 'missing';
    console.log(JSON.stringify({ revisionBefore, revisionAfter, hmrFrames }));
    await testInfo.attach('hmr-diagnostics', { body: JSON.stringify({ revisionBefore, revisionAfter, hmrFrames }), contentType: 'application/json' });
    await testInfo.attach('browser-console', { body: errors.join('\n'), contentType: 'text/plain' });
  }
});
