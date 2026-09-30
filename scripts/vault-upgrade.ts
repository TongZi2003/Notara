import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { clearManagedCode } from './vault-supervisor.ts';

/** `npm run vault:upgrade [-- --root <目录>]`: give a stopped Vault this checkout's plugin. */
const args = process.argv.slice(2);
let root = join(homedir(), '.notara', 'vault-runtime');
let keepSource = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1]) root = resolve(args[++i]!);
  else if (args[i] === '--keep-source') keepSource = true;
  else throw new Error(`未知参数：${args[i]}`);
}
const { upgradeVaultPersistent } = await import('./dev-isolated.ts');
try {
  const result = await upgradeVaultPersistent(root);
  if (!keepSource) await clearManagedCode(root);
  if (!result.upgraded) console.log(`已是最新版本 ${result.to ?? ''}，不需要升级。`);
  else {
    console.log(`已升级：${result.from ?? '未知版本'} → ${result.to}。课堂、资料与设置都保留。`);
    console.log(`旧版本留在 ${result.backup}；现在运行 npm run vault 继续学习。`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
