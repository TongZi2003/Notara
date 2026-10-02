import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

test('four simultaneous browser pages sustain navigation and settings cycles without losing classroom data', async ({ browser }, testInfo) => {
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const pages: Page[] = [];
  const errors: string[] = [], timings: number[] = [], heaps: Array<{ before: number; after: number; growth: number }> = [];
  let requests = 0, completedCycles = 0;
  const started = performance.now();
  try {
    const material = '# 浏览器压力资料\n\n原始材料和公式必须保留：$x^2+y^2=1$。\n';
    await mkdir(join(client.vault, '压力测试'), { recursive: true });
    await Promise.all(Array.from({ length: 60 }, (_, index) => client.writeVaultFile(`压力测试/资料-${index}.md`, material + `\n资料编号 ${index}\n`)));
    await client.script(Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`浏览器压力-${index}`, `第 ${index} 节合成课堂。$a^2+b^2=c^2$。`])));
    const { workspace } = client.value(await client.rpc<{ workspace: { workspaceId: string } }>('workspace/create', { request: { path: client.workspace } }));
    const sessions = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const { sessionId: id } = client.value(await client.rpc<{ sessionId: string }>('session/create', { request: { workspaceId: workspace.workspaceId, agentPreset: 'notara-teacher' } }));
      await client.ask(id, `浏览器压力-${index}`);
      await client.rename(id, `压力课堂-${index}`);
      return id;
    }));
    for (let index = 0; index < 4; index++) {
      const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
      page.on('pageerror', error => errors.push(`page-${index}: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error' && !/favicon|net::ERR_ABORTED/i.test(message.text())) errors.push(`page-${index}: ${message.text()}`); });
      page.on('response', response => { requests++; if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`); });
      pages.push(page);
    }
    const pageResults = await Promise.allSettled(pages.map(async (page, index) => {
      await page.goto(runtime.authUrl);
      const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
      try { await later.waitFor({ timeout: 6000 }); await later.click(); } catch { /* preference already initialized */ }
      const rail = page.getByRole('navigation', { name: '学习导航' });
      await expect(rail).toBeVisible();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Performance.getMetrics')).metrics.find((metric: { name: string }) => metric.name === 'JSHeapUsedSize')?.value ?? 0;
      };
      const cycle = async () => {
        const start = performance.now();
        for (const name of ['计划', 'Vault', '技能', '首页']) {
          await rail.getByRole('button', { name, exact: true }).click();
          await expect(rail.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
        }
        const lesson = page.locator('.nv-panel').getByTitle(`压力课堂-${index}`, { exact: true });
        await lesson.click();
        await expect(page.getByRole('tablist', { name: '课堂视图' })).toBeVisible();
        for (const name of ['白板', '教室', '对话']) {
          const tab = page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name, exact: true });
          await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
        await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
        await page.getByText('远控设置', { exact: true }).first().click();
        await expect(page.locator('.nv-remote-settings')).toBeVisible();
        await expect(page.locator('.nv-remote-settings').getByRole('button', { name: '启用远控' })).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(page.locator('.nv-remote-settings')).toHaveCount(0);
        timings.push(performance.now() - start); completedCycles++;
      };
      await cycle(); // Warm the lazy views before measuring retained heap growth.
      const before = await heap();
      for (let repeat = 0; repeat < 7; repeat++) await cycle();
      const after = await heap(); heaps.push({ before, after, growth: after - before });
      // This detects substantial retained growth; it is not a universal memory capacity claim.
      expect(after - before).toBeLessThan(80 * 1024 * 1024);
      await page.reload();
      await expect(page.getByRole('tablist', { name: '课堂视图' })).toBeVisible();
      await expect(page.getByText(`第 ${index} 节合成课堂。`, { exact: false }).first()).toBeVisible();
      if (index === 0) await page.screenshot({ path: testInfo.outputPath('browser-stress-final.png') });
      await cdp.detach();
    }));
    expect(pageResults.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : [])).toEqual([]);
    expect(completedCycles).toBe(32);
    expect((await client.sessions()).map(row => row.sessionId)).toEqual(expect.arrayContaining(sessions));
    for (let index = 0; index < 60; index++) expect(await readFile(join(client.vault, `压力测试/资料-${index}.md`), 'utf8')).toBe(material + `\n资料编号 ${index}\n`);
    expect(errors).toEqual([]);
  } finally {
    if (completedCycles !== 32) for (const [index, page] of pages.entries()) {
      await testInfo.attach(`page-${index}-snapshot`, { body: await page.locator('body').ariaSnapshot().catch(() => 'page unavailable'), contentType: 'text/plain' });
      await page.screenshot({ path: testInfo.outputPath(`page-${index}-failure.png`) }).catch(() => {});
    }
    const sorted = [...timings].sort((a, b) => a - b);
    const report = { synthetic: true, browserPages: 4, materialFiles: 60, seededSessions: 12, completedCycles, responses: requests,
      elapsedMs: Math.round(performance.now() - started), cycleP50Ms: Math.round(sorted[Math.floor(sorted.length * .5)] ?? 0), cycleP95Ms: Math.round(sorted[Math.floor(sorted.length * .95)] ?? 0), heaps, errors };
    await mkdir('.runtime', { recursive: true });
    await writeFile('.runtime/browser-stress-report.json', JSON.stringify(report, null, 2));
    await testInfo.attach('stress-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await Promise.all(pages.map(page => page.close()));
    await client.close(); await runtime.stop();
  }
});
