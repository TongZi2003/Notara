import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, enterClassroom, sendInput, openLessonSettings } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';

const MODEL_TRIGGER = /^(Select model|选择模型)/;

async function startLesson(page: Parameters<typeof enterClassroom>[0], url: string, prompt: string, root: string): Promise<void> {
  await enterClassroom(page, url);
  await sendInput(page, prompt);
  await expect.poll(async () => existsSync(join(root, 'model-requests.jsonl')), { timeout: 30_000 }).toBe(true);
  await expect(page.getByTestId('learning-workspace')).toBeVisible();
}

test('a completed turn keeps its native usage and the lesson panel never fills unreported buckets', async ({ page, classroom }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await startLesson(page, classroom.authUrl, '请讲解一次函数', classroom.root);

  // The native completed-turn usage line stays exactly where it was.
  const tail = page.getByRole('button', { name: /Usage|用量/ });
  await expect(tail).toBeVisible();
  await expect(tail).toContainText('15');
  // The native model control stays the only model control.
  await expect(page.getByRole('button', { name: MODEL_TRIGGER })).toHaveCount(1);

  await openLessonSettings(page);
  const panel = page.getByTestId('lesson-settings-modal');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('usage-input')).toHaveText('8');
  await expect(panel.getByTestId('usage-cache-read')).toHaveText('2');
  // The adapter never reported a cache write: the panel says so instead of 0.
  await expect(panel.getByTestId('usage-cache-write')).toHaveText('未报告');
  await expect(panel.getByTestId('usage-output')).toHaveText('5');
  await expect(panel.getByTestId('usage-coverage')).toContainText('都已记下');
  // Occupancy is an estimate of a different thing, and it says so.
  const estimates = panel.getByTestId('usage-estimates');
  await expect(estimates).toBeVisible();
  await expect(estimates).toContainText('估算');
  await expect(estimates).toContainText('不是实际消耗');
  // The docked panel slides in: assert the section really lands before the shot.
  await expect(panel).toBeInViewport({ ratio: 0.95 });
  await panel.getByTestId('usage-totals').scrollIntoViewIfNeeded();
  await expect(panel.getByTestId('usage-totals')).toBeInViewport({ ratio: 0.95 });
  await page.screenshot({ path: testInfo.outputPath('lesson-usage.png') });
  expect(errors).toEqual([]);
});

test('a turn without a proof of total usage is reported as incomplete coverage', async ({ page, classroom }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await startLesson(page, classroom.authUrl, '[partial] 换一题', classroom.root);

  await openLessonSettings(page);
  const panel = page.getByTestId('lesson-settings-modal');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('usage-coverage')).toContainText('覆盖');
  await expect(panel.getByTestId('usage-coverage')).toContainText('只能看已报告的部分');
  // An unproven bucket is not printed as an actual reported number.
  await expect(panel.getByTestId('usage-cache-write')).toHaveText('不完整');
  await expect(panel.getByTestId('usage-cache-read')).toHaveText('不完整');
  await expect(panel).toBeInViewport({ ratio: 0.95 });
  await panel.getByTestId('usage-coverage').scrollIntoViewIfNeeded();
  await expect(panel.getByTestId('usage-coverage')).toBeInViewport({ ratio: 0.95 });
  await page.screenshot({ path: testInfo.outputPath('lesson-usage-partial.png') });
  expect(errors).toEqual([]);
});

test('a second turn refreshes the lesson panel that stayed open, and a refresh agrees', async ({ page, classroom }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await startLesson(page, classroom.authUrl, '请讲解一次函数', classroom.root);

  await openLessonSettings(page);
  const panel = page.getByTestId('lesson-settings-modal');
  await expect(panel.getByTestId('usage-input')).toHaveText('8');
  await expect(panel.getByTestId('usage-coverage')).toContainText('1 个回合');

  // The modal is never closed: the native Session's settle signal is the only
  // thing that re-reads the lesson, so the second turn has to move these lines.
  // It is sent over the same wire the composer uses, because the modal is a
  // deliberate overlay above the composer.
  const client = await connectRuntime(classroom);
  const listed = await client.rpc<SessionListValue>('session/list', { _request: {} });
  if (!listed.ok) throw new Error('session/list refused');
  const sessionId = listed.value.items.find(item => !item.blank && item.origin !== 'subagent')!.sessionId;
  await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '再讲一题' }] } });
  await expect(panel.getByTestId('usage-input')).toHaveText('16', { timeout: 30_000 });
  await expect(panel.getByTestId('usage-output')).toHaveText('10');
  await expect(panel.getByTestId('usage-cache-read')).toHaveText('4');
  await expect(panel.getByTestId('usage-coverage')).toContainText('2 个回合');
  await panel.getByTestId('usage-totals').scrollIntoViewIfNeeded();
  await expect(panel.getByTestId('usage-totals')).toBeInViewport({ ratio: 0.95 });
  await page.screenshot({ path: testInfo.outputPath('lesson-usage-second-turn.png') });

  // The same read after a reload shows the same native totals, not a fresh zero.
  await page.reload();
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await openLessonSettings(page);
  const reopened = page.getByTestId('lesson-settings-modal');
  await expect(reopened.getByTestId('usage-input')).toHaveText('16');
  await expect(reopened.getByTestId('usage-output')).toHaveText('10');
  await expect(reopened.getByTestId('usage-coverage')).toContainText('2 个回合');
  expect(errors).toEqual([]);
});
