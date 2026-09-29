import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

/**
 * The Vault's lightweight code editor: a code file opens as highlighted text,
 * indents by its language, completes names already defined in the file, saves
 * through the asset version check, and picks up an outside edit (the teacher's
 * native edit) while the buffer is clean.
 */
test('a Python file opens in the library editor, indents, completes, saves and follows outside edits', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    const file = join(runtime.root, 'workspace', 'vault', '代码', 'hog.py');
    await mkdir(join(runtime.root, 'workspace', 'vault', '代码'), { recursive: true });
    await writeFile(file, 'def roll_dice(num_rolls):\n    total = 0\n    return total\n');
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }

    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await page.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /hog\.py$/ }).click();
    const editor = page.getByRole('region', { name: '代码编辑：代码/hog.py' });
    await expect(editor).toBeVisible();
    await expect(editor.getByText('Python', { exact: true })).toBeVisible();
    const content = editor.locator('.cm-content');
    await expect(content).toContainText('def roll_dice(num_rolls):');
    // Highlighted: the keyword is its own styled token.
    expect(await content.locator('span', { hasText: /^def$/ }).count()).toBeGreaterThan(0);

    // Enter after a colon indents by the language's unit; completion offers names from the file.
    await content.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('def twice(value):');
    await page.keyboard.press('Enter');
    await page.keyboard.type('return val');
    const completion = page.locator('.cm-tooltip-autocomplete');
    await expect(completion).toBeVisible();
    await expect(completion.getByText('value', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type(' * 2');
    await expect(editor.getByRole('status')).toHaveText('有未保存的修改');
    await page.screenshot({ path: testInfo.outputPath('code-editor.png') });

    await editor.getByRole('button', { name: '保存' }).click();
    await expect(editor.getByRole('status')).toHaveText('已保存');
    const saved = await readFile(file, 'utf8');
    expect(saved).toContain('def twice(value):\n    return value * 2');

    // An outside edit replaces the clean buffer on the next refresh.
    await writeFile(file, `${saved}\nprint(twice(3))\n`);
    await expect(content).toContainText('print(twice(3))', { timeout: 15_000 });
    await expect(editor.getByRole('status')).toHaveText('已载入文件的最新内容');

    // Unsaved code survives picking another file in the panel: the pick is
    // refused until the edit is saved or discarded.
    await content.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# 还没保存');
    await expect(editor.getByRole('status')).toHaveText('有未保存的修改');
    const files = page.getByRole('group', { name: '文件列表' });
    await files.getByRole('button', { name: '向量.md', exact: true }).click();
    await expect(page.getByText('当前页面有未保存修改，请先保存或放弃。').first()).toBeVisible();
    await expect(content).toContainText('# 还没保存');
    await editor.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(content).not.toContainText('# 还没保存');
    await expect(editor.getByRole('status')).toHaveText('已放弃修改');
    await files.getByRole('button', { name: '向量.md', exact: true }).click();
    await expect(page.locator('.nv-breadcrumb').first()).toHaveText('知识/向量.md');
    expect(await readFile(file, 'utf8')).not.toContain('还没保存');
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
