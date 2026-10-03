import { expect, test } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

test('automatic onboarding preserves Settings while the selected lesson is still restoring', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  let holdSessions = false;
  let releaseSessions!: () => void;
  const sessionGate = new Promise<void>(resolve => { releaseSessions = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(`
    window.__notaraTestHoldWorkspace = sessionStorage.getItem('__notaraTestHoldWorkspace') === '1';
  `);
  // The transport multiplexes Workspace follow frames. Hold only delivery of
  // the genuine baseline, leaving its contents and every native state transition intact.
  await page.route('**/plugins/**', async route => {
    const url = route.request().url();
    if (!url.includes('dsh-api-workspace-controller') && !url.includes('dsh-api-session-controller')) return route.continue();
    const response = await route.fetch();
    let source = await response.text();
    if (source.includes('replaceBaseline(baseline) {')) {
      expect(source.split('replaceBaseline(baseline) {')).toHaveLength(2);
      source = source.replace('replaceBaseline(baseline) {', `replaceBaseline(baseline) {
        if (globalThis.__notaraTestHoldWorkspace) {
          globalThis.__notaraTestResumeWorkspace = () => {
            globalThis.__notaraTestHoldWorkspace = false;
            this.replaceBaseline(baseline);
          };
          return;
        }`);
    }
    if (source.includes('rootCtx.reflect.provide("sessions", this, void 0);')) {
      expect(source.split('rootCtx.reflect.provide("sessions", this, void 0);')).toHaveLength(2);
      source = source.replace('rootCtx.reflect.provide("sessions", this, void 0);',
        'rootCtx.reflect.provide("sessions", this, void 0); globalThis.__notaraTestSessions = this;');
    }
    await route.fulfill({ response, body: source });
  });
  await page.route('**/api/session/list', async route => {
    if (holdSessions) await sessionGate;
    await route.continue();
  });
  try {
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* configured synthetic provider */ }
    await expect(page.locator('.nv-home')).toBeVisible();
    // Create a nonblank, genuinely selected lesson so its saved mainView
    // must be restored when the delayed Workspace baseline arrives.
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('设置恢复测试'); await input.press('Enter');
    await expect(page.locator('.hWmORq_body').last()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tab', { name: '卡片', exact: true }).click();

    await page.evaluate(() => sessionStorage.setItem('__notaraTestHoldWorkspace', '1'));
    holdSessions = true;
    await page.reload();
    await expect(page.locator('.nv-rail')).toBeVisible();
    await page.waitForFunction(() => typeof (window as any).__notaraTestResumeWorkspace === 'function');
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    const panel = page.locator('[data-shortcut-modal="settings"]');
    await expect(panel).toBeVisible();
    await panel.getByText('学习界面', { exact: true }).click();
    await expect(panel.getByRole('radio', { name: /^极简/ })).toBeVisible();

    // Let the actual unary request finish. A ready Session list without the
    // Workspace baseline has no mainView yet and previously dismissed Settings.
    holdSessions = false; releaseSessions();
    await page.waitForFunction(() => (window as any).__notaraTestSessions?.list.getSnapshot().phase === 'ready');
    expect(await page.evaluate(() => Object.values((window as any).__notaraTestSessions.list.getSnapshot().byId)
      .some((row: any) => (row.retainedBy.mainView ?? 0) > 0))).toBe(false);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('radio', { name: /^极简/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('settings-restored.png') });

    await page.evaluate(() => (window as any).__notaraTestResumeWorkspace());
    await page.waitForFunction(() => Object.values((window as any).__notaraTestSessions.list.getSnapshot().byId)
      .some((row: any) => (row.retainedBy.mainView ?? 0) > 0));
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('radio', { name: /^极简/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  } finally {
    holdSessions = false; releaseSessions();
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await page.close();
    await runtime.stop();
  }
  expect(errors).toEqual([]);
});
