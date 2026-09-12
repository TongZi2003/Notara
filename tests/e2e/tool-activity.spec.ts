import { test, expect, enterClassroom, sendInput } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

test('tool rows speak plainly until expanded and retain the native inspection route', async ({ page, classroom }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '[tools]' + JSON.stringify([
    { name: 'list_cards', arguments: { state: 'due' } },
    { name: 'propose_card', arguments: { kind: 'card', title: '先检查象限', front: '观察角的范围。' } },
    { name: 'read_card', arguments: { target: 'card:missing-fixture' } },
  ]));
  const client = await connectRuntime(classroom);
  await expect.poll(async () => {
    const sessions = await client.rpc<SessionListValue>('session/list', { _request: {} });
    return sessions.ok && sessions.value.items.length > 0 && sessions.value.items.every(item => !item.running);
  }).toBe(true);
  const process = page.getByTestId('tool-process-toggle');
  await expect(process).toContainText('老师的准备过程 · 3 步');
  if (await process.getAttribute('aria-expanded') !== 'true') await process.click();
  const rows = page.getByTestId('tool-activity');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('查看今天该复习的卡片');
  await expect(rows.nth(1)).toContainText('提案已准备好');
  await expect(rows.nth(1).getByTestId('tool-activity-summary')).toContainText('准备卡片“先检查象限”');
  await expect(rows.nth(1)).not.toContainText('已保存');
  await expect(rows.last()).toHaveAttribute('data-tool-state', 'error');
  for (const row of await rows.all()) {
    await expect(row.getByTestId('tool-activity-details')).toHaveCount(0);
    await expect(row.getByTestId('tool-activity-summary')).not.toContainText('card:missing-fixture');
    await expect(row.getByTestId('tool-activity-summary')).not.toContainText('read_card');
  }
  await rows.last().getByTestId('tool-activity-summary').click();
  const details = rows.last().getByTestId('tool-activity-details');
  await expect(details).toContainText('read_card');
  await expect(details).toContainText('card:missing-fixture');
  await expect(details).toContainText('参数');
  await expect(details).toContainText('结果');
  await details.scrollIntoViewIfNeeded();
  await expect(details).toBeVisible();
  await page.screenshot({ path: info.outputPath('tool-details-mobile.png'), fullPage: true });
  await details.getByRole('button', { name: '查看工具定义与完整记录' }).click();
  await expect(page.getByRole('tab', { name: 'Trajectory', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByTestId('inline-proposal')).toContainText('待你确认');
  await rows.last().getByTestId('tool-activity-summary').click();
  await expect(rows.last().getByTestId('tool-activity-details')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('tool-process-toggle')).toContainText('3 步');
  expect(errors).toEqual([]);
});

test('an expanded image read keeps the native attachment preview', async ({ page, classroom }) => {
  const png = await sharp({ create: { width: 160, height: 80, channels: 3, background: '#26437c' } }).png().toBuffer();
  await writeFile(join(classroom.root, 'classroom', 'shape.png'), png);
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'read_image', arguments: { file_path: 'shape.png' } }));
  const process = page.getByTestId('tool-process-toggle');
  await expect(process).toBeVisible();
  if (await process.getAttribute('aria-expanded') !== 'true') await process.click();
  const row = page.getByTestId('tool-activity');
  await expect(row).toHaveAttribute('data-tool-state', 'ok');
  await expect(row.getByTestId('tool-activity-summary')).toHaveText(/查看图片：已完成/);
  await row.getByTestId('tool-activity-summary').click();
  const preview = row.getByTestId('tool-activity-details').getByRole('img');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(160);
});
