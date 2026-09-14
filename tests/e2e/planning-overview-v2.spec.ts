/**
 * P6.5 the roadmap's own date range, on a real Host.
 *
 * The range is answered by `studyforgeCalendar.roadmap`, so the nodes that match
 * here are the nodes the calendar matches. A filter only changes what is
 * visible: an undated plan stays in 全部, an ancestor of a match is drawn as
 * context without counting, and clearing the range restores the stored tree —
 * parents and order included — exactly as it was.
 *
 * The calendar and daily-report halves of P6.5 own their own page and spec; this
 * file covers the roadmap half only.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { enterClassroom, typeInput, openCoursesList, openCourseDetail } from './fixtures/classroom.ts';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    // The opened-lesson half really sends a message through the composer, so the
    // run needs a controllable model rather than a provider that may have no key.
    const runtime = await startIsolated({ testModel: true });
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

async function dismissNotices(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count() === 0) continue;
    try { await button.click({ timeout: 2_000 }); } catch { /* it was already gone */ }
  }
}

async function openCourses(page: Page): Promise<void> {
  await dismissNotices(page);
  // These flows use the row editor and its per-node controls, so the student
  // explicitly chooses 课程列表; the default course tab is the roadmap canvas.
  await openCoursesList(page);
}

async function planNode(page: Page, title: string, date?: string): Promise<void> {
  await page.getByTestId('roadmap-create').click();
  await page.getByTestId('route-editor-title').fill(title);
  if (date !== undefined) await page.getByTestId('route-editor-date').fill(date);
  await page.getByTestId('route-editor-save').click();
  await expect(page.getByTestId('route-editor')).toHaveCount(0);
}

async function mountUnder(page: Page, child: string, parent: string): Promise<void> {
  await openCourseDetail(page, child);
  await page.getByTestId('roadmap-node-mount').click();
  await page.getByTestId('roadmap-mount-select').selectOption({ label: parent });
  await page.getByRole('button', { name: '关闭课程详情', exact: true }).click();
  await page.getByRole('button', { name: '展开' + parent, exact: true }).click();
}

async function rowTitles(page: Page): Promise<string[]> {
  return page.getByTestId('roadmap-node-title').allInnerTexts();
}

