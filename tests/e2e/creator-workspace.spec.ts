import { test, expect, enterClassroom, typeInput } from './fixtures/classroom.ts';

test('creator identity opens a bound native conversation and the same editable artifact', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 900 });
  await enterClassroom(page, classroom.authUrl);
  await typeInput(page, '教学对话的草稿先保留');
  await page.getByTestId('agent-role').selectOption('creator');
  await expect(page.getByTestId('creation-workspace')).toBeVisible();
  await page.getByRole('textbox', { name: '作品名称' }).fill('物理教法');
  await page.getByRole('textbox', { name: '适用科目' }).fill('物理');
  await page.getByRole('button', { name: '开始共建', exact: true }).click();
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await expect(page.getByTestId('agent-role')).toHaveValue('creator');
  // The native blank session header appears once its first real turn starts.
  await typeInput(page, '先讨论如何讲清受力分析');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByTestId('open-creation-editor').click();
  await page.getByTestId('artifact-editor').fill('# 物理教法\n\n先让学生描述现象，再画受力图。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByTestId('artifact-preview')).toContainText('再画受力图');
  await page.screenshot({ path: info.outputPath('creator-coauthoring.png'), fullPage: true });
  await page.getByRole('button', { name: '回到创作对话', exact: true }).click();
  await page.getByTestId('agent-role').selectOption('teacher');
  await expect(page.locator('[data-composer-input]')).toContainText('教学对话的草稿先保留');
  expect(errors).toEqual([]);
});
