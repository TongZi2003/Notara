import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { startVaultPersistent } from '../../scripts/dev-isolated.ts';
import { superviseVault } from '../../scripts/vault-supervisor.ts';
import { connectVault } from '../fixtures/vault-http.ts';

async function unusedPort() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}

async function openSettings(page: Page, url: string) {
  await page.goto(url);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await later.waitFor({ timeout: 5000 }); await later.click(); } catch { /* already configured */ }
  await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
  await page.getByText('远控设置', { exact: true }).first().click();
  await expect(page.locator('.nv-remote-settings')).toBeVisible();
}

test('remote settings are opt-in, retain private configuration and close only the remote entrance', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'Notara remote settings browser '));
  const root = join(directory, 'synthetic runtime');
  let seed: Awaited<ReturnType<typeof startVaultPersistent>> | undefined;
  let runtime: Awaited<ReturnType<typeof superviseVault>> | undefined;
  let client: Awaited<ReturnType<typeof connectVault>> | undefined;
  let peer: Page | undefined;
  let starts = 0, stops = 0, failNextStop = false;
  const errors: string[] = [], responseBodies: string[] = [];
  const password = 'SyntheticRemotePassword!24', token = 'synthetic-ngrok-token-for-ui-test';
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => {
    if (response.url().includes('/api/notaraRemote/')) void response.text().then(body => responseBodies.push(body)).catch(() => {});
  });
  const dependencies = {
    assertNgrokReady: async () => join(directory, 'unused-global-config.yml'),
    startTunnel: async (config: { publicHost: string }) => {
      starts++;
      let stopped = false;
      return { publicUrl: `https://${config.publicHost}`, exited: new Promise<never>(() => {}), async stop() {
        if (failNextStop) { failNextStop = false; throw new Error('synthetic stop failure'); }
        if (!stopped) { stopped = true; stops++; }
      } };
    },
  };
  const updates = { discover: async () => null, prepare: async () => { throw new Error('No external release in isolated tests'); } };
  try {
    seed = await startVaultPersistent(root, { port: 0, testModel: true });
    await seed.stop(); seed = undefined;
    runtime = await superviseVault(root, resolve('.'), undefined, updates, dependencies);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openSettings(page, runtime.authUrl);
    const settings = page.locator('.nv-remote-settings');
    await expect(settings.getByRole('status').first()).toHaveText('未启用');
    await expect(settings.getByRole('button', { name: '启用远控' })).toBeDisabled();
    expect(starts).toBe(0);
    await settings.getByLabel('ngrok 域名', { exact: true }).fill('synthetic-ui.ngrok-free.app');
    await settings.getByLabel('远程访问用户名', { exact: true }).fill('synthetic-user');
    await settings.getByLabel('远程访问密码', { exact: true }).fill(password);
    await settings.getByLabel('ngrok Authtoken', { exact: true }).fill(token);
    await settings.getByText('高级设置', { exact: true }).click();
    const proxyPort = await unusedPort(), apiPort = await unusedPort();
    await settings.getByLabel('代理端口', { exact: true }).fill(String(proxyPort));
    await settings.getByLabel('ngrok 管理端口', { exact: true }).fill(String(apiPort));
    await settings.getByLabel('ngrok 域名', { exact: true }).fill('https://invalid.example/path');
    await settings.getByRole('button', { name: '保存设置' }).click();
    await expect(settings.getByRole('alert')).toBeVisible();
    await expect(settings.getByRole('button', { name: '启用远控' })).toBeDisabled();
    expect(starts).toBe(0);
    await settings.getByLabel('ngrok 域名', { exact: true }).fill('synthetic-ui.ngrok-free.app');
    await settings.getByRole('button', { name: '保存设置' }).click();
    await expect(settings.getByText('设置已保存，远控仍需手动启用。')).toBeVisible();
    await expect(settings.getByLabel('远程访问密码', { exact: true })).toHaveValue('');
    await expect(settings.getByLabel('ngrok Authtoken', { exact: true })).toHaveValue('');
    expect(starts).toBe(0);
    peer = await page.context().newPage();
    peer.on('pageerror', error => errors.push(error.message));
    await openSettings(peer, runtime.authUrl);
    const peerSettings = peer.locator('.nv-remote-settings');
    await expect(peerSettings.getByRole('button', { name: '启用远控' })).toBeEnabled();
    await Promise.all([settings.getByRole('button', { name: '启用远控' }).click(), peerSettings.getByRole('button', { name: '启用远控' }).click()]);
    await expect(settings.getByRole('status').first()).toHaveText('已启用');
    await expect(peerSettings.getByRole('status').first()).toHaveText('已启用');
    await expect(settings.getByRole('link', { name: 'https://synthetic-ui.ngrok-free.app/login' })).toBeVisible();
    await expect(settings.getByLabel('ngrok 域名', { exact: true })).toBeDisabled();
    expect(starts).toBe(1);
    // The real proxy is alive behind a synthetic tunnel. No public network is opened.
    const proxy = await fetch(`http://127.0.0.1:${proxyPort}/`, { headers: { host: 'synthetic-ui.ngrok-free.app' } });
    expect(proxy.status).toBe(401);
    await settings.getByRole('button', { name: '关闭远控' }).click();
    await expect(settings.getByRole('status').first()).toHaveText('未启用');
    await expect(peerSettings.getByRole('status').first()).toHaveText('未启用');
    expect(stops).toBe(1);
    await expect(fetch(`http://127.0.0.1:${proxyPort}/`)).rejects.toThrow();

    // Empty secrets preserve stored credentials; drafts survive a status refresh.
    await settings.getByLabel('远程访问用户名', { exact: true }).fill('updated-user');
    await settings.getByRole('button', { name: '刷新状态' }).click();
    await expect(settings.getByLabel('远程访问用户名', { exact: true })).toHaveValue('updated-user');
    await settings.getByRole('button', { name: '保存设置' }).click();
    await expect(settings.getByText('设置已保存，远控仍需手动启用。')).toBeVisible();
    await expect(peerSettings.getByLabel('远程访问用户名', { exact: true })).toHaveValue('updated-user');
    await peer.close(); peer = undefined;
    for (let repeat = 0; repeat < 5; repeat++) {
      await settings.getByRole('button', { name: '启用远控' }).click();
      await expect(settings.getByRole('status').first()).toHaveText('已启用');
      await settings.getByRole('button', { name: '关闭远控' }).click();
      await expect(settings.getByRole('status').first()).toHaveText('未启用');
    }
    expect(starts).toBe(6); expect(stops).toBe(6);
    await settings.getByRole('button', { name: '启用远控' }).click();
    await expect(settings.getByRole('status').first()).toHaveText('已启用');
    failNextStop = true;
    await settings.getByRole('button', { name: '关闭远控' }).click();
    await expect(settings.getByRole('button', { name: '重试关闭远控' })).toBeEnabled();
    await expect(settings.getByLabel('ngrok 域名', { exact: true })).toBeDisabled();
    await settings.getByRole('button', { name: '重试关闭远控' }).click();
    await expect(settings.getByRole('status').first()).toHaveText('未启用');
    expect(starts).toBe(7); expect(stops).toBe(7);
    const browserStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(browserStorage).not.toContain(password); expect(browserStorage).not.toContain(token);
    expect(responseBodies.join('\n')).not.toContain(password); expect(responseBodies.join('\n')).not.toContain(token);
    await page.screenshot({ path: testInfo.outputPath('remote-settings-desktop.png') });
    await page.setViewportSize({ width: 430, height: 932 });
    await expect(settings.getByRole('button', { name: '启用远控' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('remote-settings-mobile.png') });
    await page.keyboard.press('Escape');
    client = await connectVault({ root, authUrl: runtime.authUrl, log: () => '', restart: async () => {}, stop: async () => {} });
    const session = await client.createSession();
    await client.ask(session, '远控关闭后继续课堂', { '远控关闭后继续课堂': '本地课堂正常。' });
    expect((await client.turns(session)).length).toBeGreaterThan(0);
    await client.close(); client = undefined;
    expect(errors).toEqual([]);
    // Detach the browser before the deliberate offline restart, so connection
    // refusal during downtime cannot be confused with a live-page regression.
    await page.goto('about:blank');
    await runtime.stop(); runtime = undefined;
    runtime = await superviseVault(root, resolve('.'), undefined, updates, dependencies);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openSettings(page, runtime.authUrl);
    await expect(settings.getByRole('status').first()).toHaveText('未启用');
    await expect(settings.getByLabel('远程访问用户名', { exact: true })).toHaveValue('updated-user');
    await expect(settings.getByRole('button', { name: '启用远控' })).toBeEnabled();
    expect(starts).toBe(7);
    await page.route('**/api/notaraRemote/status', route => route.fulfill({ json: { result: { ok: false, error: { message: 'remote_bridge_unavailable' } } } }), { times: 1 });
    await settings.getByRole('button', { name: '刷新状态' }).click();
    await expect(settings.getByRole('alert')).toBeVisible();
    await expect(settings.getByRole('alert')).toHaveCount(0, { timeout: 8000 });
    expect(errors).toEqual([]);
  } finally {
    await peer?.close(); await client?.close(); await runtime?.stop(); await seed?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