function localDay(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const read = (type: string): string => parts.find(part => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

test('a date range narrows the roadmap, keeps ancestors as context, and clearing restores the tree', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await expect(page.getByTestId('course-tree-empty')).toBeVisible();

  // One undated direction, one planned today, and a March branch with a child.
  await planNode(page, '没有日期的方向');
  await planNode(page, '今天这一节', localDay());
  await planNode(page, '三月总复习', '2027-03-20');
  await planNode(page, '三月里的第一节', '2027-03-05');
  await mountUnder(page, '三月里的第一节', '三月总复习');

  const stored = await rowTitles(page);
  expect(stored).toHaveLength(4);
  const parentNode = page.getByTestId('roadmap-node').filter({ has: page.getByTestId('roadmap-node-title').filter({ hasText: '三月总复习' }) });
  await expect(parentNode.locator(':scope > ul > [data-testid="roadmap-node"]')).toContainText('三月里的第一节');
  await page.screenshot({ path: testInfo.outputPath('roadmap-all.png'), fullPage: true });

  // Today's range matches one node; the undated plan is not in a dated range.
  await page.locator('.sf-route-filter summary').click();
  await page.getByTestId('roadmap-filter-today').click();
  await expect(page.getByTestId('roadmap-node-title')).toHaveText(['今天这一节']);
  await page.screenshot({ path: testInfo.outputPath('roadmap-today.png'), fullPage: true });

  // A range whose only match is the child draws its parent as context, uncounted.
  await page.getByTestId('roadmap-filter-from').fill('2027-03-05');
  await page.getByTestId('roadmap-filter-to').fill('2027-03-05');
  await expect(page.getByTestId('roadmap-node-title')).toHaveText(['三月总复习', '三月里的第一节']);
  await page.screenshot({ path: testInfo.outputPath('roadmap-context.png'), fullPage: true });

  // Clearing really restores the stored tree and its order.
  await page.getByTestId('roadmap-filter-clear').click();
  expect(await rowTitles(page)).toEqual(stored);

  // Three weeks out still matches both March nodes and nothing else.
  await page.getByTestId('roadmap-filter-from').fill('2027-03-01');
  await page.getByTestId('roadmap-filter-to').fill('2027-03-31');
  await expect(page.getByTestId('roadmap-node-title')).toHaveText(['三月总复习', '三月里的第一节']);
  await page.getByTestId('roadmap-filter-all').click();
  expect(await rowTitles(page)).toEqual(stored);

  // The filter never touched the Host: a fresh boot shows the same four nodes.
  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  // The read is a real Remote call, so wait for it rather than sampling the DOM
  // the moment the page mounts.
  await page.getByRole('button', { name: '展开三月总复习', exact: true }).click();
  await expect.poll(() => rowTitles(page)).toEqual(stored);
  expect(errors).toEqual([]);
});

test('an opened planned lesson stays visible in the whole roadmap and keeps its real lesson', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await planNode(page, '今天开的一节', localDay());

  await openCourseDetail(page, '今天开的一节');
  await page.getByTestId('roadmap-node-start').click();
  // Starting the node really opens one native lesson: the student lands in it and
  // can type there. The composer is the real input, not a Remote call.
  const composer = page.locator('[data-composer-input]');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveAttribute('contenteditable', 'true');
  await typeInput(page, '这一节先讲顶点式');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(composer).toHaveText('');

  // Back on the course page the node shows the lesson it really opened.
  await openCourses(page);
  await expect(page.getByTestId('roadmap-node-opened')).toBeVisible();
  await expect(page.getByTestId('roadmap-node-title')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('roadmap-opened.png'), fullPage: true });

  // Filtering the roadmap never hides the lesson the student really started.
  await page.locator('.sf-route-filter summary').click();
  await page.getByTestId('roadmap-filter-today').click();
  await expect(page.getByTestId('roadmap-node')).toHaveCount(1);
  await expect(page.getByTestId('roadmap-node-opened')).toBeVisible();
  await page.getByTestId('roadmap-filter-clear').click();
  await expect(page.getByTestId('roadmap-node-opened')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a card the student really placed keeps its coordinate, and a content edit does not lose it', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await planNode(page, '摆放这一节', localDay());
  await planNode(page, '另一节', localDay());

  await page.getByTestId('courses-view').selectOption('roadmap');
  const canvas = page.getByTestId('roadmap-canvas');
  await expect(canvas).toBeVisible();
  const card = page.getByTestId('roadmap-canvas-node').filter({ hasText: '摆放这一节' });
  const startX = Number(await card.getAttribute('data-x'));
  const startY = Number(await card.getAttribute('data-y'));

  // Drag the card itself; the coordinate is written on release, not on the tap.
  const box = await card.boundingBox();
  if (box === null) throw new Error('the placed card has no box');
  await page.mouse.move(box.x + 30, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + 30 + 160, box.y + 14 + 96, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await card.getAttribute('data-x'))).toBeGreaterThan(startX + 120);
  const placedX = await card.getAttribute('data-x');
  const placedY = await card.getAttribute('data-y');
  await page.screenshot({ path: testInfo.outputPath('roadmap-placed.png'), fullPage: true });

  // A real content edit elsewhere leaves the student's own placement alone.
  await page.getByTestId('courses-view').selectOption('list');
  await openCourseDetail(page, '另一节');
  await page.getByTestId('roadmap-node-edit').click();
  await page.getByTestId('route-editor-title').fill('另一节（改过）');
  await page.getByTestId('route-editor-save').click();
  await expect(page.getByTestId('roadmap-node').filter({ hasText: '另一节（改过）' })).toBeVisible();
  await page.getByRole('button', { name: '关闭课程详情', exact: true }).click();
  await page.getByTestId('courses-view').selectOption('roadmap');
  await expect(card).toHaveAttribute('data-x', placedX ?? '');
  await expect(card).toHaveAttribute('data-y', placedY ?? '');

  // The placement is the Host's, not this tab's: a fresh boot reads it back.
  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await page.getByTestId('courses-view').selectOption('roadmap');
  const restored = page.getByTestId('roadmap-canvas-node').filter({ hasText: '摆放这一节' });
  await expect(restored).toHaveAttribute('data-x', placedX ?? '');
  await expect(restored).toHaveAttribute('data-y', placedY ?? '');

  // Putting it back in the automatic order is a real edit: the placement goes away.
  await restored.getByTestId('roadmap-node-auto').click();
  await expect(restored.getByTestId('roadmap-node-auto')).toHaveCount(0);
  await expect.poll(async () => Number(await restored.getAttribute('data-x'))).toBe(startX);
  expect(errors).toEqual([]);
});
