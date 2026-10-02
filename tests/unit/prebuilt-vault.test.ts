import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { PORTABLE_MARKER, verifyPrebuiltVault } from '../../scripts/prebuilt-vault.ts';

test('ordinary source installs keep their normal build path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-prebuilt-'));
  try { expect(await verifyPrebuiltVault(root)).toBe(false); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('portable validation rejects changed assets, missing payload and unsafe inventory paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-prebuilt-'));
  try {
    const files: Record<string, string> = {};
    for (const [name, content] of Object.entries({ 'examples/native-vault/package.json': '{"version":"1.2.3"}', 'examples/native-vault/client.js': '// prebuilt', 'runtime/node.exe': 'synthetic-node' })) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), content);
      files[name] = createHash('sha256').update(content).digest('hex');
    }
    const manifest = { format: 1, version: '1.2.3', platform: 'win32', arch: 'x64', nodeVersion: process.versions.node, files };
    const save = async () => writeFile(join(root, PORTABLE_MARKER), JSON.stringify(manifest));
    await save();
    expect(await verifyPrebuiltVault(root)).toBe(true);
    await writeFile(join(root, 'examples/native-vault/client.js'), '// modified');
    await expect(verifyPrebuiltVault(root)).rejects.toThrow(/已修改或损坏/);
    await writeFile(join(root, 'examples/native-vault/client.js'), '// prebuilt');
    manifest.version = '1.2.4'; await save();
    await expect(verifyPrebuiltVault(root)).rejects.toThrow(/版本不一致/);
    manifest.version = '1.2.3';
    files['../outside'] = files['runtime/node.exe']!; await save();
    await expect(verifyPrebuiltVault(root)).rejects.toThrow(/路径无效/);
    delete files['../outside']; await save();
    await rm(join(root, 'runtime/node.exe'));
    await expect(verifyPrebuiltVault(root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, 'examples/native-vault/client.js'), 'utf8')).toBe('// prebuilt');
  } finally { await rm(root, { recursive: true, force: true }); }
});
