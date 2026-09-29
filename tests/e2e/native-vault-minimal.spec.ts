import { test, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

test('minimal assets, local graph and native split panes keep file and conversation context', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await mkdir(join(runtime.root, 'workspace/vault/卡片'), { recursive: true });
    await writeFile(join(runtime.root, 'workspace/vault/卡片/基底.md'), '---\ntype: card\ntags: [math, vector]\n---\n# 基底卡\n\n![[知识/向量.md#anchor=关键联系]]\n\n> 基底给出坐标的语言。\n');
    await writeFile(join(runtime.root, 'workspace/vault/卡片/坐标.md'), '---\ntype: card\nparent: 卡片/基底.md\ntags: [vector]\n---\n# 坐标卡\n\n![[卡片/基底.md#anchor=基底卡]]\n');
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('打开资料'); await input.press('Enter');
    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await expect(page.getByRole('tab', { name: '阅读器', exact: true })).toHaveCount(0);
    await expect(page.getByText('文件事实源', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新建页面', exact: true })).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toBeHidden();
    const expandFiles = page.getByRole('button', { name: '展开文件栏', exact: true });
    if (await expandFiles.count()) await expandFiles.click();
    await page.getByRole('button', { name: /向量\.md/ }).first().click();
    await expect(page.locator('.cm-vault-properties')).toBeVisible();
    await page.getByRole('button', { name: '向量.md', exact: true }).click({ button: 'right' });
    const fileMenu = page.getByRole('menu');
    await expect(fileMenu).toBeVisible();
    await expect(fileMenu.getByRole('menuitem', { name: '将整个文件带入对话', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '新建页面', exact: true }).click();
    await page.getByLabel('页面标题').fill('我的摘录');
    await page.getByLabel('目标路径').fill('卡片/我的摘录.md');
    await page.getByRole('button', { name: '创建 Markdown 页面', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('我的摘录');
    await expect(page.getByRole('button', { name: '带入整个文件', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '带入整个文件', exact: true }).click();
    await expect(page.locator('[data-composer-input]')).toContainText('我的摘录');
    expect(await readFile(join(runtime.root, 'workspace/vault/卡片/我的摘录.md'), 'utf8')).toContain('# 我的摘录');
    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tab', { name: '图谱', exact: true }).click();
    await page.getByRole('button', { name: '图谱节点 向量', exact: true }).click();
    const details = page.getByRole('complementary', { name: '节点详情' });
    await expect(details).toContainText('子卡片 1');
    await page.getByRole('button', { name: '图谱节点 向量', exact: true }).click({ button: 'right' });
    const graphMenu = page.getByRole('menu');
    await expect(graphMenu).toBeVisible();
    await expect(graphMenu.getByRole('menuitem', { name: '以此为中心', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(graphMenu).toHaveCount(0);
    await expect(details).toContainText('子卡片 1');
    await expect(details.getByRole('button', { name: '基底卡', exact: true })).toBeVisible();
    await expect(details.getByText(/向量既可以用代数坐标/)).toHaveCount(0);
    await expect(details.getByRole('button', { name: '继续拆分', exact: true })).toHaveCount(0);
    await details.getByRole('button', { name: '以此为中心', exact: true }).click();
    await expect(page.getByRole('button', { name: '图谱节点 色板.svg', exact: true })).toHaveCount(0);
    await page.getByLabel('关联深度').selectOption('2');
    await expect(page.getByRole('button', { name: '图谱节点 坐标卡', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '标签筛选', exact: true }).click();
    await page.getByLabel('标签 math', { exact: true }).check();
    await expect(page.getByRole('button', { name: '图谱节点 坐标卡', exact: true })).toHaveCount(0);
    const bringTagged = page.getByRole('button', { name: /带入当前筛选的 1 张卡片/ });
    await expect(bringTagged).toBeVisible();
    await bringTagged.click();
    await expect(page.locator('[data-composer-input]')).toContainText('基底卡');
    await expect(page.locator('[data-composer-input]')).toContainText('1 张带有 #math 的卡片');
    await page.getByRole('button', { name: '标签筛选', exact: true }).click();
    await details.getByRole('button', { name: '带入对话拆分', exact: true }).click();
    await expect(page.locator('[data-nv-split]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toContainText('拆分');
    await expect(page.locator('[data-nv-split]')).toContainText('向量');
    await expect(page.locator('[data-composer-input]')).toContainText('基底卡');
    const leftTabs = page.getByRole('tablist', { name: '左侧分页' });
    const rightTabs = page.getByRole('tablist', { name: '右侧分页' });
    const inputHandle = await page.locator('[data-composer-input]').elementHandle();
    const divider = page.getByRole('separator', { name: '调整资料面板宽度' });
    await divider.focus(); await divider.press('ArrowLeft');
    await expect(divider).toHaveAttribute('aria-valuenow', '57');
    await expect(page.locator('[data-nv-split]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('split-chat-graph.png') });
    await page.getByRole('button', { name: '收起资料面板', exact: true }).click();
    await expect(page.locator('[data-nv-split]')).toHaveCount(0);
    await expect(page.locator('[data-composer-input]')).toContainText('拆分');
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
});

test('classroom whiteboard renders and edits a controlled parabola interaction', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    // New writes use `figure`; a board written before 0.17.1 still carries its
    // parabola interaction. Seed exactly such an older board and interaction.
    const trigger = '我们来看这条抛物线';
    await writeFile(join(runtime.root, 'teacher-replies.json'), `${JSON.stringify({ [trigger]: '好，白板上有一张互动图。' })}\n`);
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill(trigger);
    await input.press('Enter');
    await expect(page.getByText('好，白板上有一张互动图。').first()).toBeVisible({ timeout: 30_000 });
    const harness = await connectVault(runtime);
    const sessionId = ((await harness.sessions()) as Array<{ sessionId: string; blank?: boolean }>).find(row => !row.blank)!.sessionId;
    await harness.close();
    const owner = createHash('sha256').update(sessionId).digest('hex').slice(0, 32), interactionId = crypto.randomUUID();
    const scene = JSON.stringify({ type: 'lesson-interaction', session: sessionId, interactionId, provider: 'math', preset: 'parabola', scene: { kind: 'math', preset: 'parabola', viewport: [-5, 5, 5, -5], parameters: { a: 0.8, h: 0, k: 0 }, observation: '' } });
    const vault = join(runtime.root, 'workspace', 'vault');
    await mkdir(join(vault, 'lesson-interaction', owner), { recursive: true });
    await writeFile(join(vault, 'lesson-interaction', owner, `${interactionId}.json`), scene);
    const ref = { provider: 'math', interactionId, revision: createHash('sha256').update(scene).digest('hex').slice(0, 24), preset: 'parabola' };
    await mkdir(join(vault, 'lesson-board'), { recursive: true });
    await writeFile(join(vault, 'lesson-board', `${owner}.md`), `---\ntype: lesson-board\ntitle: 课堂板书\nsession: ${sessionId}\nsourceNotes: {}\n---\n<!-- notara-board ${JSON.stringify({ id: 'legacy-parabola', kind: 'note', x: 60, y: 60, width: 340, interactive: ref })} -->\n## 抛物线的形状\n\n先观察参数变化，再回到板书解释。\n`);
    await page.getByRole('tab', { name: '白板', exact: true }).click();
    await expect(page.locator('[data-interactive-provider="math"]')).toBeVisible();
    await expect(page.locator('[data-interactive-provider="math"]')).toContainText('抛物线的形状');
    // The block sits under its section title; scroll the canvas like a student would.
    const viewport = page.getByLabel('课堂板书画布');
    const box = await viewport.boundingBox();
    if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 260); }
    await page.getByRole('button', { name: '展开互动图 ↗', exact: true }).click();
    await expect(page.locator('.nb-interactive.is-expanded')).toBeVisible();
    const slider = page.locator('.nb-interactive.is-expanded input[type="range"]');
    let finishSave!: () => void;
    const saveGate = new Promise<void>(resolve => { finishSave = resolve; });
    await page.route('**/api/notaraVault/mutateBoardInteraction', async route => { await saveGate; await route.continue(); });
    await slider.fill('1.2');
    await expect(page.locator('.nb-interactive.is-expanded')).toContainText('1.2');
    await page.getByRole('button', { name: '收起', exact: true }).click();
    await expect(page.locator('.nb-interactive.is-expanded')).toBeVisible();
    finishSave();
    await expect(page.locator('.nb-interactive.is-expanded')).toHaveCount(0);
    await page.getByRole('button', { name: '带入对话', exact: true }).click();
    await expect(page.locator('[data-composer-input]')).toContainText('y = 1.2');
    await page.screenshot({ path: testInfo.outputPath('controlled-parabola-board.png') });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
});
