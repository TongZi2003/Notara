import { expect, type Locator, type Page } from '@playwright/test';

/** Exercise geometry and real wheel input in both hosts of the shared map. */
export async function checkMapZoom(page: Page, map: Locator): Promise<void> {
  const shell = page.locator('.sf-mindmap-shell').filter({ has: map });
  const viewport = shell.getByRole('region');
  const controls = shell.getByRole('group', { name: '关系图缩放' });
  const node = map.locator('.sf-mindmap-node').first();
  const before = (await node.boundingBox())!, edges = (await map.locator('svg').boundingBox())!;
  const count = await map.locator('.sf-mindmap-node').count();
  await controls.getByRole('button', { name: '放大关系图' }).click();
  await expect(map).toHaveAttribute('data-zoom', '1.25');
  expect((await node.boundingBox())!.width / before.width).toBeCloseTo(1.25, 2);
  expect((await map.locator('svg').boundingBox())!.height / edges.height).toBeCloseTo(1.25, 2);
  await controls.getByRole('button', { name: '恢复关系图大小' }).click();
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 100));
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -65);
  await page.keyboard.up('Control');
  await expect.poll(async () => Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(1);
  const scale = await map.getAttribute('data-zoom');
  await page.mouse.wheel(0, 180);
  await expect(map).toHaveAttribute('data-zoom', scale!);
  await controls.getByRole('button', { name: '恢复关系图大小' }).click();
  await viewport.focus();
  await viewport.press('-');
  await viewport.press('-');
  await viewport.press('-');
  await expect(map).toHaveAttribute('data-zoom', '0.25');
  await expect(controls.getByRole('button', { name: '缩小关系图' })).toBeDisabled();
  expect(await viewport.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(Math.max(box.width, Number(await map.evaluate(el => el.getBoundingClientRect().width))) + 2);
  await viewport.press('0');
  for (let i = 0; i < 5; i++) await viewport.press('+');
  await expect(map).toHaveAttribute('data-zoom', '2');
  await expect(controls.getByRole('button', { name: '放大关系图' })).toBeDisabled();
  await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
  const controlBox = (await controls.boundingBox())!, visible = (await viewport.boundingBox())!;
  expect(controlBox.x).toBeGreaterThanOrEqual(visible.x);
  expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(visible.y + visible.height + 1);
  await controls.getByRole('button', { name: '恢复关系图大小' }).click();
  await expect(map).toHaveAttribute('data-zoom', '1');
  await expect(map.locator('.sf-mindmap-node')).toHaveCount(count);
}
