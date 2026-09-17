import { join } from 'node:path';
import { test, expect, enterClassroom } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { RouteNativeLesson, RouteView } from '@studyforge/contracts/routes';
import type { SetView } from '@studyforge/contracts/sets';

function value<T>(reply: RemoteResult<T>): T { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; }

test('the default roadmap shows real lessons, places and mounts them on the same route, and survives refresh', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const client = await connectRuntime(classroom);
  const native = value(await client.rpc<{ sessionId: string }>('session/create', { request: { cwd: join(classroom.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  value(await client.rpc('session/prompt', { request: { sessionId: native.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '先检查这个函数的定义域。' }] } }));
  value(await client.rpc('session/rename', { request: { sessionId: native.sessionId, title: '自己开的函数课' } }));
  const planned = value(await client.rpc<RouteView>('studyforgeOrganization/addRouteNode', { input: { operationId: 'map-root', node: { title: '函数这条学习线', date: '2027-02-12' } } }));
  const child = value(await client.rpc<RouteView>('studyforgeOrganization/addRouteNode', { input: { operationId: 'map-child', node: { title: '接着看图像', parent: planned.nodes[0]!.id, date: '2027-02-13' } } }));
  const summary = value(await client.rpc<RouteNativeLesson[]>('studyforgeOrganization/routeLessons', {})).find(lesson => lesson.sessionId === native.sessionId)!;
  await enterClassroom(page, classroom.authUrl);
  await page.getByRole('button', { name: '课程', exact: true }).first().click();
  const canvas = page.getByTestId('roadmap-canvas'); await expect(canvas).toBeVisible();
  const paper = () => page.getByTestId('studyforge-page-studyforge.courses').evaluate(el => {
    const css = getComputedStyle(el), header = el.querySelector('header')!.getBoundingClientRect();
    return { color: css.backgroundColor, image: css.backgroundImage, size: css.backgroundSize, position: css.backgroundPosition, top: header.top, height: header.height };
  });
  const before = await paper();
  await page.getByTestId('courses-view').selectOption('list');
  await expect(page.getByTestId('course-lessons')).toBeVisible();
  expect(await paper()).toEqual(before);
  await page.getByTestId('courses-view').selectOption('roadmap'); await expect(canvas).toBeVisible();
  await expect(canvas.locator('.sf-map-title')).toContainText(['自己开的函数课']);
  await expect(canvas.getByTestId('map-edge')).toHaveCount(1);
  expect(value(await client.rpc<RouteView>('studyforgeOrganization/route', {}))).toEqual(child);
  await page.locator('.sf-course-filters summary').click();
  await page.getByTestId('roadmap-filter-today').click();
  await expect(canvas.locator('.sf-map-title')).toHaveText(['自己开的函数课']);
  await page.getByTestId('roadmap-filter-from').fill('2027-02-13');
  await page.getByTestId('roadmap-filter-to').fill('2027-02-13');
  await expect(canvas.locator('.sf-map-title')).toHaveText(['函数这条学习线', '接着看图像']);
  await expect(page.getByTestId('roadmap-filter-count')).toHaveText('1 节匹配');
  await page.getByTestId('roadmap-filter-clear').click();
  await page.locator('.sf-course-filters summary').click();
  await expect(canvas.locator('.sf-map-title')).toHaveCount(3);
  const scale = await page.getByTestId('map-world').getAttribute('data-scale');
  await page.getByTestId('map-zoom-in').click(); await expect(page.getByTestId('map-world')).not.toHaveAttribute('data-scale', scale!);
  await page.getByTestId('map-fit').click();

  const ordinary = canvas.locator(`[data-node-id="${summary.nodeId}"]`);
  await ordinary.getByRole('button', { name: '详情', exact: true }).click();
  await page.getByTestId('roadmap-node-mount').click();
  await page.getByTestId('roadmap-mount-select').selectOption({ label: '函数这条学习线' });
  await expect.poll(async () => value(await client.rpc<RouteView>('studyforgeOrganization/route', {})).nodes.find(node => node.session?.sessionId === native.sessionId)?.parent).toBe(planned.nodes[0]!.id);
  await page.getByRole('button', { name: '关闭课程详情', exact: true }).click();
  await page.getByTestId('map-fit').click();
  const box = await ordinary.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 20);
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 45, box!.y + 65, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => value(await client.rpc<RouteView>('studyforgeOrganization/route', {})).layout.some(position => position.nodeId === summary.nodeId)).toBe(true);
  await expect(page.getByTestId('course-node-detail')).toHaveCount(0);
  const stored = value(await client.rpc<RouteView>('studyforgeOrganization/route', {}));
  expect(stored.nodes.filter(node => node.session?.sessionId === native.sessionId)).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('course-map-wide.png'), fullPage: true });
  await page.reload(); await expect(canvas).toBeVisible();
  await expect(canvas.getByTestId('map-edge')).toHaveCount(2);
  await expect(ordinary).toHaveAttribute('data-x', String(stored.layout.find(position => position.nodeId === summary.nodeId)!.x));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('map-controls')).toBeVisible();
  // The pannable world is deliberately larger than its clipped viewport.
  await expect(canvas).toHaveCSS('overflow', 'hidden');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('course-map-narrow.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('six navigation entries are visible and learning-space management remains reachable through settings', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const client = await connectRuntime(classroom);
  const set = value(await client.rpc<SetView>('studyforgeOrganization/createSet', { input: { operationId: 'layout-set', set: { name: '函数学习', subjects: ['数学'], materials: [], members: [] } } }));
  await enterClassroom(page, classroom.authUrl);
  const navigation = page.getByRole('navigation', { name: '学习导航', exact: true });
  for (const label of ['首页', '学习集', '课程', '资料', '日历', '学情']) await expect(navigation.getByRole('button', { name: label, exact: true })).toBeVisible();
  await expect(page.locator('.sf-side-more,.sf-side-archive')).toHaveCount(0);
  await expect(navigation.getByRole('button', { name: '卡片', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '打开学习集', exact: true }).selectOption(set.ref);
  await expect(page.getByTestId('studyforge-page-studyforge.sets')).toBeVisible();
  await expect(page.locator(`[data-setcard="${set.ref}"]`)).toHaveClass(/editing/);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('materials-open-cards').click();
  await expect(page.getByTestId('studyforge-page-studyforge.cards')).toBeVisible();
  await expect(navigation.getByRole('button', { name: '资料', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '← 资料', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: '学习空间', exact: true }).click();
  await expect(page.getByTestId('learning-space-settings')).toBeVisible();
  await page.screenshot({ path: info.outputPath('learning-space-settings.png'), fullPage: true });
  expect(errors).toEqual([]);
});
