import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, enterClassroom, typeInput } from './fixtures/classroom.ts';

test('plus selects a native skill reference without sending and the native turn loads it only on submit', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterClassroom(page, classroom.authUrl);
  await typeInput(page, '找一下能解释配角的材料');
  const input = page.locator('[data-composer-input]');
  await page.locator('[data-composer-seat] input[type="file"][hidden]').setInputFiles({ name: '查找要求.txt', mimeType: 'text/plain', buffer: Buffer.from('保留这份附件') });
  await page.locator('.sf-composer-more summary').click();
  await page.getByRole('button', { name: '按语义查找', exact: true }).click();
  await expect(input).toContainText('找一下能解释配角的材料');
  await expect(page.locator('[data-composer-chip="studyforge-task"]')).toContainText('按语义查找');
  await expect(page.getByText('查找要求.txt', { exact: false }).first()).toBeVisible();
  expect((await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).trim()).toBe('');
  await page.screenshot({ path: info.outputPath('skill-in-draft.png'), fullPage: true });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(async () => (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).includes('skill-invocation')).toBe(true);
  const requests = await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8');
  expect(requests).toContain('围绕学生要找的概念');
  expect(requests).toContain('studyforge-semantic-search');
  await expect(page.locator('[data-composer-chip="studyforge-task"]')).toHaveCount(0);
});
