import { test, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

/**
 * 教师内容默认折叠是渲染层的行为，不是一个编辑器行为：路线总述、课程说明和资产
 * 阅读页都走同一份 Live Preview。这里用真实浏览器确认三件事——skills 里写的
 * `<details><summary>…</summary>` 简写确实收起而不是打出原始标签；卡片的
 * 参考理解默认折叠且仍可展开、编辑；内容与学生理解照常显示。
 */
test('teacher material folds by default in the reading surfaces and still opens on demand', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const editor = page.getByLabel('Markdown Live Preview 编辑器');
  const openFile = async (pattern: RegExp) => {
    const toggle = page.getByRole('button', { name: '展开文件栏', exact: true }).first();
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.getByRole('button', { name: pattern }).first().click();
    await expect(editor).toBeVisible();
  };
  try {
    await mkdir(join(runtime.root, 'workspace/vault/路线'), { recursive: true });
    await mkdir(join(runtime.root, 'workspace/vault/卡片'), { recursive: true });
    // The shorthand the teaching skills write: the summary sits beside the tag.
    await writeFile(join(runtime.root, 'workspace/vault/路线/数列路线.md'), [
      '---', 'name: 学习路线', 'type: route', 'status: draft', 'lessons: [{"id":"lesson-1","title":"基础练习","materials":[]}]', '---',
      '# 数列路线', '',
      '## 目标', '', '写清学完后能独立完成的任务。', '',
      '## 阶段主线', '', '按等差、递推、求和推进。', '',
      '<details><summary>教师参考</summary>', '', '先做基础练习，再进入独立迁移。', '', '</details>', '',
      '课程通过对话里的路线规划创建。', '',
      '<!-- notara:route-node "lesson-1" -->', '本课先观察数列。', '',
      '<details><summary>教师参考</summary>', '', '只在需要时给递推提示。', '', '</details>',
      '<!-- notara:route-node:end -->', '',
    ].join('\n'));
    await writeFile(join(runtime.root, 'workspace/vault/卡片/求值卡.md'), [
      '---', 'type: card', 'tags: [数学]', '---',
      '# 求值卡', '',
      '## 内容', '', '求 $1+1$。', '',
      '## 参考理解', '', '独立求解：$2$。', '',
      '## 学生理解', '', '他先数了数。', '',
    ].join('\n'));

    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    await page.getByText('Notara Vault', { exact: true }).first().click();
    const composer = page.locator('[data-composer-input][contenteditable="true"], textarea[placeholder]').last();
    await composer.fill('打开资料'); await composer.press('Enter');
    await page.getByRole('tab', { name: '资产', exact: true }).click();

    await openFile(/数列路线\.md$/);
    const note = editor.locator('.cm-vault-teacher').filter({ hasText: '教师参考' }).first();
    await expect(note).toBeVisible();
    expect(await note.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
    await expect(editor).not.toContainText('<details>');
    await expect(editor).not.toContainText('先做基础练习');
    await expect(editor).toContainText('按等差、递推、求和推进。');
    await note.locator('summary').first().click();
    expect(await note.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true);
    await expect(note).toContainText('先做基础练习');
    await expect(note.getByRole('button', { name: '编辑教师内容', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('route-teacher-fold.png') });

    await openFile(/求值卡\.md$/);
    const cardPath = join(runtime.root, 'workspace/vault/卡片/求值卡.md');
    const originalCard = await readFile(cardPath, 'utf8');
    const section = editor.locator('.cm-vault-section').filter({ hasText: '参考理解' });
    await expect(section).toBeVisible();
    expect(await section.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
    await expect(editor).not.toContainText('独立求解');
    await expect(editor).toContainText('他先数了数。');
    await section.locator('summary').first().click();
    expect(await section.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true);
    await expect(section).toContainText('独立求解');
    await expect(editor).toContainText('他先数了数。');
    await page.screenshot({ path: testInfo.outputPath('card-understanding-fold.png') });
    // 编辑参考理解 reveals that section's own source; 内容 and 学生理解 stay put.
    await page.getByRole('button', { name: '编辑参考理解', exact: true }).click();
    await expect(editor).toContainText('## 参考理解');
    await expect(editor).toContainText('他先数了数。');
    await page.getByRole('button', { name: '收起参考理解', exact: true }).click();
    await expect(editor).not.toContainText('独立求解');
    expect(await readFile(cardPath, 'utf8')).toBe(originalCard);

    await page.getByRole('tab', { name: '路线', exact: true }).click();
    await page.getByLabel('学习路线', { exact: true }).selectOption('路线/数列路线.md');
    const overview = page.locator('.nv-route-overview');
    await overview.locator('summary').first().click();
    const overviewNote = overview.locator('.cm-vault-teacher');
    await expect(overviewNote).toBeVisible();
    expect(await overviewNote.evaluate(el => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(overview).not.toContainText('先做基础练习');
    await overviewNote.locator('summary').click();
    await expect(overviewNote).toContainText('先做基础练习');
    await expect(overview.getByRole('button', { name: '编辑教师内容' })).toHaveCount(0);
    // Return the canvas to the visible area after inspecting the long overview.
    await overview.locator('summary').first().click();
    await page.getByRole('button', { name: '居中', exact: true }).click();
    await page.locator('.nv-graph-node').filter({ hasText: '基础练习' }).click();
    const brief = page.locator('.nv-route-brief');
    const briefNote = brief.locator('.cm-vault-teacher');
    await expect(briefNote).toBeVisible();
    expect(await briefNote.evaluate(el => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(brief).not.toContainText('只在需要时给递推提示');
    await briefNote.locator('summary').click();
    await expect(briefNote).toContainText('只在需要时给递推提示');
    await expect(brief.getByRole('button', { name: '编辑教师内容' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('route-bench-fold.png') });
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
  }
});
