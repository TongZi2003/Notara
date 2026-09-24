import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom } from './fixtures/classroom.ts';

const test = base.extend<{ vault: IsolatedRuntime }>({
  vault: async ({}, use, testInfo) => {
    const runtime = await startIsolated();
    try {
      await mkdir(join(runtime.root, 'classroom/vault/资料'), { recursive: true });
      await writeFile(join(runtime.root, 'classroom/vault/资料/向量.md'), '---\ntype: card\ntags: [数学]\nlearned: false\n---\n# 向量\n\n向量可以用坐标表示。\n');
      await writeFile(join(runtime.root, 'classroom/vault/路线.md'), '# 路线\n\n下一课读 [[资料/向量]]。\n');
      const client = await connectRuntime(runtime);
      const created = await client.rpc<{ sessionId: string }>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } });
      if (!created.ok) throw new Error('vault fixture session failed');
      await use(runtime);
    } finally {
      await runtime.stop();
      await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
      await expect(access(runtime.root)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  },
});

async function settle(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    try { await button.waitFor({ state: 'visible', timeout: 3_000 }); await button.click(); } catch { /* isolated boot may already be settled */ }
  }
}

test('native vault panel browses, searches, edits, links and references Markdown assets', async ({ page, vault }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterClassroom(page, vault.authUrl); await settle(page);
  await expect(page.getByTestId('learning-workspace')).toBeVisible();
  await page.getByTestId('workspace-open-vault').click();
  const panel = page.getByTestId('vault-panel'); await expect(panel).toBeVisible();
  await expect(panel.getByTestId('vault-tree').locator('[data-path="资料/向量.md"]')).toBeVisible();
  await panel.getByTestId('vault-tree').locator('[data-path="资料/向量.md"]').click();
  await expect(panel.getByTestId('vault-document')).toContainText('向量');
  await expect(panel.getByTestId('vault-frontmatter')).toContainText('type');
  await expect(panel.getByTestId('vault-backlinks')).toContainText('路线.md');
  await panel.getByLabel('搜索资产').fill('坐标');
  await expect(panel.getByTestId('vault-tree').locator('[data-path="资料/向量.md"]')).toBeVisible();
  await panel.getByTestId('vault-tree').locator('[data-path="资料/向量.md"]').click();
  const editor = panel.getByLabel('编辑 Markdown');
  await editor.fill('---\ntype: card\ntags: [数学]\nlearned: true\n---\n# 向量\n\n向量可以用坐标表示。\n\n已完成一次整理。\n');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel).toContainText('已保存');
  await page.reload(); await settle(page); await page.getByTestId('workspace-open-vault').click();
  await page.getByTestId('vault-tree').locator('[data-path="资料/向量.md"]').click();
  await expect(page.getByLabel('编辑 Markdown')).toHaveValue(/已完成一次整理。/);
  const localDraft = '---\ntype: card\ntags: [数学]\nlearned: true\n---\n# 向量\n\n本地草稿。\n';
  await page.getByLabel('编辑 Markdown').fill(localDraft);
  await writeFile(join(vault.root, 'classroom/vault/资料/向量.md'), '---\ntype: card\ntags: [数学]\nlearned: false\n---\n# 向量\n\n外部新版本。\n');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel).toContainText('文件已变化，请刷新后再保存。');
  await expect(page.getByLabel('编辑 Markdown')).toHaveValue(localDraft);
  await page.reload(); await settle(page); await page.getByTestId('workspace-open-vault').click();
  await page.getByTestId('vault-tree').locator('[data-path="资料/向量.md"]').click();
  await page.getByRole('button', { name: '带入对话', exact: true }).click();
  await expect(page.locator('[data-composer-chip="notara-vault"]')).toContainText('向量');
  expect(errors).toEqual([]);
});
