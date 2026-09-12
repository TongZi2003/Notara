/**
 * P6.2/P6.4 on a real Host: one planned course axis and one plan, each edited by
 * a student and a second writer.
 *
 * Every title, date and revision on screen comes back from the Host: the axis is
 * `studyforgeOrganization.route`, opening a node is a real `openPlannedLesson`,
 * and the second writer is a second browser page — its stale baseline is the
 * Host's own refusal, not something the test scripts. A filter only changes what
 * is visible, and clearing it leaves the stored tree exactly as it was.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { enterClassroom, typeInput, openCards, openCoursesList } from './fixtures/classroom.ts';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    // Opening a node really sends a message in the lesson, so the run needs the
    // controllable model instead of a provider that may have no key.
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
  // These flows use the row editor, so the student explicitly chooses the list tab.
  await openCoursesList(page);
}

/** Create one ordinary card through the real editor so a node can point at it. */
async function createCard(page: Page, title: string, front: string): Promise<void> {
  await dismissNotices(page);
  await openCards(page);
  await page.getByTestId('card-browser-create').click();
  await page.getByTestId('card-editor-title').fill(title);
  await page.getByTestId('card-editor-front').fill(front);
  await page.getByTestId('card-editor-save').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText(title);
}

/** Plan one node with one card reference, a date and a teaching declaration. */
async function planNode(page: Page, title: string, options: { readonly date?: string; readonly card?: string; readonly stance?: string }): Promise<void> {
  await page.getByTestId('roadmap-create').click();
  await page.getByTestId('route-editor-title').fill(title);
  if (options.date !== undefined) await page.getByTestId('route-editor-date').fill(options.date);
  if (options.card !== undefined) {
    await page.getByTestId('route-editor-card').selectOption({ label: options.card });
    await page.getByTestId('route-editor-add-card').click();
    await expect(page.getByTestId('route-editor-material-label').filter({ hasText: options.card })).toBeVisible();
  }
  await page.getByTestId('route-editor-teaching').selectOption('socratic');
  if (options.stance !== undefined) await page.getByTestId('route-editor-stance').fill(options.stance);
  await page.getByTestId('route-editor-save').click();
  await expect(page.getByTestId('route-editor')).toHaveCount(0);
}

async function editNode(page: Page, title: string, next: string): Promise<void> {
  const row = page.getByTestId('roadmap-node').filter({ hasText: title });
  await row.getByTestId('roadmap-node-edit').click();
  await page.getByTestId('route-editor-title').fill(next);
}

