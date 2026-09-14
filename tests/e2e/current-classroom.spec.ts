import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { enterClassroom, openRoot, openSetManagement } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { SessionCreateValue } from '@deepseek-ai/dsh-api-session-controller';

/**
 * This spec exercises a real lesson, so it boots the isolated runtime with the
 * controllable test provider. The shared fixture stays model-free for the
 * specs that never send a prompt.
 */
const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
    try {
      await use(runtime);
    } finally {
      await runtime.stop();
      await runtime.stop(); // disposal is idempotent
      await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
      await expect(access(runtime.root)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  },
});

/** The native model control's accessible name, whichever locale the app boots in. */
const MODEL_TRIGGER = /^(Select model|选择模型)/;
const STUDENT_PAGES = [
  { label: '课程', page: 'studyforge.courses' },
  { label: '资料', page: 'studyforge.materials' },
  { label: '管理学习集', page: 'studyforge.sets' },
  { label: '学情', page: 'studyforge.memory' },
  { label: '日历', page: 'studyforge.calendar' },
] as const;

/** First-run notices are modal and ordered; a returning boot shows none. */
async function dismissNotices(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    try {
      await button.waitFor({ state: 'visible', timeout: 5_000 });
      await button.click();
    } catch { /* onboarding is a one-time surface */ }
  }
}

async function enter(page: Page, url: string): Promise<void> {
  await enterClassroom(page, url);
}

test('native classroom keeps its own composer and carries the student lesson surfaces', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text()); });
  try {
    await enter(page, dsh.authUrl);

    // The classroom is the native Conversation: nothing of ours covers `main`/`conversation`.
    await expect(page.locator('[data-conversation-scroll]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    await expect(page.getByTestId('studyforge-shell')).toHaveCount(0);
    // Model selection stays the native control; this client adds none of its own.
    await expect(page.getByRole('button', { name: MODEL_TRIGGER })).toBeVisible();
    await expect(page.locator('[data-studyforge-style="p2"]')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('native-classroom-1440.png') });

    // Every student entry reaches its own page, and leaving it restores the classroom.
    for (const entry of STUDENT_PAGES) {
      if (entry.page === 'studyforge.sets') await openSetManagement(page);
      else await openRoot(page, entry.label);
      const surface = page.getByTestId(`studyforge-page-${entry.page}`);
      await expect(surface).toBeVisible();
      await expect(page.locator('[data-conversation-scroll]')).toHaveCount(0);
      if (entry.page === 'studyforge.courses') {
        expect(await surface.innerText()).not.toMatch(/studyforge\.|sessionId|schema|\/Users\//);
        // The default course page is the roadmap; the lesson list is its own tab.
        await page.getByTestId('courses-view').selectOption('list');
        await expect(page.getByTestId('course-tree-empty')).toContainText('暂无课程');
      }
    }
    await openRoot(page, '首页');
    await expect(page.locator('[data-conversation-scroll]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('home-back-to-classroom.png') });

    // A zero-material lesson: the student says what they want, and the native
    // session is created by that submission with no material picked first.
    await page.locator('[data-composer-input]').click();
    await page.keyboard.insertText('我想先弄清楚一次函数的图像');
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    await expect(send).toBeEnabled();
    await send.click();
    await page.screenshot({ path: testInfo.outputPath('sent-zero-material.png') });
    await expect.poll(async () => existsSync(join(dsh.root, 'model-requests.jsonl')), { timeout: 30_000 }).toBe(true);

    // The lesson entry opens this client's own rightbar page type; the read is real
    // (this lesson has no material yet, and the panel says exactly that).
    const lessonEntry = page.getByTestId('open-lesson');
    await expect(lessonEntry).toBeVisible();
    await lessonEntry.click();
    const panel = page.getByTestId('studyforge-lesson-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading')).toHaveCount(0);
    await expect(panel.getByTestId('lesson-materials-empty')).toBeVisible();
    // The docked panel slides in: assert controls and content actually land in the
    // viewport before the evidence shot, so a mid-transition frame cannot pass.
    await expect(panel.getByTestId('lesson-materials-refresh')).toBeInViewport({ ratio: 1 });
    await expect(panel.getByTestId('material-pick')).toBeInViewport({ ratio: 1 });
    await expect(panel).toBeInViewport({ ratio: 0.95 });
    expect(await panel.innerText()).not.toMatch(/studyforge\.|sessionId|schema|\/Users\/|\.jsonl/);
    await page.screenshot({ path: testInfo.outputPath('lesson-panel-rightbar.png') });

    // The lesson the student just started is now a real row in their course list.
    await page.getByTestId('notebook-sidebar').getByRole('button', { name: '课程', exact: true }).click();
    const courses = page.getByTestId('studyforge-page-studyforge.courses');
    await expect(courses).toBeVisible();
    await page.getByTestId('courses-view').selectOption('list');
    await expect(page.getByTestId('roadmap-nodes')).toBeVisible({ timeout: 20_000 });
    await expect(courses).toContainText('一次函数');
    await page.screenshot({ path: testInfo.outputPath('courses-after-lesson.png') });

    // Narrower and smallest supported viewports keep the classroom and the entries usable.
    await page.setViewportSize({ width: 1024, height: 768 });
    await openRoot(page, '首页');
    // 开始学习 now deliberately starts a new lesson. Return via the real history
    // entry to exercise the same lesson's panel at the smaller viewport.
    await page.getByTestId('notebook-sidebar').getByRole('button', { name: /一次函数/ }).last().click();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('classroom-1024.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    if (!await panel.isVisible()) await page.getByTestId('open-lesson').click();
    // At the smallest width the native rightbar covers the viewport, so the lesson
    // panel itself is what the student reads there; a browser reload resets the
    // in-memory layout and the navigation is reachable again.
    const narrowPanel = page.getByTestId('studyforge-lesson-panel');
    await expect(narrowPanel).toBeVisible();
    await expect(narrowPanel.getByRole('heading')).toHaveCount(0);
    await expect(narrowPanel.getByTestId('lesson-materials-refresh')).toBeInViewport({ ratio: 1 });
    await expect(narrowPanel.getByTestId('material-pick')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('narrow-390-lesson.png') });
    await page.reload();
    await dismissNotices(page);
    const calendarRow = page.getByTestId('notebook-sidebar').getByRole('button', { name: '日历', exact: true });
    await expect(calendarRow).toBeVisible();
    await calendarRow.click();
    await expect(page.getByTestId('studyforge-page-studyforge.calendar')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('narrow-390.png') });
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('browser-console', { body: errors.join('\n'), contentType: 'text/plain' });
  }
});

