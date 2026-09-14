import type { Locator } from '@playwright/test';
import { test, expect, enterClassroom, typeInput, openAppearance, closeAppearance } from './fixtures/classroom.ts';

/** A control rectangle proves nothing: a glyph counts only when it paints a real
 * box inside that control and the pointer can still reach it. */
async function paintedGlyphs(button: Locator) {
  const outer = await button.boundingBox();
  return button.evaluate((el, box) => [...el.querySelectorAll('svg')].map(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      width: rect.width, height: rect.height, display: style.display, visibility: style.visibility, opacity: Number(style.opacity),
      reachable: !!hit && (hit === node || node.contains(hit) || !!hit.closest('button')?.contains(node)),
      inside: !!box && rect.x >= box.x - 1 && rect.width > 0 && rect.x + rect.width <= box.x + box.width + 1 && rect.y >= box.y - 1 && rect.y + rect.height <= box.y + box.height + 1,
    };
  }).filter(node => node.display !== 'none' && node.visibility !== 'hidden' && node.opacity > 0 && node.width >= 10 && node.height >= 10), outer);
}

/** The icon band must paint exactly one reachable glyph inside the control. */
async function expectGlyph(button: Locator, where: string): Promise<void> {
  const glyphs = await paintedGlyphs(button);
  expect(glyphs.length, `${where}: exactly one painted glyph`).toBe(1);
  expect(glyphs[0]!.reachable, `${where}: glyph must be the pointer target, not covered`).toBe(true);
  expect(glyphs[0]!.inside, `${where}: glyph must sit inside its control`).toBe(true);
}

test('narrow composer keeps a real glyph on every icon control and restores labels when widened in both themes', async ({ page, classroom }, info) => {
  await page.setViewportSize({ width: 1154, height: 747 }); await enterClassroom(page, classroom.authUrl);
  await page.getByTestId('workspace-open-materials').click();
  const pane = page.getByTestId('workspace-pane-chat'), divider = page.getByRole('separator', { name: '调整分栏大小' }).first();
  const card = page.locator('[data-composer-card]');
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
    const outer = (await card.boundingBox())!;
    for (const [index, rect] of rects.entries()) {
      expect(rect).not.toBeNull(); expect(rect!.width).toBeGreaterThanOrEqual(28);
      expect(rect!.x).toBeGreaterThanOrEqual(outer.x); expect(rect!.x + rect!.width).toBeLessThanOrEqual(outer.x + outer.width);
      if (index) expect(rect!.x - rects[index - 1]!.x - rects[index - 1]!.width).toBeGreaterThanOrEqual(2);
      expect(await buttons[index]!.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    }
  };
  const expectIcons = async (where: string) => {
    await expect(agent.locator('span')).toBeHidden(); await expect(subject.locator('span')).toBeHidden();
    await expect(model.locator('span').first()).toBeHidden();
    await expectGlyph(agent, `${where} agent`); await expectGlyph(subject, `${where} subject`); await expectGlyph(model, `${where} model`);
    await separate();
  };
  let naturalSplit = true;
  for (const style of ['modern', 'notebook'] as const) {
    await openAppearance(page); await page.getByTestId(`theme-${style}`).click(); await closeAppearance(page);
    // 1. The reported split: 1154x747 with the materials workbench open leaves a
    // composer above the trigger's own 360px icon breakpoint, where the native
    // trigger hides its icon and only the label would remain.
    if (naturalSplit) {
      naturalSplit = false;
      const natural = (await card.boundingBox())!.width;
      expect(natural, `${style}: the reported split sits above the native 360px breakpoint`).toBeGreaterThan(360);
      expect(natural, `${style}: the reported split stays inside the 440px icon band`).toBeLessThanOrEqual(440);
      await expectIcons(`${style} natural ${Math.round(natural)}px`);
    }
    await resize(500);
    const band = (await card.boundingBox())!.width;
    expect(band, `${style}: the band split stays above the native 360px breakpoint`).toBeGreaterThan(360);
    expect(band, `${style}: the band split stays inside the 440px icon band`).toBeLessThanOrEqual(440);
    await expectIcons(`${style} band ${Math.round(band)}px`);
    await model.click(); await expect(page.getByRole('menuitem', { name: 'Model study-model-a', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Model study-model-a', exact: true }).click();
    await expect(page.getByRole('menuitemradio').first()).toBeVisible(); await page.keyboard.press('Escape');
    // A build that ships the trigger without its leading icon must keep a glyph:
    // only trailing svgs are hidden, so probe the DOM the same way CSS sees it.
    const fallback = await model.evaluate(el => {
      const head = el.querySelector('svg'); if (!head?.parentNode) return { total: 0, painted: 0 };
      const parent = head.parentNode, next = head.nextSibling;
      parent.removeChild(head);
      try {
        const painted = (node: SVGElement) => { const r = node.getBoundingClientRect(); return getComputedStyle(node).display !== 'none' && r.width >= 10 && r.height >= 10 && !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button')?.contains(node); };
        const rest = [...el.querySelectorAll('svg')];
        return { total: rest.length, painted: rest.filter(painted).length };
      } finally { parent.insertBefore(head, next); }
    });
    expect(fallback.total, `${style}: the native trigger still ships a trailing glyph`).toBe(1);
    expect(fallback.painted, `${style}: without the leading icon the trailing glyph stays visible`).toBe(1);
    await expectGlyph(model, `${style} restored model`);
    await agent.click(); await expect(page.getByRole('dialog', { name: '智能体身份' })).toBeVisible(); await page.keyboard.press('Escape');
    await subject.click(); await expect(page.getByRole('dialog', { name: '选择本课涉及科目' })).toBeVisible(); await page.keyboard.press('Escape');
    await expect(page.locator('[data-composer-input]')).toHaveText(draft);
    await page.screenshot({ path: info.outputPath(`${style}-icon-composer.png`), fullPage: true });
    // 2. Narrower splits keep one glyph per control instead of collapsing to nothing.
    for (const width of [440, 380, 330]) {
      await resize(width);
      expect((await card.boundingBox())!.width, `${style}: target ${width}px pane stays in the icon band`).toBeLessThanOrEqual(440);
      await expectIcons(`${style} ${width}px`);
    }
    // 3. Widening restores the readable labels.
    await resize(700); await expect(agent.locator('span')).toBeVisible(); await expect(subject.locator('span')).toBeVisible();
    await expect(model.locator('span').first()).toBeVisible();
    await separate();
  }
  await resize(330); await send.click(); await expect(page.getByText('已收到：' + draft, { exact: true })).toBeVisible();
  await expect(page.locator('[data-composer-input]')).toBeEmpty(); await separate();
});
