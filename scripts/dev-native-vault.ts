import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

await import('./build-native-vault.ts');

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function samplePdf(): Buffer {
  const pageText = (lines: string[]): string => {
    const commands = ['BT', '/F1 24 Tf', '72 720 Td', `(${lines[0]}) Tj`, '/F1 15 Tf'];
    for (const line of lines.slice(1)) commands.push('0 -34 Td', `(${line}) Tj`);
    commands.push('ET');
    const content = commands.join('\n');
    return `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`;
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    pageText(['Vector foundations', 'A basis gives a coordinate language.', 'Drag a rectangle to extract this passage.']),
    pageText(['Coordinates', 'A point can be described by its coordinates.', 'The same vector has algebraic and geometric views.']),
  ];
  const header = Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'binary');
  const chunks = [header], offsets = [0];
  let length = header.length;
  objects.forEach((object, index) => {
    offsets[index + 1] = length;
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii');
    chunks.push(chunk); length += chunk.length;
  });
  const xrefOffset = length;
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
}

export interface VaultRuntime {
  readonly authUrl: string;
  readonly root: string;
  log(): string;
  stop(): Promise<void>;
}

/** Boot the vault plugin alone on a random port: temp DSH_HOME, temp
 * workspace seeded with pages, media and a real two-page PDF. */
export async function startVaultIsolated(): Promise<VaultRuntime> {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-native-'));
  try {
    return await bootVault(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function bootVault(root: string): Promise<VaultRuntime> {
  const home = join(root, 'home'), workspace = join(root, 'workspace');
  await Promise.all([mkdir(home, { recursive: true }), mkdir(workspace, { recursive: true })]);
  const workspacePath = await realpath(workspace);
  const workspaceId = randomUUID(), workspaceNow = new Date().toISOString();
  await mkdir(join(home, 'storages'), { recursive: true });
  await writeFile(join(home, 'storages/workspace.json'), `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
    tables: { workspaces: { [workspaceId]: { path: workspacePath, title: 'Notara Vault', sessionIds: [], createdAt: workspaceNow, updatedAt: workspaceNow } } },
  }, null, 2)}\n`);
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
    writeFile(join(workspace, 'vault/媒体/向量讲义.pdf'), samplePdf()),
  ]);
  await mkdir(join(workspace, 'node_modules/@notara'), { recursive: true });
  await symlink(join(project, 'examples/native-vault'), join(workspace, 'node_modules/@notara/vault-native'));
  await mkdir(join(home, 'profiles/web/node_modules/@notara'), { recursive: true });
  await symlink(join(project, 'examples/native-vault'), join(home, 'profiles/web/node_modules/@notara/vault-native'));
  await writeFile(join(home, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n');
  await writeFile(join(home, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'notara-vault-native', name: '@notara/vault-native' }] }]));
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') && key !== 'DSH_HOME' && key !== 'DSH_TELEMETRY_DISABLED') delete env[key];
  }
  const child = spawn(process.execPath, [join(project, 'node_modules/.bin/dsh'), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let authUrl = '';
  const collect = (chunk: Buffer): void => {
    output += chunk.toString();
    authUrl = /dsh web: (http:\/\/\S+)/.exec(output)?.[1] ?? authUrl;
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  let stopping: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopping ??= (async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await rm(root, { recursive: true, force: true });
    })();
    return stopping;
  }
  await new Promise<void>((resolveReady, reject) => {
    const timer = setInterval(() => {
      if (authUrl) { clearInterval(timer); resolveReady(); }
      else if (child.exitCode !== null) { clearInterval(timer); reject(new Error(output)); }
    }, 50);
  });
  await writeFile(join(root, 'launcher.json'), JSON.stringify({ pid: child.pid, workspace, node: process.versions.node, authUrl }));
  const redact = (text: string): string => text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
  return { get authUrl() { return authUrl; }, root, log: () => redact(output), stop };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const runtime = await startVaultIsolated();
  console.log(`Notara Vault: ${new URL(runtime.authUrl).origin}/`);
  console.log(`隔离数据目录：${runtime.root}`);
  process.once('SIGINT', () => { void runtime.stop(); });
  process.once('SIGTERM', () => { void runtime.stop(); });
}
