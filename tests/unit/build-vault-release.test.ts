import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, expect, test } from 'vitest';
import { buildRelease } from '../../scripts/build-vault-release.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test('release inventory includes all Windows executable, source and license assets, excluding the cache lock and unrelated versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-release-posix-')); roots.push(root);
  const text = async (path: string, content = 'fixture'): Promise<void> => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); };
  for (const path of ['package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'README.md', 'LICENSE', '安装 Notara.cmd', '启动 Notara.cmd', '关闭 Notara.cmd', '创建桌面快捷方式.cmd',
    'scripts/entry.ts', 'examples/pixel-classroom/package.json', 'resources/font.txt', 'resources/icons/notara.ico', 'docs/install.md', 'docs/first-lesson.md', 'docs/runtime/plugins.md',
    'docs/runtime/vault-launcher.md', 'docs/runtime/windows-native-vault.md', 'docs/runtime/upstream-lock.json', 'docs/runtime/chatgpt-account.md', 'docs/runtime/remote-access.md']) await text(path);
  await text('package.json', JSON.stringify({ devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.1', '@deepseek-ai/cordis': '4.0.4' } }));
  await text('examples/native-vault/package.json', JSON.stringify({ version: '0.23.2' }));
  await text('docs/runtime/update-contract.json', JSON.stringify({ dataVersion: 4 }));
  const files = ['busybox.exe', 'source.tgz', 'LICENSE.txt', 'NOTICE.txt'].map(name => `vendor/windows-posix/FRP-test/${name}`);
  for (const path of files) await text(path, `asset ${path}`);
  await text('vendor/windows-posix/FRP-test/.provision.lock', 'private lock');
  await text('vendor/windows-posix/old/unreviewed.exe', 'excluded');
  const result = await buildRelease(join(root, 'output'), root, { windowsPosix: async source => {
    expect(source).toBe(root); return { executable: join(root, files[0]!), files };
  } });
  const entries = unzipSync(await readFile(result.archive));
  const inventory = JSON.parse(new TextDecoder().decode(entries['notara/notara-files.json']!)) as { files: Record<string, string> };
  for (const path of [...files, 'resources/icons/notara.ico', 'LICENSE']) {
    expect(entries[`notara/${path}`]).toBeDefined();
    expect(inventory.files[path]).toBe(createHash('sha256').update(entries[`notara/${path}`]!).digest('hex'));
  }
  expect(Object.keys(entries).filter(name => name.includes('/vendor/'))).toHaveLength(4);
});
