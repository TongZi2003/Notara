import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, enterClassroom, sendInput } from './fixtures/classroom.ts';

/**
 * P2.7 debug surfaces. The switch is off on a fresh browser; turning it on adds
 * one Raw Conversation view that reads the SAME session binding the native Chat
 * and Trajectory read. Ordinary classroom copy never shows internal paths.
 */
test('raw debug stays off by default, then reads the shared binding window', async ({ page, classroom }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '请弄清一次函数的图像');
  await expect.poll(async () => existsSync(join(classroom.root, 'model-requests.jsonl')), { timeout: 30_000 }).toBe(true);
  await expect(page.getByText(/已收到：请弄清一次函数的图像/)).toBeVisible();

  // Ordinary Chat: the internal system prompt is replaced by a student-facing note.
  const note = page.getByTestId('sf-system-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('课堂准备');
  expect(await note.innerText()).not.toMatch(/@deepseek-ai|System prompt|\/Users\//);
  // Even expanding the student note keeps internals out of ordinary reading.
  await note.getByRole('button').click();
  await expect(note.getByTestId('sf-system-note-body')).toBeVisible();
  expect(await note.innerText()).not.toMatch(/@deepseek-ai|\/Users\/|schema/);
  // Native context rows already ride the compact process disclosure.
  const contextRow = page.locator('[data-chat-flow-kind="context"]');
  if (await contextRow.count() > 0) await expect(contextRow.first()).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('chat-without-internals.png') });

  // Default: no Raw view.
  await expect(page.getByRole('tab', { name: 'Raw', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  const requestsBefore = await requestCount(classroom.root);
  const toggle = page.getByTestId('sf-debug-toggle');
  await expect(page.getByTestId('sf-debug-row')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // The Raw view appears and reads the binding's own window.
  await page.getByRole('tab', { name: 'Raw', exact: true }).click();
  const raw = page.getByTestId('sf-raw-view');
  await expect(raw).toBeVisible();
  // The one switch reaches both debug views: our Raw, and the native Trajectory.
  await page.getByTestId('sf-raw-open-trajectory').click();
  await expect(page.getByRole('tab', { name: 'Trajectory', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sf-raw-view')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Raw', exact: true }).click();
  await expect(page.getByTestId('sf-raw-view')).toBeVisible();
  await expect(page.getByTestId('sf-raw-window')).toContainText('持久');
  const entries = page.getByTestId('sf-raw-entry');
  expect(await entries.count()).toBeGreaterThan(0);
  await expect(entries.first()).toHaveAttribute('data-raw-kind', 'event');

  // Expanding one row shows the raw event JSON, unmodified.
  await entries.first().getByRole('button').first().click();
  const firstJson = page.getByTestId('sf-raw-json').first();
  await expect(firstJson).toBeVisible();
  await expect(firstJson).toContainText('"type"');

  // Search narrows the resident window without touching it.
  const total = await entries.count();
  await page.getByTestId('sf-raw-search').fill('user/message');
  await expect(page.getByTestId('sf-raw-search-count')).toBeVisible();
  expect(await entries.count()).toBeLessThanOrEqual(total);

  // The exact internal string that ordinary Chat withheld is still in Raw.
  await page.getByTestId('sf-raw-search').fill('@deepseek-ai');
  await expect(page.getByTestId('sf-raw-search-count')).toBeVisible();
  const matched = Number(/匹配 (\d+)/.exec(await page.getByTestId('sf-raw-search-count').innerText())?.[1] ?? '0');
  expect(matched).toBeGreaterThan(0);
  await page.getByTestId('sf-raw-entry').first().getByRole('button').first().click();
  await expect(page.getByTestId('sf-raw-json').first()).toContainText('@deepseek-ai');
  await page.getByTestId('sf-raw-search').fill('');

  // Raw is the same durable record Chat rendered, not a parallel feed.
  await page.getByTestId('sf-raw-search').fill('请弄清一次函数的图像');
  const sameText = Number(/匹配 (\d+)/.exec(await page.getByTestId('sf-raw-search-count').innerText())?.[1] ?? '0');
  expect(sameText).toBeGreaterThan(0);
  await page.getByTestId('sf-raw-entry').first().getByRole('button').first().click();
  await expect(page.getByTestId('sf-raw-json').first()).toContainText('请弄清一次函数的图像');
  // Reading the debug window never asks the model again.
  expect(await requestCount(classroom.root)).toBe(requestsBefore);
  await page.getByTestId('sf-raw-search').fill('');

  // Older pages load through the binding's own request; a fresh lesson is at its start.
  await expect(page.getByTestId('sf-raw-load-older')).toBeVisible();
  await expect(page.getByTestId('sf-raw-window')).toContainText('已到最早');

  // Copy round-trips through the real clipboard.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('sf-raw-copy-window').click();
  await expect(page.getByTestId('sf-raw-copy-window')).toHaveText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"type"');

  // Read-only course metadata; the P5 confirmation path is not connected.
  const domain = page.getByTestId('sf-raw-domain');
  await expect(domain).toContainText('只读');
  await expect(page.getByTestId('sf-raw-domain-json')).toContainText('"lessonMaterials"');
  await expect(domain).toContainText('确认通路还没有接上');
  await page.screenshot({ path: testInfo.outputPath('raw-debug.png') });

  // Turning it back off removes the Raw view and returns to the native ring.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('sf-debug-toggle').click();
  await expect(page.getByTestId('sf-debug-toggle')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Raw', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-conversation-scroll]')).toBeVisible();
  expect(errors).toEqual([]);
});

async function requestCount(root: string): Promise<number> {
  return (await readFile(join(root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').length;
}

test('the native Normal transcript never prints the internal context source', async ({ page, classroom }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '请讲解一次函数');
  await expect.poll(async () => existsSync(join(classroom.root, 'model-requests.jsonl')), { timeout: 30_000 }).toBe(true);
  await expect(page.getByText(/已收到：请讲解一次函数/)).toBeVisible();

  // Ask the native shell for its other transcript presentation.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await dialog.getByRole('button', { name: 'Compact', exact: true }).click();
  const normal = page.getByRole('menuitemradio', { name: 'Normal', exact: true }).or(page.getByRole('menuitem', { name: 'Normal', exact: true }));
  await normal.first().click();
  await page.keyboard.press('Escape');

  const contextNote = page.getByTestId('sf-context-note');
  await expect(contextNote).toBeVisible();
  await contextNote.getByRole('button').click();
  await expect(contextNote.getByTestId('sf-context-note-body')).toBeVisible();
  const rendered = await page.locator('[data-conversation-scroll]').innerText();
  expect(rendered).not.toContain('@deepseek-ai');
  expect(rendered).not.toContain('Context injection');
  await page.screenshot({ path: testInfo.outputPath('normal-transcript.png') });
  expect(errors).toEqual([]);
});
