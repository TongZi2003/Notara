import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { VAULT_SOLVER_MODEL, VAULT_SOLVER_PROVIDER, VAULT_SOLVER_REPLY_KEY, VAULT_TEST_PROVIDER } from '../../scripts/fixtures/vault-test-model.ts';
import { connectVault } from '../fixtures/vault-http.ts';

/**
 * The Vault classroom bench, driven the way a teacher drives it: one tab in the
 * same workspace container, two fixed roles (大肥鱼 and 解题者), the 教室设置
 * dialog with its own model route, the background task lane, 查看分析 and 停止.
 *
 * 查看分析 is the one place a full solution is allowed to be read, and it opens
 * the native one-shot child session — never a second chat inside this bench. The
 * default classroom lane shows status only, so the answer marker never appears
 * before the teacher explicitly opens the record.
 *
 * Everything asserted here is learner-visible. The scripted replies live in the
 * run's own data root; this is native wiring, never real teaching quality.
 */
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const bench = (page: Page) => page.getByRole('region', { name: '教室区域', exact: true });
const tablist = (page: Page) => page.getByRole('tablist', { name: '左侧分页' });
/** Marker that exists only inside the solver's后台 answer. */
const ANSWER_MARKER = 'SOLVER-ANALYSIS-Q7';
const SOLVER_REQUEST = '让解题者后台算这道题';
/** The model route the classroom's own preferred model lives on. */
const SOLVER_ROUTE_VALUE = `${VAULT_SOLVER_PROVIDER}\u0000${VAULT_SOLVER_MODEL}`;

async function openVault(page: Page, runtime: VaultRuntime): Promise<void> {
  await page.goto(runtime.authUrl);
  const later = page.getByRole('button', { name: 'Configure later', exact: true });
  try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
  await page.getByText('Notara Vault', { exact: true }).first().click();
  await expect(page.locator('[data-composer-input]')).toBeVisible();
}

function watch(page: Page, errors: string[]): void {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}

function script(runtime: VaultRuntime, replies: Record<string, unknown>): Promise<void> {
  return writeFile(join(runtime.root, 'teacher-replies.json'), `${JSON.stringify(replies, null, 2)}\n`);
}

