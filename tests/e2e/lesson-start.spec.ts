import { test, expect, enterClassroom, sendInput, typeInput, openLessonStart, openLessonSettings } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CourseView } from '@studyforge/contracts/courses';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const value = <T,>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };

test('开始 owns settings and imports; lost replies retry the same writes, preserve the draft, and open the saved original', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  const client = await connectRuntime(classroom);
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '准备这节课。');
  await expect(page.getByText('已收到：准备这节课。', { exact: true })).toBeVisible();
  const sessionId = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => !row.blank && row.origin !== 'subagent')!.sessionId;
  const requests = await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8');
  await typeInput(page, '这段输入先留着');
  await expect(page.getByRole('button', { name: 'Add attachment', exact: true })).toBeHidden();
  await expect(page.getByTestId('open-lesson-settings')).toHaveCount(0);
  await openLessonSettings(page);
  await expect(page.getByTestId('lesson-settings-modal')).toContainText('本课概况');
  await page.getByTestId('lesson-settings-close').click();
  const start = page.getByTestId('lesson-deck-reopen');
  await expect(start.getByRole('heading', { name: '外部资料' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('start-desktop.png'), fullPage: true });

  const imports: unknown[] = [], writes: unknown[] = [];
  for (const [endpoint, recorded] of [['studyforgeMaterials/import', imports], ['studyforgeCourses/update', writes]] as const) {
    await page.route(`**/api/${endpoint}`, async route => {
      recorded.push(route.request().postDataJSON().payload.args);
      if (recorded.length > 1) { await route.continue(); return; }
      await route.fetch();
      await route.abort('failed');
    });
  }
  await start.getByTestId('material-file-input').setInputFiles({ name: '新课资料.md', mimeType: 'text/markdown', buffer: Buffer.from('# 新课资料\n先确定自变量的范围。') });
  await expect(start.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  expect(value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {}))).toHaveLength(1);
  // Returning from the desk must not discard the uncertain import attempt.
  await page.getByTestId('open-lesson').click();
  await openLessonStart(page);
  await expect(start.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  await start.getByRole('button', { name: '重试', exact: true }).click();
  await expect(start.getByText('资料已收好，暂时没能加入本课。', { exact: true })).toBeVisible();
  const after = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  expect(after.data.lessonMaterials.materials).toHaveLength(1);
  // A later course change must survive replaying the lost attachment reply.
  value(await client.rpc('studyforgeCourses/update', { input: { sessionId, operationId: 'later-change', expectedVersion: after.version, patch: { temporaryInstructions: '保留这条新要求。' } } }));
  await start.getByRole('button', { name: '重试', exact: true }).click();
  await expect(start.getByText('已加入本课', { exact: true })).toBeVisible();
  expect(imports).toHaveLength(2); expect(imports[1]).toEqual(imports[0]);
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  const final = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  expect(final.data.lessonMaterials.materials).toHaveLength(1);
  expect(final.data.temporaryInstructions).toBe('保留这条新要求。');
  await expect(page.locator('[data-composer-input]')).toContainText('这段输入先留着');
  await start.getByRole('button', { name: '新课资料', exact: true }).click();
  await expect(page.getByTestId('lesson-materials-map')).toContainText('新课资料');
  await expect(page.getByTestId('lesson-materials-pane')).toContainText('先确定自变量的范围。');
  expect(await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).toBe(requests);
  await openLessonStart(page);
  await expect(start.getByText('已加入本课', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(start.getByTestId('material-pick')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('start-narrow.png'), fullPage: true });
  await page.reload();
  await page.getByTestId('open-lesson').click();
  await expect(page.getByTestId('lesson-materials-map')).toContainText('新课资料');
});

test('开始 imports stay with the original lesson during a switch; composer paste is not intercepted', async ({ page, classroom }) => {
  const client = await connectRuntime(classroom);
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '第一课。');
  await expect(page.getByText('已收到：第一课。', { exact: true })).toBeVisible();
  const first = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => !row.blank && row.origin !== 'subagent')!.sessionId;
  await openLessonStart(page);
  // Native composer paste should only stage its image, not import a material.
  await page.locator('[data-composer-input]').evaluate(el => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    const clipboardData = new DataTransfer(); clipboardData.items.add(new File([bytes], '课堂截图.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('button', { name: 'Remove image 课堂截图.png', exact: true })).toBeVisible();
  expect(value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {}))).toHaveLength(0);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void;
  const waiting = new Promise<void>(resolve => { arrived = resolve; });
  await page.route('**/api/studyforgeMaterials/import', async route => { arrived(); await held; await route.continue(); });
  await page.getByTestId('lesson-deck-reopen').getByTestId('material-file-input').setInputFiles({ name: '第一课原文.md', mimeType: 'text/markdown', buffer: Buffer.from('第一课的原文') });
  await waiting;
  try {
    await page.getByRole('button', { name: 'New session', exact: true }).click();
    await sendInput(page, '第二课。');
    await expect(page.getByText('已收到：第二课。', { exact: true })).toBeVisible();
  } finally { release(); }
  await expect.poll(async () => value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId: first } })).data.lessonMaterials.materials.length).toBe(1);
  const second = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId !== first && !row.blank && row.origin !== 'subagent')!.sessionId;
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId: second } })).data.lessonMaterials.materials).toHaveLength(0);
});
