import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

test('ChatGPT settings render every SIWC model, retain stale results on refresh failure, and clear on either logout path', async ({ page }) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    const root = process.cwd();
    const bundle = await build({ absWorkingDir: root, bundle: true, write: false, format: 'iife', stdin: { resolveDir: root, contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { installChatgptSettings } from './examples/native-vault/chatgpt-client.js';
      const h = React.createElement, root = createRoot(document.getElementById('root'));
      const rows = [
        { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
        { id: 'gpt-6-luna', name: 'GPT-6-Luna' },
        { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' }
      ];
      let connected = true, failNextModels = false, modelRows = rows, authorizationRevision = 0;
      const remote = {
        async status() { return { ok: true, value: { pending: false, accounts: [{ id: 'synthetic-account', label: 'Synthetic test account', connected, planEnabled: true, authorizationRevision }] } }; },
        async models() {
          if (failNextModels) { failNextModels = false; return { ok: false, error: { message: 'chatgpt_request_failed' } }; }
          return { ok: true, value: { models: modelRows } };
        },
        async signOut() { connected = false; return { ok: true, value: {} }; },
        async begin() { return { ok: false, error: { message: 'chatgpt_request_failed' } }; },
        async cancel() { return { ok: true, value: {} }; }
      };
      const scope = {
        remote: { notaraChatgpt: remote },
        slots: { inject(_slot, install) { install(); }, register(_descriptor, Component) { root.render(h(Component)); } },
        effect(effect) { return effect(); }
      };
      installChatgptSettings({ plugin(specification) { specification.apply(scope); } }, React);
      window.chatgptCatalogHarness = {
        failNextRefresh() { failNextModels = true; },
        setRows(value) { modelRows = value; },
        setConnected(value) { connected = value; },
        reauthorize() { authorizationRevision++; }
      };
    ` } });
    await page.clock.install();
    await page.route('**/chatgpt-catalog-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' }));
    await page.goto(new URL('/chatgpt-catalog-harness', runtime.authUrl).href);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const settings = page.locator('.nv-chatgpt-settings');
    const catalog = settings.locator('[data-model-catalog="synthetic-account"]');
    await expect(settings.getByRole('button', { name: '查看可用模型' })).toBeEnabled();
    await settings.getByRole('button', { name: '查看可用模型' }).click();
    await expect(catalog).toContainText('GPT-6-Sol');
    await expect(catalog).toContainText('GPT-6-Luna');
    await expect(catalog).toContainText('GPT-6.1-Sol');

    await page.evaluate(() => (window as unknown as { chatgptCatalogHarness: { failNextRefresh(): void } }).chatgptCatalogHarness.failNextRefresh());
    await settings.getByRole('button', { name: '刷新可用模型' }).click();
    await expect(settings.getByRole('alert')).toContainText('ChatGPT 请求未完成');
    await expect(catalog).toContainText('GPT-6-Sol');
    await expect(catalog).toContainText('GPT-6-Luna');
    await expect(catalog).toContainText('GPT-6.1-Sol');

    await page.evaluate(() => (window as unknown as { chatgptCatalogHarness: { setRows(rows: unknown[]): void } }).chatgptCatalogHarness.setRows([{ id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' }]));
    await settings.getByRole('button', { name: '刷新可用模型' }).click();
    await expect(catalog).toHaveText('账号返回 1 个可用模型：GPT-6.2-Sol');
    await expect(catalog).not.toContainText('GPT-6-Sol');

    // Authorization failure retains the existing account object and its valid rows.
    await settings.getByRole('button', { name: '重新登录' }).click();
    await expect(settings.getByRole('alert')).toContainText('ChatGPT 请求未完成');
    await expect(catalog).toContainText('GPT-6.2-Sol');
    // Successful reauthorization in another window clears displayed old rows even
    // when the new prefetch fails and connected/planEnabled remain unchanged.
    await page.evaluate(() => (window as unknown as { chatgptCatalogHarness: { reauthorize(): void } }).chatgptCatalogHarness.reauthorize());
    await page.clock.fastForward(1_600);
    await expect(catalog).toHaveCount(0);
    await expect(settings.getByRole('button', { name: '查看可用模型' })).toBeEnabled();
    await page.evaluate(() => (window as unknown as { chatgptCatalogHarness: { failNextRefresh(): void } }).chatgptCatalogHarness.failNextRefresh());
    await settings.getByRole('button', { name: '查看可用模型' }).click();
    await expect(catalog).toHaveCount(0);
    await settings.getByRole('button', { name: '查看可用模型' }).click();
    await expect(catalog).toContainText('GPT-6.2-Sol');

    page.once('dialog', dialog => dialog.accept());
    await settings.getByRole('button', { name: '退出账号' }).click();
    await expect(settings).toContainText('已退出');
    await expect(catalog).toHaveCount(0);

    // Simulate another signed-in settings window disconnecting the account.
    await page.evaluate(() => (window as unknown as { chatgptCatalogHarness: { setConnected(value: boolean): void } }).chatgptCatalogHarness.setConnected(true));
    await page.clock.fastForward(1_600);
    await expect(settings.getByRole('button', { name: '查看可用模型' })).toBeEnabled();
    await settings.getByRole('button', { name: '查看可用模型' }).click();
    await expect(catalog).toContainText('GPT-6.2-Sol');
    await page.evaluate(() => (window as unknown as { chatgptCatalogHarness: { setConnected(value: boolean): void } }).chatgptCatalogHarness.setConnected(false));
    await page.clock.fastForward(1_600);
    await expect(settings).toContainText('已退出');
    await expect(catalog).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
  }
});
