/**
 * Teaching memory loading over the real HTTP Host — no browser, no real model.
 *
 * The contract under test is the migration one (docs/migration/2026-09-21-teaching-memory-loading.md):
 * L0 only discloses *entries* and never injects insight or profile bodies. The
 * main classroom has no native text-file rows, so the teacher reaches candidates
 * by native Bash (`ls`, `grep`, `sed`) and saves through the bundled command line
 * (`write-batch`), whose `edit` re-reads the real file and writes back through the
 * Vault's own revision check. Nothing here may fall back to `read`/`write`/
 * `edit`/`glob`/`grep`, to a retired classroom tool (`learning_find` /
 * `learning_read`) or to a `write-batch` model tool — it is a command, not a row.
 *
 * Cross-set reading stays a real behaviour: an explicitly registered second
 * learning set is reachable by its real absolute path, while merely registering
 * it never silently injects its memory into this lesson. Candidate ordering is
 * not a product promise, so no assertion fixes search result order.
 *
 * The two model turns that need no tool call and the `/compact` command still
 * run against the same scripted synthetic adapter the rest of the lane uses.
 */
import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, effectiveSystemText, toolNames } from '../fixtures/vault-http.ts';

/** The Vault's own content revision: sha256 of the Markdown text, first 24 hex. */
const revisionOf = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 24);
/** The JSON payload a command printed: its own last well-formed JSON line. */
function commandJson<T extends { ok?: unknown }>(text: string): T {
  for (const line of text.split('\n').reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as T;
      if (parsed !== null && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    } catch { /* the echoed command is not the result line */ }
  }
  throw new Error(`no JSON result line in tool output: ${text.slice(0, 200)}`);
}
/** The exact Bash line the teacher runs for one `write-batch` payload. */
const batchCommand = (files: unknown[]): string => `printf '%s' '${JSON.stringify({ files })}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" write-batch`;
interface BatchPayload { ok?: boolean; command?: string; result?: { results: { path: string; op: string; saved: boolean; revision?: string; error?: { code: string; message: string; next: string } }[]; savedCount: number; failedCount: number } }

