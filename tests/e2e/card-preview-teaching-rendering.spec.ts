import type { Locator } from '@playwright/test';
import { test, expect, enterClassroom, openCards, openAppearance, closeAppearance } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

/** Contrast of the actual rendered foreground and its nearest opaque surface. */
async function contrast(locator: Locator): Promise<number> {
  return locator.evaluate(element => {
    const rgb = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (channels: number[]): number => channels.slice(0, 3).map(value => {
      const s = value / 255;
      return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
    let background = [255, 255, 255];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = rgb(getComputedStyle(node).backgroundColor);
      if (color.length === 3 || color[3] === 1) { background = color; break; }
    }
    const foreground = luminance(rgb(getComputedStyle(element).color));
    const surface = luminance(background);
    return (Math.max(foreground, surface) + .05) / (Math.min(foreground, surface) + .05);
  });
}

test('card list previews render complete inline and block formulas without changing the stored card', async ({ page, classroom }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const client = await connectRuntime(classroom);
  const formula = String.raw`\left(\prod_{k=1}^{n}a_k\right)^{\frac{1}{n}}\ge\frac{n}{\sum_{k=1}^{n}\frac{1}{a_k}}\qquad\text{（几何平均与调和平均）}\qquad\text{等号成立当且仅当 }a_1=a_2=\cdots=a_n`;
  const front = `证明：若 $a_k>0$，其中 $k=1,2,\\ldots,n$，则有\n\n$$\n${formula}\n$$\n\n`;
  expect(front.length).toBeGreaterThan(180);
  const saved = await client.rpc('studyforgeLearning/createCard', { input: {
    operationId: 'preview-math', content: { title: '几何平均与调和平均', front },
  } });
  expect(saved.ok).toBe(true);
  const before = await client.rpc('studyforgeLearning/cards', {});
  await enterClassroom(page, classroom.authUrl);
  await openCards(page);
  const row = page.getByTestId('card-row').filter({ hasText: '几何平均与调和平均' });
  const preview = row.locator('.sf-card-face-preview');
  await expect(preview.locator('.katex')).toHaveCount(3);
  await expect(preview.locator('.katex-display')).toBeVisible();
  await expect(preview.locator('.katex-error')).toHaveCount(0);
  await expect(preview.locator('annotation').last()).toHaveText(formula);
  await page.screenshot({ path: info.outputPath('card-preview-math.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await row.getByTestId('card-row-open').click();
  await expect(page.getByTestId('card-detail-front').locator('.katex-display')).toBeVisible();
  expect(await client.rpc('studyforgeLearning/cards', {})).toEqual(before);
  expect(errors).toEqual([]);
});

test('teaching editor and selected rows remain legible in both themes and light/dark appearances', async ({ page, classroom }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await enterClassroom(page, classroom.authUrl);
  for (const theme of ['modern', 'notebook'] as const) {
    await openAppearance(page);
    await page.getByTestId(`theme-${theme}`).click();
    await closeAppearance(page);
    await page.getByTestId('notebook-sidebar').getByRole('button', { name: '教法', exact: true }).click();
    const panel = page.getByTestId('studyforge-teaching-page');
    const selected = panel.locator('.sf-teaching-tree').getByRole('button', { name: '资料整理', exact: true });
    await selected.click();
    const editor = panel.getByTestId('teaching-editor');
    await expect(editor).toHaveValue(/资料整理/);
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      if (scheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme');
      else await expect(page.locator('body')).not.toHaveAttribute('data-ds-dark-theme');
      await page.screenshot({ path: info.outputPath(`teaching-${theme}-${scheme}.png`), fullPage: true });
      expect(await contrast(editor), `${theme}/${scheme} editor contrast`).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(selected), `${theme}/${scheme} selected contrast`).toBeGreaterThanOrEqual(4.5);
      await editor.fill('# 资料整理\n\n保留本次编辑的草稿。');
      await page.emulateMedia({ colorScheme: scheme === 'dark' ? 'light' : 'dark' });
      await expect(editor).toHaveValue('# 资料整理\n\n保留本次编辑的草稿。');
    }
  }
  expect(errors).toEqual([]);
});
