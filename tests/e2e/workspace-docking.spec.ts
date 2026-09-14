import { test, expect, enterClassroom, typeInput } from './fixtures/classroom.ts';

test('three peer views preserve the native draft through docking, resizing, hiding and narrow switching', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 960 }); await enterClassroom(page, classroom.authUrl);
  await expect(page.getByTestId('learning-workspace')).toBeVisible();
  const input = page.locator('[data-composer-input]');
  await typeInput(page, '这份草稿移动后还要在');
  const original = await input.elementHandle();
  await page.locator('[data-composer-seat] input[type="file"][hidden]').setInputFiles({ name: '课堂草稿.txt', mimeType: 'text/plain', buffer: Buffer.from('分栏草稿附件') });
  await page.getByTestId('workspace-open-thoughts').click();
  await page.getByTestId('workspace-open-materials').click();
  for (const view of ['chat', 'thoughts', 'materials']) await expect(page.getByTestId(`workspace-pane-${view}`)).toHaveAttribute('data-visible', 'true');
  const chat = page.getByTestId('workspace-pane-chat'), thought = page.getByTestId('workspace-pane-thoughts');
  // Genuine pointer drag of a view header into another pane's bottom zone.
  const grip = thought.getByRole('button', { name: '拖动思维图', exact: true }), from = (await grip.boundingBox())!, target = (await chat.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * .82, { steps: 15 });
  await expect(page.getByTestId('drop-chat-bottom')).toBeVisible();
  const drop = (await page.getByTestId('drop-chat-bottom').boundingBox())!;
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2); await page.mouse.up();
  await expect.poll(async () => (await thought.boundingBox())!.y > (await chat.boundingBox())!.y).toBe(true);
  await expect(input).toContainText('这份草稿移动后还要在');
  expect(await original!.evaluate(el => el === document.querySelector('[data-composer-input]'))).toBe(true);
  await page.getByRole('button', { name: '关闭对话', exact: true }).click(); await expect(chat).toHaveAttribute('data-visible', 'false');
  await page.getByTestId('workspace-open-chat').click(); await expect(input).toContainText('这份草稿移动后还要在');
  await expect(page.getByText('课堂草稿.txt', { exact: false }).first()).toBeVisible();
  const separator = page.getByRole('separator', { name: '调整分栏大小' }).first(), ratio = await separator.getAttribute('aria-valuenow');
  await separator.focus(); await page.keyboard.press('ArrowRight'); expect(await separator.getAttribute('aria-valuenow')).not.toBe(ratio);
  await page.screenshot({ path: info.outputPath('three-views.png'), fullPage: true });
  await page.setViewportSize({ width: 520, height: 820 }); await page.getByTestId('workspace-open-thoughts').click();
  await expect(chat).toHaveAttribute('data-visible', 'false'); await expect(thought).toHaveAttribute('data-visible', 'true');
  await page.getByTestId('workspace-open-chat').click(); await expect(input).toContainText('这份草稿移动后还要在');
  await page.screenshot({ path: info.outputPath('narrow-chat.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  for (const view of ['chat', 'thoughts', 'materials']) await expect(page.getByTestId(`workspace-pane-${view}`)).toHaveAttribute('data-visible', 'true');
  await page.reload(); await expect(page.getByTestId('workspace-pane-materials')).toHaveAttribute('data-visible', 'true');
  expect(errors).toEqual([]);
});

test('soft paper is optional and remembers style independently from paper colour', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await enterClassroom(page, classroom.authUrl);
  await page.goto(new URL('/#studyforge/appearance', classroom.authUrl).href);
  await expect(page.getByTestId('notebook-style')).toHaveValue('notebook');
  await page.getByTestId('notebook-style').selectOption('soft'); await page.getByTestId('notebook-tone').selectOption('white');
  await page.reload(); await expect(page.getByTestId('notebook-style')).toHaveValue('soft'); await expect(page.getByTestId('notebook-tone')).toHaveValue('white');
  await page.goto(new URL('/#studyforge/classroom', classroom.authUrl).href);
  await expect(page.locator('body')).toHaveAttribute('data-sf-style', 'soft');
  await page.screenshot({ path: info.outputPath('soft-paper-home.png'), fullPage: true });
  await page.goto(new URL('/#studyforge/appearance', classroom.authUrl).href); await page.getByTestId('notebook-style').selectOption('notebook');
  await expect(page.locator('body')).toHaveAttribute('data-sf-style', 'notebook'); await expect(page.getByTestId('notebook-tone')).toHaveValue('white');
});

