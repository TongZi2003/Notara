import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { startVaultIsolated, startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { liveVaultUrl } from '../../scripts/vault-launcher-state.ts';
import { packageBin } from '../../scripts/package-bin.ts';
import { connectVault } from '../fixtures/vault-http.ts';

const execute = promisify(execFile);
const trigger = (page: Page) => page.getByRole('button', { name: '关闭 Notara「拾页」', exact: true });
const confirmation = (page: Page) => page.getByRole('dialog', { name: '关闭 Notara「拾页」', exact: true });
async function enter(page: Page, authUrl: string) {
  await page.goto(authUrl);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await later.waitFor({ timeout: 6000 }); await later.click(); } catch { /* acknowledged already */ }
  await expect(trigger(page)).toBeVisible({ timeout: 30_000 });
}

test('红色关闭按钮支持取消、背景与 Escape；不支持的启动方式如实提示并允许重试', async ({ page }) => {
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await enter(page, runtime.authUrl);
    await trigger(page).click();
    await confirmation(page).getByRole('button', { name: '取消', exact: true }).click();
    await expect(confirmation(page)).toHaveCount(0);
    await trigger(page).click(); await page.keyboard.press('Escape');
    await expect(confirmation(page)).toHaveCount(0);
    await trigger(page).click(); await page.locator('.nv-dialog').click({ position: { x: 5, y: 5 } });
    await expect(confirmation(page)).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 780 });
    await trigger(page).click();
    await confirmation(page).getByRole('button', { name: '确定', exact: true }).click();
    await expect(confirmation(page).getByRole('alert')).toContainText('当前启动方式不支持');
    await expect(confirmation(page).getByRole('button', { name: '确定', exact: true })).toBeEnabled();
    await confirmation(page).getByRole('button', { name: '取消', exact: true }).click();
    await expect(trigger(page)).toBeFocused();
    const stillRunning = await fetch(runtime.authUrl, { redirect: 'manual' });
    expect(stillRunning.status).toBe(303); await stillRunning.body?.cancel();
    expect(errors).toEqual([]);
  } finally { await page.close(); await runtime.stop(); }
});

test('页面确认关闭完整桌面控制器、取消保活并保留课堂和资料，随后可再次启动', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const base = await mkdtemp(join(tmpdir(), 'notara-ui-shutdown-'));
  const root = join(base, 'runtime'), profile = join(base, 'profile'), config = join(base, 'remote', 'config.json');
  const statePath = join(base, 'remote', 'config.controller.json');
  const seed = await startVaultPersistent(root, { testModel: true, port: 0 }); await seed.stop();
  const command = (action: string) => execute(process.execPath, [packageBin(resolve('.'), 'tsx', 'tsx'), resolve('scripts/remote-vault.ts'), action, '--root', root, '--config', config], {
    cwd: resolve('.'), timeout: 90_000, windowsHide: true, maxBuffer: 64_000,
    env: { ...process.env, USERPROFILE: profile, HOME: profile, APPDATA: join(profile, 'AppData/Roaming'), LOCALAPPDATA: join(profile, 'AppData/Local') },
  });
  const errors: string[] = []; let shuttingDown = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !(shuttingDown && /WebSocket|ERR_CONNECTION_(REFUSED|RESET)|Failed to fetch|connection.*closed/i.test(message.text()))) errors.push(message.text());
  });
  try {
    await command('local-start');
    const authUrl = (await liveVaultUrl(root))!;
    const client = await connectVault({ root, authUrl, log: () => '', stop: async () => {}, restart: async () => {} });
    let session: string, sentinel: string;
    try {
      session = await client.createSession(); await client.rename(session, 'Synthetic retained classroom');
      await client.writeVaultFile('shutdown-sentinel.md', '# Synthetic retained learning set\n'); sentinel = join(client.vault, 'shutdown-sentinel.md');
    } finally { await client.close(); }
    await page.setViewportSize({ width: 1440, height: 900 }); await enter(page, authUrl);
    const powerBox = (await trigger(page).boundingBox())!;
    const settingsBox = (await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().boundingBox())!;
    expect(powerBox.y + powerBox.height).toBeLessThanOrEqual(settingsBox.y);
    const color = await trigger(page).evaluate(element => getComputedStyle(element).color);
    const components = color.match(/[\d.]+/g)!.map(Number); expect(components[0]).toBeGreaterThan(components[1]!);
    await trigger(page).click();
    const cancelBox = (await confirmation(page).getByRole('button', { name: '取消', exact: true }).boundingBox())!;
    const confirmBox = (await confirmation(page).getByRole('button', { name: '确定', exact: true }).boundingBox())!;
    expect(cancelBox.x).toBeLessThan(confirmBox.x);
    await page.screenshot({ path: testInfo.outputPath('shutdown-confirmation.png') });
    await page.keyboard.press('Escape'); expect(await liveVaultUrl(root)).toBeDefined();
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText('学习界面', { exact: true }).first().click();
    await page.getByRole('radio', { name: /^手帐/ }).check(); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 780 });
    await expect(trigger(page)).toBeVisible(); await trigger(page).click();
    await expect(confirmation(page)).toContainText('是否要关闭 Notara「拾页」？');
    shuttingDown = true;
    await confirmation(page).getByRole('button', { name: '确定', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '已请求关闭 Notara「拾页」', exact: true })).toContainText('双击桌面的');
    await expect.poll(() => liveVaultUrl(root), { timeout: 25_000 }).toBeUndefined();
    await expect.poll(async () => stat(statePath).then(() => true, () => false)).toBe(false);
    await expect(stat(join(base, 'remote', 'config.controller-lock.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    await page.waitForTimeout(6000);
    expect(await liveVaultUrl(root)).toBeUndefined();
    expect(await readFile(sentinel!, 'utf8')).toBe('# Synthetic retained learning set\n');
    await command('local-start');
    const restarted = await connectVault({ root, authUrl: (await liveVaultUrl(root))!, log: () => '', stop: async () => {}, restart: async () => {} });
    try { expect((await restarted.sessions()).some(row => row.sessionId === session!)).toBe(true); }
    finally { await restarted.close(); }
    expect(errors).toEqual([]);
  } finally { await page.close(); await command('stop').catch(() => {}); await rm(base, { recursive: true, force: true }); }
});