test('五种工作预设独立保存配置，列表与像素共用真实出题任务', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({ testModel: true, pixelClassroom: true });
  const errors: string[] = [];
  watch(page, errors);
  try {
    await openVault(page, runtime);
    await tab(page, '教室').click();
    await expect(bench(page)).toBeVisible();
    const pixel = page.frameLocator('iframe[title="教室像素视图"]');
    for (const name of ['题目研究员', '课时备课员', '核验员', '通用工作员', '出题员']) {
      await expect(pixel.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(pixel.getByRole('button', { name: '播放', exact: true })).toHaveCount(0);
    await expect(bench(page).getByRole('region', { name: '后台任务', exact: true })).toHaveCount(0);
    await bench(page).getByRole('button', { name: '列表', exact: true }).click();
    for (const name of ['大肥鱼', '题目研究员', '课时备课员', '核验员', '通用工作员', '出题员']) {
      await expect(bench(page).locator('.nv-members').getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeHidden();
    await bench(page).getByRole('button', { name: '教室设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '教室设置' });
    await dialog.getByRole('button', { name: '出题员', exact: true }).click();
    await dialog.getByLabel('后台模型', { exact: true }).selectOption(SOLVER_ROUTE_VALUE);
    await dialog.getByLabel('推理等级', { exact: true }).selectOption('low');
    await dialog.getByLabel('每次分析的生成上限').fill('8192');
    await dialog.getByLabel('资料范围', { exact: true }).selectOption('read');
    // Unsaved drafts also remain separate while switching posts.
    await dialog.getByRole('button', { name: '题目研究员', exact: true }).click();
    await expect(dialog.getByLabel('每次分析的生成上限')).toHaveValue('32768');
    await expect(dialog.getByLabel('资料范围', { exact: true })).toHaveValue('none');
    await dialog.getByRole('button', { name: '出题员', exact: true }).click();
    await expect(dialog.getByLabel('每次分析的生成上限')).toHaveValue('8192');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('已保存，下一次后台分析会用这个模型。').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('worker-settings.png') });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.reload();
    await tab(page, '教室').click();
    await bench(page).getByRole('button', { name: '教室设置', exact: true }).click();
    const restored = page.getByRole('dialog', { name: '教室设置' });
    await restored.getByRole('button', { name: '出题员', exact: true }).click();
    await expect(restored.getByLabel('后台模型', { exact: true })).toHaveValue(SOLVER_ROUTE_VALUE);
    await expect(restored.getByLabel('推理等级', { exact: true })).toHaveValue('low');
    await expect(restored.getByLabel('每次分析的生成上限')).toHaveValue('8192');
    await expect(restored.getByLabel('资料范围', { exact: true })).toHaveValue('read');
    await restored.getByRole('button', { name: '关闭', exact: true }).click();

    const request = '给我准备一道检查向量加法的小测。';
    await script(runtime, { [request]: [{ name: 'ask_worker', arguments: { preset: 'exercise', goal: '准备一道向量加法小测。' } }], '__worker:exercise': { text: ANSWER_MARKER, pauseMs: 12_000 } });
    await tab(page, '对话').click();
    await page.locator('[data-composer-input]').fill(request);
    await page.locator('[data-composer-input]').press('Enter');
    await tab(page, '教室').click();
    await bench(page).getByRole('button', { name: '像素', exact: true }).click();
    await pixel.getByRole('button', { name: '出题员', exact: true }).click();
    await expect(pixel.getByText('独立分析中', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(pixel.locator('body')).not.toContainText(ANSWER_MARKER);
    await expect(pixel.getByText(/分析完成/)).toBeVisible({ timeout: 30_000 });
    await expect(pixel.getByRole('button', { name: '查看分析（含完整解法）', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('worker-pixel-task.png') });
    await pixel.getByRole('button', { name: '题目研究员', exact: true }).click();
    await expect(pixel.getByText('这位工作员还没有后台任务。老师实际派出任务后，会自动出现在这里。')).toBeVisible();
    await expect(pixel.getByRole('button', { name: '查看分析（含完整解法）', exact: true })).toHaveCount(0);
    await bench(page).getByRole('button', { name: '列表', exact: true }).click();
    await expect(bench(page).locator('.nv-task')).toContainText('出题员');
    await expect(bench(page).locator('.nv-task')).toContainText('分析完成');
    await expect(bench(page)).not.toContainText(ANSWER_MARKER);
    // A background refresh must not grant an old draft the newest CAS revision.
    await bench(page).getByRole('button', { name: '教室设置', exact: true }).click();
    const staleDialog = page.getByRole('dialog', { name: '教室设置' });
    await staleDialog.getByRole('button', { name: '出题员', exact: true }).click();
    await staleDialog.getByLabel('每次分析的生成上限').fill('4096');
    const companion = await connectVault(runtime);
    try {
      const teacherRequest = (await companion.requests()).find(row => row.provider === VAULT_TEST_PROVIDER && row.purpose === null);
      expect(teacherRequest?.sessionId).toBeTruthy();
      const session = { sessionId: teacherRequest!.sessionId! };
      const before = companion.value(await companion.rpc<{revision: number}>('notaraVault/classroom', { input: { sessionId: session.sessionId } }));
      companion.value(await companion.rpc('notaraVault/configureSolver', { input: { sessionId: session.sessionId, expectedRevision: before.revision, preset: 'exercise', tools: 'read', route: { provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL, reasoningEffort: 'low', maxTokens: 16384 } } }));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(staleDialog.getByRole('button', { name: '载入最新设置', exact: true })).toBeVisible();
      await staleDialog.getByRole('button', { name: '保存', exact: true }).click();
      await expect(staleDialog.getByRole('alert')).toContainText('已经在别处更新');
      const after = companion.value(await companion.rpc<{ workers: { id: string; route: { maxTokens: number } }[] }>('notaraVault/classroom', { input: { sessionId: session.sessionId } }));
      expect(after.workers.find(row => row.id === 'exercise')?.route.maxTokens).toBe(16384);
      await staleDialog.getByRole('button', { name: '载入最新设置', exact: true }).click();
      await expect(staleDialog.getByLabel('每次分析的生成上限')).toHaveValue('16384');
    } finally { await companion.close(); }
  } finally {
    await writeFile(testInfo.outputPath('console.json'), JSON.stringify(errors));
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await page.screenshot({ path: testInfo.outputPath('final-state.png') });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
});

test('解题默认不内联解答：任务可查看分析并打开原生一次性只读子会话，取消不留迟到结果', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [];
  watch(page, errors);
  try {
    // Complete one task, inspect it, then cancel a second independent task.
    await script(runtime, {
      [SOLVER_REQUEST]: [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 2+3。', focus: '只看结果' } }],
      '__session-title': '大肥鱼课堂验收',
      [VAULT_SOLVER_REPLY_KEY]: `${ANSWER_MARKER}：把两个数量相加，得到 5。`,
    });
    await openVault(page, runtime);
    await page.locator('[data-composer-input]').fill(SOLVER_REQUEST);
    await page.locator('[data-composer-input]').press('Enter');

    // The bench reports the real background task to the teacher while it runs.
    await tab(page, '教室').click();
    await expect(bench(page).getByText('题目研究员 · 分析完成', { exact: true })).toBeVisible({ timeout: 60_000 });
    // The default classroom lane never inlines the answer or the child session.
    await expect(bench(page)).not.toContainText(ANSWER_MARKER);
    // A learner-facing surface shows no session id, tool protocol or schema.
    await expect(bench(page)).not.toContainText(/notaraVault|ask_worker|sessionId|childSessionId/);
    // A running task is already inspectable: the teacher does not have to wait.
    const inspect = bench(page).getByRole('button', { name: '查看分析（含完整解法）', exact: true });
    await expect(inspect).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: testInfo.outputPath('solver-running.png') });

    // 查看分析 opens the native one-shot child session; the full solution lives
    // in that record, and the conversation is read-only there.
    await inspect.click();
    await expect(page.getByText(ANSWER_MARKER, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^(一次性子代理记录|One-shot subagent record)$/)).toBeVisible({ timeout: 30_000 });
    // The native composer chain retains its hidden fallback to preserve drafts.
    await expect(page.locator('[data-composer-input]')).toBeHidden();
    // A child session is not a classroom: 教学设置 and 教室 belong to the parent.
    await expect(page.getByRole('button', { name: '教学设置', exact: true })).toHaveCount(0);
    await expect(tablist(page).getByRole('tab', { name: '教室', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('child-session.png') });

    // 保留 lineage: the native switcher still gets back to the parent classroom.
    await page.getByRole('button', { name: '大肥鱼课堂验收', exact: true }).first().click();
    await expect(tablist(page).getByRole('tab', { name: '教室', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await tab(page, '对话').click();
    await page.getByRole('button', { name: /tool call|工具调用/ }).first().click();
    await expect(page.locator('[data-tool="ask_worker"]').first()).toBeVisible();
    await expect(page.locator('[data-tool="ask_worker"]').first()).not.toContainText(ANSWER_MARKER);
    await expect(page.locator('body')).not.toContainText(ANSWER_MARKER);
    const secondRequest = '再请解题者分析另一道题';
    await script(runtime, { [secondRequest]: [{ name: 'ask_worker', arguments: { preset: 'problem', goal: '求 3+4。' } }], [VAULT_SOLVER_REPLY_KEY]: { text: 'CANCELED-SECRET', pauseMs: 20_000 } });
    await page.locator('[data-composer-input]').fill(secondRequest);
    await page.locator('[data-composer-input]').press('Enter');
    await tab(page, '教室').click();

    // 停止 is the one control the background lane owns; after it the task settles
    // and the child never delivers a late answer.
    const stop = bench(page).getByRole('button', { name: '停止', exact: true });
    await expect(stop).toBeVisible({ timeout: 30_000 });
    await stop.click();
    await expect(bench(page).getByText('已停止这次后台分析。')).toBeVisible({ timeout: 30_000 });
    await expect(bench(page).getByText('题目研究员 · 已停止', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(bench(page)).not.toContainText(ANSWER_MARKER);
    await expect(bench(page).getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('solver-stopped.png') });

    // The stopped record stays openable: the child really ran, it just has no
    // completed analysis handed to the teacher.
    await bench(page).locator('.nv-task').filter({ hasText: '已停止' }).getByRole('button', { name: '查看分析（含完整解法）', exact: true }).click();
    await expect(page.getByText(/^(一次性子代理记录|One-shot subagent record)$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-composer-input]')).toBeHidden();
    await expect(page.getByText(ANSWER_MARKER, { exact: false })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('stopped-record.png') });

    // The visible 教室回复 entry stays a status line and the native composer is
    // still the only editable one after returning to the parent.
    await page.getByRole('button', { name: '大肥鱼课堂验收', exact: true }).first().click();
    await tab(page, '对话').click();
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    if (!await page.locator('[data-tool="ask_worker"]').first().isVisible()) await page.getByRole('button', { name: /tool call|工具调用/ }).first().click();
    await expect(page.locator('[data-tool="ask_worker"]').first()).toBeVisible();
    await expect(page.locator('[data-tool="ask_worker"]').first()).not.toContainText(ANSWER_MARKER);
    await page.screenshot({ path: testInfo.outputPath('solver-entry.png') });
  } finally {
    await writeFile(testInfo.outputPath('console.json'), JSON.stringify(errors));
    await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
    await page.screenshot({ path: testInfo.outputPath('final-state.png') });
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
});