test('layout menu supports every pair and the native conversation returns when the workspace plugin unloads', async ({ page, classroom }) => {
  await page.setViewportSize({ width: 1440, height: 950 }); await enterClassroom(page, classroom.authUrl);
  const choose = async (name: string): Promise<void> => { await page.getByLabel('调整布局', { exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); };
  for (const [name, visible] of [['对话与思维图', ['chat', 'thoughts']], ['对话与资料', ['chat', 'materials']], ['思维图与资料', ['thoughts', 'materials']]] as const) {
    await choose(name);
    for (const view of ['chat', 'thoughts', 'materials']) await expect(page.getByTestId(`workspace-pane-${view}`)).toHaveAttribute('data-visible', String((visible as readonly string[]).includes(view)));
  }
  await choose('对话在左 · 两图上下');
  const thought = (await page.getByTestId('workspace-pane-thoughts').boundingBox())!, materials = (await page.getByTestId('workspace-pane-materials').boundingBox())!;
  expect(materials.y).toBeGreaterThan(thought.y); expect(materials.x).toBe(thought.x);
  await choose('三栏并排');
  const columns = await Promise.all(['chat', 'thoughts', 'materials'].map(view => page.getByTestId(`workspace-pane-${view}`).boundingBox()));
  expect(new Set(columns.map(box => box!.y)).size).toBe(1);
  await choose('只看对话');
  await classroom.setClientEnabled(false); await page.reload();
  await expect(page.getByTestId('learning-workspace')).toHaveCount(0);
  const later = page.getByRole('button', { name: 'Configure later', exact: true }); if (await later.isVisible()) await later.click();
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await classroom.setClientEnabled(true); await page.reload();
  await expect(page.getByTestId('learning-workspace')).toBeVisible();
});

test('student controls share typography and rounded shapes; subject menus fit narrow panes without coding launchers', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 }); await enterClassroom(page, classroom.authUrl);
  await expect(page.getByRole('button', { name: /Select workspace|选择工作区/ })).toBeHidden();
  await expect(page.getByRole('button', { name: /Open workspace in|打开工作目录/ })).toBeHidden();
  await page.getByTestId('workspace-open-thoughts').click();
  await expect(page.getByText('会话树', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '这节课的分支', exact: true })).toHaveCount(0);
  for (const width of [1440, 520]) {
    await page.setViewportSize({ width, height: 850 }); await page.getByTestId('workspace-open-chat').click();
    const subject = page.getByTestId('subject-picker').getByRole('button'), role = page.getByTestId('agent-role'), model = page.locator('[data-slot="conversation.input.model"] button').first();
    const fonts = await Promise.all([subject, role, model].map(el => el.evaluate(node => ({ family: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, radius: getComputedStyle(node).borderTopLeftRadius }))));
    expect(new Set(fonts.map(font => font.family)).size).toBe(1); expect(new Set(fonts.map(font => font.size)).size).toBe(1);
    for (const span of await model.locator('span:visible').all()) expect(await span.evaluate(el => getComputedStyle(el).fontFamily)).toBe(fonts[0]!.family);
    for (const font of fonts) expect(parseFloat(font.radius)).toBeGreaterThanOrEqual(8);
    await model.click();
    await page.getByRole('menuitem', { name: 'Model study-model-a', exact: true }).click();
    const modelOption = page.getByRole('menuitemradio').first(); await expect(modelOption).toBeVisible();
    expect(await modelOption.evaluate(el => getComputedStyle(el).fontFamily)).toBe(fonts[0]!.family);
    await page.keyboard.press('Escape');
    await subject.click(); const menu = page.getByRole('dialog', { name: '选择本课涉及科目', exact: true });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(850);
    await page.getByRole('textbox', { name: '添加涉及科目', exact: true }).fill('高考数学中的三角函数与恒等变换');
    await menu.getByRole('button', { name: '添加', exact: true }).click(); await expect(menu.getByRole('checkbox', { name: '高考数学中的三角函数与恒等变换', exact: true })).toBeChecked();
    await expect(subject).toHaveText('Subject');
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
    expect(await subject.evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(170);
    await page.screenshot({ path: info.outputPath(`consistent-controls-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('compact Agent and Subject menus keep the split composer toolbar on one line at 1117px', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1117, height: 747 }); await enterClassroom(page, classroom.authUrl);
  await page.getByTestId('workspace-open-materials').click();
  await typeInput(page, '保留当前草稿');
  const agent = page.getByTestId('agent-role'), subject = page.getByTestId('subject-picker').getByRole('button');
  await expect(agent).toHaveText('Agent'); await expect(subject).toHaveText('Subject');
  await expect(agent.locator('svg')).toBeVisible(); await expect(subject.locator('svg')).toBeVisible();
  const buttons = [page.locator('.sf-composer-more>summary'), agent, subject, page.locator('[data-slot="conversation.input.model"] button').first()];
  const boxes = await Promise.all(buttons.map(button => button.boundingBox()));
  expect(Math.max(...boxes.map(box => box!.y)) - Math.min(...boxes.map(box => box!.y))).toBeLessThan(5);
  await agent.click(); const menu = page.getByRole('dialog', { name: '智能体身份', exact: true });
  await expect(menu).toBeVisible(); expect(parseFloat(await menu.evaluate(el => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(12);
  await expect(menu.getByRole('button', { name: '教学者', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('compact-agent-menu.png'), fullPage: true });
  await menu.getByRole('button', { name: '教学者', exact: true }).click(); await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-composer-input]')).toContainText('保留当前草稿');
  await subject.click(); await expect(page.getByRole('dialog', { name: '选择本课涉及科目', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('compact-subject-menu.png'), fullPage: true });
  await page.keyboard.press('Escape');
  const card = page.locator('[data-composer-card]'); expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
