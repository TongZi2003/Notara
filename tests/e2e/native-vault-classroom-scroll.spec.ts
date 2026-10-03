import { test, expect, type Page } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type ScriptedReply } from '../fixtures/vault-http.ts';

const title = '长列表滚动验收';
const analysis = 'SCROLL-ANALYSIS：后台分析完成。';
const viewports = [{ width: 1360, height: 900 }, { width: 960, height: 600 }, { width: 390, height: 650 }];
const tab = (page: Page) => page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '教室', exact: true });

test('classroom lists all recent background tasks and its last action stays visible while scrolling in both appearances', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    client.approvals.auto('allowed-once');
    // Twenty real, independently scoped workers leave real native child records.
    // Finish the oldest role first, then use batches within the five-worker cap.
    const batches = [1, 5, 5, 5, 4];
    const trigger = (batch: number) => `准备后台任务滚动验收 ${batch + 1}`;
    const response = (batch: number) => `滚动验收第 ${batch + 1} 组已准备好。`;
    const replies: Record<string, ScriptedReply> = {
      '__session-title': title,
      '__worker:exercise': analysis,
      '__worker:general': analysis,
    };
    let task = 0;
    for (const [batch, count] of batches.entries()) replies[trigger(batch)] = {
      calls: Array.from({ length: count }, () => {
        const index = task++;
        return { name: 'ask_worker', arguments: { preset: index === 0 ? 'exercise' : 'general', goal: `合成滚动验收 ${index + 1}：确认这次独立分析完成。` } };
      }), text: response(batch),
    };
    await client.script(replies);
    await page.setViewportSize(viewports[0]!);
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    for (const batch of batches.keys()) {
      await input.fill(trigger(batch)); await input.press('Enter');
      await expect(page.getByText(response(batch), { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    }
    const teacherRequest = (await client.requests()).find(row => row.purpose === null && row.messages.some(message =>
      message.role === 'user' && message.content.some(block => block.type === 'text' && block.text === trigger(0))));
    expect(teacherRequest?.sessionId).toBeTruthy();
    const receipt = client.value(await client.rpc<{ tasks: Array<{ status: string }> }>('notaraVault/classroom', { input: { sessionId: teacherRequest!.sessionId! } }));
    expect(receipt.tasks).toHaveLength(20);
    expect(receipt.tasks.every(row => row.status === 'completed')).toBe(true);
    await tab(page).click();
    const classroom = page.locator('.nv-classroom');
    await expect(classroom.locator('.nv-task')).toHaveCount(20);
    await expect(classroom).not.toContainText(analysis);

    for (const appearance of ['minimal', 'notebook'] as const) {
      await page.setViewportSize(viewports[0]!);
      if (appearance === 'notebook') {
        await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
        await page.getByText('学习界面', { exact: true }).first().click();
        await page.getByRole('radio', { name: /^手帐/ }).check();
        await page.keyboard.press('Escape');
        await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook');
      }
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.evaluate(async () => { await document.fonts.ready; });
        await expect(classroom.locator('.nv-task')).toHaveCount(20);
        await classroom.evaluate(element => { element.scrollTop = 0; });
        const box = await classroom.boundingBox();
        expect(box).toBeTruthy();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(box!.height / 2, 200));
        await page.mouse.wheel(0, 10_000);
        await expect.poll(() => classroom.evaluate(element => ({ overflowing: element.scrollHeight > element.clientHeight, bottom: element.scrollTop >= element.scrollHeight - element.clientHeight - 1 }))).toEqual({ overflowing: true, bottom: true });

        const last = classroom.locator('.nv-task').last();
        await expect(last).toContainText('出题员 · 分析完成');
        const inspect = last.getByRole('button', { name: '查看分析（含完整解法）', exact: true });
        // Visibility alone accepts partially clipped buttons. Check the entire
        // action against every containing viewport before Playwright auto-scrolls.
        const geometry = await inspect.evaluate(element => {
          const button = element.getBoundingClientRect();
          const containers = ['.nv-classroom', '.nv-pane-content', '.nv-pane', '.nv-panes', '.nv-workspace'].map(selector => element.closest(selector)!.getBoundingClientRect());
          return {
            fullyInside: containers.every(rect => button.top >= rect.top - 1 && button.bottom <= rect.bottom + 1 && button.left >= rect.left - 1 && button.right <= rect.right + 1),
            insideScreen: button.bottom <= window.innerHeight + 1 && button.right <= window.innerWidth + 1,
          };
        });
        expect(geometry).toEqual({ fullyInside: true, insideScreen: true });
        await page.screenshot({ path: testInfo.outputPath(`classroom-bottom-${appearance}-${viewport.width}.png`) });
        await inspect.click();
        await expect(page.getByText(analysis, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(/^(一次性子代理记录|One-shot subagent record)$/)).toBeVisible();
        await expect(page.locator('[data-composer-input]')).toBeHidden();
        await page.getByRole('button', { name: '返回课堂', exact: true }).click();
        await expect(tab(page)).toHaveAttribute('aria-selected', 'true');
        await expect(classroom.locator('.nv-task')).toHaveCount(20);
      }
    }
  } finally {
    // Close the browser first: otherwise its live status polling can report a
    // connection reset caused solely by terminating the synthetic test Host.
    await page.close();
    await testInfo.attach('console-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(message => !/favicon|downloadable font/i.test(message))).toEqual([]);
});
