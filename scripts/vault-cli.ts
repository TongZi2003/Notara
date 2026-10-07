import { validateVaultPort } from './vault-launcher-state.ts';

export const VAULT_USAGE = [
  '用法：npm run vault -- [选项]',
  '  --root <目录>   使用指定的数据目录',
  '  --port <端口>   指定端口；0 表示自动选择',
  '  --no-open       启动后不打开浏览器',
  '  --open          只打开已运行的服务',
  '  --help          显示此帮助',
].join('\n');

export interface VaultCliOptions { root?: string; port?: number; noOpen: boolean; openOnly: boolean }
export type VaultCliParseResult = { help: true } | { help: false; options: VaultCliOptions };

export function parseVaultArguments(args: readonly string[]): VaultCliParseResult {
  const options: VaultCliOptions = { noOpen: false, openOnly: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--root' || argument === '--port') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} 后需要一个值。\n${VAULT_USAGE}`);
      if (argument === '--root') options.root = value;
      else { options.port = Number(value); validateVaultPort(options.port); }
    } else if (argument === '--no-open') options.noOpen = true;
    else if (argument === '--open') options.openOnly = true;
    else throw new Error(`未知参数：${argument}\n${VAULT_USAGE}`);
  }
  return { help: false, options };
}
