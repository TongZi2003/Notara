/** Real Windows shell scopes and lifecycle under an isolated native DSH Host. */
import { afterEach, expect, test } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseExitStatus } from '@deepseek-ai/dsh-shell';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, toolNames, type ToolOutcome, type VaultHarness } from '../fixtures/vault-http.ts';

let runtime: VaultRuntime | undefined, harness: VaultHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; await runtime?.stop(); runtime = undefined; });

async function askTool(client: VaultHarness, sessionId: string, text: string, name: string, args: Record<string, unknown>): Promise<{ outcome: ToolOutcome; turns: Awaited<ReturnType<VaultHarness['ask']>> }> {
  const turns = await client.ask(sessionId, text, { [text]: [{ name, arguments: args }] });
  const outcome = (await client.outcomes(sessionId)).filter(row => row.name === name).at(-1);
  if (!outcome) throw new Error(`missing ${name} result for ${text}`);
  return { outcome, turns };
}
async function askBash(client: VaultHarness, sessionId: string, text: string, command: string, args: Record<string, unknown> = {}) {
  return askTool(client, sessionId, text, 'bash', { command, description: `[notara:material-read] ${text}`, ...args });
}
const scriptDirectories = async (): Promise<string[]> => (await readdir(join(tmpdir(), 'notara-windows-posix')).catch(() => [])).filter(name => name.startsWith('call-'));
function scriptPath(text: string): string {
  const match = text.match(/[A-Za-z]:\/[^\r\n]*?\/notara-windows-posix\/call-[^/\r\n]+\/command\.sh/);
  if (!match) throw new Error(`missing private script path in output: ${text.slice(0, 200)}`);
  return match[0];
}
function jobId(text: string, promoted = false): string {
  const match = text.match(promoted ? /moved to background job ([^\]\s]+)/ : /started background job (\S+)/);
  if (!match) throw new Error(`missing background job id: ${text.slice(0, 200)}`);
  return match[1]!;
}
async function permission(client: VaultHarness, sessionId: string, mode: 'read-only' | 'workspace-write') {
  client.value(await client.rpc('commands/execute', { agentId: sessionId, line: `/permission ${mode}`, submittedAttachments: [] }));
}

test.skipIf(process.platform !== 'win32')('Windows preserves native PowerShell for standard sessions and confines the teacher’s POSIX CLI writes', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const ordinary = await harness.createSession('standard');
  const native = await askTool(harness, ordinary, '验证原生 PowerShell', 'pwsh', {
    command: 'Write-Output ("native-pwsh|{0}|中文|{1}" -f $PSVersionTable.PSVersion.Major, (6 * 7))',
    description: '验证普通会话原生 PowerShell 的中文和表达式',
  });
  expect(native.outcome.failed, native.outcome.text).toBe(false);
  expect(native.outcome.text).toMatch(/native-pwsh\|\d+\|中文\|42/);
  expect(parseExitStatus(native.outcome.text)).toMatchObject({ exitCode: 0 });
  expect(toolNames(native.turns[0]!)).toContain('pwsh');
  expect(toolNames(native.turns[0]!)).not.toContain('bash');

  const teacher = await harness.createSession();
  const before = await scriptDirectories();
  const ash = await askBash(harness, teacher, '验证教师 POSIX shell', 'printf "native-ash|%s|%s|中文\\n" "$0" "$LANG"');
  expect(ash.outcome.failed, ash.outcome.text).toBe(false);
  expect(ash.outcome.text).toMatch(/native-ash\|[^\r\n]*notara-windows-posix\/call-[^/\r\n]+\/command\.sh\|C\.UTF-8\|中文/);
  expect(parseExitStatus(ash.outcome.text)).toMatchObject({ exitCode: 0 });
  expect(toolNames(ash.turns[0]!)).toContain('bash');
  expect(toolNames(ash.turns[0]!)).not.toContain('pwsh');
  const schema = ash.turns[0]!.toolSchemas.find(row => row !== null && typeof row === 'object' && (row as { name?: string }).name === 'bash');
  expect(JSON.stringify(schema)).toContain('native BusyBox ash on Windows');
  expect(JSON.stringify(schema)).toContain('POSIX ash command');
  expect(JSON.stringify(schema)).toContain('sandbox_permissions');
  expect(JSON.stringify(schema)).toContain('run_in_background');
  await expect(stat(scriptPath(ash.outcome.text))).rejects.toThrow(/ENOENT/);

  await permission(harness, teacher, 'read-only');
  harness.approvals.auto('rejected');
  const readonly = await askBash(harness, teacher, '只读课堂不能保存卡片', `printf '%s' '${JSON.stringify({ files: [{ op: 'create', path: '卡片/只读不得保存.md', content: '# 不得保存\n' }] })}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" write-batch`);
  expect(readonly.outcome.failed, readonly.outcome.text).toBe(false);
  expect(readonly.outcome.text).toContain('"ok":false');
  expect(readonly.outcome.text).toContain('cli_write_denied');
  expect(parseExitStatus(readonly.outcome.text)).toMatchObject({ exitCode: 1 });
  expect(await harness.vaultExists('卡片/只读不得保存.md')).toBe(false);
  expect((await scriptDirectories()).filter(name => !before.includes(name))).toEqual([]);

  // The private shell never replaces the host service, even after both scopes
  // have mounted and the teacher's permission was changed independently.
  const again = await askTool(harness, ordinary, '教师只读后普通 PowerShell 仍可用', 'pwsh', {
    command: 'Write-Output ("native-pwsh-still|{0}" -f (7 * 6))', description: '验证普通会话仍执行 PowerShell 表达式',
  });
  expect(again.outcome.failed, again.outcome.text).toBe(false);
  expect(again.outcome.text).toContain('native-pwsh-still|42');
  expect(parseExitStatus(again.outcome.text)).toMatchObject({ exitCode: 0 });
}, 180_000);

