import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

type UpdateStatus = {
  phase: string;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string | undefined;
  launchId: string;
  message: string;
};

type Gate = {
  started: Promise<void>;
  markStarted(): void;
  wait: Promise<void>;
  release(): void;
};

type UpdateMock = {
  status: UpdateStatus;
  checkResult?: UpdateStatus | undefined;
  applyError?: string | undefined;
  holdStatus?: Gate | undefined;
  holdCheck?: Gate | undefined;
  holdApply?: Gate | undefined;
  counts: { status: number; statusComplete: number; check: number; apply: number };
};

const ready = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  phase: 'ready', currentVersion: '0.25.0', latestVersion: '0.25.1',
  releaseUrl: 'https://github.com/TongZi2003/Notara/releases/tag/v0.25.1',
  launchId: 'synthetic-launch-1', message: '新版已准备好，课堂空闲时可以重启更新。', ...overrides,
});

function deferred(): Gate {
  let start!: () => void;
  let finish!: () => void;
  return {
    started: new Promise<void>(resolve => { start = resolve; }),
    markStarted: () => start(),
    wait: new Promise<void>(resolve => { finish = resolve; }),
    release: () => finish(),
  };
}

function installUpdateMock(context: BrowserContext, status = ready()): UpdateMock {
  const mock: UpdateMock = { status, counts: { status: 0, statusComplete: 0, check: 0, apply: 0 } };
  void context.route('**/api/notaraVault/*', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1);
    if (method === 'updateStatus') {
      mock.counts.status++;
      const value = mock.status;
      const gate = mock.holdStatus;
      if (gate) { mock.holdStatus = undefined; gate.markStarted(); await gate.wait; }
      await route.fulfill({ json: { result: { ok: true, value } } });
      mock.counts.statusComplete++;
    } else if (method === 'checkUpdate') {
      mock.counts.check++;
      const gate = mock.holdCheck;
      if (gate) { mock.holdCheck = undefined; gate.markStarted(); await gate.wait; }
      await route.fulfill({ json: { result: { ok: true, value: mock.checkResult ?? mock.status } } });
    } else if (method === 'applyUpdate') {
      mock.counts.apply++;
      const gate = mock.holdApply;
      if (gate) { mock.holdApply = undefined; gate.markStarted(); await gate.wait; }
      await route.fulfill({ json: mock.applyError
        ? { result: { ok: false, error: { message: mock.applyError } } }
        : { result: { ok: true, value: mock.status } } });
    } else await route.fallback();
  });
  return mock;
}

function capturePageErrors(page: Page, errors: string[]): void {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}

async function enterVault(page: Page, authUrl: string): Promise<void> {
  await page.goto(authUrl);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await later.waitFor({ state: 'visible', timeout: 5000 }); await later.click(); } catch { /* already acknowledged */ }
  await expect(page.locator('.nv-home')).toBeVisible({ timeout: 30_000 });
}

async function pushStatus(page: Page, mock: UpdateMock, status: UpdateStatus): Promise<void> {
  mock.status = status;
  const before = mock.counts.status;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => mock.counts.status).toBeGreaterThan(before);
}

async function openUpdateSettings(page: Page) {
  await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
  await page.getByText('更新', { exact: true }).first().click();
  const panel = page.locator('.nv-update-settings');
  await expect(panel).toBeVisible();
  return panel;
}

test('the global notice stays in the viewport corner across views, folds, themes, and phone widths', async ({ page }, testInfo) => {
  const runtime = await startVaultIsolated({ testModel: true });
  const mock = installUpdateMock(page.context());
  const errors: string[] = [];
  capturePageErrors(page, errors);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterVault(page, runtime.authUrl);
    const notice = page.getByRole('dialog', { name: 'Notara 更新提示' });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('aria-modal', 'false');
    expect(await notice.evaluate(node => node.contains(document.activeElement))).toBe(false);

    const desktop = await notice.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, position: getComputedStyle(node).position, viewport: innerWidth };
    });
    expect(desktop.position).toBe('fixed');
    expect(desktop.left).toBeGreaterThanOrEqual(18);
    expect(desktop.right).toBeLessThanOrEqual(desktop.viewport - 18);
    expect(desktop.top).toBeGreaterThanOrEqual(60);
    await page.screenshot({ path: testInfo.outputPath('notice-desktop-light.png') });

    await page.getByRole('button', { name: '计划', exact: true }).first().click();
    await expect(notice).toBeVisible();
    await page.getByRole('button', { name: '收起面板', exact: true }).click();
    await expect(page.locator('aside.nv-sidebar')).toHaveAttribute('data-collapsed', 'true');
    await expect(notice).toBeVisible();

    const lightBackground = await notice.evaluate(node => getComputedStyle(node).backgroundColor);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', /.*/);
    await expect.poll(() => notice.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(lightBackground);
    const darkBackground = await notice.evaluate(node => getComputedStyle(node).backgroundColor);
    expect(darkBackground).not.toBe(lightBackground);

    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText('学习界面', { exact: true }).first().click();
    await page.getByRole('radio', { name: /^手帐/ }).check();
    await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook');
    await page.keyboard.press('Escape');
    await expect(notice).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('notice-notebook-dark.png') });

    await page.setViewportSize({ width: 375, height: 780 });
    const phone = await notice.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth, top: rect.top, position: getComputedStyle(node).position };
    });
    expect(phone.position).toBe('fixed');
    expect(phone.left).toBeGreaterThanOrEqual(8);
    expect(phone.right).toBeLessThanOrEqual(phone.viewport - 8);
    expect(phone.width).toBeLessThanOrEqual(phone.viewport - 24);
    expect(phone.top).toBeGreaterThanOrEqual(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('notice-phone-notebook-dark.png') });
    expect(mock.counts.status).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally { await runtime.stop(); }
});