function localDay(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const read = (type: string): string => parts.find(part => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

test('a planned node really opens one native lesson, and a restart keeps it bound', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await createCard(page, '二次函数顶点', '求 $y=x^2-4x+3$ 的顶点。');
  await openCourses(page);
  await expect(page.getByTestId('native-lessons-empty')).toBeVisible();

  await planNode(page, '二次函数顶点式', { date: localDay(), card: '二次函数顶点', stance: '先看清顶点和对称轴。' });
  const node = page.getByTestId('roadmap-node').filter({ hasText: '二次函数顶点式' });
  await expect(node.getByTestId('roadmap-node-date')).not.toBeEmpty();
  await expect(node.getByTestId('roadmap-node-decl')).toContainText('苏格拉底授课');
  await expect(node.getByTestId('roadmap-node-decl')).toContainText('先看清顶点和对称轴。');
  // The reference reads as the card's own title, never as an internal id.
  await expect(node.getByTestId('roadmap-node-materials')).toContainText('二次函数顶点');
  await page.screenshot({ path: testInfo.outputPath('course-planned-node.png'), fullPage: true });

  await node.getByTestId('roadmap-node-start').click();
  // Starting the node opens one real lesson: the student is in it and can type.
  const composer = page.locator('[data-composer-input]');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveAttribute('contenteditable', 'true');
  await typeInput(page, '先看顶点和对称轴');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(composer).toHaveText('');

  // Back on the course page: the node shows the lesson it opened, and the real
  // lesson appears in the native lesson list with the node's own title.
  await openCourses(page);
  await expect(node.getByTestId('roadmap-node-opened')).toBeVisible();
  await expect(page.getByTestId('studyforge-lessons').getByRole('button', { name: /二次函数顶点式/ })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('course-node-opened.png'), fullPage: true });

  // A fresh boot reads the Host again: still one node, still the one real lesson.
  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await expect(page.getByTestId('roadmap-node')).toHaveCount(1);
  await expect(page.getByTestId('roadmap-node-opened')).toBeVisible();
  await expect(page.getByTestId('studyforge-lessons').getByRole('button', { name: /二次函数顶点式/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('two writers move different nodes from the same read, and only the same node refuses', async ({ page, context, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await planNode(page, '甲节', { date: localDay() });
  await planNode(page, '乙节', { date: localDay() });

  // A holds an open draft for 甲节 and has not saved: A's baseline stays the row it
  // read, which is what makes the second writer's move on the same node visible.
  await editNode(page, '甲节', '甲节（A 抢改）');

  // B reads the same route (same baseline), moves 乙节 first — a different node, so
  // the read being one revision behind is not a conflict — and then moves 甲节.
  const other = await context.newPage();
  try {
    await enterClassroom(other, dsh.authUrl);
    await openCourses(other);
    await editNode(other, '乙节', '乙节（改过）');
    await other.getByTestId('route-editor-save').click();
    await expect(other.getByTestId('roadmap-node').filter({ hasText: '乙节（改过）' })).toBeVisible();
    await expect(other.getByTestId('route-editor-notice')).toHaveCount(0);

    await editNode(other, '甲节', '甲节（B 抢改）');
    await other.getByTestId('route-editor-save').click();
    await expect(other.getByTestId('roadmap-node').filter({ hasText: '甲节（B 抢改）' })).toBeVisible();

    // Now the same node: A's baseline was read before either save, so its save is
    // refused and the draft survives.
    await page.getByTestId('route-editor-save').click();
    await expect(page.getByTestId('route-editor-notice')).toContainText('刚被别人改过');
    await expect(page.getByTestId('route-editor-title')).toHaveValue('甲节（A 抢改）');
    await page.screenshot({ path: testInfo.outputPath('route-node-conflict.png'), fullPage: true });

    // Saving again uses the revision that was just read, so A's own draft lands.
    await page.getByTestId('route-editor-save').click();
    await expect(page.getByTestId('roadmap-node').filter({ hasText: '甲节（A 抢改）' })).toBeVisible();
  } finally { await other.close(); }

  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await expect(page.getByTestId('roadmap-node').filter({ hasText: '甲节（A 抢改）' })).toBeVisible();
  await expect(page.getByTestId('roadmap-node').filter({ hasText: '乙节（改过）' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a plan is edited by its own target, keeps the draft on a stale save, and never rewrites another plan', async ({ page, context, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await createCard(page, '等差中项', '若 $a,A,b$ 成等差，则 $2A=a+b$。');
  await openCourses(page);
  await page.getByTestId('courses-tab-plans').click();
  await expect(page.getByTestId('plan-empty')).toBeVisible();

  await page.getByTestId('plan-create-campaign').click();
  await page.getByTestId('plan-editor-title').fill('期末复习');
  await page.getByTestId('plan-editor-daily').fill('3');
  await page.getByTestId('plan-editor-start').fill(localDay());
  await page.getByTestId('plan-editor-end').fill(addDays(localDay(), 20));
  await page.getByTestId('plan-editor-check').click();
  await expect(page.getByTestId('plan-preview')).toContainText('每天：3 张');
  await page.getByTestId('plan-editor-save').click();
  await expect(page.getByTestId('plan-row').filter({ hasText: '期末复习' })).toBeVisible();

  const list = await page.getByTestId('plan-row').all();
  expect(list).toHaveLength(1);

  // A second writer changes the same target; this page keeps its own draft.
  await page.getByTestId('plan-row').filter({ hasText: '期末复习' }).getByTestId('plan-row-open').click();
  await page.getByTestId('plan-editor-daily').fill('5');
  const other = await context.newPage();
  try {
    await enterClassroom(other, dsh.authUrl);
    await openCourses(other);
    await other.getByTestId('courses-tab-plans').click();
    await other.getByTestId('plan-row').filter({ hasText: '期末复习' }).getByTestId('plan-row-open').click();
    await other.getByTestId('plan-editor-title').fill('期末复习（老师改的）');
    await other.getByTestId('plan-editor-check').click();
    await expect(other.getByTestId('plan-preview')).toContainText('期末复习（老师改的）');
    await other.getByTestId('plan-editor-save').click();
    await expect(other.getByTestId('plan-row').filter({ hasText: '期末复习（老师改的）' })).toBeVisible();

    // The stale save is refused; the draft is still there and the newest revision is shown.
    await page.getByTestId('plan-editor-check').click();
    await expect(page.getByTestId('plan-editor-notice')).toContainText('刚被别人改过');
    await expect(page.getByTestId('plan-editor-latest')).toContainText('期末复习（老师改的）');
    await expect(page.getByTestId('plan-editor-title')).toHaveValue('期末复习');
    // Nothing was rebased behind the student's back: without a fresh confirmation
    // there is no preview to confirm, so the save cannot overwrite the other writer.
    await expect(page.getByTestId('plan-editor-save')).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('plan-conflict.png'), fullPage: true });

    // Only the explicit "keep my draft on the newest revision" moves the baseline;
    // the confirmation then matches what would really be written.
    await page.getByTestId('plan-editor-rebase').click();
    await expect(page.getByTestId('plan-editor-rebase')).toHaveCount(0);
    await page.getByTestId('plan-editor-check').click();
    await expect(page.getByTestId('plan-preview')).toContainText('每天：5 张');
    await page.getByTestId('plan-editor-save').click();
    await expect(page.getByTestId('plan-row').filter({ hasText: '期末复习' })).toBeVisible();
    await other.getByTestId('plan-refresh').click();
    const rows = await other.getByTestId('plan-row').all();
    expect(rows).toHaveLength(1);
  } finally { await other.close(); }

  // A second target is created and the first one is edited again: no cross-talk.
  await page.getByTestId('plan-create-campaign').click();
  await page.getByTestId('plan-editor-title').fill('三角函数小练');
  await page.getByTestId('plan-editor-daily').fill('2');
  await page.getByTestId('plan-editor-start').fill(localDay());
  await page.getByTestId('plan-editor-end').fill(addDays(localDay(), 6));
  await page.getByTestId('plan-editor-check').click();
  await page.getByTestId('plan-editor-save').click();
  await expect(page.getByTestId('plan-row')).toHaveCount(2);
  const first = page.getByTestId('plan-row').filter({ hasText: '期末复习' });
  const firstRef = await first.getAttribute('data-plan-ref');
  await first.getByTestId('plan-row-open').click();
  await page.getByTestId('plan-editor-title').fill('期末复习（再改）');
  await page.getByTestId('plan-editor-check').click();
  await page.getByTestId('plan-editor-save').click();
  const edited = page.getByTestId('plan-row').filter({ hasText: '期末复习（再改）' });
  await expect(edited).toBeVisible();
  expect(await edited.getAttribute('data-plan-ref')).toBe(firstRef);
  await expect(page.getByTestId('plan-row').filter({ hasText: '三角函数小练' }).getByTestId('plan-row-kind')).toContainText('第 1 版');

  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await page.getByTestId('courses-tab-plans').click();
  await expect(page.getByTestId('plan-row').filter({ hasText: '期末复习（再改）' })).toBeVisible();
  await expect(page.getByTestId('plan-row').filter({ hasText: '三角函数小练' })).toBeVisible();
  expect(errors).toEqual([]);
});

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + days)).toISOString().slice(0, 10);
}

test('at 390 the course page really widens after the sidebar collapses, and the canvas still fits', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  await openCourses(page);
  await planNode(page, '窄屏这一节', { date: localDay() });

  await page.setViewportSize({ width: 390, height: 844 });
  // The native frame collapses its sidebar on its own. Wait for the centre column
  // to have really widened — a screenshot taken during the transition would show
  // the old, squeezed layout and read as a defect that is not there.
  const surface = page.getByTestId('studyforge-page-studyforge.courses');
  await expect.poll(async () => (await surface.boundingBox())?.width ?? 0).toBeGreaterThan(290);
  // The student's own surface does not overflow its column.
  expect(await surface.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('course-390.png'), fullPage: true });

  await page.getByTestId('roadmap-arrange').click();
  const canvas = page.getByTestId('roadmap-canvas');
  await expect(canvas).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  if (canvasBox === null) throw new Error('the roadmap canvas has no box');
  expect(canvasBox.width).toBeGreaterThan(240);
  const card = page.getByTestId('roadmap-canvas-node').filter({ hasText: '窄屏这一节' });
  await expect(card).toBeVisible();
  const cardBox = await card.boundingBox();
  if (cardBox === null) throw new Error('the planned card has no box');
  // The card sits inside the visible board rather than clipped past its edge.
  expect(cardBox.x).toBeGreaterThanOrEqual(canvasBox.x - 1);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 1);
  await page.screenshot({ path: testInfo.outputPath('course-arrange-390.png'), fullPage: true });
  expect(errors).toEqual([]);
});
