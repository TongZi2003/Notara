import { test, expect, enterClassroom, sendInput, typeInput, openLessonMaterials } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CourseView } from '@studyforge/contracts/courses';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('whiteboard defaults to the library and filters actual lesson references without writing on browse', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const client = await connectRuntime(classroom);
  for (const title of ['函数原文', '几何原文']) value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: {
    operationId: title, material: { title, fileName: title + '.md', mediaType: 'text/markdown' }, base64: Buffer.from('# ' + title + '\n这一页尚未上课。').toString('base64'),
  } }));
  await page.setViewportSize({ width: 1440, height: 950 });
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '今天先聊聊函数');
  await expect(page.getByText('已收到：今天先聊聊函数', { exact: true })).toBeVisible();
  const sessionId = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => !row.blank && row.origin !== 'subagent')!.sessionId;
  const before = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  await openLessonMaterials(page);
  const scope = page.getByTestId('workbench-scope'), map = page.getByTestId('lesson-materials-map');
  await expect(scope).toHaveValue('all');
  await expect(map).toContainText('函数原文'); await expect(map).toContainText('几何原文');
  await scope.selectOption('lesson');
  await expect(map).toHaveCount(0); await expect(page.getByText('本节课还没有引用资料', { exact: true })).toBeVisible();
  await scope.selectOption('all');
  await map.getByTestId('lesson-resource-row').filter({ hasText: '函数原文' }).getByTestId('lesson-resource-open').click();
  await expect(page.getByTestId('lesson-materials-pane')).toContainText('这一页尚未上课');
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }))).toEqual(before);
  // Browsing the pane still writes nothing; 带入对话 is what stages the chip.
  await page.getByTestId('lesson-materials-pane').getByRole('button', { name: '带入对话', exact: true }).click();
  await typeInput(page, '我想讨论这部分');
  const chip = page.locator('[data-composer-chip="studyforge-source"]');
  await expect(chip).toContainText('函数原文');
  await page.getByRole('button', { name: '更多学习操作', exact: true }).click();
  await page.getByRole('button', { name: '整理成讲义', exact: true }).click();
  await expect(chip).toContainText('函数原文');
  await expect(page.locator('[data-composer-input]')).toContainText('我想讨论这部分');
  await expect(page.locator('[data-composer-input]')).toContainText('整理成讲义');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[data-composer-input]')).toBeEmpty();
  await scope.selectOption('lesson');
  await expect(map).toContainText('函数原文'); await expect(map).not.toContainText('几何原文');
  await scope.selectOption('all'); await expect(map).toContainText('几何原文');
  await page.screenshot({ path: info.outputPath('library-whiteboard.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭资料工作台', exact: true }).click();
  await page.getByTestId('workspace-open-materials').click();
  await expect(scope).toHaveValue('all'); await expect(map).toContainText('几何原文');
  expect(errors).toEqual([]);
});