test('a creation session keeps the classroom and hides the learning lesson surfaces', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text()); });
  try {
    await enter(page, dsh.authUrl);

    // Seed an existing native creation session; the learning homepage no longer
    // offers a coding/creation switch. Verify its native composer still works.
    const client = await connectRuntime(dsh);
    const created = await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(dsh.root, 'classroom'), agentPreset: 'studyforge-creation' } });
    if (!created.ok) throw new Error('creation fixture refused');
    await client.rpc('session/prompt', { request: { sessionId: created.value.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '准备制作封面' }] } });
    await client.rpc('session/rename', { request: { sessionId: created.value.sessionId, title: '制作封面测试' } });
    await page.reload();
    await page.getByTestId('notebook-sidebar').getByRole('button', { name: /制作封面测试/ }).click();

    await page.locator('[data-composer-input]').click();
    await page.keyboard.insertText('帮我做一张封面');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(async () => existsSync(join(dsh.root, 'model-requests.jsonl')), { timeout: 30_000 }).toBe(true);

    // The classroom, its composer and the native model control stay; only the
    // learning lesson entry and its outputs are absent.
    await expect(page.locator('[data-conversation-scroll]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    await expect(page.getByRole('button', { name: MODEL_TRIGGER })).toBeVisible();
    await expect(page.getByTestId('open-lesson')).toHaveCount(0);
    await expect(page.getByTestId('studyforge-lesson-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click();
    await expect(page.getByRole('tab').filter({ hasText: 'Files' })).toBeVisible();
    await expect(page.getByTestId('lesson-deck-reopen')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('creation-session.png') });
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('browser-console', { body: errors.join('\n'), contentType: 'text/plain' });
  }
});
