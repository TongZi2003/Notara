/**
 * The teacher's Bash through Notara's Git Bash executor (git-bash-executor.js),
 * the one Windows uses. Windows discovers Git Bash; other platforms use
 * /bin/bash under the native sandbox. The executor replaces the native shell, writes each
 * command to a private script, adds its environment, keeps the Vault commands
 * working, stays confined to the workspace, and cleans its scripts up.
 */
import { afterEach, expect, test } from 'vitest';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

let runtime: VaultRuntime | undefined, harness: VaultHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; await runtime?.stop(); runtime = undefined; });

async function askBash(client: VaultHarness, sessionId: string, text: string, command: string) {
  await client.ask(sessionId, text, { [text]: [{ name: 'bash', arguments: { command, description: `[notara:material-read] ${text}` } }] });
  return (await client.outcomes(sessionId)).filter(row => row.name === 'bash').at(-1)!;
}
const scripts = join(tmpdir(), 'notara-git-bash');
const leftovers = async (): Promise<string[]> => (await readdir(scripts).catch(() => [])).filter(name => name.endsWith('.sh'));

test('the teacher’s Bash runs through the Git Bash executor: scripts, environment, Vault commands and the sandbox', async () => {
  runtime = await startVaultIsolated({ testModel: true, ...(process.platform === 'win32' ? {} : { gitBash: '/bin/bash' }) });
  const patch = JSON.stringify(JSON.parse(await readFile(join(runtime.root, 'home/cordis.patch.yml'), 'utf8')));
  expect(patch).toContain(`"id":"${process.platform === 'win32' ? 'pwsh' : 'bash'}-sandbox","disabled":true`);
  expect(patch).toContain('"@notara/vault-native/git-bash-executor"');
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();
  const before = await leftovers();

  // The command ran as a script file of the executor, with its environment.
  const env = await askBash(harness, sessionId, '看一下环境', 'printf "%s|%s|%s|%s\\n" "$0" "$MSYS_NO_PATHCONV" "$LANG" "$PYTHONUTF8"');
  expect(env.failed, env.text).toBe(false);
  expect(env.text).toMatch(/notara-git-bash\/[0-9a-f-]+\.sh\|1\|C\.UTF-8\|1/);

  // Quotes, dollars and Chinese inside a heredoc arrive as written; a command
  // far longer than a Windows command line still runs.
  const heredoc = await askBash(harness, sessionId, '原样输出', "cat <<'EOF'\n中文 \"引号\" $dollar\nEOF\n: " + 'x'.repeat(40_000) + '\necho long-ok');
  expect(heredoc.failed, heredoc.text).toBe(false);
  expect(heredoc.text).toContain('中文 "引号" $dollar');
  expect(heredoc.text).toContain('long-ok');

  // The Vault's own command line works from this shell.
  const files = [{ op: 'create', path: '卡片/执行器.md', content: '---\ntype: card\n---\n# 执行器\n' }];
  const batch = await askBash(harness, sessionId, '保存卡片', `printf '%s' '${JSON.stringify({ files })}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" write-batch`);
  expect(batch.failed, batch.text).toBe(false);
  expect(await readFile(join(runtime.root, 'workspace/vault/卡片/执行器.md'), 'utf8')).toContain('# 执行器');

  // Still confined: a write outside the workspace (and outside the temp
  // directories the sandbox grants) is refused and leaves nothing.
  const outsideDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), '.runtime');
  const outside = join(outsideDir, `git-bash-sandbox-probe-${process.pid}.txt`);
  await mkdir(outsideDir, { recursive: true });
  try {
    await askBash(harness, sessionId, '写到外面', `echo x > "${outside}"`);
    await expect(stat(outside)).rejects.toThrow(/ENOENT/);
  } finally { await rm(outside, { force: true }); }

  // Every script this lesson wrote is gone.
  expect((await leftovers()).filter(name => !before.includes(name))).toEqual([]);
});
