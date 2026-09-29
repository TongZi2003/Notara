import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * 番茄钟 in the classroom header: started and stopped from the page, counted
 * down from the Host clock, kept across a reload, and when a phase ends the
 * teacher speaks first while the student gains no message of their own and the
 * notice text never shows.
 */
test('the classroom pomodoro counts down, survives a reload and makes the teacher speak when it ends', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const harness = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await writeFile(join(runtime.root, 'teacher-replies.json'), `${JSON.stringify({ '先开始上课': '好，我们开始。' })}\n`);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }

    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('先开始上课'); await input.press('Enter');
    const replies = page.locator('.hWmORq_body');
    await expect(replies.last()).toContainText('好，我们开始。', { timeout: 30_000 });

    // Start a focus phase from the header.
    const trigger = page.locator('.nv-pomodoro-trigger');
    await expect(trigger).toHaveAttribute('aria-label', '番茄钟');
    await trigger.click();
    const panel = page.getByRole('group', { name: '番茄钟' });
    await expect(panel.getByText(/到点后老师会主动开口/)).toBeVisible();
    await panel.getByRole('button', { name: '开始专注 25 分钟' }).click();
    await expect(trigger).toHaveAttribute('aria-label', /^番茄钟：专注还剩 2[45]:\d\d$/);
    const first = await trigger.getAttribute('aria-label');
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 5_000 }).not.toBe(first);
    await page.screenshot({ path: testInfo.outputPath('pomodoro-running.png') });

    // The Host keeps the phase: a reload shows the same running timer.
    await page.reload();
    // A reload resumes the classroom; picking it in the Home panel keeps it open.
    await page.getByRole('button', { name: /^Vault 课堂/ }).first().click();
    await expect(page.locator('.nv-pomodoro-trigger')).toHaveAttribute('aria-label', /^番茄钟：专注还剩 2[45]:\d\d$/, { timeout: 30_000 });

    // Stopping returns the header to idle.
    await page.locator('.nv-pomodoro-trigger').click();
    await page.getByRole('group', { name: '番茄钟' }).getByRole('button', { name: '结束这段专注' }).click();
    await expect(page.locator('.nv-pomodoro-trigger')).toHaveAttribute('aria-label', '番茄钟');

    // A one-minute break (below the header's own choices) through the same Host
    // method, so the end of a phase is observable within the test.
    const sessions = await harness.sessions();
    // The one classroom that already has the student's message; blank rows are the home page's prepared seats.
    const lesson = (sessions as Array<{ sessionId: string; blank?: boolean }>).find(row => !row.blank);
    expect(lesson, JSON.stringify(sessions)).toBeTruthy();
    harness.value(await harness.rpc('notaraVault/startPomodoro', { input: { sessionId: lesson!.sessionId, phase: 'break', minutes: 1 } }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.nv-pomodoro-trigger')).toHaveAttribute('aria-label', /^番茄钟：休息还剩 [01]:\d\d$/, { timeout: 20_000 });
    const before = await replies.count();
    await expect.poll(() => replies.count(), { timeout: 120_000, intervals: [2_000] }).toBeGreaterThan(before);
    await expect(page.locator('.nv-pomodoro-trigger')).toHaveAttribute('aria-label', '番茄钟', { timeout: 30_000 });
    // The student still has only their own message, and the notice stays hidden.
    await expect(page.locator('.Sixlwa_bubble')).toHaveCount(1);
    await expect(page.getByText(/主动开口/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('pomodoro-teacher-spoke.png') });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await harness.close();
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
