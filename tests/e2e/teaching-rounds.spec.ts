import { test, expect, enterClassroom, sendInput } from './fixtures/classroom.ts';

test('the default classroom hides experimental rounds and plugin workbenches', async ({ page, classroom }) => {
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '上课');
  await expect(page.getByTestId('learning-workspace')).toBeVisible();
  await expect(page.getByTestId('workspace-open-rounds')).toHaveCount(0);
  await expect(page.locator('[data-testid^="workspace-open-plugin-"]')).toHaveCount(0);
  await expect(page.getByTestId('workspace-open-chat')).toBeVisible();
  await expect(page.getByTestId('workspace-open-thoughts')).toBeVisible();
  await expect(page.getByTestId('workspace-open-materials')).toBeVisible();
});
