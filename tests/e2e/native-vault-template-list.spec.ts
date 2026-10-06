import { test, expect } from '@playwright/test';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

test('custom templates remain selectable beside non-Markdown files in a mixed-case directory', async ({ page }, testInfo) => {
  test.skip(process.platform !== 'win32', 'Windows case-insensitive directory behavior');
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await testInfo.attach('isolated-runtime', { body: runtime.root, contentType: 'text/plain' });
    const vault = join(runtime.root, 'workspace', 'vault');
    const existing = (await readdir(vault)).find(name => name.toLowerCase() === '_templates');
    if (existing && existing !== '_Templates') {
      const intermediate = join(vault, '_templates-qa-rename');
      await rename(join(vault, existing), intermediate);
      await rename(intermediate, join(vault, '_Templates'));
    }
    const templates = join(vault, '_Templates');
    await mkdir(templates, { recursive: true });
    expect(await readdir(vault)).toContain('_Templates');
    await writeFile(join(templates, 'custom.md'), '---\nname: 我的自定义模板\ntemplate: true\ntype: note\n---\n# {{title}}\n\n来自自定义模板的正文。\n');
    await writeFile(join(templates, 'preview.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(templates, 'notes.txt'), 'Not a Markdown template');

    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* test model is already configured */ }
    await page.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tablist', { name: 'Vault 视图' }).getByRole('tab', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: '新建页面', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '从模板新建' });
    const select = dialog.getByLabel('模板', { exact: true });
    await expect(select.locator('option[value="custom.md"]')).toHaveText('我的自定义模板');
    await expect(select.locator('option[value="preview.png"], option[value="notes.txt"]')).toHaveCount(0);
    await select.selectOption('custom.md');
    await dialog.getByLabel('页面标题').fill('模板浏览器回归');
    await dialog.getByLabel('目标路径').fill('知识/模板浏览器回归.md');
    await dialog.getByRole('button', { name: '创建 Markdown 页面', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const editor = page.getByLabel('Markdown Live Preview 编辑器');
    await expect(editor).toContainText('来自自定义模板的正文。');
    await expect(editor.getByText('模板', { exact: true })).toHaveCount(0);
    await expect(editor.getByText('名称', { exact: true })).toHaveCount(0);
    const saved = await readFile(join(vault, '知识', '模板浏览器回归.md'), 'utf8');
    expect(saved).toContain('# 模板浏览器回归\n\n来自自定义模板的正文。');
    expect(saved).not.toMatch(/^template:\s*true$/m);
    expect(saved).not.toMatch(/^name:/m);
    expect(errors).toEqual([]);
  } finally {
    await runtime.stop();
  }
});
