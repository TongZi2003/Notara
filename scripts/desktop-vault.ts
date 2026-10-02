import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { liveVaultUrl, validateVaultPort } from './vault-launcher-state.ts';
import { defaultRemoteConfigPath } from './remote-access-config.ts';
import { openVaultBrowser } from './open-vault-browser.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [action, ...args] = process.argv.slice(2);
let root = join(homedir(), '.notara', 'vault-runtime'), config = defaultRemoteConfigPath();
let port: number | undefined, noOpen = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--root' && args[i + 1]) root = resolve(args[++i]!);
  else if (arg === '--config' && args[i + 1]) config = resolve(args[++i]!);
  else if (arg === '--port' && args[i + 1]) { port = Number(args[++i]); validateVaultPort(port); }
  else if (arg === '--no-open') noOpen = true;
  else throw new Error(`未知参数：${arg}`);
}

try {
  if (action !== 'start' && action !== 'stop') throw new Error('操作必须为 start 或 stop。');
  const loader = pathToFileURL(join(project, 'node_modules/tsx/dist/loader.mjs')).href;
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, ['--import', loader, join(project, 'scripts/remote-vault.ts'), action === 'start' ? 'local-start' : 'stop',
      '--root', root, '--config', config, ...(action === 'start' && port !== undefined ? ['--port', String(port)] : [])],
    { cwd: project, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`Notara ${action === 'start' ? '启动' : '关闭'}未完成，请查看上方错误。`)));
  });
  const url = await liveVaultUrl(root);
  if (action === 'start') {
    if (!url) throw new Error('Notara 尚未就绪，请稍后重试启动。');
    if (!noOpen) await openVaultBrowser(url);
    console.log('Notara 已在后台运行；关闭浏览器不会停止服务。使用“Stop Notara”正常退出。');
  } else {
    if (url) throw new Error('Notara 是从其他终端启动的，此快捷方式没有关闭它。请回到原启动终端按 Ctrl+C。');
    console.log('Notara 已关闭，课堂和资料已保留。');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Notara 操作未完成。');
  process.exitCode = 1;
}