test('教学记忆：L0 只给入口，Bash 的 ls/grep/sed 逐步读正文，写入走命令行且跨集可核对', async () => {
  const runtime = await startVaultIsolated({ testModel: true }), host = await connectVault(runtime);
  const started = performance.now();
  try {
    await mkdir(join(host.vault, '锦囊'), { recursive: true });
    await mkdir(join(host.vault, '学情'), { recursive: true });
    const insight = '---\ntype: insight\ntags: [geometry]\n---\n# 两种表示的比较\n\n## 何时想起\n遇到两个动点，没有明显对称结构，先比较表示。\n\n## 经历与反例\n原题001：曾优先试极点极线，但条件不能支持；学生改用参数方程。不要因为这次成功就断言总是适用。\n\n## 教法\n先让学生说明选路理由。\n';
    await host.writeVaultFile('锦囊/选路.md', insight);
    await host.writeVaultFile('学情/表示.md', '---\ntype: learner-profile\n---\n# 表示偏好\n## 何时想起\n两个动点的问题，注意他会先选解析表示。\n## 观察\n只依据原题001的实际尝试，不推断一般水平。\n');
    // 第二集先只注册，不参与本课装配。
    const foreign = join(runtime.root, 'second-workspace');
    const foreignInsight = join(foreign, 'vault/锦囊/类比.md');
    await mkdir(join(foreign, 'vault/锦囊'), { recursive: true });
    await writeFile(foreignInsight, insight.replace('原题001', '原题002'));
    host.value(await host.rpc('workspace/create', { request: { path: foreign } }));

    const session = await host.createSession();

    // 第一轮：L0 只给入口，正文和候选都在模型自己手里。
    const [initial] = await host.ask(session, '先看看这道题的结构。', { '先看看这道题的结构。': [{ name: 'bash', arguments: { command: 'ls -1 vault/锦囊/*.md', description: '[notara:memory-read] 列出锦囊候选' } }] });
    const initialWire = JSON.stringify(initial);
    expect(initialWire).not.toContain('原题001：曾优先试');
    expect(initialWire).not.toContain('原题002：曾优先试');
    // Verify the assembled tool surface, not a particular prompt sentence: the
    // teacher reads and searches with Bash, and has no native text-file rows.
    const teacherTools = toolNames(initial!);
    expect(teacherTools).toContain('bash');
    for (const hidden of ['read', 'write', 'edit', 'glob', 'grep']) expect(teacherTools, `主课堂仍挂着原生文本工具 ${hidden}`).not.toContain(hidden);
    const candidates = (await host.outcomes(session)).find(row => row.name === 'bash');
    expect(candidates?.failed).toBe(false);
    expect(candidates?.text).toContain('vault/锦囊/选路.md');
    expect(candidates?.text).not.toContain('原题001：曾优先试');

    // 第二轮：正文检索用原生 grep -rn，给出真实路径与命中行，不给整篇经历。
    const [grepTurn] = await host.ask(session, '两个动点、没有对称结构的题，以前有什么经历？', { '两个动点、没有对称结构的题，以前有什么经历？': [{ name: 'bash', arguments: { command: "grep -rn '两个动点' vault/锦囊", description: '[notara:memory-read] 检索以往经历' } }] });
    const found = (await host.outcomes(session)).filter(row => row.name === 'bash').at(-1);
    expect(found?.failed).toBe(false);
    expect(found?.text).toContain('vault/锦囊/选路.md');
    // 原生 grep 的行格式是 path:line:正文，第二个冒号后直接接正文，没有多余空格。
    expect(found?.text).toMatch(/^vault\/锦囊\/选路\.md:\d+:.*两个动点/m);
    // 命中行只是线索：完整经历与失效条件还没有进入课堂。
    expect(JSON.stringify(grepTurn)).not.toContain('不要因为这次成功就断言总是适用');
    expect(JSON.stringify(grepTurn)).not.toContain('原题002：曾优先试');

    // 第三轮：原生 sed 精读那条真实文件，全文与失效条件才进入请求。
    const readTurns = await host.ask(session, '展开这条经历，尤其看它不适用的条件。', { '展开这条经历，尤其看它不适用的条件。': [{ name: 'bash', arguments: { command: "sed -n '1,200p' vault/锦囊/选路.md", description: '[notara:memory-read] 读这条经历全文' } }] });
    const read = (await host.outcomes(session)).filter(row => row.name === 'bash').at(-1);
    expect(read?.failed).toBe(false);
    expect(read?.text).toContain('原题001：曾优先试极点极线');
    expect(read?.text).toContain('不要因为这次成功');
    expect(readTurns.length).toBeGreaterThan(1);
    expect(JSON.stringify(readTurns[0])).not.toContain('不要因为这次成功');
    expect(JSON.stringify(readTurns.at(-1))).toContain('不要因为这次成功');

    // 写入往返：文件被外部改动后，按旧读结果写的 write-batch edit 会被拒绝；
    // 重新读取当前正文之后，同一路径的失败项才用唯一原文重试成功。
    const external = insight.replace('先让学生说明选路理由。', '先让学生说明选路理由，并写清适用条件。') + '\n## 更正\n原题条件已更正。\n';
    await host.writeVaultFile('锦囊/选路.md', external);
    const staleTurns = await host.ask(session, '用旧的读结果补一句修正。', { '用旧的读结果补一句修正。': [{ name: 'bash', arguments: { command: batchCommand([{ op: 'edit', path: '锦囊/选路.md', oldText: '## 教法\n先让学生说明选路理由。', newText: '## 教法\n先让学生说明选路理由，并写清适用条件。' }]), description: '[notara:memory-write] 按旧读结果补一句修正' } }] });
    const stale = (await host.outcomes(session)).filter(row => row.name === 'bash').at(-1);
    expect(stale?.text).toMatch(/\[exit code: 1\]/);
    const stalePayload = commandJson<BatchPayload>(stale!.text);
    expect(stalePayload.result?.results[0]).toMatchObject({ path: '锦囊/选路.md', op: 'edit', saved: false, error: { code: 'batch_original_mismatch' } });
    // 失败项没有写入：外部改动与更正都还在，且没有留下第二份教法原文。
    expect(await host.readVaultFile('锦囊/选路.md')).toBe(external);
    expect(JSON.stringify(staleTurns.at(-1))).toContain('batch_original_mismatch');

    await host.ask(session, '重新读一遍现在的版本。', { '重新读一遍现在的版本。': [{ name: 'bash', arguments: { command: "sed -n '1,200p' vault/锦囊/选路.md", description: '[notara:memory-read] 重新读一遍现在的版本' } }] });
    const reloaded = (await host.outcomes(session)).filter(row => row.name === 'bash').at(-1);
    expect(reloaded?.failed).toBe(false);
    expect(reloaded?.text).toContain('原题条件已更正。');
    expect(reloaded?.text).toContain('并写清适用条件');

    const savedTurns = await host.ask(session, '按现在的正文补一句更正说明。', { '按现在的正文补一句更正说明。': [{ name: 'bash', arguments: { command: batchCommand([{ op: 'edit', path: '锦囊/选路.md', oldText: '## 更正\n原题条件已更正。', newText: '## 更正\n原题条件已更正，且只在原题001上成立。' }]), description: '[notara:memory-write] 按现在的正文补一句更正说明' } }] });
    const saved = (await host.outcomes(session)).filter(row => row.name === 'bash').at(-1);
    expect(saved?.text).not.toMatch(/\[exit code:/);
    const savedPayload = commandJson<BatchPayload>(saved!.text);
    expect(savedPayload.result).toMatchObject({ savedCount: 1, failedCount: 0 });
    const afterSave = await host.readVaultFile('锦囊/选路.md');
    expect(afterSave).toContain('原题条件已更正，且只在原题001上成立。');
    expect(afterSave).toContain('并写清适用条件');
    expect(afterSave).toContain('不要因为这次成功就断言总是适用。');
    expect(savedPayload.result?.results[0]).toMatchObject({ path: '锦囊/选路.md', saved: true, revision: revisionOf(afterSave) });
    expect(JSON.stringify(savedTurns.at(-1))).toContain('write-batch');

    // 跨集：显式注册的第二集按真实绝对路径可读；只注册不会把它的经历悄悄塞进本课。
    await host.ask(session, '看看另一个已接入学习集里的同类经历。', { '看看另一个已接入学习集里的同类经历。': [{ name: 'bash', arguments: { command: `sed -n '1,200p' '${foreignInsight}'`, description: '[notara:memory-read] 读另一个学习集的同类经历' } }] });
    const cross = (await host.outcomes(session)).filter(row => row.name === 'bash').at(-1);
    expect(cross?.failed, cross?.text).toBe(false);
    expect(cross?.text).toContain('原题002：曾优先试');
    const [scoped] = await host.ask(session, '继续比较表示。', { '继续比较表示。': '继续比较表示。' });
    // An explicitly read foreign document remains in conversation history;
    // it must not become an automatically injected memory/system instruction.
    expect(JSON.stringify(scoped)).toContain('原题002：曾优先试');
    expect(effectiveSystemText(scoped!)).not.toContain('原题002：曾优先试');

    // 技能仍然按名字加载，且三份正文都能读到。
    await host.ask(session, '载入资料检索、作文批改和讲义整理的具体做法。', { '载入资料检索、作文批改和讲义整理的具体做法。': ['material-search', 'essay-review', 'markdown-handout'].map(name => ({ name: 'skill', arguments: { name: `notara-${name}` } })) });
    const skills = (await host.outcomes(session)).filter(row => row.name === 'skill');
    expect(skills).toHaveLength(3);
    expect(skills.every(row => !row.failed)).toBe(true);

    // 设置与压缩：教法、临时要求仍按 in-history 生效，压缩不吞掉它们。
    host.value(await host.rpc('notaraVault/updateTeachingSettings', { input: { sessionId: session, expectedRevision: 0, patch: { teachingRef: 'lecture', temporaryInstructions: '保留我的选路理由' } } }));
    const compact = host.value(await host.rpc<{ result?: { kind: string; text: string } }>('commands/execute', { agentId: session, line: '/compact', submittedAttachments: [] }));
    expect(JSON.stringify(compact)).toContain('Compacted');
    const [afterCompact] = await host.ask(session, '压缩以后继续比较表示。', { '压缩以后继续比较表示。': '继续比较表示。' });
    expect(effectiveSystemText(afterCompact!)).toContain('讲解式');
    expect(JSON.stringify(afterCompact)).toContain('保留我的选路理由');

    await mkdir('.runtime/teaching-implementation', { recursive: true });
    const outcomes = await host.outcomes(session);
    await writeFile('.runtime/teaching-implementation/memory-request-metrics.json', JSON.stringify({
      model: 'notara-vault-test/vault-test', synthetic: true, elapsedMs: Math.round(performance.now() - started),
      requestCount: (await host.turns(session)).length, firstRequestBytes: Buffer.byteLength(JSON.stringify(initial)),
      firstToolSchemaBytes: Buffer.byteLength(JSON.stringify(initial?.toolSchemas)),
      memoryCalls: outcomes.filter(row => row.name === 'bash').length,
      l0CharacterLimit: 1200, workspaces: 2, compression: 'actual-native-command',
    }, null, 2) + '\n');
  } finally { await host.close(); await runtime.stop(); }
}, 120_000);
