import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SDK_CLIENT = `${ROOT}/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`;

async function buildClientHarness() {
  const client = await readFile(SDK_CLIENT, 'utf8');
  const exportAnchor = '\t\texports.apply = apply;';
  expect(client.split(exportAnchor)).toHaveLength(2);
  const exposedClient = client.replace(exportAnchor, '\t\texports.__test = { ModelsSection, ModelListEditor };\n' + exportAnchor);

  const harness = await build({
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    stdin: {
      resolveDir: ROOT,
      contents: `
        import React from 'react';
        import * as jsxRuntime from 'react/jsx-runtime';
        import { createPortal } from 'react-dom';
        import { createRoot } from 'react-dom/client';

        const primitiveCache = new Map();
        const primitives = new Proxy({}, {
          get(_target, name) {
            if (!primitiveCache.has(name)) primitiveCache.set(name, function TestPrimitive(props) {
              if (name === 'Modal') {
                if (!props.open) return null;
                return createPortal(React.createElement('section', {
                  role: 'dialog', 'aria-label': props.title,
                  style: { position: 'fixed', inset: 0, zIndex: 10000, background: 'white' }
                },
                  props.title ? React.createElement('h2', null, props.title) : null,
                  props.description ? React.createElement('p', null, props.description) : null,
                  props.children,
                  props.footer ? React.createElement('footer', null, props.footer) : null), document.body);
              }
              if (name === 'Button') {
                const { variant: _variant, size: _size, ...domProps } = props;
                return React.createElement('button', domProps, props.children);
              }
              if (name === 'Checkbox') {
                return React.createElement('label', null,
                  React.createElement('input', {
                    type: 'checkbox', checked: props.checked, disabled: props.disabled,
                    onChange: event => props.onChange(event.target.checked)
                  }), props.label);
              }
              if (name === 'SegmentedControl') {
                return React.createElement('div', { role: 'group', 'aria-label': props.label },
                  ...props.options.map(option => React.createElement('button', {
                    key: option.value, type: 'button', disabled: props.disabled || option.disabled,
                    'aria-pressed': props.value === option.value,
                    onClick: () => props.onChange(option.value)
                  }, option.label)));
              }
              return React.createElement('span', null, props.children);
            });
            return primitiveCache.get(name);
          }
        });

        const rootNode = document.getElementById('root');
        const root = createRoot(rootNode);
        let loaded;
        const calls = [];
        const queues = new Map();
        const queue = (provider, result) => {
          const list = queues.get(provider) ?? [];
          list.push(result);
          queues.set(provider, list);
        };
        const getPath = (value, path) => path.reduce((at, key) => at == null ? undefined : at[key], value);
        const setPath = (source, path, value) => {
          const rootValue = structuredClone(source ?? {});
          let at = rootValue;
          for (const key of path.slice(0, -1)) at = at[key] ??= {};
          at[path.at(-1)] = structuredClone(value);
          return rootValue;
        };
        const deletePath = (source, path) => {
          const rootValue = structuredClone(source ?? {});
          let at = rootValue;
          for (const key of path.slice(0, -1)) at = at?.[key];
          if (at) delete at[path.at(-1)];
          return rootValue;
        };
        const schema = {
          rehydrate: serialized => serialized ?? {},
          validate: () => undefined,
          nodeAtPath: (_root, path) => path.includes('\\u0000probe') ? undefined : ({ type: 'object' }),
          getPath,
          hasPath: (value, path) => getPath(value, path) !== undefined,
          setPath,
          deletePath
        };
        const namespaceValue = { providers: {
          'provider-a': { api: 'openai-completions', models: [{ id: 'a-stable' }] },
          'provider-b': { api: 'openai-completions', models: [{ id: 'b-stable' }] },
          'provider-existing': { api: 'openai-completions', models: [{ id: 'existing-model', input: ['text', 'image'] }] }
        } };
        const namespaceUser = { providers: {
          'provider-existing': { api: 'openai-completions', models: [{ id: 'existing-model', input: ['text', 'image'] }] }
        } };
        const namespaceBase = { providers: {
          'provider-a': { api: 'openai-completions', models: [{ id: 'a-stable' }] },
          'provider-b': { api: 'openai-completions', models: [{ id: 'b-stable' }] }
        } };
        const namespace = {
          ns: 'llm-pi-ai', revision: 'synthetic-revision', schema: {}, writable: true,
          value: namespaceValue, user: namespaceUser, base: namespaceBase
        };
        const row = (provider, configured = false, active = false) => ({
          entry: {
            provider, displayName: provider.toUpperCase(), settingsNs: 'llm-pi-ai',
            settingsPath: ['providers', provider], active
          }, configured, removable: false, apiKeyEnv: undefined, credential: undefined
        });
        let snapshot = {
          status: 'ready', error: null, credentialError: null, writable: true,
          rows: [row('provider-existing', true, true), row('provider-a'), row('provider-b')],
          namespaces: new Map([['llm-pi-ai', namespace]])
        };
        const operations = {
          discoverModels: async (_ns, options) => {
            const provider = options.provider;
            calls.push(provider);
            const list = queues.get(provider) ?? [];
            if (list.length) {
              const result = list.shift();
              if (result.__throw === true) throw new Error(result.message);
              return result;
            }
            return { kind: 'found', models: [{ id: provider + '-default', inputModalities: ['text'] }] };
          },
          describeCredential: async () => ({ configured: false, writable: true }),
          writeSettings: async () => ({ kind: 'written', view: { user: namespace.user, revision: 'next' } }),
          storeCredential: async () => undefined,
          removeCredential: async () => undefined
        };
        const controller = { load: async () => undefined, store: { getSnapshot: () => snapshot } };
        const t = key => key;
        const renderSlot = () => null;
        const mount = () => root.render(React.createElement(loaded.__test.ModelsSection, {
          controller, useSnapshot: selector => selector(snapshot), operations, schema, t, renderSlot
        }));

        window.__ModuleLoader__ = { load: registration => {
          loaded = registration.factory(id => {
            if (id === 'react') return React;
            if (id === 'react/jsx-runtime') return jsxRuntime;
            if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
            if (id === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: () => ({}) };
            throw new Error('Unexpected private SDK dependency: ' + id);
          });
        }};
        window.modelHarness = {
          mount, queue, calls,
          clearCalls: () => { calls.length = 0; },
          setExistingInput: input => {
            namespace.user.providers['provider-existing'].models[0].input = input;
            namespace.value.providers['provider-existing'].models[0].input = input;
          }
        };
      `
    }
  });
  return { harness: harness.outputFiles[0]!.text, client: exposedClient };
}

