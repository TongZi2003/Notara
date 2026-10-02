import { spawn } from 'node:child_process';

/** Use an argument vector, never a shell command containing the login token. */
export async function openVaultBrowser(url: string): Promise<void> {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] as const
    : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] as const
      : ['xdg-open', [url]] as const;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new Error('无法打开默认浏览器；服务仍在运行，可执行 npm run vault:open 重试。')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
