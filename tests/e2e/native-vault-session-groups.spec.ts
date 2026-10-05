import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

interface FolderState { workspaceId: string; revision: number; groups: { id: string; title: string }[]; members: { sessionId: string; groupId: string }[] }
const composer = (page: Page) => page.locator('[data-composer-input][contenteditable="true"]').last();
const folder = (page: Page, title: string) => page.getByRole('region', { name: `对话分组：${title}`, exact: true });
const row = (page: Page, title: string) => page.locator('.nv-panel .nv-session-row').filter({ has: page.getByText(title, { exact: true }) });
async function enter(page: Page, url: string) {
  await page.goto(url);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await later.waitFor({ timeout: 4000 }); await later.click(); } catch { /* already configured */ }
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
}
async function createFolder(page: Page, title: string) {
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建分组', exact: true });
  await dialog.getByLabel('分组名称').fill(title);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(folder(page, title)).toBeVisible();
}
async function move(page: Page, title: string, groupId: string) {
  await page.getByRole('button', { name: `对话操作：${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: '移动到分组', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '移动到分组', exact: true });
  await dialog.getByLabel('目标分组').selectOption(groupId);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('一层对话分组持久保留，移动与解散保持课堂、草稿、板书和记忆归属', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  let client = await connectVault(runtime);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1500, height: 960 });
  try {
    await mkdir(join(client.vault, '学情'), { recursive: true });
    await client.writeVaultFile('学情/分组验收.md', '---\ntype: learner-profile\n---\n# 合成画像\n\n分组移动必须保留这份合成资料。\n');
    await client.script({ '__session-title': '极限课堂', '开始分组验收': { calls: [{ name: 'write_lesson_board', arguments: { title: '极限板书', section: '入门', body: '分组操作不改板书。' } }], text: '分组验收课堂已开始。' } });
    await enter(page, runtime.authUrl);
    await composer(page).fill('开始分组验收'); await composer(page).press('Enter');
    await expect(page.getByText('分组验收课堂已开始。', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    const main = (await client.sessions()).find(item => item.projections?.values?.title === '极限课堂')!.sessionId;
    const sibling = client.value(await client.rpc<{ sessionId: string }>('session/fork', { request: { sessionId: main } }));
    await client.rename(sibling.sessionId, '函数课堂');
    await expect(row(page, '函数课堂')).toBeVisible();
    const registered = client.value(await client.rpc<{ workspace: { workspaceId: string } }>('workspace/create', { request: { path: client.workspace } }));
    const workspaceId = registered.workspace.workspaceId;
    const state = async () => client.value(await client.rpc<FolderState>('notaraVault/sessionGroups', { input: { workspaceId } }));
    const boardBefore = client.value(await client.rpc('notaraVault/board', { input: { sessionId: main } }));
    const profileBefore = await client.readVaultFile('学情/分组验收.md');
    const registryBefore = await readFile(join(runtime.root, 'home/storages/workspace.json'), 'utf8');
    const turnsBefore = (await client.turns(main)).length;
    await composer(page).fill('分组过程中保留的草稿');
    const inputNode = await composer(page).elementHandle();

    await createFolder(page, '高等数学');
    await expect(folder(page, '高等数学').getByText('暂无对话', { exact: true })).toBeVisible();
    await createFolder(page, '物理');
    const groupId = (await state()).groups.find(group => group.title === '高等数学')!.id;
    await move(page, '极限课堂', groupId); await move(page, '函数课堂', groupId);
    await expect(folder(page, '高等数学').locator('.nv-folder-lessons .nv-session-row')).toHaveCount(2);
    await expect(composer(page)).toHaveText('分组过程中保留的草稿');
    expect(await composer(page).evaluate((element, original) => element === original, inputNode!)).toBe(true);
    expect((await client.turns(main)).length).toBe(turnsBefore);
    expect(await readFile(join(runtime.root, 'home/storages/workspace.json'), 'utf8')).toBe(registryBefore);
    expect(client.value(await client.rpc('notaraVault/board', { input: { sessionId: main } }))).toEqual(boardBefore);
    expect(await client.readVaultFile('学情/分组验收.md')).toBe(profileBefore);

    await folder(page, '高等数学').getByRole('button', { name: '分组：高等数学', exact: true }).click();
    await expect(row(page, '极限课堂')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: '分组：高等数学', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: '分组：高等数学', exact: true }).click();
    await expect(row(page, '极限课堂')).toBeVisible();
    await expect(composer(page)).toHaveText('分组过程中保留的草稿');

    await page.getByRole('button', { name: '分组操作：高等数学', exact: true }).click();
    await page.getByRole('menuitem', { name: '重命名分组', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '重命名分组', exact: true });
    await dialog.getByLabel('分组名称').fill('高等数学练习');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(folder(page, '高等数学练习').locator('.nv-folder-lessons .nv-session-row')).toHaveCount(2);
    await page.getByRole('button', { name: '新建分组', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '新建分组', exact: true });
    await dialog.getByLabel('分组名称').fill('高等数学练习');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('这个分组名称已经存在');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();

    // Restart the actual Host and load its own fresh plugin snapshot.
    await page.goto('about:blank'); await client.close(); await runtime.restart(); client = await connectVault(runtime);
    await enter(page, runtime.authUrl);
    await expect(folder(page, '高等数学练习').locator('.nv-folder-lessons .nv-session-row')).toHaveCount(2);
    expect((await state()).members).toEqual([{ sessionId: main, groupId }, { sessionId: sibling.sessionId, groupId }]);
    // Re-entering Home may create a native blank classroom; compare grouping
    // operations against this settled registry, separately from Host startup.
    const registryAfterRestart = await readFile(join(runtime.root, 'home/storages/workspace.json'), 'utf8');
    await move(page, '函数课堂', '');
    await expect(folder(page, '高等数学练习').locator('.nv-folder-lessons .nv-session-row')).toHaveCount(1);
    await expect(row(page, '函数课堂')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('conversation-folders.png') });
    await page.getByRole('button', { name: '分组操作：高等数学练习', exact: true }).click();
    await page.getByRole('menuitem', { name: '解散分组', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '解散分组', exact: true });
    await dialog.getByRole('button', { name: '解散', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(folder(page, '高等数学练习')).toHaveCount(0);
    await expect(row(page, '极限课堂')).toBeVisible();
    expect((await state()).members).toEqual([]);
    expect(await client.readVaultFile('学情/分组验收.md')).toBe(profileBefore);
    expect(client.value(await client.rpc('notaraVault/board', { input: { sessionId: main } }))).toEqual(boardBefore);
    expect(await readFile(join(runtime.root, 'home/storages/workspace.json'), 'utf8')).toBe(registryAfterRestart);
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await page.close(); await client.close(); await runtime.stop();
  }
});