async function openModelsSection(page: import('@playwright/test').Page, authUrl: string) {
  const { harness, client } = await buildClientHarness();
  await page.route('**/subscription-catalog-harness', route =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto(new URL('/subscription-catalog-harness', authUrl).href);
  await page.addScriptTag({ content: harness });
  await page.addScriptTag({ content: client });
  await page.evaluate(() => (window as any).modelHarness.mount());
}

test('catalog provider draft discovers once, reuses per-provider results, and manual success refreshes the cached result', async ({ page }) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await openModelsSection(page, runtime.authUrl);
    await page.evaluate(() => {
      const h = (window as any).modelHarness;
      h.queue('provider-a', { kind: 'found', models: [{ id: 'a-v1', name: 'A v1', inputModalities: ['text', 'image'] }] });
      h.queue('provider-b', { kind: 'found', models: [{ id: 'b-v1', name: 'B v1', inputModalities: ['text'] }] });
      h.queue('provider-a', { kind: 'found', models: [{ id: 'a-v2', name: 'A v2', inputModalities: ['text', 'image'] }] });
    });

    await page.getByRole('button', { name: 'add', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual(['provider-a']);
    await expect(dialog).toContainText('a-v1');
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click();

    await page.getByRole('combobox', { name: 'provider' }).selectOption('provider-b');
    await expect(dialog).toContainText('b-v1');
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual(['provider-a', 'provider-b']);
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click();

    await page.getByRole('combobox', { name: 'provider' }).selectOption('provider-a');
    await expect(dialog).toContainText('a-v1');
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual(['provider-a', 'provider-b']);
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click();

    await page.locator('details summary').filter({ hasText: 'customized' }).click();
    await page.getByRole('button', { name: 'fetchModels', exact: true }).click();
    await expect(dialog).toContainText('a-v2');
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual(['provider-a', 'provider-b', 'provider-a']);
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click();

    await page.getByRole('combobox', { name: 'provider' }).selectOption('provider-b');
    await expect(dialog).toContainText('b-v1');
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click();
    await page.getByRole('combobox', { name: 'provider' }).selectOption('provider-a');
    await expect(dialog).toContainText('a-v2');
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual(['provider-a', 'provider-b', 'provider-a']);
    await expect(dialog.getByRole('checkbox').first()).toBeChecked();
    await dialog.getByRole('button', { name: 'fetchAdopt', exact: true }).click();
    await page.locator('details summary').filter({ hasText: 'customized' }).click();
    await expect(page.getByRole('textbox', { name: 'modelId 2' })).toHaveValue('a-v2');
    await page.getByRole('button', { name: 'cancel', exact: true }).click();
    await page.evaluate(() => (window as any).modelHarness.queue('provider-a', {
      kind: 'found', models: [{ id: 'a-reopened', inputModalities: ['text'] }]
    }));
    await page.getByRole('button', { name: 'add', exact: true }).click();
    await expect(dialog).toContainText('a-reopened');
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual([
      'provider-a', 'provider-b', 'provider-a', 'provider-a'
    ]);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
  }
});

test('manual discovery failure keeps the last good local catalog and remains retryable', async ({ page }) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await openModelsSection(page, runtime.authUrl);
    await page.evaluate(() => {
      const h = (window as any).modelHarness;
      h.queue('provider-a', { kind: 'found', models: [{ id: 'a-stable', inputModalities: ['text', 'image'] }] });
      h.queue('provider-a', { kind: 'refused', message: 'synthetic offline refusal' });
      h.queue('provider-a', { kind: 'found', models: [{ id: 'a-retry', inputModalities: ['text'] }] });
    });
    await page.getByRole('button', { name: 'add', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual(['provider-a']);
    await expect(dialog).toContainText('a-stable');
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click();

    await page.locator('details summary').filter({ hasText: 'customized' }).click();
    await page.getByRole('button', { name: 'addModel', exact: true }).click();
    await page.getByRole('textbox', { name: 'modelId 1' }).fill('a-stable');
    await page.getByRole('button', { name: 'modelAdvanced 1', exact: true }).click();
    await page.getByRole('button', { name: 'fetchModels', exact: true }).click();
    await expect(page.getByText('synthetic offline refusal')).toBeVisible();
    await expect(page.getByRole('button', { name: 'fetchModels', exact: true })).toBeEnabled();

    const imageInput = page.getByRole('checkbox', { name: 'modelInputImage' });
    await expect(imageInput).toBeChecked();
    await expect(imageInput).toBeEnabled();

    await page.getByRole('combobox', { name: 'provider' }).selectOption('provider-b');
    await expect(dialog).toContainText('provider-b-default');
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click();
    await page.getByRole('combobox', { name: 'provider' }).selectOption('provider-a');
    await expect(dialog).toHaveCount(0);
    await page.locator('details summary').filter({ hasText: 'customized' }).click();
    await expect(page.getByText('synthetic offline refusal')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'modelId 1' })).toHaveValue('a-stable');
    await page.getByRole('button', { name: 'modelAdvanced 1', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'modelInputImage' })).toBeChecked();

    await page.getByRole('button', { name: 'fetchModels', exact: true }).click();
    await expect(dialog).toContainText('a-retry');
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual(['provider-a', 'provider-a', 'provider-b', 'provider-a']);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
  }
});

