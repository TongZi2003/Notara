import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
// @ts-expect-error Native Vault standalone JS; use its real file reader.
import { parseFrontmatter } from '../../examples/native-vault/frontmatter.js';

test('a self-check judges the key step, keeps older records readable, and does not inflate same-day review', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const path = join(runtime.root, 'workspace/vault/卡片/选法.md');
  const fields = async () => parseFrontmatter(await readFile(path, 'utf8')).frontmatter;
  const openReview = async () => {
    await page.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: '计划', exact: true }).click();
    await page.getByRole('tablist', { name: '计划视图' }).getByRole('tab', { name: '复习', exact: true }).click();
    await page.getByRole('button', { name: /^全部 \d/ }).click();
    await page.locator('.nv-review-row').filter({ hasText: '选法' }).click();
    await expect(page.getByRole('heading', { name: '选法', exact: true })).toBeVisible();
  };
  const detail = page.getByRole('region', { name: '卡片复习详情' });
  const unlearned = { learned: false, mastery: 0, interval: null, last_review: null, next_review: null };
  // One second-generation row and one teacher record from the four-part format (0.20.0–0.20.1).
  const history = [
    { id: 'old-list', at: '2026-09-01T04:00:00.000Z', day: '2026-09-01', assessments: [{ ability: '判断方法适用范围', outcome: 'demonstrated' }, { ability: '未经提醒主动唤起方法', outcome: 'not_observed' }],
      note: '第二代记录。', sessionId: null, actor: 'teacher', before: unlearned, after: unlearned },
    { id: 'plan', at: '2026-09-02T04:00:00.000Z', day: '2026-09-02', result: 'unchecked', nextCheck: '边界：没有对称结构时换什么方法', note: '讲过选法。', sessionId: null, actor: 'teacher', before: unlearned, after: unlearned },
  ];
  try {
    await mkdir(join(runtime.root, 'workspace/vault/卡片'), { recursive: true });
    await writeFile(path, `---\ntype: card\ntags: [数学]\nreview_history: ${JSON.stringify(history)}\n---\n# 选法\n\n## 学生理解\n老师提醒极点极线，学生自行判断不适用并提出参数方程。\n`);
    await writeFile(join(runtime.root, 'workspace/vault/卡片/待检查.md'), '---\ntype: card\nreview_history: [{"day":"2026-02-30"}]\n---\n# 待检查\n');
    await testInfo.attach('isolated-root', { body: runtime.root, contentType: 'text/plain' });
    await page.goto(runtime.authUrl);
    // Let the real session-backed workspace settle before changing benches.
    await page.locator('[data-composer-input][contenteditable="true"]').last().fill('开始复习');
    await page.getByRole('button', { name: /^(发送消息|Send message)$/ }).click();
    await expect(page.getByRole('button', { name: /^(发送消息|Send message)$/ })).toBeDisabled();
    await openReview();
    await expect(page.getByRole('button', { name: '检查 待检查.md', exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: '保存评估', exact: true })).toBeDisabled();
    await detail.getByLabel('评估说明', { exact: true }).fill('只看了一眼卡片，没有自己做。');
    // A note alone is not a judgment: the key step needs a result.
    await expect(detail.getByRole('button', { name: '保存评估', exact: true })).toBeDisabled();
    await detail.getByLabel('关键一步的结果', { exact: true }).selectOption('unchecked');
    await detail.getByRole('button', { name: '保存评估', exact: true }).click();
    await expect(page.getByText('已保存评估，原复习安排保持不变。', { exact: true })).toBeVisible();
    expect((await fields()).learned).toBe(false);
    expect((await fields()).next_review).toBeNull();

    await page.reload();
    await openReview();
    await detail.locator('.nv-review-history summary').click();
    await expect(detail.locator('.nv-review-history')).toContainText('关键一步：这次没考');
    await expect(detail.locator('.nv-review-history')).toContainText('判断方法适用范围：已表现出来');
    await expect(detail.locator('.nv-review-history')).not.toContainText('下次检验');

    // A later independent attempt starts review; another same-day success
    // remains recorded but does not climb the ladder or postpone the due day.
    for (let attempt = 0; attempt < 2; attempt++) {
      await detail.getByLabel('关键一步的结果', { exact: true }).selectOption('done');
      await detail.getByLabel('检验的是哪一步', { exact: true }).fill('判断方法适用范围');
      await detail.getByLabel('评估说明', { exact: true }).fill(`新的尝试 ${attempt+1}：自己选择了参数方程并说明理由。`);
      await detail.getByRole('button', { name: '保存评估', exact: true }).click();
      await expect.poll(async () => (await fields()).review_history.length).toBe(attempt+4);
      await expect(detail.getByLabel('评估说明', { exact: true })).toHaveValue('');
      await expect(detail.getByLabel('关键一步的结果', { exact: true })).toHaveValue('');
      expect((await fields()).mastery).toBe(1);
    }
    const saved = await fields();
    // [0] second generation, [1] teacher plan, [2] unchecked self-check, [3] first done, [4] same-day repeat.
    expect(saved.review_history[4]).toMatchObject({ keyStep: '判断方法适用范围', result: 'done', actor: 'self' });
    expect(saved.review_history[4].before).toEqual(saved.review_history[4].after);
    await detail.locator('.nv-review-history summary').click();
    await detail.getByRole('button', { name: '撤销最近一次评估', exact: true }).click();
    await expect(page.getByText('已撤销最近一次评估，恢复原来的复习安排。', { exact: true })).toBeVisible();
    expect((await fields()).review_history[4].revertedAt).toBeTruthy();
    expect((await fields()).next_review).toBe(saved.next_review);
    await page.screenshot({ path: testInfo.outputPath('key-step-review.png') });

    await detail.getByRole('button', { name: '打开卡片原文', exact: true }).click();
    const editor = page.getByLabel('Markdown Live Preview 编辑器');
    await expect(editor).toContainText('选法');
    await expect(editor).toContainText('复习记录');
    await editor.locator('.cm-vault-property-record summary').click();
    await expect(editor).toContainText('关键一步（判断方法适用范围）：做出来');
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
