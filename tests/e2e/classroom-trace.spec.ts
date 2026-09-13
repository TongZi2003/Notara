import { test, expect, enterClassroom, typeInput } from './fixtures/classroom.ts';
test('thought graph is editable and navigates to native conversation without exposing debug trajectory', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1400, height: 900 }); await enterClassroom(page, classroom.authUrl);
  await typeInput(page, '为什么能量守恒？'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByTestId('workspace-open-thoughts').click();
  await expect(page.getByTestId('classroom-thoughts')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Trajectory', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '记一个想法', exact: true }).click();
  await page.getByRole('textbox', { name: '节点标题' }).fill('先界定系统'); await page.getByRole('textbox', { name: '节点内容' }).fill('哪些物体属于同一个系统？');
  await page.getByRole('button', { name: '保存节点', exact: true }).click();
  await page.getByTestId('thought-map').getByRole('button', { name: '先界定系统 想法', exact: true }).click();
  await expect(page.locator('.sf-thought-detail')).toContainText('哪些物体属于同一个系统');
  await page.getByRole('button', { name: '放大关系图', exact: true }).click();
  await expect(page.getByTestId('thought-map')).toHaveAttribute('data-zoom', '1.25');
  await page.getByRole('button', { name: '关闭思维图', exact: true }).click();
  await page.getByTestId('workspace-open-thoughts').click();
  await expect(page.getByTestId('thought-map')).toHaveAttribute('data-zoom', '1.25');
  await expect(page.locator('.sf-thought-detail')).toContainText('哪些物体属于同一个系统');
  await page.screenshot({ path: info.outputPath('thought-workspace.png'), fullPage: true });
  await page.getByRole('button', { name: '带入对话', exact: true }).click();
  await expect(page.locator('[data-composer-chip="studyforge-thought"]')).toContainText('先界定系统');
  expect(errors).toEqual([]);
});

test('a failed turn gives student wording while its technical message stays out of the ordinary classroom', async ({ page, classroom }) => {
  await enterClassroom(page, classroom.authUrl); await typeInput(page, '[error]');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('classroom-reply-error')).toHaveText('这次没有收到回复，可以再试一次。');
  await expect(page.getByTestId('classroom-reply-error')).not.toContainText('isolated model request failure');
});