test('a thrown manual discovery falls back without an unhandled browser error', async ({ page }) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await openModelsSection(page, runtime.authUrl);
    await page.evaluate(() => {
      const h = (window as any).modelHarness;
      h.queue('provider-a', { kind: 'found', models: [{ id: 'a-stable', inputModalities: ['text', 'image'] }] });
      h.queue('provider-a', { __throw: true, message: 'synthetic thrown transport error' });
    });
    await page.getByRole('button', { name: 'add', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('a-stable');
    await dialog.getByRole('button', { name: 'cancel', exact: true }).click();
    await page.locator('details summary').filter({ hasText: 'customized' }).click();
    await page.getByRole('button', { name: 'fetchModels', exact: true }).click();
    await expect(page.getByText('fetchEmpty')).toBeVisible();
    await expect(page.getByRole('button', { name: 'fetchModels', exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => (window as any).modelHarness.calls)).toEqual(['provider-a', 'provider-a']);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
  }
});

test('opening an existing provider editor does not auto-discover or leave its input controls loading', async ({ page }) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await openModelsSection(page, runtime.authUrl);
    await page.getByText('edit', { exact: true }).click();
    await page.locator('details summary').filter({ hasText: 'customized' }).click();
    await expect(page.getByRole('textbox', { name: 'modelId 1' })).toHaveValue('existing-model');
    await page.getByRole('button', { name: 'modelAdvanced 1', exact: true }).click();
    const imageInput = page.getByRole('checkbox', { name: 'modelInputImage' });
    await expect(imageInput).toBeChecked();
    await expect(imageInput).toBeEnabled();
    await expect(page.getByRole('button', { name: 'fetchModels', exact: true })).toHaveText('fetchModels');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as any).modelHarness.calls)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
  }
});
