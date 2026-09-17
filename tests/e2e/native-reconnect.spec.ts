import { test, expect, enterClassroom, sendInput, typeInput } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; }

test('native per-session drafts, history and reopening remain separate across two classes and restart', async ({ page, classroom }, testInfo) => {
  await enterClassroom(page, classroom.authUrl);
  const client = await connectRuntime(classroom);
  await sendInput(page, '甲课的第一句');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：甲课的第一句', { exact: true })).toHaveCount(1);
  const a = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => !row.origin)!.sessionId;
  value(await client.rpc('session/rename', { request: { sessionId: a, title: '甲课' } }));
  await typeInput(page, '甲课未发送草稿');
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.locator('[data-composer-input]')).toBeEmpty();
  await sendInput(page, '乙课的第一句');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：乙课的第一句', { exact: true })).toHaveCount(1);
  const b = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => !row.origin && row.sessionId !== a)!.sessionId;
  value(await client.rpc('session/rename', { request: { sessionId: b, title: '乙课' } }));
  await typeInput(page, '乙课未发送草稿');
  // Reopening a lesson goes through the sidebar's own recent-sessions row.
  await page.getByTestId('notebook-sidebar').locator('button.sf-side-session', { hasText: '甲课' }).click();
  await expect(page.locator('[data-composer-input]')).toHaveText('甲课未发送草稿');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：甲课的第一句', { exact: true })).toHaveCount(1);
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：乙课的第一句', { exact: true })).toHaveCount(0);
  await page.getByTestId('notebook-sidebar').locator('button.sf-side-session', { hasText: '乙课' }).click();
  await expect(page.locator('[data-composer-input]')).toHaveText('乙课未发送草稿');
  await page.screenshot({ path: testInfo.outputPath('native-drafts-separated.png') });
  const requests = await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8');
  const titles = async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.filter(row => row.sessionId === a || row.sessionId === b).map(row => row.projections?.values.title).sort();
  expect(await titles()).toEqual(['乙课', '甲课'].sort());
  await page.reload();
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：乙课的第一句', { exact: true })).toHaveCount(1);
  expect(await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).toBe(requests);
  expect(await titles()).toEqual(['乙课', '甲课'].sort());
  await classroom.restart();
  const restoredClient = await connectRuntime(classroom);
  const restored = value(await restoredClient.rpc<SessionListValue>('session/list', { _request: {} }));
  expect(restored.items.filter(row => row.sessionId === a || row.sessionId === b).map(row => row.projections?.values.title).sort()).toEqual(['乙课', '甲课'].sort());
  await enterClassroom(page, classroom.authUrl);
  await page.getByTestId('notebook-sidebar').locator('button.sf-side-session', { hasText: '甲课' }).click();
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：甲课的第一句', { exact: true })).toHaveCount(1);
  expect(await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).toBe(requests);
  await page.screenshot({ path: testInfo.outputPath('native-history-after-restart.png') });
});

test('native reconnect replaces a disconnected stream with the one durable reply', async ({ page, classroom }, testInfo) => {
  await enterClassroom(page, classroom.authUrl);
  const text = '[slow] 断线后这一次回复继续完成。'.repeat(8);
  await sendInput(page, text);
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toBeVisible();
  const client = await connectRuntime(classroom);
  await expect.poll(async () => (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).includes(text)).toBe(true);
  await page.context().setOffline(true);
  try {
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.some(row => row.running), { timeout: 15_000 }).toBe(false);
  } finally { await page.context().setOffline(false); }
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：' + text, { exact: true })).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0);
  const requests = await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8');
  await page.reload();
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：' + text, { exact: true })).toHaveCount(1);
  expect(await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).toBe(requests);
  await page.screenshot({ path: testInfo.outputPath('native-offline-replay.png') });
});
