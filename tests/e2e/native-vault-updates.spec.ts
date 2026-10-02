import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startVaultIsolated, startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { superviseVault } from '../../scripts/vault-supervisor.ts';

test('the update notice survives an action error and the settings can check again', async ({ page }, testInfo) => {
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = []; let applied = 0, checked = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/notaraVault/*', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1);
    if (method === 'updateStatus' || method === 'checkUpdate') {
      if (method === 'checkUpdate') checked++;
      await route.fulfill({ json: { result: { ok: true, value: { phase: 'ready', currentVersion: '0.22.0', latestVersion: '0.22.1', launchId: 'synthetic-launch', message: '新版已准备好，课堂空闲时可以重启更新。' } } } });
    } else if (method === 'applyUpdate') {
      applied++;
      await route.fulfill({ json: { result: { ok: false, error: { message: '课堂或后台任务还在进行，请等结束后再更新。' } } } });
    } else await route.fallback();
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 5000 }); await later.click(); } catch { /* not shown */ }
    await expect(page.getByText('有新版本 0.22.1')).toBeVisible();
    await page.getByRole('button', { name: '重启并更新', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('课堂或后台任务还在进行，请等结束后再更新。');
    expect(applied).toBe(1);
    await page.getByRole('button', { name: '关闭更新提示' }).click();
    await expect(page.getByRole('dialog', { name: 'Notara 更新提示' })).toHaveCount(0);
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText('更新', { exact: true }).click();
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(checked).toBe(1);
    await expect(page.getByRole('dialog', { name: 'Notara 更新提示' })).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('update-settings.png') });
  } finally { await runtime.stop(); }
});

test('a real launcher startup reaches the global notice and another launch reminds again', async ({ page, context }) => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), 'notara-update-browser-'));
  const version = JSON.parse(await readFile('examples/native-vault/package.json', 'utf8')).version as string;
  const parts = version.split('.').map(Number); parts[2] = parts[2]! + 1;
  const latest = parts.join('.');
  const seed = await startVaultPersistent(root, { testModel: true, port: 0 }); await seed.stop();
  let checked = 0, prepared = 0;
  // No external download or installation; the actual launcher bridge and Host
  // transport still carry the status all the way to the browser.
  const operations = {
    discover: async () => { checked++; return { version: latest, compatible: true, sha256: 'a'.repeat(64),
      url: `https://github.com/TongZi2003/Notara/releases/tag/v${latest}`,
      archiveUrl: `https://github.com/TongZi2003/Notara/releases/download/v${latest}/notara-${latest}.zip`,
      runtime: { dsh: '0.2.0-rc.1', cordis: '4.0.4', dataVersion: 4 } }; },
    prepare: async () => { prepared++; return resolve('.'); },
  };
  let runtime = await superviseVault(root, resolve('.'), undefined, operations);
  const errors: string[] = [];
  const watch = (target: typeof page) => target.on('pageerror', error => errors.push(error.message));
  watch(page);
  try {
    await page.goto(runtime.authUrl);
    const notice = page.getByRole('dialog', { name: 'Notara 更新提示' });
    await expect(notice).toContainText(`有新版本 ${latest}`, { timeout: 30_000 });
    const second = await context.newPage(); watch(second);
    await second.goto(runtime.authUrl);
    await expect(second.getByRole('dialog', { name: 'Notara 更新提示' })).toBeVisible();
    expect(checked).toBe(1); expect(prepared).toBe(1);
    await page.getByRole('button', { name: '关闭更新提示' }).click();
    await expect(notice).toHaveCount(0);
    await expect(second.getByRole('dialog', { name: 'Notara 更新提示' })).toHaveCount(0);
    await page.reload(); await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
    await expect(notice).toHaveCount(0);
    const launchId = runtime.controller.status().launchId;
    await second.close(); await page.close(); await runtime.stop();
    runtime = await superviseVault(root, resolve('.'), undefined, operations);
    expect(runtime.controller.status().launchId).not.toBe(launchId);
    const reopened = await context.newPage(); watch(reopened);
    await reopened.goto(runtime.authUrl);
    await expect(reopened.getByRole('dialog', { name: 'Notara 更新提示' })).toContainText(`有新版本 ${latest}`, { timeout: 30_000 });
    expect(checked).toBe(2); expect(prepared).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(context.pages().map(target => target.close()));
    await runtime.stop(); await rm(root, { recursive: true, force: true });
  }
});
