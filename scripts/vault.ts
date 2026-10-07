import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { httpUrlPort, liveVaultUrl, pluginVersions } from './vault-launcher-state.ts';
import { managedCode, superviseVault } from './vault-supervisor.ts';
import { openVaultBrowser } from './open-vault-browser.ts';
import { parseVaultArguments, VAULT_USAGE } from './vault-cli.ts';

function openBrowser(url: string): void {
  void openVaultBrowser(url).catch(error => console.error(error.message));
}

export async function runManagedVaultEntry(entry: { runVault?: (args?: readonly string[]) => Promise<void> }, args: readonly string[]): Promise<void> {
  await entry.runVault?.(args);
}

export async function runVault(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseVaultArguments(args);
  if (parsed.help) { console.log(VAULT_USAGE); return; }
  const { root: requestedRoot, port, noOpen, openOnly } = parsed.options;
  const root = resolve(requestedRoot ?? join(homedir(), '.notara', 'vault-runtime'));
  const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const managed = await managedCode(root);
  if (managed && managed !== project) {
    const managedEntry = await import(pathToFileURL(join(managed, 'scripts/vault.ts')).href) as { runVault?: (args?: readonly string[]) => Promise<void> };
    // Newer snapshots export an explicit entry point because this module is
    // imported from the launching checkout. Older snapshots execute at import.
    await runManagedVaultEntry(managedEntry, args);
  } else {
    // A `git pull` does not change a running directory's plugin: say so when they differ.
    const versions = await pluginVersions(root, project);
    if (versions.snapshot && versions.checkout && versions.snapshot !== versions.checkout)
      console.log(`这个数据目录运行的是 ${versions.snapshot}，代码目录里是 ${versions.checkout}。先停止服务，再运行 npm run vault:upgrade 升级（课堂与资料都保留）。`);
    const running = await liveVaultUrl(root);
    if (running) {
      if (port !== undefined && httpUrlPort(new URL(running)) !== port) throw new Error('Vault 已在其他端口运行，请先停止该实例。');
      console.log(`使用现有 Notara 服务：${new URL(running).origin}/`);
      if (!noOpen) openBrowser(running);
    } else {
      if (openOnly) throw new Error('Vault 尚未运行，请先执行 npm run vault。');
      const runtime = await superviseVault(root, project, port);
      const running = (await pluginVersions(root, project)).snapshot;
      console.log(`Notara ${running ?? ''}：${new URL(runtime.authUrl).origin}/\n数据目录：${root}（停止服务不会删除）`);
      console.log('重新打开当前登录入口：npm run vault:open（自定义目录需带 -- --root <目录>）');
      if (!noOpen) openBrowser(runtime.authUrl);
      else console.log('本次不打开浏览器；登录链接保存在私有 launcher.json 中。');
      process.once('SIGINT', () => { void runtime.stop(); });
      process.once('SIGTERM', () => { void runtime.stop(); });
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runVault().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
