import { test, expect, enterClassroom, typeInput, openRoot } from './fixtures/classroom.ts';

test('native home centers its first input, preserves draft and hides recommendations only after acceptance', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let rejectPaths = true;
  await page.route('**/api/studyforgeCourses/learningPaths', async route => {
    if (!rejectPaths) { await route.continue(); return; }
    const request = route.request().postDataJSON() as { rpcId: string };
    await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { code: 'gateway/internal', message: 'Fixture route read rejected', details: {} } } } });
  });
  await enterClassroom(page, classroom.authUrl);
  await expect(page.getByText('今天想学什么？', { exact: true })).toBeVisible();
  const entries = page.getByTestId('learning-entry'), input = page.locator('[data-composer-input]');
  await expect(entries).toBeVisible();
  await typeInput(page, '我想学习三角函数');
  await expect(entries.getByRole('button', { name: '按路线学习' })).toBeDisabled();
  await expect(entries.getByRole('button', { name: '自由学习' })).toBeEnabled();
  await expect(entries.getByRole('status')).toContainText('学习路线暂时读不出来');
  rejectPaths = false;
  await entries.getByRole('button', { name: '重试', exact: true }).click();
  await expect(entries.getByRole('button', { name: '按路线学习' })).toBeEnabled();
  await expect(input).toContainText('我想学习三角函数');
  await entries.getByRole('button', { name: '按路线学习' }).click();
  await expect(entries.getByRole('button', { name: '按路线学习' })).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toContainText('我想学习三角函数');
  const a = (await entries.boundingBox())!, b = (await input.boundingBox())!;
  expect(a.y).toBeGreaterThan(b.y + b.height);
  expect(b.y).toBeGreaterThan(280); expect(b.y).toBeLessThan(510);
  await page.screenshot({ path: info.outputPath('home-centered-input.png'), fullPage: true });
  await openRoot(page, '资料'); await openRoot(page, '首页');
  await expect(input).toContainText('我想学习三角函数');
  await expect(entries).toBeVisible();
  let rejectFirst = true;
  await page.route('**/api/session/prompt', async route => {
    if (!rejectFirst) { await route.continue(); return; }
    rejectFirst = false;
    const request = route.request().postDataJSON() as { rpcId: string };
    await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { code: 'gateway/internal', message: 'Fixture admission rejected', details: {} } } } });
  });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(input).toContainText('我想学习三角函数');
  await expect(entries).toBeVisible();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(entries).toHaveCount(0);
  await page.reload(); await expect(entries).toHaveCount(0);
  await expect(input).toBeVisible();
  await openRoot(page, '首页'); await expect(entries).toBeVisible();
  await page.getByTestId('notebook-settings').click();
  await page.getByTestId('notebook-tone').selectOption('white');
  await page.getByTestId('notebook-back').click();
  await page.setViewportSize({ width: 500, height: 800 });
  await expect(entries).toBeVisible();
  expect(await entries.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('home-narrow.png'), fullPage: true });
});
