import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

test('the command button discovers teaching Skills and picks through the native invocation without sending the draft', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  let harness: VaultHarness | undefined;
  const errors: string[] = [];
  const wire: string[] = [];
  page.on('requestfailed', request => wire.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) wire.push(`${new URL(response.url()).pathname}: ${response.status()}`); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    harness = await connectVault(runtime);
    await page.goto(runtime.authUrl);
    await page.getByText('Notara Vault', { exact: true }).first().click();
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.fill('请帮我回顾这道错题的理解变化');
    const session = (await harness.sessions())[0]!.sessionId;
    expect(await harness.turns(session)).toHaveLength(0);
    await page.getByRole('button', { name: /^(指令|Commands)$/ }).click();
    const menu = page.locator('[data-trigger-menu]');
    const manifest = JSON.parse(await readFile(new URL('../../resources/vault-teaching/manifest.json', import.meta.url), 'utf8'));
    for (const row of [...manifest.choices, ...manifest.skills]) {
      const title = row.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(menu.getByRole('option', { name: new RegExp('^' + title) })).toHaveCount(row.menu === 'more' ? 0 : 1);
    }
    await page.screenshot({ path: testInfo.outputPath('command-skills.png') });
    await menu.getByRole('option', { name: /^更多技能/ }).click();
    for (const row of [...manifest.choices, ...manifest.skills]) {
      const title = row.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(menu.getByRole('option', { name: new RegExp('^' + title) })).toHaveCount(1);
    }
    await expect(composer).toHaveText('请帮我回顾这道错题的理解变化');
    expect(await harness.turns(session)).toHaveLength(0);
    await menu.getByRole('option', { name: /^收起更多技能/ }).click();
    await expect(menu.getByRole('option', { name: /^数学关注/ })).toHaveCount(0);
    await menu.getByRole('option', { name: /^更多技能/ }).hover();
    await composer.press('Enter');
    await expect(menu.getByRole('option', { name: /^数学关注/ })).toHaveCount(1);
    await expect(composer).toHaveText('请帮我回顾这道错题的理解变化');
    await menu.getByRole('option', { name: /^收起更多技能/ }).click();
    await menu.getByRole('option', { name: /^学习经历与方法整理/ }).click();
    await expect(composer).toContainText('请帮我回顾这道错题的理解变化');
    await expect(composer).toContainText('/notara-method-distillation');
    expect(await harness.turns(session)).toHaveLength(0);
    await page.getByRole('button', { name: /^(发送消息|Send message)$/ }).click();
    await harness.waitForTurn(session, 0);
    const turn = (await harness.turns(session)).at(-1)!;
    const text = turn.messages.flatMap(message => message.content).map(block => block.text ?? '').join('\n');
    expect(text).toContain('<skill_content name="notara-method-distillation">');
    expect(text).toContain(await readFile(new URL('../../resources/vault-teaching/skills/method-distillation.md', import.meta.url), 'utf8'));
    expect(text).toContain('请帮我回顾这道错题的理解变化');

    await composer.fill('/认知');
    await expect(menu.getByRole('option', { name: /^学习经历与方法整理/ })).toBeVisible();
    const before = (await harness.turns(session)).length;
    await composer.press('Enter');
    await expect(composer).toContainText('/notara-method-distillation');
    expect(await harness.turns(session)).toHaveLength(before);
    await composer.fill('/notara-subject-computing');
    await expect(menu.getByRole('option', { name: /^计算机关注/ })).toBeVisible();
    await composer.fill('/数学');
    await expect(menu.getByRole('option', { name: /^数学关注/ })).toBeVisible();
    await composer.press('Escape');
    await composer.fill('');

    const plain = await harness.createSession('standard');
    // Native sidebar hides non-selected blank sessions even after a rename.
    await harness.ask(plain, '普通助手菜单检查');
    await harness.rename(plain, '普通助手菜单检查');
    await page.reload();
    // RPC-created sessions are not added to the UI's workspace membership.
    await page.getByRole('treeitem', { name: /^(未分组|Ungrouped)$/ }).click();
    await page.getByText('普通助手菜单检查', { exact: true }).click();
    await page.getByRole('button', { name: /^(指令|Commands)$/ }).click();
    await expect(menu.getByRole('option').first()).toBeVisible();
    await expect(menu.getByRole('status')).toHaveCount(0);
    await expect(menu.getByRole('option', { name: /^更多技能/ })).toHaveCount(0);
    for (const row of [...manifest.choices, ...manifest.skills]) {
      const title = row.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(menu.getByRole('option', { name: new RegExp('^' + title) })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('browser-diagnostics', { body: JSON.stringify({ errors, wire, sessions: await harness?.sessions() }), contentType: 'application/json' });
    await testInfo.attach('isolated-runtime-log', { body: runtime.log(), contentType: 'text/plain' });
    await harness?.close();
    await runtime.stop();
  }
});
