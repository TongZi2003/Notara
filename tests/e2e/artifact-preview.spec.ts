import { test, expect, enterClassroom, typeInput } from './fixtures/classroom.ts';
test('HTML artifact runs in sandbox and installs a versioned classroom skill', async ({ page, classroom }, info) => {
  await enterClassroom(page, classroom.authUrl); await page.getByTestId('agent-role').click(); await page.getByRole('dialog', { name: '智能体身份', exact: true }).getByRole('button', { name: '创作者', exact: true }).click();
  await page.getByRole('textbox', { name: '作品名称' }).fill('数一数'); await page.getByRole('combobox', { name: '作品类型' }).selectOption('html'); await page.getByRole('button', { name: '开始共建', exact: true }).click();
  await typeInput(page, '准备可点击的演示'); await page.getByRole('button', { name: 'Send message', exact: true }).click(); await page.getByTestId('open-creation-editor').click();
  await page.getByTestId('artifact-editor').fill('<!doctype html><html lang="zh"><body><button onclick="this.textContent=Number(this.textContent)+1">0</button></body></html>');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.frameLocator('iframe[title="互动演示预览"]').getByRole('button', { name: '0', exact: true }).click();
  await expect(page.frameLocator('iframe[title="互动演示预览"]').getByRole('button', { name: '1', exact: true })).toBeVisible();
  await page.getByTestId('install-artifact').click(); await expect(page.getByRole('status')).toContainText('已安装');
  await page.screenshot({ path: info.outputPath('installed-html.png'), fullPage: true });
  await page.getByRole('button', { name: '回到创作对话', exact: true }).click(); await page.getByTestId('agent-role').click(); await page.getByRole('dialog', { name: '智能体身份', exact: true }).getByRole('button', { name: '教学者', exact: true }).click();
  await page.getByRole('button', { name: '更多学习操作', exact: true }).click(); await page.getByRole('group', { name: '学习技能', exact: true }).getByRole('button', { name: '数一数', exact: true }).click();
  await expect(page.locator('[data-composer-chip="studyforge-task"]')).toContainText('数一数');
});
