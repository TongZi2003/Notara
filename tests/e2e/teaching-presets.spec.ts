import { test, expect, enterClassroom, sendInput, typeInput, openLessonSettings } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CourseView } from '@studyforge/contracts/courses';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const value = <T,>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };

test('teaching choices preserve the native draft and same lesson; a temporary requirement reaches the next actual request', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '开始学习');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：开始学习', { exact: true })).toBeVisible();
  const session = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => !item.blank && item.origin !== 'subagent')!;
  await typeInput(page, '这条课堂草稿要保留');
  // Open settings through 开始 without replacing the native composer draft.
  await openLessonSettings(page);
  await expect(page.getByTestId('lesson-settings-modal')).toBeVisible();
  await page.getByTestId('lesson-adjust').locator('summary').click();
  await expect(page.getByTestId('teaching-preset').locator('option')).toHaveText(['苏格拉底授课', '费曼法', '讲解式']);
  for (const choice of ['socratic', 'feynman', 'lecture']) {
    await page.getByTestId('teaching-preset').selectOption(choice);
    await expect.poll(async () => value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId: session.sessionId } })).data.teachingRef).toBe(choice);
    await expect(page.locator('[data-composer-input]')).toContainText('这条课堂草稿要保留');
  }
  await page.getByTestId('teaching-instructions').fill('这节课先完整讲解，再给一道独立练习。');
  await page.getByTestId('teaching-save').click();
  await expect.poll(async () => value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId: session.sessionId } })).data.temporaryInstructions).toBe('这节课先完整讲解，再给一道独立练习。');
  // Close settings before sending the draft that remained in the composer.
  await page.getByTestId('lesson-settings-close').click();
  await expect(page.getByTestId('lesson-settings-modal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：这条课堂草稿要保留', { exact: true })).toBeVisible();
  const requests = (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { sessionId: string; purpose: string; messages: unknown });
  const request = requests.filter(row => row.sessionId === session.sessionId && row.purpose !== 'session-title').at(-1);
  expect(JSON.stringify(request?.messages)).toContain('这节课先完整讲解，再给一道独立练习。');
  expect(value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.filter(item => !item.blank && item.origin !== 'subagent')).toHaveLength(1);
  await enterClassroom(page, classroom.authUrl);
  // The same settings are reachable through 开始 after reloading.
  await openLessonSettings(page);
  await expect(page.getByTestId('lesson-settings-modal')).toBeVisible();
  await page.getByTestId('lesson-adjust').locator('summary').click();
  await expect(page.getByTestId('teaching-preset')).toHaveValue('lecture');
  await expect(page.getByTestId('teaching-instructions')).toHaveValue('这节课先完整讲解，再给一道独立练习。');
  await page.screenshot({ path: info.outputPath('teaching-settings.png'), fullPage: true });
});
