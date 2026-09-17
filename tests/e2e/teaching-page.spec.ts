import type { TeachingResource } from '@studyforge/contracts/teaching';
import { test, expect, enterClassroom } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

function value<T>(reply: { ok: boolean; value?: T; error?: unknown }): T {
  if (!reply.ok || reply.value === undefined) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}

test('the teaching page lists every bundled file, edits it as a workspace override, and restores the default', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await enterClassroom(page, classroom.authUrl);
    const sidebar = page.getByTestId('notebook-sidebar');
    await sidebar.getByRole('button', { name: '教法', exact: true }).click();
    const panel = page.getByTestId('studyforge-teaching-page');
    await expect(panel).toBeVisible();

    // The tree groups every real teaching file: base, guided, presets, skills, assistants.
    const tree = panel.locator('.sf-teaching-tree');
    for (const group of ['共同规则', '诊断与路线引导', '教学预设', '任务技能', '委派角色']) await expect(tree.getByRole('heading', { name: new RegExp(group) })).toBeVisible();
    for (const name of ['苏格拉底授课', '整理成讲义', '蒸馏学习方法', '检索帮手', '同伴']) await expect(tree.getByRole('button', { name: new RegExp(name) })).toBeVisible();

    // Reading a node shows its full effective body, not a summary.
    await tree.getByRole('button', { name: /苏格拉底授课/ }).click();
    const editor = panel.getByTestId('teaching-editor');
    await expect(editor).toBeVisible();
    const bundled = await editor.inputValue();
    expect(bundled).toContain('# 苏格拉底授课');

    // Editing writes a workspace override; the tree marks it and the store agrees.
    await editor.fill(bundled + '\n\n[page-marker] 学生补的一句约定。');
    await panel.getByTestId('teaching-save').click();
    await expect(panel.getByTestId('teaching-notice')).toContainText('已保存');
    await expect(tree.getByRole('button', { name: /苏格拉底授课/ }).locator('em')).toContainText('已修改');
    const stored = value(await client.rpc<TeachingResource>('studyforgeTeaching/resource', { input: { nodeId: 'preset/socratic' } }));
    expect(stored.overridden).toBe(true); expect(stored.body).toContain('page-marker'); expect(stored.version).toBe(1);
    await page.screenshot({ path: info.outputPath('teaching-edited.png') });

    // The bundled baseline stays readable next to the override.
    await panel.getByRole('button', { name: '对照内置原文' }).click();
    await expect(panel.getByTestId('teaching-bundled')).toContainText('# 苏格拉底授课');
    await expect(panel.getByTestId('teaching-bundled')).not.toContainText('page-marker');

    // Restore writes the bundled body back; the marker clears and the version moves on.
    await panel.getByTestId('teaching-reset').click();
    await expect(panel.getByTestId('teaching-notice')).toContainText('已恢复内置版本');
    await expect(tree.getByRole('button', { name: /苏格拉底授课/ }).locator('em')).toHaveCount(0);
    const restored = value(await client.rpc<TeachingResource>('studyforgeTeaching/resource', { input: { nodeId: 'preset/socratic' } }));
    expect(restored.overridden).toBe(false); expect(restored.body).toBe(bundled); expect(restored.version).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('browser-console', { body: errors.join('\n'), contentType: 'text/plain' });
  }
});
