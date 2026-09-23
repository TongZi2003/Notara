import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, skillNames, type VaultHarness } from '../fixtures/vault-http.ts';

test('search, teacher reflection and learning review load through native Skill invocation on demand', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  let harness: VaultHarness | undefined;
  try {
    harness = await connectVault(runtime);
    const ids = ['material-search', 'teaching-reflection', 'learning-review'];
    const bodies = await Promise.all(ids.map(id => readFile(new URL(`../../resources/vault-teaching/skills/${id}.md`, import.meta.url), 'utf8')));
    for (const [index, id] of ids.entries()) {
      const session = await harness.createSession();
      const prompt = `/notara-${id}\n请按这个功能处理当前提供的材料。`;
      const [request] = await harness.ask(session, prompt, { [prompt]: '已收到本次材料。' });
      expect(skillNames(request!)).toEqual(expect.arrayContaining(ids.map(name => `notara-${name}`)));
      const content = request!.messages.flatMap(row => row.content).map(block => block.text ?? '').join('\n');
      expect(content).toContain(`<skill_content name="notara-${id}">`);
      expect(content).toContain(bodies[index]);
      for (const [other, body] of bodies.entries()) if (other !== index) expect(content).not.toContain(body);
    }
    const ordinary = await harness.createSession('standard');
    const [request] = await harness.ask(ordinary, '普通助手检查', { '普通助手检查': '已收到。' });
    expect(skillNames(request!).filter(name => name.startsWith('notara-'))).toEqual([]);
  } finally {
    await harness?.close();
    await runtime.stop();
  }
}, 120_000);
