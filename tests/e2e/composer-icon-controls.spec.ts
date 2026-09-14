import { test, expect, enterClassroom, typeInput, openAppearance, closeAppearance } from './fixtures/classroom.ts';

test('narrow composer uses separate reachable icons and restores labels when widened in both themes', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1154, height: 747 }); await enterClassroom(page, classroom.authUrl);
  await page.getByTestId('workspace-open-materials').click();
  const pane = page.getByTestId('workspace-pane-chat'), divider = page.getByRole('separator', { name: '调整分栏大小' }).first();
  const agent = page.getByTestId('agent-role'), subject = page.getByTestId('subject-picker').getByRole('button');
  const model = page.locator('[data-slot="conversation.input.model"] button'), send = page.getByRole('button', { name: 'Send message', exact: true });
  const draft = '检查窄栏中的独立按钮'; await typeInput(page, draft);
  const resize = async (width: number) => {
    const edge = (await divider.boundingBox())!, chat = (await pane.boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 30); await page.mouse.down();
    await page.mouse.move(chat.x + width, edge.y + 30, { steps: 8 }); await page.mouse.up();
  };
  const separate = async () => {
    const buttons = [page.locator('.sf-composer-more>summary'), agent, subject, model, send];
    const rects = await Promise.all(buttons.map(button => button.boundingBox()));
    const outer = (await page.locator('[data-composer-card]').boundingBox())!;
    for (const [index, rect] of rects.entries()) {
      expect(rect).not.toBeNull(); expect(rect!.width).toBeGreaterThanOrEqual(28);
      expect(rect!.x).toBeGreaterThanOrEqual(outer.x); expect(rect!.x + rect!.width).toBeLessThanOrEqual(outer.x + outer.width);
      if (index) expect(rect!.x - rects[index - 1]!.x - rects[index - 1]!.width).toBeGreaterThanOrEqual(2);
      expect(await buttons[index]!.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    }
  };
  for (const style of ['modern', 'notebook'] as const) {
    await openAppearance(page); await page.getByTestId(`theme-${style}`).click(); await closeAppearance(page);
    for (const width of [350, 280]) {
      await resize(width); await expect(agent.locator('span')).toBeHidden(); await expect(subject.locator('span')).toBeHidden();
      await expect(model.locator('span').first()).toBeHidden(); await expect(model.locator('svg').first()).toBeVisible();
      await separate();
    }
    await resize(350);
    await model.click(); await expect(page.getByRole('menuitem', { name: 'Model study-model-a', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Model study-model-a', exact: true }).click();
    await expect(page.getByRole('menuitemradio').first()).toBeVisible(); await page.keyboard.press('Escape');
    await agent.click(); await expect(page.getByRole('dialog', { name: '智能体身份' })).toBeVisible(); await page.keyboard.press('Escape');
    await subject.click(); await expect(page.getByRole('dialog', { name: '选择本课涉及科目' })).toBeVisible(); await page.keyboard.press('Escape');
    await expect(page.locator('[data-composer-input]')).toHaveText(draft);
    await page.screenshot({ path: info.outputPath(`${style}-icon-composer.png`), fullPage: true });
    await resize(700); await expect(agent.locator('span')).toBeVisible(); await expect(subject.locator('span')).toBeVisible();
    await separate();
  }
  await resize(280); await send.click(); await expect(page.getByText('已收到：' + draft, { exact: true })).toBeVisible();
  await expect(page.locator('[data-composer-input]')).toBeEmpty(); await separate();
});
