import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = [
  'examples/native-vault/fonts/wenkai.woff2',
  'examples/native-vault/lazy/excalidraw/fonts/THIRD-PARTY-NOTICES.txt',
  'examples/pixel-classroom/dist/classroom.js',
];
const missing = generated.filter(path => !existsSync(resolve(root, path)));
if (missing.length) {
  console.error(`插件测试缺少构建产物：${missing.join(', ')}`);
  console.error('新 clone 请先运行：npm run build:native-vault && npm run build:pixel-classroom');
  process.exit(1);
}

for (const project of ['examples/native-vault', 'examples/pixel-classroom']) {
  // Each file can own SQLite workers and sizable synthetic archives. Bound
  // competing instances on hosted runners; retain every test and RPC deadline.
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2'], { cwd: resolve(root, project), stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
