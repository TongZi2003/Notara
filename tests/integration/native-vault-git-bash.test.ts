/**
 * The teacher's POSIX shell under the native sandbox: Windows uses its scoped
 * BusyBox ash provider, while other platforms explicitly exercise the existing
 * Git Bash executor with /bin/bash. Both write private scripts, preserve UTF-8
 * and long commands, keep Vault CLI CAS writes confined, and clean their scripts.
 */
import { afterEach, expect, test } from 'vitest';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExitStatus } from '@deepseek-ai/dsh-shell';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

let runtime: VaultRuntime | undefined, harness: VaultHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; await runtime?.stop(); runtime = undefined; });

async function askBash(client: VaultHarness, sessionId: string, text: string, command: string) {
  const previous = new Set((await client.outcomes(sessionId)).map(row => row.callId));
  await client.ask(sessionId, text, { [text]: [{ name: 'bash', arguments: { command, description: `[notara:material-read] ${text}` } }] });
  const result = (await client.outcomes(sessionId)).filter(row => row.name === 'bash' && !previous.has(row.callId)).at(-1);
  if (!result) throw new Error('submitted turn produced no new bash result');
  return result;
}
const windows = process.platform === 'win32';
const scripts = join(tmpdir(), windows ? 'notara-windows-posix' : 'notara-git-bash');
const leftovers = async (): Promise<string[]> => (await readdir(scripts).catch(() => [])).filter(name => windows ? name.startsWith('call-') : name.endsWith('.sh'));
const batchCommand = (files: unknown[]): string => `printf '%s' '${JSON.stringify({ files })}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" write-batch`;
interface BatchReceipt { ok: boolean; result?: { savedCount: number; failedCount: number; results: { saved: boolean; error?: { code: string } }[] } }
function batchReceipt(text: string): BatchReceipt {
  for (const line of text.split('\n').reverse()) {
    try {
      const value = JSON.parse(line.trim()) as BatchReceipt;
      if (value !== null && typeof value === 'object' && typeof value.ok === 'boolean') return value;
    } catch { /* exit markers and echoed commands are not CLI receipts */ }
  }
  throw new Error(`no write-batch receipt in tool output: ${text.slice(0, 200)}`);
}

