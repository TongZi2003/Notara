import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
// @ts-expect-error Native Vault standalone JS; use its real file reader.
import { parseFrontmatter } from '../../examples/native-vault/frontmatter.js';

test('ability observations survive reload, keep unknown distinct, and do not inflate same-day review', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const path = join(runtime.root, 'workspace/vault/卡片/选法.md');
  const fields = async () => parseFrontmatter(await readFile(path, 'utf8')).frontmatter;
  const openReview = async () => {
    await page.getByRole('tab', { name: '日历', exact: true }).click();
    await page.getByRole('button', { name: '间隔复习', exact: true }).click();
    await page.getByRole('button', { name: /^全部 \d/ }).click();
    await page.locator('.nv-review-row').filter({ hasText: '选法' }).click();
    await expect(page.getByRole('heading', { name: '选法', exact: true })).toBeVisible();
  };
  const detail = page.getByRole('region', { name: '卡片复习详情' });
  try {
    await mkdir(join(runtime.root, 'workspace/vault/卡片'), { recursive: true });
    await writeFile(path, '---\ntype: card\ntags: [数学]\n---\n# 选法\n\n## 学生理解\n老师提醒极点极线，学生自行判断不适用并提出参数方程。\n');
    await writeFile(join(runtime.root, 'workspace/vault/卡片/待检查.md'), '---\ntype: card\nreview_history: [{"day":"2026-02-30"}]\n---\n# 待检查\n');
    await testInfo.attach('isolated-root', { body: runtime.root, contentType: 'text/plain' });
    await page.goto(runtime.authUrl);
    await page.getByText('Notara Vault', { exact: true }).first().click();
    // Let the real session-backed workspace settle before changing benches.
    await page.locator('[data-composer-input][contenteditable="true"]').last().fill('开始观察复习能力');
    await page.getByRole('button', { name: /^(发送消息|Send message)$/ }).click();
    await expect(page.getByRole('button', { name: /^(发送消息|Send message)$/ })).toBeDisabled();
    await openReview();
    await expect(page.getByRole('button', { name: '检查 待检查.md', exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: '保存评估', exact: true })).toBeDisabled();
    await detail.getByLabel('评估能力 1', { exact: true }).fill('判断方法适用范围');
    await detail.getByLabel('能力表现 1', { exact: true }).selectOption('demonstrated');
    await detail.getByRole('button', { name: '添加能力', exact: true }).click();
    await detail.getByLabel('评估能力 2', { exact: true }).fill('未经提醒主动唤起方法');
    await expect(detail.getByLabel('能力表现 2', { exact: true })).toHaveValue('not_observed');
    await detail.getByLabel('评估说明', { exact: true }).fill('老师给出候选方法，适用性判断和替代方法由学生完成；自主唤起还没有观察。');
    await detail.getByRole('button', { name: '保存评估', exact: true }).click();
    await expect(page.getByText('已保存能力评估，原复习安排保持不变。', { exact: true })).toBeVisible();
    expect((await fields()).learned).toBe(false);
    expect((await fields()).next_review).toBeNull();

    await page.reload();
    await openReview();
    await detail.locator('.nv-review-history summary').click();
    await expect(detail.locator('.nv-review-history')).toContainText('判断方法适用范围：已表现出来');
    await expect(detail.locator('.nv-review-history')).toContainText('未经提醒主动唤起方法：尚未观察');
    await expect(detail.locator('.nv-review-history')).not.toContainText('还需练习');

    // A later actual observation can start review; another same-day success
    // remains recorded but does not climb the ladder or postpone the due day.
    for (let attempt = 0; attempt < 2; attempt++) {
      await detail.getByLabel('评估能力 1', { exact: true }).fill('未经提醒主动唤起方法');
      await detail.getByLabel('能力表现 1', { exact: true }).selectOption('demonstrated');
      await detail.getByLabel('评估说明', { exact: true }).fill(`新的尝试 ${attempt+1}：学生自己选择了参数方程并说明理由。`);
      await detail.getByRole('button', { name: '保存评估', exact: true }).click();
      await expect.poll(async () => (await fields()).review_history.length).toBe(attempt+2);
      await expect(detail.getByLabel('评估说明', { exact: true })).toHaveValue('');
      expect((await fields()).mastery).toBe(1);
    }
    const saved = await fields();
    expect(saved.review_history[2].before).toEqual(saved.review_history[2].after);
    await detail.locator('.nv-review-history summary').click();
    await detail.getByRole('button', { name: '撤销最近一次评估', exact: true }).click();
    await expect(page.getByText('已撤销最近一次评估，恢复原来的复习安排。', { exact: true })).toBeVisible();
    expect((await fields()).review_history[2].revertedAt).toBeTruthy();
    expect((await fields()).next_review).toBe(saved.next_review);
    await page.screenshot({ path: testInfo.outputPath('ability-review.png') });

    await detail.getByRole('button', { name: '打开卡片原文', exact: true }).click();
    const editor = page.getByLabel('Markdown Live Preview 编辑器');
    await expect(editor).toContainText('选法');
    await expect(editor).toContainText('复习记录');
    await editor.locator('.cm-vault-property-record summary').click();
    await expect(editor).toContainText('尚未观察');
    await openReview();
    await page.getByRole('button', { name: '检查 待检查.md', exact: true }).click();
    await expect(editor).toContainText('待检查');
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await testInfo.attach('runtime-log', { body: runtime.log(), contentType: 'text/plain' });
    await runtime.stop();
  }
});
