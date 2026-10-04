import {afterEach, expect, test} from 'vitest';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {startVaultIsolated, type VaultRuntime} from '../../scripts/dev-isolated.ts';
import {connectVault, effectiveSystemText, outcomeJson, toolNames, type VaultHarness, type ToolOutcome} from '../fixtures/vault-http.ts';

let runtime: VaultRuntime | undefined, harness: VaultHarness | undefined;
afterEach(async () => {await harness?.close(); harness = undefined; await runtime?.stop(); runtime = undefined;});
async function call(session: string, name: string, args: Record<string, unknown>, title: string): Promise<ToolOutcome> {
  await harness!.ask(session, title, {[title]: {name, arguments: args}});
  const result = (await harness!.outcomes(session)).filter(row => row.name === name).at(-1);
  if (!result) throw new Error(`missing ${name} result`);
  return result;
}
async function permission(session: string, mode: string) {
  harness!.value(await harness!.rpc('commands/execute', {agentId: session, line: `/permission ${mode}`, submittedAttachments: []}));
}

test('dedicated Vault tools execute without shell, preserve CAS, and honor native approval outcomes', async () => {
  runtime = await startVaultIsolated({testModel: true}); harness = await connectVault(runtime);
  const session = await harness.createSession();
  await permission(session, 'workspace-write');
  const first = await harness.ask(session, '检查新资料入口', {'检查新资料入口': '准备好了。'});
  expect(toolNames(first[0]!)).toEqual(expect.arrayContaining(['vault_read', 'vault_search', 'vault_save', 'vault_command']));
  const saved = await call(session, 'vault_save', {path: '代码/同步.py', content: 'print("sync")\n', expectedRevision: null}, '保存代码');
  expect(saved.failed, saved.text).toBe(false);
  const revision = outcomeJson<{revision: string}>(saved)!.revision;
  const read = await call(session, 'vault_read', {path: '代码/同步.py'}, '读回代码');
  expect(outcomeJson(read)).toMatchObject({revision, content: 'print("sync")\n'});
  const conflict = await call(session, 'vault_save', {path: '代码/同步.py', content: 'lost', expectedRevision: null}, '不能覆盖已有代码');
  expect(conflict.failed).toBe(true);
  expect(await harness.readVaultFile('代码/同步.py')).toBe('print("sync")\n');
  const batch = await call(session, 'vault_command', {command: 'write-batch', input: {files: [{op: 'create', path: '知识/同步.md', content: '# 教学同步\n\n同步检索证据。\n'}]}}, '保存一张资料');
  expect(batch.failed, batch.text).toBe(false);
  expect(outcomeJson(batch)).toMatchObject({savedCount: 1, failedCount: 0});
  const found = await call(session, 'vault_search', {query: '同步检索证据'}, '搜索新资料');
  expect(found.failed, found.text).toBe(false);
  expect(outcomeJson<{hits: {path: string}[]}>(found)?.hits.map(row => row.path)).toContain('知识/同步.md');
  const help = await call(session, 'vault_command', {command: 'command-help', input: {command: 'record-review'}}, '查看复习字段');
  expect(help.failed, help.text).toBe(false);
  const template = await call(session, 'vault_read', {path: '_templates/learner-profile.md'}, '读取学情模板');
  expect(template.failed, template.text).toBe(false);
  expect(outcomeJson<{content: string}>(template)?.content).toContain('当前判断');
  const page = await call(session, 'vault_command', {command: 'pdf-page', input: {path: '媒体/向量讲义.pdf', page: 2}}, '直接读讲义原页');
  expect(page.failed, page.text).toBe(false);
  expect(outcomeJson(page)).toMatchObject({page: 2, imageAvailable: true});
  expect(page.text).not.toContain('imageData');
  const pageRequest = (await harness.turns(session)).at(-1)!;
  const images = pageRequest.messages.flatMap(message=>message.content).filter(block=>block.type==='image');
  expect(images.length).toBeGreaterThan(0);
  expect(images.at(-1)?.attachment?.attachmentId).toBeTruthy();
  await runtime.restart();
  harness = await connectVault(runtime);
  const [restored] = await harness.ask(session,'重启后保留原页',{'重启后保留原页':'继续。'});
  expect(restored!.messages.flatMap(message=>message.content).filter(block=>block.type==='image').at(-1)?.attachment?.attachmentId).toBe(images.at(-1)?.attachment?.attachmentId);
  const forged = await call(session, 'vault_command', {command: 'write-batch', input: {root: 'elsewhere', files: []}}, '拒绝资料根覆盖');
  expect(forged.failed).toBe(true);
  for (const path of ['lesson-board/fake.md', '技能/direct.md', '_templates/overwrite.md']) {
    const blocked = await call(session, 'vault_save', {path, content: '# nope', expectedRevision: null}, `禁止绕过专用入口 ${path}`);
    expect(blocked.failed, path).toBe(true);
    expect(await harness.vaultExists(path)).toBe(false);
  }
  await permission(session, 'read-only');
  harness.approvals.auto('rejected');
  const denied = await call(session, 'vault_save', {path: '知识/拒绝.md', content: '# 禁止', expectedRevision: null}, '拒绝保存');
  expect(denied.failed).toBe(true);
  expect(await harness.vaultExists('知识/拒绝.md')).toBe(false);
  harness.approvals.auto('allowed-once');
  const approved = await call(session, 'vault_save', {path: '知识/一次批准.md', content: '# 一次批准', expectedRevision: null}, '只批准这次保存');
  expect(approved.failed, approved.text).toBe(false);
  expect(await harness.readVaultFile('知识/一次批准.md')).toBe('# 一次批准');
  expect((await harness.outcomes(session)).some(row => row.name === 'bash')).toBe(false);
}, 300_000);

test('learner profile snapshot stays in appended context and later profile edits preserve system and tools', async () => {
  runtime = await startVaultIsolated({testModel: true}); harness = await connectVault(runtime);
  await mkdir(join(harness.vault, '学情'), {recursive: true});
  await harness.writeVaultFile('学情/同步画像.md', '---\ntype: learner-profile\ntitle: 同步画像\n---\n## 观察\nPROFILE_INITIAL_EVIDENCE\n## 教学偏好\n先画图\n');
  const session = await harness.createSession();
  const [first] = await harness.ask(session, '开始学情测试', {'开始学情测试': '开始。'});
  expect(JSON.stringify(first?.messages)).toContain('PROFILE_INITIAL_EVIDENCE');
  expect(effectiveSystemText(first!)).not.toContain('PROFILE_INITIAL_EVIDENCE');
  await harness.writeVaultFile('学情/同步画像.md', '---\ntype: learner-profile\ntitle: 同步画像\n---\n## 观察\nPROFILE_NEW_EVIDENCE\n');
  const [next] = await harness.ask(session, '画像更新后续课', {'画像更新后续课': '继续。'});
  expect(effectiveSystemText(next!)).toBe(effectiveSystemText(first!));
  expect(next?.toolSchemas).toEqual(first?.toolSchemas);
  expect(JSON.stringify(next?.messages)).toContain('notara:profile-changed');
  expect(JSON.stringify(next?.messages)).toContain('PROFILE_INITIAL_EVIDENCE');
  expect(effectiveSystemText(next!)).not.toContain('PROFILE_NEW_EVIDENCE');
}, 300_000);
