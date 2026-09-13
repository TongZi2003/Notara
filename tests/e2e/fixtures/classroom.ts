import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../../scripts/dev-isolated.ts';

export const test = base.extend<{ classroom: IsolatedRuntime }>({
  classroom: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('native-host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});
export { expect };
export async function enterClassroom(page: Page, authUrl: string): Promise<void> {
  const target = new URL(authUrl); target.hash = '#studyforge/classroom';
  await page.goto(target.href);
  for (const name of ['Continue', 'Configure later']) {
    const button = page.getByRole('button', { name, exact: true });
    try { await button.waitFor({ state: 'visible', timeout: 3000 }); await button.click(); }
    catch { /* Returning sessions and configured test providers do not repeat onboarding. */ }
  }
  await expect(page.locator('[data-composer-input]')).toBeVisible();
}

/** The accepted sidebar: five roots plus a set picker; cards and sets are reached from pages. */
export const SIDEBAR_ROOTS = ['首页', '课程', '资料', '日历', '学情'] as const;

/** The expanded sidebar body (pickers and actions) hides behind the fold. */
async function expandSidebar(page: Page): Promise<void> {
  const sidebar = page.getByTestId('notebook-sidebar');
  if (await sidebar.getAttribute('data-collapsed') === 'true') {
    await sidebar.getByRole('button', { name: '展开侧栏', exact: true }).click();
  }
}

/** Click one of the five sidebar roots by its student-facing label. */
export async function openRoot(page: Page, label: (typeof SIDEBAR_ROOTS)[number]): Promise<void> {
  await expandSidebar(page);
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: label, exact: true }).click();
}

/** The card library is a materials action ("卡片与笔记"), not a sidebar root. */
export async function openCards(page: Page): Promise<void> {
  await openRoot(page, '资料');
  await page.getByTestId('studyforge-page-studyforge.materials').getByRole('button', { name: '卡片与笔记', exact: true }).click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

/** Learning-set management lives behind the sidebar's 管理学习集 entry. */
export async function openSetManagement(page: Page): Promise<void> {
  await expandSidebar(page);
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: '管理学习集', exact: true }).click();
  await expect(page.getByTestId('studyforge-page-studyforge.sets')).toBeVisible();
}

/** A connected, pannable roadmap is the default course page. */
export async function openCourses(page: Page): Promise<void> {
  await openRoot(page, '课程');
  await expect(page.getByTestId('studyforge-page-studyforge.courses')).toBeVisible();
}

/** Existing row-editor flows still exist, but the student chooses the list tab. */
export async function openCoursesList(page: Page): Promise<void> {
  await openCourses(page);
  await page.getByTestId('courses-tab-list').click();
  await expect(page.getByTestId('course-lessons')).toBeVisible();
}
/** Settings and imports live in the native rightbar's 开始 page. */
export async function openLessonStart(page: Page): Promise<void> {
  await page.getByTestId('open-lesson').click();
  const start = page.getByRole('tab').filter({ hasText: /开始|Start/ });
  if (await start.count()) await start.first().click();
  else await page.getByRole('button', { name: /^(新标签页|New tab)$/ }).first().click();
  await expect(page.getByTestId('lesson-deck-reopen')).toBeVisible();
}
export async function openLessonSettings(page: Page): Promise<void> {
  await openLessonStart(page);
  await page.getByTestId('open-lesson-settings').click();
  await expect(page.getByTestId('lesson-settings-modal')).toBeVisible();
}
export async function typeInput(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-composer-input]');
  await input.click();
  // Native preparation blocks (e.g. loading this message's source crops)
  // explicitly make the composer inert until its visible reference is ready.
  await expect(input).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.insertText(text);
}
export async function sendInput(page: Page, text: string): Promise<void> {
  await typeInput(page, text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
