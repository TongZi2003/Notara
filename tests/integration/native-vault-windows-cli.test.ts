import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';
// @ts-expect-error The JavaScript parser is shared with the native Vault.
import { parseFrontmatter } from '../../examples/native-vault/frontmatter.js';

type Receipt = { ok: boolean; command: string; result: Record<string, any> };
const revision = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 24);

test.skipIf(process.platform !== 'win32')('Windows teacher CLI writes cards, reviews and routes through the bound native filesystem', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  const host = await connectVault(runtime);
  try {
    const sessionId = await host.createSession();
    let sequence = 0;
    async function cli(command: string, args: Record<string, unknown>, success = true): Promise<Receipt> {
      const prompt = `Windows CLI ${++sequence}: ${command}`;
      const body = JSON.stringify(args).replaceAll("'", "'\\''");
      await host.ask(sessionId, prompt, { [prompt]: [{ name: 'bash', arguments: {
        command: `printf '%s' '${body}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" ${command}`,
        description: `[notara:note-write] ${prompt}`,
      } }] });
      const outcome = (await host.outcomes(sessionId)).filter(row => row.name === 'bash').at(-1)!;
      expect(outcome.failed, outcome.text).toBe(false);
      const line = outcome.text.split('\n').find(text => text.trimStart().startsWith('{"ok":'));
      expect(line, outcome.text).toBeDefined();
      const receipt = JSON.parse(line!) as Receipt;
      expect(receipt.ok, outcome.text).toBe(success);
      expect(receipt.command).toBe(command);
      if (success) expect(outcome.text).not.toMatch(/\[exit code: [1-9]/);
      else expect(outcome.text).toContain('[exit code: 1]');
      return receipt;
    }

    const cardPath = '卡片/Windows 写入回归.md';
    const card = '---\ntype: card\n---\n# 文件写入\n\n学生解释后再评估。\n';
    const batch = await cli('write-batch', { files: [{ op: 'create', path: cardPath, content: card }] });
    expect(batch.result.savedCount).toBe(1);
    expect(await host.readVaultFile(cardPath)).toBe(card);
    const recorded = await cli('record-review', {
      path: cardPath, expectedRevision: revision(card), result: 'unchecked', note: '尚未独立尝试，保留实际证据。',
    });
    expect(recorded.result.sessionId).toBe(sessionId);
    expect(recorded.result.standalone).toBe(false);
    const reviewed = await host.readVaultFile(cardPath);
    expect(reviewed).toContain('review_history:');
    expect(recorded.result.revision).toBe(revision(reviewed));
    await cli('record-review', { path: cardPath, expectedRevision: revision(card), result: 'unchecked', note: '旧版本不能覆盖。' }, false);
    expect(await host.readVaultFile(cardPath)).toBe(reviewed);
    const undone = await cli('undo-review', { path: cardPath, expectedRevision: recorded.result.revision });
    expect(undone.result.revision).toBe(revision(await host.readVaultFile(cardPath)));
    expect(parseFrontmatter(await host.readVaultFile(cardPath)).frontmatter.review_history[0].revertedAt).toBeTruthy();

    const route = await cli('create-route', { title: 'Windows 路线回归', lessons: [{ title: '第一课' }] });
    expect(route.result.standalone).toBe(false);
    const nodeId = route.result.nodes[0].id;
    const revised = await cli('revise-route', {
      path: route.result.path, expectedRevision: route.result.revision,
      reason: '根据合成课堂记录补充本课任务。', updates: [{ nodeId, brief: '## 本课任务\n解释自己的方法。' }],
    });
    expect(await host.readVaultFile(route.result.path)).toContain('解释自己的方法。');
    const scheduled = await cli('schedule-lesson', {
      path: route.result.path, expectedRevision: revised.result.revision, nodeId, date: '2026-10-03',
    });
    const planned = await host.readVaultFile(route.result.path);
    expect(planned).toContain('2026-10-03');
    expect(scheduled.result.revision).toBe(revision(planned));
    await cli('schedule-lesson', { path: route.result.path, expectedRevision: route.result.revision, nodeId, date: null }, false);
    expect(await host.readVaultFile(route.result.path)).toBe(planned);
  } finally { await host.close(); await runtime.stop(); }
}, 120_000);
