import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { PluginCandidate, PluginView } from '@studyforge/contracts/plugins';
import { test, expect } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

function value<T>(reply: { ok: boolean; value?: T; error?: unknown }): T {
  if (!reply.ok || reply.value === undefined) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}

// A real iframe session: the student's own pointer operations (pan, click-to-add
// a point, reset) must surface as labelled entries in the Host activity trail,
// which the next teacher request sees in its runtime-context snapshot.
test('math board pointer operations land in the workbench activity trail', async ({ page, classroom }) => {
  const client = await connectRuntime(classroom);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/math-workbench') } }));
  const plugin = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const id = 'plugin-' + plugin.ref.slice(7) + '-board';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
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
  await expect(frame.locator('#sync')).toHaveText('已同步');

  // Pan the viewport, then click to drop a point: two labelled writes.
  const board = (await frame.locator('#math-board').boundingBox())!;
  const start = { x: board.x + board.width * .25, y: board.y + board.height * .3 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.mouse.click(start.x, start.y);
  await expect(frame.locator('#math-board [data-math-object="P1"]')).toBeVisible();
  await expect(frame.locator('#sync')).toHaveText('已同步');

  const sessionId = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items[0]!.sessionId;
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '继续' }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items[0]?.running, { timeout: 30_000 }).toBe(false);

  const requests = (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { sessionId: string; purpose: string; messages: { content: { type: string; text?: string }[] }[] });
  const main = requests.filter(row => row.sessionId === sessionId && row.purpose !== 'session-title');
  const snapshot = main.at(-1)!
    .messages.flatMap(message => message.content.flatMap(block => block.type === 'text' && block.text ? [block.text] : []))
    .find(text => text.includes('学生近期在工作台上的操作'));
  expect(snapshot, 'the teacher request must carry the board activity snapshot').toBeTruthy();
  expect(snapshot).toContain('调整视区');
  expect(snapshot).toContain('添加点 P1');
  expect(errors).toEqual([]);
});