test('dismissal persists across refresh and polling, syncs between pages, and expires for a new version or launch', async ({ page, context }, testInfo) => {
  const runtime = await startVaultIsolated({ testModel: true });
  const mock = installUpdateMock(context);
  const errors: string[] = [];
  capturePageErrors(page, errors);
  try {
    await page.setViewportSize({ width: 1360, height: 860 });
    await enterVault(page, runtime.authUrl);
    const notice = page.getByRole('dialog', { name: 'Notara 更新提示' });
    await expect(notice).toBeVisible();

    const peer = await context.newPage();
    capturePageErrors(peer, errors);
    await peer.setViewportSize({ width: 1200, height: 800 });
    await enterVault(peer, runtime.authUrl);
    const peerNotice = peer.getByRole('dialog', { name: 'Notara 更新提示' });
    await expect(peerNotice).toBeVisible();

    await page.getByRole('button', { name: '关闭更新提示' }).click();
    await expect(notice).toHaveCount(0);
    await expect(peerNotice).toHaveCount(0);
    const beforeReload = mock.counts.statusComplete;
    await page.reload();
    await expect(page.locator('.nv-home')).toBeVisible();
    await expect.poll(() => mock.counts.statusComplete).toBeGreaterThan(beforeReload);
    await expect(notice).toHaveCount(0);

    const pollPage = await context.newPage();
    capturePageErrors(pollPage, errors);
    await pollPage.clock.install({ time: new Date('2026-10-02T00:00:00.000Z') });
    await pollPage.setViewportSize({ width: 1200, height: 800 });
    const beforePollPage = mock.counts.statusComplete;
    await enterVault(pollPage, runtime.authUrl);
    const pollNotice = pollPage.getByRole('dialog', { name: 'Notara 更新提示' });
    await expect.poll(() => mock.counts.statusComplete).toBeGreaterThan(beforePollPage);
    await expect(pollNotice).toHaveCount(0);
    const beforePoll = mock.counts.status;
    const beforePollComplete = mock.counts.statusComplete;
    await pollPage.clock.fastForward(30 * 60_000);
    await expect.poll(() => mock.counts.status).toBeGreaterThan(beforePoll);
    await expect.poll(() => mock.counts.statusComplete).toBeGreaterThan(beforePollComplete);
    await expect(pollNotice).toHaveCount(0);
    await pollPage.close();

    await pushStatus(page, mock, ready({ latestVersion: '0.25.2', message: '0.25.2 已准备好。' }));
    await expect(notice.getByRole('heading', { name: '有新版本 0.25.2' })).toBeVisible();
    await pushStatus(peer, mock, ready({ latestVersion: '0.25.2', message: '0.25.2 已准备好。' }));
    await expect(peerNotice.getByRole('heading', { name: '有新版本 0.25.2' })).toBeVisible();
    await page.getByRole('button', { name: '关闭更新提示' }).click();
    await expect(notice).toHaveCount(0);
    await expect(peerNotice).toHaveCount(0);

    mock.status = ready({ latestVersion: '0.25.2', launchId: 'synthetic-launch-2', message: '新启动器已准备好。' });
    for (const target of [page, peer]) {
      const before = mock.counts.status;
      await target.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect.poll(() => mock.counts.status).toBeGreaterThan(before);
    }
    await expect(notice.getByRole('heading', { name: '有新版本 0.25.2' })).toBeVisible();
    await expect(peerNotice.getByRole('heading', { name: '有新版本 0.25.2' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('notice-new-launch.png') });

    const late = deferred();
    mock.holdStatus = late;
    const beforeLate = mock.counts.status;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await late.started;
    await expect.poll(() => mock.counts.status).toBeGreaterThan(beforeLate);
    await page.getByRole('button', { name: '关闭更新提示' }).click();
    late.release();
    await expect(notice).toHaveCount(0);
    await expect(peerNotice).toHaveCount(0);
    await page.waitForTimeout(100);
    await expect(notice).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await runtime.stop(); }
});

test('all reported phases render honestly, release links stay allowlisted, and slow requests do not override actions', async ({ page }, testInfo) => {
  const runtime = await startVaultIsolated({ testModel: true });
  const mock = installUpdateMock(page.context());
  const errors: string[] = [];
  capturePageErrors(page, errors);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterVault(page, runtime.authUrl);
    const notice = page.getByRole('dialog', { name: 'Notara 更新提示' });
    await expect(notice).toBeVisible();
    const trustedRelease = notice.getByRole('link', { name: '发布说明' });
    await expect(trustedRelease).toHaveAttribute('href', 'https://github.com/TongZi2003/Notara/releases/tag/v0.25.1');
    await expect(trustedRelease).toHaveAttribute('target', '_blank');
    await expect(trustedRelease).toHaveAttribute('rel', 'noopener noreferrer');

    await page.getByRole('button', { name: '关闭更新提示' }).click();
    const settings = await openUpdateSettings(page);
    const checkGate = deferred();
    mock.holdCheck = checkGate;
    mock.checkResult = ready();
    await settings.getByRole('button', { name: '检查更新', exact: true }).click();
    await checkGate.started;
    await expect(settings.getByRole('status')).toHaveText('正在检查更新…');
    await expect(settings.getByRole('button', { name: '检查更新', exact: true })).toHaveCount(0);
    expect(mock.counts.check).toBe(1);
    checkGate.release();
    await expect(settings.getByRole('status')).toHaveText('新版已准备好，课堂空闲时可以重启更新。');
    await expect(notice).toHaveCount(0);
    expect(mock.counts.check).toBe(1);

    await pushStatus(page, mock, ready({ phase: 'downloading', latestVersion: '0.25.2', releaseUrl: undefined, message: '正在后台准备新版；可以继续学习。' }));
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('status')).toHaveText('正在后台准备新版；可以继续学习。');

    await pushStatus(page, mock, ready({ phase: 'manual', latestVersion: '0.25.2', releaseUrl: 'https://evil.example/release', message: '请按安装说明手动升级。' }));
    await expect(notice.getByRole('status')).toHaveText('请按安装说明手动升级。');
    await expect(notice.getByRole('link', { name: '发布说明' })).toHaveCount(0);

    await pushStatus(page, mock, ready({ phase: 'error', latestVersion: '0.25.2', releaseUrl: 'javascript:alert(1)', message: '更新检查失败，请稍后重试。' }));
    await expect(notice.getByRole('status')).toHaveText('更新检查失败，请稍后重试。');
    await expect(notice.getByRole('button', { name: '重新检查', exact: true })).toBeVisible();
    await expect(notice.getByRole('link', { name: '发布说明' })).toHaveCount(0);

    await pushStatus(page, mock, { phase: 'current', currentVersion: '0.25.0', launchId: 'synthetic-launch-1', message: '已是当前可用的正式版本。' });
    await expect(notice).toHaveCount(0);
    await expect(settings.getByRole('status')).toHaveText('已是当前可用的正式版本。');

    await pushStatus(page, mock, { phase: 'unsupported', currentVersion: '0.25.0', launchId: 'synthetic-launch-1', message: '请通过 npm run vault 启动，才能检查和安装更新。' });
    await expect(notice).toHaveCount(0);
    await expect(settings.getByRole('status')).toHaveText('请通过 npm run vault 启动，才能检查和安装更新。');
    await expect(settings.getByRole('button', { name: '检查更新', exact: true })).toHaveCount(0);

    const finalReady = ready({ latestVersion: '0.25.3', releaseUrl: 'https://github.com/TongZi2003/Notara/releases/tag/v0.25.3' });
    await pushStatus(page, mock, finalReady);
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link', { name: '发布说明' })).toHaveAttribute('href', finalReady.releaseUrl!);
    await page.keyboard.press('Escape');
    await expect(page.locator('.nv-update-settings')).toHaveCount(0);

    const lateStatus = deferred();
    const apply = deferred();
    mock.holdStatus = lateStatus;
    mock.holdApply = apply;
    const beforeLate = mock.counts.status;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await lateStatus.started;
    await expect.poll(() => mock.counts.status).toBeGreaterThan(beforeLate);
    mock.applyError = '课堂或后台任务还在进行，请等结束后再更新。';
    await notice.getByRole('button', { name: '重启并更新', exact: true }).click();
    await apply.started;
    await expect(notice.getByText('正在重启更新，请保持页面打开…')).toBeVisible();
    await expect(notice.getByRole('button', { name: '重启并更新', exact: true })).toHaveCount(0);
    expect(mock.counts.apply).toBe(1);
    const beforeStatusComplete = mock.counts.statusComplete;
    lateStatus.release();
    await expect.poll(() => mock.counts.statusComplete).toBeGreaterThan(beforeStatusComplete);
    await expect(notice.getByText('正在重启更新，请保持页面打开…')).toBeVisible();
    await expect(notice.getByRole('alert')).toHaveCount(0);
    apply.release();
    await expect(notice.getByRole('alert')).toHaveText('课堂或后台任务还在进行，请等结束后再更新。');
    await expect(notice.getByRole('alert')).toHaveText('课堂或后台任务还在进行，请等结束后再更新。');
    expect(mock.counts.apply).toBe(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('notice-action-error-after-late-status.png') });
  } finally { await runtime.stop(); }
});
