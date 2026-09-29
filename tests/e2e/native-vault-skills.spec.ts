import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

/**
 * The two skill tiers from the student's side: drafts the teacher wrote wait in
 * the 技能 page in the rail; only after the student turns one on does the teacher's command
 * menu offer it (titled from the skill itself). A revision of an active skill is
 * reviewed as a line diff and replaces the live text only when adopted.
 */
const skill = (id: string, title: string, body: string, extra = '') =>
  `---\ntype: skill\nid: ${id}\ntitle: ${title}\ndescription: ${title}：本测试用的说明。\nstatus: draft\n${extra}---\n${body}\n`;

test('the student reviews, enables and revises teacher-written skills on the 技能 page', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    const setRoot = join(runtime.root, 'workspace', 'vault', '技能'), globalRoot = join(runtime.root, 'home', 'notara-skills');
    await mkdir(setRoot, { recursive: true }); await mkdir(globalRoot, { recursive: true });
    await writeFile(join(setRoot, 'conic-points.md'), skill('conic-points', '解析几何要点', '# 解析几何要点\n\n## 要点\n\n- 圆都过同一定点时，可以考虑反演。', 'tags: [解析几何]\n'));
    await writeFile(join(globalRoot, 'analog-circuits.md'), skill('analog-circuits', '模拟电子技术', '# 模拟电子技术\n\n## 主线\n\n先定工作点，再谈小信号。'));
    await mkdir(join(runtime.root, 'workspace', 'vault', '锦囊'), { recursive: true });
    await writeFile(join(runtime.root, 'workspace', 'vault', '锦囊', '反演.md'), '---\ntype: insight\ntitle: 反演处理过定点的圆\ntags: [解析几何]\n---\n# 反演\n\n## 何时想起\n\n- 多个圆都过同一定点时\n');

    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    await expect(page.locator('.nv-home')).toBeVisible();

    // Drafts are not offered to the teacher.
    const openMenu = async () => {
      await page.getByRole('button', { name: /^(指令|Commands|Add files or run commands|添加文件或调用指令)$/ }).last().click();
      return page.locator('[data-trigger-menu]');
    };
    let menu = await openMenu();
    await expect(menu.getByRole('option', { name: /^调研/ })).toHaveCount(1);
    await expect(menu.getByRole('option', { name: /^解析几何要点/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 技能 in the rail: both tiers listed as drafts; read, then enable.
    const rail = page.getByRole('navigation', { name: '学习导航' });
    const list = page.getByRole('group', { name: '技能列表' }), view = page.locator('.nv-skill-page');
    const openSkills = async () => {
      await rail.getByRole('button', { name: '首页', exact: true }).click();
      await rail.getByRole('button', { name: '技能', exact: true }).click();
      await expect(list).toBeVisible();
    };
    const row = (name: string) => list.getByRole('button', { name: new RegExp(name) });
    await openSkills();
    await expect(row('解析几何要点')).toContainText('草稿');
    await expect(row('模拟电子技术')).toContainText('草稿');
    await row('解析几何要点').click();
    await expect(view.getByRole('heading', { name: '解析几何要点' })).toBeVisible();
    await expect(view.locator('pre')).toContainText('可以考虑反演');
    await view.getByRole('button', { name: '启用', exact: true }).click();
    await expect(row('解析几何要点')).toContainText('启用中');
    await row('模拟电子技术').click();
    await view.getByRole('button', { name: '启用', exact: true }).click();
    await expect(row('模拟电子技术')).toContainText('启用中');
    await expect.poll(async () => readFile(join(setRoot, 'conic-points.md'), 'utf8')).toMatch(/^status: active$/m);
    await page.screenshot({ path: testInfo.outputPath('skills-enabled.png') });

    // Built-in teaching skills are listed read-only.
    const builtin = list.getByRole('region', { name: '内置 · 随包的教学技能' });
    await builtin.getByRole('button', { name: '板书', exact: true }).click();
    await expect(view.getByRole('heading', { name: '板书' })).toBeVisible();
    await expect(view.getByText('这里只能查看')).toBeVisible();
    await expect(view.getByRole('button', { name: /^(启用|停用)$/ })).toHaveCount(0);

    // The teacher's menu now offers both, titled from the skills themselves.
    await rail.getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.locator('.nv-home')).toBeVisible();
    menu = await openMenu();
    await expect(menu.getByRole('option', { name: /^解析几何要点/ })).toHaveCount(1);
    await expect(menu.getByRole('option', { name: /^模拟电子技术/ })).toHaveCount(1);
    await page.keyboard.press('Escape');

    // A revision the teacher proposed waits for the student and is shown as a diff.
    const live = await readFile(join(setRoot, 'conic-points.md'), 'utf8');
    await writeFile(join(setRoot, 'conic-points.revision.md'), live.replace('status: active', 'status: draft\nrevises: conic-points').replace('可以考虑反演。', '可以考虑反演；圆心共线时优先用根轴。'));
    await openSkills();
    await expect(row('解析几何要点')).toContainText('启用中 · 有待确认修订');
    await row('解析几何要点').click();
    await view.getByRole('button', { name: '查看修订' }).click();
    const diff = view.getByRole('group', { name: '解析几何要点的修订' });
    await expect(diff.locator('[data-type=add]')).toContainText('根轴');
    await expect(diff.locator('[data-type=del]')).toContainText('可以考虑反演。');
    await page.screenshot({ path: testInfo.outputPath('skills-revision.png') });
    await view.getByRole('button', { name: '采用修订' }).click();
    await expect(row('解析几何要点')).not.toContainText('有待确认修订');
    const adopted = await readFile(join(setRoot, 'conic-points.md'), 'utf8');
    expect(adopted).toContain('根轴');
    expect(adopted).toMatch(/^status: active$/m);
    expect(adopted).not.toMatch(/^revises:/m);

    // The learning-set overview: created from the page as a draft with placeholders,
    // which cannot be turned on until its required facts are filled in.
    await row('学习集梗概').click();
    await expect(row('学习集梗概')).toContainText('未创建');
    await view.getByRole('button', { name: '创建学习集梗概' }).click();
    await expect(row('学习集梗概')).toContainText('草稿 · 待补全');
    await expect(view.getByRole('button', { name: '启用', exact: true })).toBeDisabled();
    const skeleton = await readFile(join(setRoot, 'learning-set.md'), 'utf8');
    await writeFile(join(setRoot, 'learning-set.md'), skeleton.replace('subjects: [待填写]', 'subjects: [数学]').replace('coverage: 待填写', 'coverage: 高中解析几何')
      .replace('level: 待填写', 'level: 高二').replace('goal: 待填写', 'goal: 期末 120 分').replace('deadline: 待填写', 'deadline: 2027-01'));
    await openSkills();
    await row('学习集梗概').click();
    await expect(view).toContainText('科目：数学 · 学什么：高中解析几何 · 学段或水平：高二 · 目标：期末 120 分 · 期限：2027-01');
    await view.getByRole('button', { name: '启用', exact: true }).click();
    await expect(row('学习集梗概')).toContainText('启用中');
    await page.screenshot({ path: testInfo.outputPath('skills-overview.png') });
    // Settings no longer carries a 技能 section.
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await expect(page.getByText('学习界面', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('dialog').getByText('技能', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