test.skipIf(process.platform !== 'win32')('Windows teacher shell cleans private scripts after background completion, cancellation and timeout promotion', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const teacher = await harness.createSession();
  await permission(harness, teacher, 'workspace-write');
  const before = await scriptDirectories();

  const background = await askBash(harness, teacher, '后台执行中文脚本', 'printf "background-start %s\\n" "$0"; sleep 1; printf "后台中文完成\\n"', { run_in_background: true });
  expect(background.outcome.failed, background.outcome.text).toBe(false);
  const backgroundId = jobId(background.outcome.text);
  const completed = await askTool(harness, teacher, '读取已完成后台输出', 'job_output', { job_id: backgroundId, wait: true, timeout_ms: 10_000 });
  expect(completed.outcome.failed, completed.outcome.text).toBe(false);
  expect(completed.outcome.text).toContain('后台中文完成');
  expect(completed.outcome.text).toContain('[status: completed, exit code: 0]');
  await expect(stat(scriptPath(completed.outcome.text))).rejects.toThrow(/ENOENT/);
  expect((await scriptDirectories()).filter(name => !before.includes(name))).toEqual([]);

  const cancellation = await askBash(harness, teacher, '启动等待取消的后台脚本', 'printf "cancel-start %s\\n" "$0"; sleep 60; printf "cancel-ended\\n"', { run_in_background: true });
  expect(cancellation.outcome.failed, cancellation.outcome.text).toBe(false);
  const cancelId = jobId(cancellation.outcome.text);
  const running = await askTool(harness, teacher, '确认后台脚本已启动', 'job_output', { job_id: cancelId, wait: true, timeout_ms: 3000 });
  expect(running.outcome.failed, running.outcome.text).toBe(false);
  expect(running.outcome.text).toContain('cancel-start');
  expect(running.outcome.text).toContain('[status: running]');
  const cancelScript = scriptPath(running.outcome.text);
  expect((await stat(cancelScript)).isFile()).toBe(true);
  const kill = await askTool(harness, teacher, '取消后台脚本', 'job_kill', { job_id: cancelId, reason: 'integration cancellation' });
  expect(kill.outcome.failed, kill.outcome.text).toBe(false);
  expect(kill.outcome.text).toContain(`requested cancellation of job ${cancelId}`);
  const killed = await askTool(harness, teacher, '等待后台脚本停止', 'job_output', { job_id: cancelId, wait: true, timeout_ms: 10_000 });
  expect(killed.outcome.failed, killed.outcome.text).toBe(false);
  expect(killed.outcome.text).toMatch(/\[status: killed[,\]]/);
  expect(killed.outcome.text).not.toContain('cancel-ended');
  await expect(stat(cancelScript)).rejects.toThrow(/ENOENT/);
  expect((await scriptDirectories()).filter(name => !before.includes(name))).toEqual([]);

  // Native Bash semantics promote an expired foreground wait to the same job;
  // the script must remain until that background process is actually stopped.
  const timeout = await askBash(harness, teacher, '前台超时移交后台', 'printf "timeout-start %s\\n" "$0"; sleep 60; printf "timeout-ended\\n"', { timeoutMs: 3000 });
  expect(timeout.outcome.failed, timeout.outcome.text).toBe(false);
  expect(timeout.outcome.text).toContain('[still running after 3000ms; moved to background job ');
  const timeoutId = jobId(timeout.outcome.text, true);
  const timeoutScript = scriptPath(timeout.outcome.text);
  expect((await stat(timeoutScript)).isFile()).toBe(true);
  const stop = await askTool(harness, teacher, '停止超时移交的脚本', 'job_kill', { job_id: timeoutId, reason: 'integration timeout cleanup' });
  expect(stop.outcome.failed, stop.outcome.text).toBe(false);
  const settled = await askTool(harness, teacher, '等待超时脚本清理', 'job_output', { job_id: timeoutId, wait: true, timeout_ms: 10_000 });
  expect(settled.outcome.failed, settled.outcome.text).toBe(false);
  expect(settled.outcome.text).toMatch(/\[status: killed[,\]]/);
  expect(settled.outcome.text).not.toContain('timeout-ended');
  await expect(stat(timeoutScript)).rejects.toThrow(/ENOENT/);
  expect((await scriptDirectories()).filter(name => !before.includes(name))).toEqual([]);
}, 180_000);
