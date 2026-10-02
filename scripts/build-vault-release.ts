import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import { codeContract, MANIFEST_NAME } from './vault-updates.ts';
import { ensureWindowsPosixBundle, type WindowsPosixBundle } from './windows-posix.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildRelease(output: string, source = project, internals: {
  windowsPosix?: (projectRoot: string) => Promise<WindowsPosixBundle>;
} = {}): Promise<{ archive: string; manifest: string; version: string }> {
  const contract = await codeContract(source);
  const windowsPosix = await (internals.windowsPosix ?? ensureWindowsPosixBundle)(source);
  const files: Record<string, Uint8Array> = {};
  const add = async (relative: string): Promise<void> => {
    const path = join(source, relative), info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`发布文件不能是软链：${relative}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        if (name.startsWith('.') || name === 'node_modules' || /\.test\.[jt]s$/.test(name)) continue;
        await add(`${relative}/${name}`);
      }
    } else if (info.isFile()) files[`notara/${relative}`] = new Uint8Array(await readFile(path));
  };
  // Deliberate allowlist: no checkout history, private data, website or research evidence.
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'README.md', '安装 Notara.cmd', '启动 Notara.cmd', '关闭 Notara.cmd', '创建桌面快捷方式.cmd', 'scripts', 'examples/native-vault', 'examples/pixel-classroom', 'resources', 'docs/install.md', 'docs/first-lesson.md',
    'docs/runtime/plugins.md', 'docs/runtime/vault-launcher.md', 'docs/runtime/windows-native-vault.md', 'docs/runtime/upstream-lock.json', 'docs/runtime/update-contract.json',
    'docs/runtime/chatgpt-account.md', 'docs/runtime/remote-access.md']) await add(path);
  // Ship the pinned native shell together with its exact source and GPL notices.
  // Individual verified assets are whitelisted; cache locks and other versions are excluded.
  for (const path of windowsPosix.files) await add(path);
  const notes = `docs/releases/native-vault-${contract.version}.md`;
  if (await lstat(join(source, notes)).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; })) await add(notes);
  const inventory = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name.slice('notara/'.length), createHash('sha256').update(bytes).digest('hex')]));
  files['notara/notara-files.json'] = new TextEncoder().encode(JSON.stringify({ format: 1, version: contract.version, files: inventory }, null, 2) + '\n');
  const bytes = zipSync(files, { level: 6 });
  const archive = `notara-${contract.version}.zip`;
  await mkdir(output, { recursive: true });
  await writeFile(join(output, archive), bytes);
  await writeFile(join(output, MANIFEST_NAME), JSON.stringify({ format: 1, version: contract.version, runtime: contract.runtime, archive, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2) + '\n');
  return { archive: join(output, archive), manifest: join(output, MANIFEST_NAME), version: contract.version };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const output = resolve(process.argv[2] ?? '.runtime/release');
  await import('./build-native-vault.ts');
  await (await import('./build-pixel-classroom.ts')).buildPixelClassroom();
  const result = await buildRelease(output);
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${result.version}`) throw new Error('发布标签必须与插件版本一致。');
  console.log(`发布包 ${result.archive}\n更新清单 ${result.manifest}`);
}
