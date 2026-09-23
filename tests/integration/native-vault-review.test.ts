import { expect, test } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';
// @ts-expect-error Exercise the standalone Vault's real parser, not a second format.
import { parseFrontmatter } from '../../examples/native-vault/frontmatter.js';

test('native teacher loads the assessment Skill and writes scoped ability evidence through Bash', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  let harness: VaultHarness | undefined;
  try {
    harness = await connectVault(runtime);
    const sessionId = await harness.createSession();
    await mkdir(join(harness.vault, '卡片'), { recursive: true });
    await harness.writeVaultFile('卡片/选法.md', '---\ntype: card\n---\n# 选法\n\n## 学生理解\n老师提到极点极线，学生说明为什么不适用。\n');
    interface Queue { hits: {path: string; revision: string}[] }
    const queue = harness.value(await harness.rpc<Queue>('notaraVault/reviewQueue', { input: {sessionId, status:'all'} }));
    const target = queue.hits.find(item => item.path === '卡片/选法.md')!;
    const payload = { path: target.path, expectedRevision: target.revision,
      assessments: [{ability:'判断极点极线是否适用', outcome:'demonstrated'}, {ability:'未经提醒主动唤起方法', outcome:'not_observed'}],
      note:'老师只提出候选方法；学生指出缺少对称结构并提出参数方程，自主唤起尚未观察。' };
    // This copied synthetic environment intentionally exercises native full
    // access, not an extra teaching-layer permission bypass.
    harness.value(await harness.rpc('commands/execute', { agentId:sessionId, line:'/permission danger-full-access', submittedAttachments:[] }));
    const command = `"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" record-review <<'NOTARA_REVIEW_JSON'\n${JSON.stringify(payload)}\nNOTARA_REVIEW_JSON`;
    const message = '/notara-method-distillation\n记录刚才的具体能力观察。';
    const turns = await harness.ask(sessionId, message, { [message]: [{name:'bash', arguments:{command, description:'[notara:review-record] 记录这次能力观察'}}] });
    const firstRequest = JSON.stringify(turns[0]);
    const skill = await readFile(new URL('../../resources/vault-teaching/skills/method-distillation.md', import.meta.url), 'utf8');
    expect(turns[0]!.messages.flatMap(row=>row.content).map(block=>block.text??'').join('\n')).toContain(skill);
    expect(firstRequest).toContain('notara-method-distillation');
    const outcome = (await harness.outcomes(sessionId)).find(row=>row.name==='bash');
    expect(outcome?.failed).toBe(false);
    expect(outcome?.text).toContain('"scheduleChanged":false');
    const saved = parseFrontmatter(await harness.readVaultFile(target.path)).frontmatter;
    expect(saved.learned).toBe(false);
    expect(saved.review_history).toHaveLength(1);
    expect(saved.review_history[0]).toMatchObject({assessments:payload.assessments, note:payload.note, actor:'teacher', sessionId});
    expect(saved.review_history[0].id).toBeTruthy();
    expect(saved.review_history[0].at).toBeTruthy();
  } finally {
    await harness?.close();
    await runtime.stop();
  }
}, 120_000);
