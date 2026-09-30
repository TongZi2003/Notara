import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { superviseVault } from '../../scripts/vault-supervisor.ts';

test('a different installed snapshot is refused before a launcher can mislabel or replace it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-mixed-version-'));
  try {
    await mkdir(join(root, 'vault-plugin'));
    await writeFile(join(root, 'vault-plugin/package.json'), '{"version":"0.0.1"}');
    await expect(superviseVault(root, resolve('.'))).rejects.toThrow('插件快照与启动代码版本不同');
    expect(await readFile(join(root, 'vault-plugin/package.json'), 'utf8')).toBe('{"version":"0.0.1"}');
  } finally { await rm(root, { recursive: true, force: true }); }
});
