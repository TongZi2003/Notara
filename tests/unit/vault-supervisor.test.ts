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

test('an invalid recovery policy is refused before creating any runtime resource', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-invalid-recovery-'));
  try {
    await expect(superviseVault(root, resolve('.'), undefined, undefined, undefined, { recoveryPolicy: { maxRestarts: 0, windowMs: 1000, delaysMs: [0] } })).rejects.toThrow('Invalid Vault recovery policy');
    await expect(readFile(join(root, 'launcher.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'vault-runtime.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
