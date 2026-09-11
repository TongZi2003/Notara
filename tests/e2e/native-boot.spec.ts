import { join } from 'node:path';
import { test, expect } from './fixtures/dsh.ts';

test('native student slots, Markdown preview, refresh and Client lifecycle', async ({ page, dsh }, testInfo) => {
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
    const shell = page.getByTestId('studyforge-shell');
    await expect(shell).toBeVisible();
    const notice = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(notice).toBeVisible();
    await notice.click();
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await expect(page.getByTestId('probe-send')).toHaveCount(0);
    await expect(page.locator('[data-studyforge-style="p0"]')).toHaveCount(1);
    expect(await shell.innerText()).not.toMatch(/probe|sessionId|\/Users\/|\.jsonl|schema/);
    await page.screenshot({ path: testInfo.outputPath('three-columns.png') });

    // Native identity is needed only to authorize the synthetic file preview.
    // This creates no prompt, model request or StudyForge learning facts.
    const origin = new URL(dsh.authUrl).origin;
    const response = await page.request.post(`${origin}/api/session/create`, {
      headers: { Origin: origin }, data: {
        type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/create',
        payload: { args: { request: { cwd: join(dsh.root, 'classroom') } } },
      },
    });
    expect(response.status()).toBe(200);
    const created: unknown = await response.json();
    expect(created).toMatchObject({ type: 'server-response', result: { ok: true } });
    await page.reload();
    await expect(shell).toHaveCount(1);
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await page.getByTestId('preview-example').click();
    await expect(page.getByRole('heading', { name: '一起读这一小段', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '一起读这一小段', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.locator('body').innerText()).not.toContain(dsh.root);
    await expect(page.locator('[data-textpreview-path]')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('native-markdown-preview.png') });
    await page.reload();
    await expect(shell).toHaveCount(1);
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();

    const oldShell = await shell.elementHandle();
    const oldStyle = await page.locator('[data-studyforge-style="p0"]').elementHandle();
    let navigations = 0;
    const onNavigation = (): void => { navigations += 1; };
    page.on('framenavigated', onNavigation);
    revisionBefore = /"id":"@studyforge\/dsh-client"[^}]*"rev":"([^"]+)"/.exec(await (await page.request.get(origin)).text())?.[1] ?? 'missing';
    await dsh.rebuildClient();
    await expect.poll(async () => ({ shell: await oldShell?.evaluate(element => element.isConnected), style: await oldStyle?.evaluate(element => element.isConnected) })).toEqual({ shell: false, style: false });
    await expect(shell).toHaveCount(1);
    await expect(page.locator('[data-studyforge-style="p0"]')).toHaveCount(1);
    page.off('framenavigated', onNavigation);
    expect(navigations).toBe(0);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await dsh.setClientEnabled(false);
    await expect.poll(async () => (await page.request.get(origin)).text()).not.toContain('@studyforge/dsh-client');
    await page.reload();
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await expect(shell).toHaveCount(0);
    await expect(page.locator('[data-studyforge-style="p0"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('native-ui-restored.png') });
    await dsh.setClientEnabled(true);
    await expect.poll(async () => (await page.request.get(origin)).text()).toContain('@studyforge/dsh-client');
    await page.reload();
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await expect(shell).toHaveCount(1);
    await expect(page.locator('[data-studyforge-style="p0"]')).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(shell).toBeVisible();
    // The native ResizeObserver and column transition settle asynchronously.
    // No horizontal overflow alone can pass while a clipped center is unusable.
    await expect.poll(async () => (await shell.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(330);
    await expect(page.getByTestId('preview-example')).toBeInViewport({ ratio: 1 });
    const rail = page.getByRole('navigation', { name: '学习导航' });
    await expect(rail).toHaveAttribute('data-wide', 'false');
    await expect(rail.getByRole('button', { name: '学习空间', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(rail.locator('.sf-nav-title')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('narrow.png') });
    expect(errors).toEqual([]);
  } finally {
    const revisionAfter = /"id":"@studyforge\/dsh-client"[^}]*"rev":"([^"]+)"/.exec(await (await page.request.get(new URL(dsh.authUrl).origin)).text())?.[1] ?? 'missing';
    console.log(JSON.stringify({ revisionBefore, revisionAfter, hmrFrames }));
    await testInfo.attach('hmr-diagnostics', { body: JSON.stringify({ revisionBefore, revisionAfter, hmrFrames }), contentType: 'application/json' });
    await page.close();
    await testInfo.attach('browser-console', { body: errors.join('\n'), contentType: 'text/plain' });
  }
});
