import { openAppearance, closeAppearance, openLessonMaterials } from './fixtures/classroom.ts';
import { test, expect, enterClassroom, sendInput, typeInput } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CourseView } from '@studyforge/contracts/courses';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const value = <T,>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };

test('conversation import saves directly, retries an uncertain reply once, and keeps the draft and original accessible', async ({ page, classroom }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 950 });
  const client = await connectRuntime(classroom);
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '先讨论一下函数。');
  await expect(page.getByText('已收到：先讨论一下函数。', { exact: true })).toBeVisible();
  const sessionId = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => !row.blank && row.origin !== 'subagent')!.sessionId;
  const requests = await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8');
  await openLessonMaterials(page);
  const empty = page.getByTestId('lesson-materials-empty');
  const composer = page.getByTestId('composer-import');
  await expect(empty.getByRole('button', { name: '导入资料', exact: true })).toBeVisible();
  await expect(page.getByText('这节课还没有用到资料。', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多学习操作', exact: true })).toBeVisible();
  await typeInput(page, '这句话先不发送');
  await page.screenshot({ path: info.outputPath('classroom-import-empty.png'), fullPage: true });

  const attempts: unknown[] = [];
  await page.route('**/api/studyforgeMaterials/import', async route => {
    attempts.push(route.request().postDataJSON().payload.args);
    if (attempts.length > 1) { await route.continue(); return; }
    await route.fetch(); await route.abort('failed');
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '更多学习操作', exact: true }).click();
  await page.getByRole('button', { name: '上传新资料到资料库', exact: true }).click();
  await (await chooser).setFiles({ name: '现场讲义.md', mimeType: 'text/markdown', buffer: Buffer.from('# 现场讲义\n先确定自变量的范围。') });
  const results = composer.getByTestId('composer-import-results');
  await expect(results.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  expect(value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {}))).toHaveLength(1);
  await results.getByRole('button', { name: '重试', exact: true }).click();
  await expect(results.getByText('已加入本课', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByTestId('lesson-materials-map')).toContainText('现场讲义');
  await expect(empty).toHaveCount(0);
  const course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  expect(course.data.lessonMaterials.materials).toHaveLength(1);
  await expect(page.getByTestId('inline-proposal')).toHaveCount(0);
  await expect(page.locator('[data-composer-input]')).toContainText('这句话先不发送');
  await results.getByRole('button', { name: '现场讲义', exact: true }).click();
  await expect(page.getByTestId('lesson-materials-pane')).toContainText('先确定自变量的范围。');
  expect(await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).toBe(requests);
  await composer.getByRole('button', { name: '收起导入结果', exact: true }).click();
  await page.screenshot({ path: info.outputPath('classroom-import-saved.png'), fullPage: true });
  await page.reload();
  await openLessonMaterials(page);
  await expect(page.getByTestId('lesson-materials-map')).toContainText('现场讲义');
  expect(value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {}))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('empty desk imports a dropped batch even when its first saved file replaces the empty state', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  await page.setViewportSize({ width: 1440, height: 950 });
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '把资料放在这里。');
  await expect(page.getByText('已收到：把资料放在这里。', { exact: true })).toBeVisible();
  const sessionId = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => !row.blank && row.origin !== 'subagent')!.sessionId;
  await openLessonMaterials(page);
  const empty = page.getByTestId('lesson-materials-empty');
  await expect(empty).toBeVisible();
  // 手帐主题入口已下线（本轮只发布极简主题）：保留外观面板的往返，不再切换主题。
  await openAppearance(page);
  await closeAppearance(page);
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: /回到这节课/u }).click();
  await expect(empty).toBeVisible();
  await page.screenshot({ path: info.outputPath('classroom-import-white.png'), fullPage: true });
  await empty.getByTestId('material-drop-zone').evaluate(el => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['# 定义域\n先看条件。'], '定义域.md', { type: 'text/markdown' }));
    dataTransfer.items.add(new File(['# 单调性\n观察变化。'], '单调性.md', { type: 'text/markdown' }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })).data.lessonMaterials.materials.length).toBe(2);
  expect(value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {}))).toHaveLength(2);
  await expect(page.getByRole('group', { name: 'Pending attachments', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('lesson-materials-map')).toContainText('定义域');
  await expect(page.getByTestId('lesson-materials-map')).toContainText('单调性');
  const composer = page.getByTestId('composer-import');
  await composer.getByTestId('import-results-toggle').click();
  await expect(composer.getByText('已加入本课', { exact: true })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  // At phone width the workspace shows only the active view; bring the chat
  // forward so the composer is usable — the materials desk leaves the stage.
  await page.getByTestId('workspace-open-chat').click();
  await expect(page.getByTestId('studyforge-lesson-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: '更多学习操作', exact: true })).toBeVisible();
  const popup = composer.getByTestId('composer-import-results');
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: '单调性', exact: true }).hover();
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('classroom-import-narrow.png'), fullPage: true });
});

test('the model can save a student-uploaded file into the library by name', async ({ page, classroom }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const client = await connectRuntime(classroom);
  await enterClassroom(page, classroom.authUrl);
  await page.locator('[data-composer-seat] input[type="file"][hidden]').first()
    .setInputFiles({ name: '讲义.md', mimeType: 'text/markdown', buffer: Buffer.from('# 讲义\n\n函数定义域的三条规则。\n') });
  await sendInput(page, '这是我找来的资料。');
  await expect(page.getByText('已收到：', { exact: false }).first()).toBeVisible();
  await sendInput(page, '[tools][{"name":"load_tools","arguments":{"names":["import_uploaded_material"]}},{"name":"import_uploaded_material","arguments":{"name":"讲义.md"}}]');
  await expect.poll(async () => value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {})).map(item => item.title)).toContain('讲义');
  expect(errors).toEqual([]);
});
