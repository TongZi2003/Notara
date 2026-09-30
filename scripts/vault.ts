import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { liveVaultUrl, pluginVersions, validateVaultPort } from './vault-launcher-state.ts';
import { managedCode, superviseVault } from './vault-supervisor.ts';

const args = process.argv.slice(2);
let root = join(homedir(), '.notara', 'vault-runtime'), port: number | undefined, noOpen = false, openOnly = false;
for (let i = 0; i < args.length; i++) {
  const argument = args[i];
  if (argument === '--root' && args[i + 1]) root = resolve(args[++i]!);
  else if (argument === '--port' && args[i + 1]) { port = Number(args[++i]); validateVaultPort(port); }
  else if (argument === '--no-open') noOpen = true;
  else if (argument === '--open') openOnly = true;
  else throw new Error(`未知参数：${argument}`);
}
function openBrowser(url: string): void {
  const [command, values] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const opener = spawn(command!, values as string[], { detached: true, stdio: 'ignore' });
  opener.on('error', () => console.error('无法打开默认浏览器；当前登录入口保存在数据目录的 launcher.json。'));
  opener.unref();
}
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const managed = await managedCode(root);
if (managed && managed !== project) {
  await import(pathToFileURL(join(managed, 'scripts/vault.ts')).href);
} else {
  // A `git pull` does not change a running directory's plugin: say so when they differ.
  const versions = await pluginVersions(root, project);
  if (versions.snapshot && versions.checkout && versions.snapshot !== versions.checkout)
    console.log(`这个数据目录运行的是 ${versions.snapshot}，代码目录里是 ${versions.checkout}。先停止服务，再运行 npm run vault:upgrade 升级（课堂与资料都保留）。`);
  const running = await liveVaultUrl(root);
  if (running) {
    if (port !== undefined && Number(new URL(running).port) !== port) throw new Error('Vault 已在其他端口运行，请先停止该实例。');
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
