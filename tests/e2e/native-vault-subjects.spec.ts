import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

test('subject resources are discoverable and a new task-based lesson keeps teacher references folded', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await testInfo.attach('isolated-runtime', { body: runtime.root, contentType: 'text/plain' });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await later.waitFor({ timeout: 4000 }); await later.click(); } catch { /* configured test model */ }
    await page.getByText('Notara Vault', { exact: true }).first().click();
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.fill('准备查看教学资源');
    await composer.press('Enter');
    const manifest = JSON.parse(await readFile(new URL('../../resources/vault-teaching/manifest.json', import.meta.url), 'utf8'));
    for (const id of ['math', 'physics', 'chemistry', 'computing', 'chinese', 'english', 'science', 'humanities']) {
      await composer.fill(`/notara-subject-${id}`);
      const resource = manifest.skills.find((row: { id: string; title: string }) => row.id === `subject-${id}`);
      await expect(page.locator('[data-trigger-menu]')).toContainText(resource.title);
      await composer.press('Escape');
    }
    await composer.press('ControlOrMeta+A');
    await composer.press('Backspace');
    await page.getByRole('tab', { name: '资产', exact: true }).click();
    await page.getByRole('button', { name: '新建页面', exact: true }).click();
    await page.getByLabel('模板', { exact: true }).selectOption('lesson.md');
    await page.getByLabel('页面标题').fill('数组入门');
    await page.getByLabel('目标路径').fill('备课/数组入门.md');
    await page.getByRole('button', { name: '创建 Markdown 页面', exact: true }).click();
    const editor = page.getByLabel('Markdown Live Preview 编辑器');
    await expect(editor).toContainText('任务 1');
    const notes = editor.locator('.cm-vault-teacher');
    await expect(notes).toHaveCount(3);
    expect(await notes.evaluateAll(elements => elements.every(el => !(el as HTMLDetailsElement).open))).toBe(true);
    await expect(editor).not.toContainText('参考内容与核验');
    const saved = await readFile(join(runtime.root, 'workspace/vault/备课/数组入门.md'), 'utf8');
    expect(saved).toContain('参考内容与核验');
    await notes.nth(1).locator('summary').click();
    await expect(notes.nth(1)).toContainText('参考内容与核验');
    expect(await readFile(join(runtime.root, 'workspace/vault/备课/数组入门.md'), 'utf8')).toBe(saved);
    await page.screenshot({ path: testInfo.outputPath('subject-lesson-template.png') });
    await notes.nth(1).locator('summary').click();
    await page.reload();
    // The workspace returns to chat on reload. Reopen the saved artifact;
    // this checks folding and persistence, not unrelated tab persistence.
    await page.getByRole('tab', { name: '资产', exact: true }).click();
    const expand = page.getByRole('button', { name: '展开文件栏', exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.getByRole('button', { name: /数组入门\.md$/ }).click();
    await expect(page.getByLabel('Markdown Live Preview 编辑器')).toContainText('数组入门');
    expect(await page.locator('.cm-vault-teacher').evaluateAll(elements => elements.length > 0 && elements.every(el => !(el as HTMLDetailsElement).open))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
  }
});
