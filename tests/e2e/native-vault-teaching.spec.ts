import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
// @ts-expect-error The standalone Vault JS has no declaration; exercise its real formatter instead of duplicating the persisted format in a fixture.
import { upsertLessonSummary } from '../../examples/native-vault/lesson-data.js';

/**
 * The Vault teaching surface: 教学设置 (before the first message, and after a
 * reload), 总结本课, the route bench with its own canvas, and the 锦囊/标签
 * projections. Everything asserted here is a learner-visible fact — no session
 * ids, tool names or file internals may appear in these surfaces.
 */
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const lessonPane = (page: Page) => page.getByRole('complementary', { name: '课程详情' });
const nodePane = (page: Page) => page.getByRole('complementary', { name: '节点详情' });

test('vault teaching keeps settings, routes and 锦囊 facts learner-facing', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime: VaultRuntime = await startVaultIsolated({ testModel: true });
  await testInfo.attach('isolated-runtime', { body: JSON.stringify({ root: runtime.root, workspace: join(runtime.root, 'workspace'), url: new URL(runtime.authUrl).origin, node: process.version }), contentType: 'application/json' });
  const errors: string[] = [];
  const wire: string[] = [];
  page.on('response', response => { if (response.request().method() === 'POST') void response.text().then(body => wire.push(new URL(response.url()).pathname + ' ' + body)).catch(() => {}); });
  page.on('websocket', socket => socket.on('framereceived', event => { const value = String(event.payload); if (/teaching|notara|error/i.test(value)) wire.push(value); }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const vault = join(runtime.root, 'workspace/vault');
  try {
    await unlink(join(vault, '路线/向量路线.md'));
    await mkdir(join(vault, '知识'), { recursive: true });
    await mkdir(join(vault, '卡片'), { recursive: true });
    await mkdir(join(vault, '备课'), { recursive: true });
    await writeFile(join(vault, '知识/向量.md'), '---\ntype: note\ntags: [math, vector]\n---\n# 向量\n\n向量既可以用代数坐标表示，也可以用基底表示。\n');
    await writeFile(join(vault, '卡片/基底.md'), '---\ntype: card\ntags: [math]\n---\n# 基底\n\n![[知识/向量.md#anchor=向量]]\n\n> 基底给出坐标的语言。\n');
    await writeFile(join(vault, '卡片/换元锦囊.md'), '---\ntype: insight\ntags: [vector]\n---\n# 换元锦囊\n\n![[知识/向量.md#anchor=向量]]\n\n## 何时想起\n\n- 题目里出现两个可以互相表示的未知量时\n');
    // A 剧本 embeds material; that pointer is provenance, not a content split.
    await writeFile(join(vault, '备课/第一课.md'), upsertLessonSummary('---\ntype: lesson\ntags: []\n---\n# 第一课\n\n![[知识/向量.md#anchor=向量]]\n\n## 本课重点\n\n- 基底与坐标的互相表示\n',{sessionId:'synthetic-lesson-metadata',body:'这是一条真实存入文件的示例小结。'}));

    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already configured */ }
    await page.getByText('Notara Vault', { exact: true }).first().click();

    // 教学设置 is one icon, usable before the first message in this classroom.
    const settingsButton = page.getByRole('button', { name: '教学设置', exact: true });
    await expect(settingsButton).toBeVisible();
    await expect(page.getByRole('button', { name: '总结本课', exact: true })).toBeVisible();
    await settingsButton.click();
    const dialog = page.getByRole('dialog', { name: '教学设置' });
    await expect(dialog).toBeVisible();
    // 教法 comes from the Host's own catalog, not from a client-side list.
    for (const title of ['苏格拉底', '费曼法', '讲解式', '结构分析']) await expect(dialog.getByRole('radio', { name: new RegExp(title) })).toBeVisible();
    await dialog.getByRole('radio', { name: /费曼法/ }).check();
    await dialog.getByLabel('学习目标').fill('理解条件概率');
    await dialog.getByLabel('每天学习时长').fill('30');
    await dialog.getByLabel('本课临时要求').fill('先让我自己试');
    await dialog.getByLabel('科目').fill('数学');
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByText('已保存，下一次提问就会用上新设置。').first()).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /费曼法/ })).toBeChecked();
    await expect(dialog.getByLabel('学习目标')).toHaveValue('理解条件概率');
    // A learner-facing surface never shows the session, the model or a schema.
    await expect(dialog).not.toContainText(/session|run-|schema|vault_|notaraVault/);
    await page.screenshot({ path: testInfo.outputPath('teaching-settings.png') });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();

    // Reload: the settings are real session state, not a local echo.
    await page.reload();
    await expect(page.getByRole('button', { name: '教学设置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '教学设置', exact: true }).click();
    const restored = page.getByRole('dialog', { name: '教学设置' });
    await expect(restored.getByRole('radio', { name: /费曼法/ })).toBeChecked();
    await expect(restored.getByLabel('学习目标')).toHaveValue('理解条件概率');
    await expect(restored.getByLabel('每天学习时长')).toHaveValue('30');
    await expect(restored.getByLabel('本课临时要求')).toHaveValue('先让我自己试');
    await expect(restored.getByLabel('科目')).toHaveValue('数学');
    await restored.getByLabel('本课临时要求').fill('这条草稿还没有保存');
    await page.reload();
    await page.getByRole('button',{name:'教学设置',exact:true}).click();
    await expect(restored.getByLabel('本课临时要求')).toHaveValue('这条草稿还没有保存');
    // 清空 restores the Host defaults instead of inventing a teaching method.
    await restored.getByRole('button', { name: '清空设置', exact: true }).click();
    await expect(restored.getByRole('radio', { name: /苏格拉底/ })).toBeChecked();
    await expect(restored.getByLabel('学习目标')).toHaveValue('');
    await expect(restored.getByLabel('科目')).toHaveValue('');
    await restored.getByRole('button', { name: '关闭', exact: true }).click();

    // 总结本课 queues the real classroom intent and keeps the native session,
    // so the composer stays live instead of the class being archived away.
    await page.getByRole('button', { name: '总结本课', exact: true }).click();
    await expect(page.getByText('已请老师在本课收尾并总结')).toBeVisible();
    await expect(page.locator('[data-composer-input]').first()).toBeVisible();

    // The route bench is its own tab on the same workspace container.
    await tab(page, '路线').click();
    await expect(page.getByText('还没有学习路线。')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeHidden();
    await page.getByRole('button', { name: '新建路线', exact: true }).first().click();
    const create = page.getByRole('dialog', { name: '新建路线' });
    await create.getByLabel('路线名称').fill('圆锥曲线');
    await create.getByLabel('课程名称').fill('第一课\n第二课\n第三课');
    await create.getByRole('button', { name: '创建路线', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '学习路线' })).toContainText('圆锥曲线');
    await expect(page.getByRole('button', { name: '路线节点 第一课', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '路线节点 第三课', exact: true })).toBeVisible();
    await expect(page.getByText(/3 节课 · 2 段接续/)).toBeVisible();

    // A planned lesson opens the real classroom; a missing 剧本 shows no entry.
    await page.getByRole('button', { name: '路线节点 第二课', exact: true }).click();
    await expect(lessonPane(page)).toContainText('计划课程');
    await expect(lessonPane(page)).toContainText('接续：第一课');
    await expect(lessonPane(page).getByRole('button', { name: '开始这节课', exact: true })).toBeVisible();
    await expect(lessonPane(page).getByRole('button', { name: '查看剧本', exact: true })).toHaveCount(0);
    await expect(lessonPane(page).getByText('这节课还没有小结。')).toBeVisible();
    const routeRegion=page.getByRole('region',{name:'路线区域',exact:true});
    expect(await routeRegion.locator('.nv-graph-layout > .nv-legend').count()).toBe(0);
    expect((await routeRegion.locator('.nv-view-top').boundingBox())!.height).toBeLessThan(100);
    expect(await page.getByRole('button',{name:'路线节点 第一课',exact:true}).evaluate(element=>element.namespaceURI)).toBe('http://www.w3.org/1999/xhtml');
    await page.screenshot({ path: testInfo.outputPath('route-bench.png') });

    // The route is a file fact: a reload rebuilds it from the Host projection.
    await page.reload();
    await tab(page, '路线').click();
    await expect(page.getByRole('button', { name: '路线节点 第二课', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '路线节点 第二课', exact: true }).click();
    await expect(lessonPane(page)).toContainText('接续：第一课');

    // 课序 never becomes a knowledge split: the plan page points at material.
    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '图谱节点 第一课', exact: true }).click();
    await expect(nodePane(page)).toContainText('路线/剧本资料');
    await expect(nodePane(page)).toContainText(/子卡片\s*[:：]?\s*0/);
    await expect(page.locator('.nv-graph-svg [data-edge="reference"]').first()).toBeAttached();
    await nodePane(page).getByRole('button',{name:'打开文件',exact:true}).click();
    const summaryEditor=page.getByRole('region',{name:'资产区域',exact:true}).locator('.cm-content');
    await expect(summaryEditor).toContainText('这是一条真实存入文件的示例小结。');
    await expect(summaryEditor).not.toContainText('synthetic-lesson-metadata');
    await expect(summaryEditor).not.toContainText('notara:lesson-summary');
    await tab(page,'图谱').click();
    await nodePane(page).getByRole('button', { name: '关闭详情', exact: true }).click();

    // 锦囊 is a real card type in the library, and tags aggregate real assets.
    await tab(page, '卡片').click();
    await expect(page.getByText(/2 张卡片 · 1 张锦囊/)).toBeVisible();
    await expect(page.getByRole('button', { name: '打开卡片 换元锦囊', exact: true })).toBeVisible();
    await expect(page.getByRole('region',{name:'卡片区域',exact:true}).getByText('锦囊', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('cards.png') });

    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '标签筛选', exact: true }).click();
    await expect(page.getByRole('button', { name: '展开标签组 math', exact: true })).toHaveText('2 个文件');
    await page.getByRole('button', { name: '展开标签组 math', exact: true }).click();
    await page.getByRole('button', { name: '聚焦 卡片/基底.md', exact: true }).click();
    await expect(nodePane(page)).toContainText('基底');
    await page.getByRole('button', { name: '只看标签组 math', exact: true }).click();
    await expect(page.getByRole('button', { name: '图谱节点 换元锦囊', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '图谱节点 基底', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(page.getByRole('button', { name: '图谱节点 换元锦囊', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('graph-tags.png') });

    // The visible route entry navigates to the real native classroom; opening
    // it again reuses that session, while 再学一次 keeps the old node and class.
    await tab(page,'路线').click();
    await page.getByRole('button',{name:'路线节点 第二课',exact:true}).click();
    await lessonPane(page).getByRole('button',{name:'开始这节课',exact:true}).click();
    await expect(page.getByRole('banner',{name:'当前课程'})).toContainText('第二课');
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    await tab(page,'路线').click();
    await page.getByRole('button',{name:'路线节点 第二课',exact:true}).click();
    await expect(lessonPane(page).getByRole('button',{name:'回到这节课',exact:true})).toBeVisible();
    await lessonPane(page).getByRole('button',{name:'再学一次',exact:true}).click();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    await tab(page,'路线').click();
    await expect(page.getByText(/4 节课 · 3 段接续/)).toBeVisible();

    // The composer is the native conversation's single instance in every bench.
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await tab(page, '对话').click();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
  } finally {
    await writeFile(testInfo.outputPath('console.json'),JSON.stringify(errors));
    await writeFile(testInfo.outputPath('host.log'), runtime.log());
    await writeFile(testInfo.outputPath('wire.json'), JSON.stringify(wire));
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await testInfo.attach('console-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('final-state.png') });
    await runtime.stop();
  }
});
