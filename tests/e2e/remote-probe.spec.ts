import { expect, test } from '@playwright/test';
import { access } from 'node:fs/promises';
import { startIsolated } from '../../scripts/dev-isolated.ts';

test('generated Remote crosses the native connection and survives Host unload', async ({ page }, testInfo) => {
  const runtime = await startIsolated({ hostEnabled: process.env.STUDYFORGE_PROBE_NO_HOST !== '1' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(runtime.authUrl);
    await page.goto(`${new URL(runtime.authUrl).origin}/?studyforge-probe=1`);
    const button = page.getByTestId('probe-send');
    const result = page.getByTestId('probe-result');
    await expect(button).toBeVisible();
    const notice = page.getByRole('button', { name: 'Continue', exact: true });
    if (await notice.isVisible()) await notice.click();
    await button.click();
    await expect(result).toContainText('空学习空间');
    const first = await result.textContent();
    expect(runtime.log()).toContain(first?.split(' · ')[1] ?? 'missing nonce');
    await page.screenshot({ path: testInfo.outputPath('remote-success.png') });
    await button.click();
    await expect(result).not.toHaveText(first ?? '');
    expect(runtime.log()).toContain('studyforge-probe');

    await runtime.setHostEnabled(false);
    await expect.poll(async () => {
      await button.click();
      return result.textContent();
    }).toContain('连接不可用 · gateway/internal: client api: studyforgeProbe/inspect failed: transport failure for /api/studyforgeProbe/inspect: HTTP 404');
    const handledWhileAbsent = runtime.log().match(/studyforge-probe /g)?.length ?? 0;
    await button.click();
    await expect(result).toContainText('HTTP 404');
    expect(runtime.log().match(/studyforge-probe /g)?.length ?? 0).toBe(handledWhileAbsent);
    await runtime.setHostEnabled(true);
    await expect.poll(async () => {
      await button.click();
      return result.textContent();
    }).toContain('空学习空间');
    await page.reload();
    await expect(button).toHaveCount(1);
    const oldPanel = await page.getByTestId('probe-panel').elementHandle();
    await runtime.rebuildClient();
    await expect.poll(() => oldPanel?.evaluate(element => element.isConnected)).toBe(false);
    await expect(button).toHaveCount(1);
    const handledBeforeClick = runtime.log().match(/studyforge-probe /g)?.length ?? 0;
    await button.click();
    await expect(result).toContainText('空学习空间');
    expect(runtime.log().match(/studyforge-probe /g)?.length ?? 0).toBe(handledBeforeClick + 1);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
    await runtime.stop();
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await testInfo.attach('browser-errors', { body: errors.join('\n'), contentType: 'text/plain' });
    await expect(access(runtime.root)).rejects.toMatchObject({ code: 'ENOENT' });
  }
});
