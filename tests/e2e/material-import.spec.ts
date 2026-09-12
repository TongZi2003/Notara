/**
 * P3.1 on a real Host: one file becomes one original, and reading it never
 * opens a lesson. Nothing here is a fixture array on the client — every title,
 * byte count and version count on screen comes back from the Host.
 */
import { writeFile } from 'node:fs/promises';
import { test as base, expect } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { enterClassroom } from './fixtures/classroom.ts';

const test = base.extend<{ runtime: IsolatedRuntime }>({
  runtime: async ({}, use, testInfo) => {
    const runtime = await startIsolated();
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('native-host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

const ORIGINAL = '# 三角函数笔记\n\n正弦与余弦的和角公式：sin(a+b)=sin a cos b + cos a sin b。\n';
const SECOND = '# 三角函数笔记\n\n第二版补上了差角公式，原件仍然保留。\n';

test('an imported original is read directly and never opens a lesson', async ({ page, runtime }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const file = testInfo.outputPath('三角函数笔记.md');
  await writeFile(file, ORIGINAL, 'utf8');

  await enterClassroom(page, runtime.authUrl);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await expect(page.getByTestId('studyforge-page-studyforge.materials')).toBeVisible();
  await expect(page.getByTestId('materials-empty')).toBeVisible();

  await page.getByTestId('material-file-input').setInputFiles(file);
  const row = page.getByTestId('material-row').filter({ hasText: '三角函数笔记' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Markdown');
  await expect(page.getByTestId('materials-notice')).toContainText('收好了');
  // The shelf is the library; the reader is a page of its own once opened.
  await row.getByRole('button').first().click();
  // The reader holds the Host's bytes and renders them as real Markdown.
  const reader = page.getByTestId('material-markdown');
  await expect(reader.getByRole('heading', { name: '三角函数笔记' })).toBeVisible();
  await expect(reader).toContainText('正弦与余弦的和角公式');
  await page.screenshot({ path: testInfo.outputPath('materials-import.png'), fullPage: true });

  // Importing is not enrolling: no lesson, no learning set was created.
  await page.getByRole('button', { name: '课程', exact: true }).first().click();
  await expect(page.getByTestId('studyforge-page-studyforge.courses')).toContainText('还没有课');
  expect(errors).toEqual([]);
});

test('a second file with the same name is refused with a next action', async ({ page, runtime }, testInfo) => {
  const file = testInfo.outputPath('同一份笔记.md');
  await writeFile(file, ORIGINAL, 'utf8');

  await enterClassroom(page, runtime.authUrl);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(file);
  await expect(page.getByTestId('material-row')).toHaveCount(1);

  await page.getByTestId('material-file-input').setInputFiles(file);
  await expect(page.getByTestId('materials-notice')).toContainText('同名资料已经有一份了');
  await expect(page.getByTestId('material-row')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('materials-name-clash.png'), fullPage: true });
});

test('a new version is explicit, keeps the old bytes readable, and a refresh keeps both', async ({ page, runtime }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const first = testInfo.outputPath('三角函数笔记.md');
  const second = testInfo.outputPath('三角函数笔记-第二版.md');
  await writeFile(first, ORIGINAL, 'utf8');
  await writeFile(second, SECOND, 'utf8');

  await enterClassroom(page, runtime.authUrl);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(first);
  const row = page.getByTestId('material-row').filter({ hasText: '三角函数笔记' });
  await expect(row).toContainText('1 个文件');

  await row.getByTestId('material-new-version-input').setInputFiles(second);
  await expect(row).toContainText('2 个版本');
  await expect(page.getByTestId('materials-notice')).toContainText('第 2 版');
  await row.getByRole('button').first().click();
  await expect(page.getByTestId('material-markdown')).toContainText('第二版补上了差角公式');

  // The first version's own bytes are still there, under its own version.
  await page.getByTestId('material-version-select').selectOption({ index: 0 });
  await expect(page.getByTestId('material-markdown')).toContainText('正弦与余弦的和角公式');

  // A reload reads the Host again: both versions survive, and v1 still resolves v1.
  await page.reload();
  for (const name of ['Continue', 'Configure later']) {
    const button = page.getByRole('button', { name, exact: true });
    try { await button.waitFor({ state: 'visible', timeout: 2000 }); await button.click(); }
    catch { /* a reload of a configured workspace has no onboarding step */ }
  }
  await expect(page.getByTestId('material-markdown')).toContainText('正弦与余弦的和角公式');
  await expect(page.getByTestId('material-version-select').locator('option')).toHaveCount(2);
  await page.getByTestId('materials-back').click();
  const afterReload = page.getByTestId('material-row').filter({ hasText: '三角函数笔记' });
  await expect(afterReload).toContainText('2 个版本');
  await afterReload.getByRole('button').first().click();
  await expect(page.getByTestId('material-version-select')).toBeVisible();
  await page.getByTestId('material-version-select').selectOption({ index: 0 });
  await expect(page.getByTestId('material-markdown')).toContainText('正弦与余弦的和角公式');
  await page.screenshot({ path: testInfo.outputPath('materials-two-versions.png'), fullPage: true });
  expect(errors).toEqual([]);
});
