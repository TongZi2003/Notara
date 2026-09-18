import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startPersistent } from './dev-isolated.ts';

/** Persistent trial instance: `npm run trial [数据目录] [--port <n>] [--no-open]`.
 * Data lives in the given directory (default .trial/) and survives restarts;
 * the model provider is configured by the user in the web onboarding. */
const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args[portAt + 1]) : undefined;
const noOpen = args.includes('--no-open');
const dir = args.find(arg => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--port');
if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error(`bad --port: ${port}`);

/** Open the login URL in the platform browser; fire-and-forget, detached so
 * the browser outlives no one and a missing opener never kills the trial. */
function openBrowser(url: string): void {
  const [command, commandArgs] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(command, commandArgs, { detached: true, stdio: 'ignore' }).unref();
  } catch { /* A browser that cannot open leaves the printed URL usable. */ }
}

const root = resolve(dir ?? '.trial');
const runtime = await startPersistent(root, { ...(port === undefined ? {} : { port }) });
console.log(`Notara 试用实例：${runtime.authUrl}`);
console.log(`数据目录：${root}（保留全部课堂与学习数据，可重复启动）`);
console.log('此终端窗口即 Notara 服务本体——窗口关闭服务即停止；登录地址也写在数据目录的 launcher.json 里，脚本可直接读取。');
if (!noOpen) openBrowser(runtime.authUrl);
process.once('SIGINT', () => { void runtime.stop(); });
process.once('SIGTERM', () => { void runtime.stop(); });
