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
export const SIDEBAR_ROOTS = ['首页', '学习集', '课程', '资料', '日历', '学情'] as const;

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

/** Organize and review cards from the materials page. */
export async function openCards(page: Page): Promise<void> {
  await openRoot(page, '资料');
  await page.getByTestId('materials-open-cards').click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

/** Learning-set management lives behind the sidebar's 管理学习集 entry. */
export async function openSetManagement(page: Page): Promise<void> {
  await expandSidebar(page);
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: '学习集', exact: true }).click();
  await expect(page.getByTestId('studyforge-page-studyforge.sets')).toBeVisible();
}

/** A connected, pannable roadmap is the default course page. */
export async function openCourses(page: Page): Promise<void> {
  await openRoot(page, '课程');
  await expect(page.getByTestId('studyforge-page-studyforge.courses')).toBeVisible();
}

/** The tree and map share their course projection and detail panel. */
export async function openCoursesList(page: Page): Promise<void> {
  await openCourses(page);
  await page.getByTestId('courses-view').selectOption('list');
  await expect(page.getByTestId('course-lessons')).toBeVisible();
}
export async function openCourseDetail(page: Page, title: string): Promise<void> {
  if (await page.getByTestId('course-node-detail').count()) await page.getByRole('button', { name: '关闭课程详情', exact: true }).click();
  await page.getByTestId('roadmap-node-title').filter({ hasText: title }).click();
  await expect(page.getByTestId('course-node-detail')).toBeVisible();
}
/** The materials workbench is the lesson's own desk inside the workspace. */
export async function openLessonMaterials(page: Page): Promise<void> {
  await page.getByTestId('workspace-open-materials').click();
  await expect(page.getByTestId('studyforge-lesson-panel')).toBeVisible();
}
/** Lesson settings live in the workspace layout menu (本课设置). */
export async function openLessonSettings(page: Page): Promise<void> {
  await page.locator('summary[aria-label="调整布局"]').click();
  await page.getByTestId('open-lesson-settings').click();
  await expect(page.getByTestId('lesson-settings-modal')).toBeVisible();
}
/** Select one original on the shelf, then open it in the reader page. */
export async function openMaterial(page: Page, title: string): Promise<void> {
  await page.getByTestId('material-row').filter({ hasText: title }).getByRole('button', { name: `预览：${title}`, exact: true }).click();
  await page.getByTestId('library-detail').getByRole('button', { name: '阅读原文', exact: true }).click();
  await expect(page.getByTestId('material-reader')).toBeVisible();
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

/** Flip the debug switch in Settings → General; Raw and Trajectory views appear after it. */
export async function enableDebug(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  const toggle = page.getByTestId('sf-debug-toggle');
  if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

export async function openAppearance(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await expect(page.getByTestId('notebook-appearance')).toBeVisible();
}
export async function closeAppearance(page: Page): Promise<void> {
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: /^(Close|关闭)$/ }).click();
  await expect(page.getByTestId('notebook-appearance')).toHaveCount(0);
}
