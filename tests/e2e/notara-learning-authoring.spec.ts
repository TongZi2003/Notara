import { test, expect, enterClassroom, openRoot } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';

const value = <T>(reply: { ok: boolean; value?: T; error?: unknown }): T => {
  if (!reply.ok || reply.value === undefined) throw new Error(JSON.stringify(reply.error));
  return reply.value;
};

test('student edits a classroom Markdown material in place and reopens the saved version', async ({ page, classroom }) => {
  await enterClassroom(page, classroom.authUrl);
  const client = await connectRuntime(classroom);
  const material = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: {
    operationId: 'notara-authoring-book', material: { title: '课堂讲义', fileName: '课堂讲义.md', mediaType: 'text/markdown' }, base64: Buffer.from('# 课堂讲义\n\n第一章先看定义。\n').toString('base64'),
  } }));
  await openRoot(page, '资料');
  const group = page.getByTestId('library-source-group').filter({ hasText: material.title });
  await group.getByRole('button', { name: `预览：${material.title}` }).click();
  await page.getByTestId('library-detail').getByRole('button', { name: '阅读原文', exact: true }).click();
  await expect(page.getByTestId('classroom-markdown-editor')).toBeVisible();
  await page.getByRole('button', { name: '编辑 Markdown', exact: true }).click();
  await page.getByTestId('classroom-markdown-draft').fill('# 课堂讲义\n\n第一章先看定义。\n\n## 第二章\n\n补一个练习。\n');
  await page.getByTestId('material-save-version').click();
  await expect(page.getByTestId('classroom-markdown-editor')).toContainText('已保存新版本');
  await expect(page.getByTestId('material-version-select').locator('option')).toHaveCount(2);

  await page.getByTestId('materials-back').click();
  await expect(page.getByTestId('library-browser')).toBeVisible();
  const reopened = page.getByTestId('library-source-group').filter({ hasText: material.title });
  await reopened.getByRole('button', { name: `预览：${material.title}` }).click();
  await page.getByTestId('library-detail').getByRole('button', { name: '阅读原文', exact: true }).click();
  await page.getByTestId('material-version-select').selectOption({ index: 1 });
  await expect(page.getByTestId('material-markdown')).toContainText('补一个练习');
  await expect(page.locator('body')).not.toContainText('studyforgeCreation');
});
