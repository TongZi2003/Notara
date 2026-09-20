import { mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./build-native-vault.ts');

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(join(tmpdir(), 'notara-vault-native-'));
const home = join(root, 'home'), workspace = join(root, 'workspace');
await Promise.all([mkdir(home, { recursive: true }), mkdir(workspace, { recursive: true })]);
await Promise.all([
  mkdir(join(workspace, 'vault/路线'), { recursive: true }),
  mkdir(join(workspace, 'vault/知识'), { recursive: true }),
  mkdir(join(workspace, 'vault/媒体'), { recursive: true }),
]);
await Promise.all([
  writeFile(join(workspace, 'vault/路线/向量路线.md'), `---
type: route
status: active
tags: [math]
---
# 向量学习路线

先从基底开始，再进入坐标表示。

- [ ] 理解基底
- [ ] 完成一个坐标例题

[[知识/向量]]
`),
  writeFile(join(workspace, 'vault/知识/向量.md'), `---
type: note
status: draft
tags: [math, vector]
---
# 向量

向量既可以用代数坐标表示，也可以用几何方向表示。

## 关键联系
- [ ] 能解释基底的作用
- [x] 看过一个例题

[[路线/向量路线]]
`),
  writeFile(join(workspace, 'vault/媒体/说明.html'), '<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:24px;color:#243}</style><h1>Vault 媒体示例</h1><p>HTML 文件以沙箱预览，可以复制 <code>![[媒体/说明.html]]</code> 嵌入到 Markdown。</p>'),
  writeFile(join(workspace, 'vault/媒体/色板.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#eef2ff"/><circle cx="150" cy="120" r="70" fill="#6370ff"/><circle cx="320" cy="120" r="70" fill="#ffb45c"/><circle cx="490" cy="120" r="70" fill="#55c79a"/></svg>'),
]);
await mkdir(join(workspace, 'node_modules/@notara'), { recursive: true });
await symlink(join(project, 'examples/native-vault'), join(workspace, 'node_modules/@notara/vault-native'));
await mkdir(join(home, 'profiles/web/node_modules/@notara'), { recursive: true });
await symlink(join(project, 'examples/native-vault'), join(home, 'profiles/web/node_modules/@notara/vault-native'));
await writeFile(join(home, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n');
await writeFile(join(home, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'notara-vault-native', name: '@notara/vault-native' }] }]));
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
const child = spawn(process.execPath, [join(project, 'node_modules/.bin/dsh'), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const collect = (chunk: Buffer): void => { output += chunk.toString(); process.stdout.write(chunk); };
child.stdout.on('data', collect); child.stderr.on('data', collect);
const stop = async (): Promise<void> => { if (child.exitCode === null) child.kill('SIGTERM'); await rm(root, { recursive: true, force: true }); };
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
await new Promise<void>((resolveReady, reject) => {
  const timer = setInterval(() => { if (/dsh web: http/.test(output)) { clearInterval(timer); resolveReady(); } else if (child.exitCode !== null) { clearInterval(timer); reject(new Error(output)); } }, 50);
});
console.log(`隔离数据目录：${root}`);
