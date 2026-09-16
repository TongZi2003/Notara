import { resolve } from 'node:path';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { PluginCandidate, PluginView } from '@studyforge/contracts/plugins';
import { test, expect } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

function value<T>(reply: { ok: boolean; value?: T; error?: unknown }): T {
  if (!reply.ok || reply.value === undefined) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}

test('empty math workbench initializes, constructs a curve, switches real boards and persists clear/reset', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/math-workbench') } }));
  const plugin = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const id = 'plugin-' + plugin.ref.slice(7) + '-board';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Hold only the initial document-read bridge messages, keeping the actual
  // isolated Host and iframe intact while exercising the loading window.
  await page.addInitScript(() => {
    let released = false;
    const waiting: MessageEvent[] = [];
    window.addEventListener('message', event => {
      if (!released && event.data?.type === 'action' && event.data?.action === 'document-read') {
        event.stopImmediatePropagation();
        waiting.push(event);
      }
    }, true);
    document.addEventListener('math-test-release-load', () => {
      released = true;
      for (const event of waiting.splice(0)) window.dispatchEvent(new MessageEvent('message', { data: event.data, origin: event.origin, source: event.source }));
    });
  });
  const releaseLoad = () => page.evaluate(() => { document.dispatchEvent(new Event('math-test-release-load')); });
  await page.setViewportSize({ width: 1154, height: 750 });
  await page.goto(classroom.authUrl);
  for (const name of [/^(Continue|继续)$/, /^(Configure later|稍后配置)$/]) {
    const button = page.getByRole('button', { name });
    try { await button.waitFor({ state: 'visible', timeout: 3000 }); await button.click(); }
    catch { /* Configured test providers can skip the key prompt. */ }
  }
  await expect(page.getByTestId('workspace-open-' + id)).toBeVisible();
  await page.getByTestId('workspace-open-' + id).click();
  await page.getByRole('button', { name: '数学工作台布局', exact: true }).click();
  await page.getByRole('button', { name: '只看数学工作台', exact: true }).click();
  const frame = page.frameLocator('iframe[title="数学工作台"]');
  await expect(frame.locator('#new-object')).toBeVisible();
  expect(errors, 'no startup exception before the first construction').toEqual([]);
  await expect(frame.locator('#math-board svg')).toBeVisible();
  await expect(frame.locator('#new-object')).toBeDisabled();
  await expect(frame.locator('#clear-scene')).toBeDisabled();
  await expect(frame.locator('#reset-scene')).toBeDisabled();
  await expect(frame.locator('#sync')).toHaveText('正在读取…');
  await releaseLoad();
  await expect(frame.locator('#sync')).toHaveText('已同步');
  await expect(frame.locator('#empty-canvas, #plane-overlay, #space-overlay')).toHaveCount(0);
  await frame.locator('#new-object').click();
  await expect(frame.locator('#inspector')).toContainText('构造 · 函数');
  await frame.getByLabel('对象名', { exact: true }).fill('f1');
  await frame.getByLabel('表达式', { exact: true }).fill('x^2');
  await frame.getByRole('button', { name: '添加', exact: true }).click();
  await expect(frame.locator('#math-board [data-math-object="f1"]')).toBeVisible();
  await expect(frame.locator('#sync')).toHaveText('已同步');
  await frame.locator('#reset-scene').dblclick();
  await expect(frame.locator('#sync')).toHaveText('已同步');
  await expect(frame.locator('#objects .object-row')).toHaveCount(0);
  await expect(frame.locator('#math-board > svg')).toHaveCount(1);
  await expect(frame.locator('#space-board > svg')).toHaveCount(1);
  await frame.getByLabel('构造类型', { exact: true }).selectOption('parametric');
  await frame.locator('#new-object').click();
  await expect(frame.locator('#inspector')).toContainText('构造 · 参数曲线');
  await frame.getByLabel('对象名', { exact: true }).fill('curve1');
  await frame.getByRole('button', { name: '添加', exact: true }).click();
  await expect(frame.locator('#math-board [data-math-object="curve1"]')).toBeVisible();
  await expect(frame.locator('#sync')).toHaveText('已同步');
  const sessions = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
  expect(sessions.items).toHaveLength(1);
  const target = { sessionId: sessions.items[0]!.sessionId, id, digest: plugin.digest };
  const read = async () => {
    const saved = value(await client.rpc<{ revision: number; json: string }>('notaraWorkbench/readDocument', { input: target }));
    return { revision: saved.revision, document: JSON.parse(saved.json) };
  };
  await expect.poll(async () => (await read()).document.objects.map((object: { name: string }) => object.name)).toEqual(['curve1']);
  await page.screenshot({ path: info.outputPath('parametric-curve.png') });
  await frame.locator('#view-3d').click();
  await expect(frame.locator('#view-3d')).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.locator('#space-board svg')).toBeVisible();
  await expect(frame.locator('#math-board')).toBeHidden();
  await page.screenshot({ path: info.outputPath('space-axes.png') });
  await frame.locator('#clear-scene').click();
  await expect.poll(async () => (await read()).document.objects).toEqual([]);
  await frame.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await read()).document.objects).toHaveLength(1);
  await frame.locator('#reset-scene').click();
  await expect.poll(async () => (await read()).document.objects).toEqual([]);
  expect((await read()).document.viewport).toEqual([-5, 5, 5, -5]);
  await page.reload();
  await expect(frame.locator('#math-board svg')).toBeVisible();
  await releaseLoad();
  await expect(frame.locator('#sync')).toHaveText('已同步');
  await expect(frame.locator('#objects .object-row')).toHaveCount(0);
  const board = (await frame.locator('#math-board').boundingBox())!;
  const start = { x: board.x + board.width * .25, y: board.y + board.height * .3 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(frame.locator('#sync')).toHaveText('已同步');
  expect((await read()).document.objects, 'panning must not create a point').toEqual([]);
  await page.mouse.click(start.x, start.y);
  await expect.poll(async () => (await read()).document.objects.map((object: { kind: string }) => object.kind)).toEqual(['point']);
  await expect(frame.locator('#math-board [data-math-object="P1"]')).toBeVisible();
  await page.reload();
  await expect(frame.locator('#reset-scene')).toBeDisabled();
  await releaseLoad();
  await expect(frame.locator('#math-board [data-math-object="P1"]')).toBeVisible();
  await expect(frame.locator('#reset-scene')).toBeEnabled();
  expect(errors).toEqual([]);
});
