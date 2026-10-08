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
  for (const path of ['package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'README.md', 'LICENSE', 'install-notara.cmd', 'start-notara.cmd', 'stop-notara.cmd', 'create-notara-shortcuts.cmd',
    'scripts/entry.ts', 'examples/pixel-classroom/package.json', 'resources/font.txt', 'resources/icons/notara.ico', 'docs/install.md', 'docs/first-lesson.md', 'docs/runtime/plugins.md',
    'docs/runtime/vault-launcher.md', 'docs/runtime/windows-native-vault.md', 'docs/runtime/upstream-lock.json', 'docs/runtime/chatgpt-account.md', 'docs/runtime/remote-access.md']) await text(path);
  await text('package.json', JSON.stringify({ devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.1', '@deepseek-ai/cordis': '4.0.4' } }));
  await text('examples/native-vault/package.json', JSON.stringify({ version: '0.24.1' }));
  await text('docs/runtime/update-contract.json', JSON.stringify({ dataVersion: 5 }));
  const kernelInputs = {
    'kernel/src/index.ts': 'export const pinnedKernel = 1;\n',
    'kernel/package.json': JSON.stringify({ version: '0.0.105' }),
    'kernel/LICENSE': 'Kernel attribution fixture',
    'LICENSE': 'Billion attribution fixture',
  };
  const kernelLock = { commit: 'pinned-fixture', files: Object.fromEntries(Object.entries(kernelInputs)
    .map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')])) };
  for (const [path, content] of Object.entries(kernelInputs)) await text(`vendor/billion-context/${path}`, content);
  await text('vendor/billion-context/upstream-lock.json', JSON.stringify(kernelLock));
  await text('vendor/billion-context/README.md', 'Pinned kernel source attribution');
  await text('examples/native-vault/billion-kernel/index.js', 'export const pinnedKernel = 1;\n');
  await text('vendor/unrelated/private-cache.txt', 'excluded');
  const files = ['busybox.exe', 'source.tgz', 'LICENSE.txt', 'NOTICE.txt'].map(name => `vendor/windows-posix/FRP-test/${name}`);
  for (const path of files) await text(path, `asset ${path}`);
  await text('vendor/windows-posix/FRP-test/.provision.lock', 'private lock');
  await text('vendor/windows-posix/old/unreviewed.exe', 'excluded');
  await text('scripts/installer-character-progress.ps1');
  await text('resources/installer/mascot-outline.json');
  await text('scripts/preview-install-progress.ps1');
  await text('preview-install-progress.cmd');
  const result = await buildRelease(join(root, 'output'), root, { windowsPosix: async source => {
    expect(source).toBe(root); return { executable: join(root, files[0]!), files };
  } });
  expect(result.version).toBe('0.24.1');
  const entries = unzipSync(await readFile(result.archive));
  const inventory = JSON.parse(new TextDecoder().decode(entries['notara/notara-files.json']!)) as { version: string; files: Record<string, string> };
  const manifest = JSON.parse(await readFile(result.manifest, 'utf8')) as { version: string; archive: string; sha256: string; runtime: { dataVersion: number } };
  expect(inventory.version).toBe(result.version);
  expect(manifest).toMatchObject({ version: result.version, archive: 'notara-0.24.1.zip' });
  expect(manifest.runtime.dataVersion).toBe(5);
  expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
  for (const path of [...files, 'resources/icons/notara.ico', 'LICENSE', 'scripts/installer-character-progress.ps1', 'resources/installer/mascot-outline.json']) {
    expect(entries[`notara/${path}`]).toBeDefined();
    expect(inventory.files[path]).toBe(createHash('sha256').update(entries[`notara/${path}`]!).digest('hex'));
  }
  // The generated module alone cannot satisfy the staging rebuild. Verify every
  // declared source input survives extraction with the exact locked bytes.
  const shippedLock = JSON.parse(new TextDecoder().decode(entries['notara/vendor/billion-context/upstream-lock.json']!)) as typeof kernelLock;
  expect(shippedLock).toEqual(kernelLock);
  for (const [path, digest] of Object.entries(shippedLock.files)) {
    const bytes = entries[`notara/vendor/billion-context/${path}`];
    expect(bytes).toBeDefined();
    expect(createHash('sha256').update(bytes!).digest('hex')).toBe(digest);
    expect(inventory.files[`vendor/billion-context/${path}`]).toBe(digest);
  }
  expect(entries['notara/vendor/billion-context/README.md']).toBeDefined();
  expect(entries['notara/examples/native-vault/billion-kernel/index.js']).toBeDefined();
  expect(Object.keys(entries).filter(name => name.includes('/vendor/windows-posix/'))).toHaveLength(4);
  expect(Object.keys(entries).some(name => name.includes('/vendor/unrelated/'))).toBe(false);
  expect(Object.keys(entries).some(name => name.includes('preview-install-progress'))).toBe(false);
});