test('the teacher’s POSIX shell preserves scripts, environment, Vault CAS writes and the sandbox', async () => {
  runtime = await startVaultIsolated({ testModel: true, ...(windows ? {} : { gitBash: '/bin/bash' }) });
  const patchRows = JSON.parse(await readFile(join(runtime.root, 'home/cordis.patch.yml'), 'utf8')) as { id?: string; disabled?: boolean; insert?: { id: string; config?: { plugins?: unknown[] } }[] }[];
  const patch = JSON.stringify(patchRows);
  if (windows) {
    expect(patchRows.some(row => row.id === 'pwsh-sandbox' && row.disabled === true)).toBe(false);
    expect(patch).not.toContain('"@notara/vault-native/git-bash-executor"');
    const teacher = patchRows.flatMap(row => row.insert ?? []).find(row => row.id === 'preset-notara-teacher');
    expect(teacher?.config?.plugins).toContainEqual({
      id: 'teacher-shell', name: 'cordis:group', group: true, isolate: { shell: true },
      config: [
        { id: 'windows-posix', name: '@notara/vault-native/windows-posix-executor', config: { timeoutMs: 60000 } },
        { id: 'tool-bash', name: '@notara/vault-native/windows-posix-tool' },
      ],
    });
  } else {
    expect(patch).toContain('"id":"bash-sandbox","disabled":true');
    expect(patch).toContain('"@notara/vault-native/git-bash-executor"');
  }
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();
  const before = await leftovers();

  // The command ran as a script file of the executor, with its environment.
  const env = await askBash(harness, sessionId, '看一下环境', 'printf "%s|%s|%s|%s\\n" "$0" "$MSYS_NO_PATHCONV" "$LANG" "$PYTHONUTF8"');
  expect(env.failed, env.text).toBe(false);
  expect(env.text).toMatch(windows
    ? /notara-windows-posix\/call-[^/\r\n]+\/command\.sh\|\|C\.UTF-8\|1/
    : /notara-git-bash\/[0-9a-f-]+\.sh\|1\|C\.UTF-8\|1/);

  // Quotes, dollars and Chinese inside a heredoc arrive as written; a command
  // far longer than a Windows command line still runs.
  const heredoc = await askBash(harness, sessionId, '原样输出', "cat <<'EOF'\n中文 \"引号\" $dollar\nEOF\n: " + 'x'.repeat(40_000) + '\necho long-ok');
  expect(heredoc.failed, heredoc.text).toBe(false);
  expect(heredoc.text).toContain('中文 "引号" $dollar');
  expect(heredoc.text).toContain('long-ok');

  // The Vault's own command line works from this shell.
  const files = [{ op: 'create', path: '卡片/执行器.md', content: '---\ntype: card\n---\n# 执行器\n' }];
  const batch = await askBash(harness, sessionId, '保存卡片', batchCommand(files));
  expect(batch.failed, batch.text).toBe(false);
  expect(batchReceipt(batch.text)).toMatchObject({ ok: true, result: { savedCount: 1, failedCount: 0 } });
  expect(await harness.readVaultFile('卡片/执行器.md')).toBe(files[0]!.content);

  const edited = await askBash(harness, sessionId, '修改卡片', batchCommand([{ op: 'edit', path: files[0]!.path, oldText: '# 执行器', newText: '# 执行器已验证' }]));
  expect(edited.failed, edited.text).toBe(false);
  expect(batchReceipt(edited.text)).toMatchObject({ ok: true, result: { savedCount: 1, failedCount: 0 } });
  const current = await harness.readVaultFile(files[0]!.path);
  expect(current).toContain('# 执行器已验证');
  const stale = await askBash(harness, sessionId, '拒绝旧原文修改', batchCommand([{ op: 'edit', path: files[0]!.path, oldText: '# 执行器\n', newText: '# 不应覆盖\n' }]));
  expect(stale.failed, stale.text).toBe(false);
  expect(batchReceipt(stale.text)).toMatchObject({ ok: false, result: { savedCount: 0, failedCount: 1 } });
  expect(await harness.readVaultFile(files[0]!.path)).toBe(current);

  // Broker publication must preserve the Windows native capability ACE and
  // Low label: a later confined shell can still write this workspace inode.
  const append = await askBash(harness, sessionId, '验证保存后工作区仍可写', 'printf "\\nshell-after-broker\\n" >> "$DSH_NOTARA_VAULT_ROOT/卡片/执行器.md"');
  expect(append.failed, append.text).toBe(false);
  expect(parseExitStatus(append.text)).toMatchObject({ exitCode: 0 });
  expect(await harness.readVaultFile(files[0]!.path)).toBe(`${current}\nshell-after-broker\n`);

  // Still confined: a write outside the workspace (and outside the temp
  // directories the sandbox grants) is refused and leaves nothing.
  const outsideDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), '.runtime');
  const outside = join(outsideDir, `git-bash-sandbox-probe-${process.pid}.txt`);
  await mkdir(outsideDir, { recursive: true });
  try {
    const denied = await askBash(harness, sessionId, '写到外面', `echo x > "${outside.replaceAll('\\', '/')}"`);
    expect(denied.failed, denied.text).toBe(false);
    expect(denied.text).toMatch(/\[exit code: [1-9]\d*\]/);
    await expect(stat(outside)).rejects.toThrow(/ENOENT/);
  } finally { await rm(outside, { force: true }); }

  // Every script this lesson wrote is gone.
  expect((await leftovers()).filter(name => !before.includes(name))).toEqual([]);
}, 180_000);
