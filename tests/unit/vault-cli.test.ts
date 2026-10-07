import { expect, test } from 'vitest';
import { parseVaultArguments, VAULT_USAGE } from '../../scripts/vault-cli.ts';
import { runManagedVaultEntry } from '../../scripts/vault.ts';

test('Vault CLI help is available before runtime startup and unknown arguments return usage', () => {
  expect(parseVaultArguments(['--help'])).toEqual({ help: true });
  expect(parseVaultArguments(['-h'])).toEqual({ help: true });
  expect(VAULT_USAGE).toContain('npm run vault -- [选项]');
  expect(() => parseVaultArguments(['--prot'])).toThrow(/未知参数：--prot[\s\S]*--help/);
});

test('Vault CLI rejects missing and invalid port values in Chinese', () => {
  expect(() => parseVaultArguments(['--port'])).toThrow(/--port 后需要一个值/);
  for (const value of ['abc', '99999', '-1']) expect(() => parseVaultArguments(['--port', value])).toThrow(/端口必须是 0 到 65535 之间的整数/);
  expect(parseVaultArguments(['--port', '0'])).toEqual({ help: false, options: { noOpen: false, openOnly: false, port: 0 } });
});

test('Vault CLI accepts explicit root and behavior flags', () => {
  expect(parseVaultArguments(['--root', 'C:/study', '--no-open', '--open'])).toEqual({
    help: false, options: { root: 'C:/study', noOpen: true, openOnly: true },
  });
});

test('managed snapshots invoke the exported CLI exactly once and legacy imports are not invoked twice', async () => {
  const args = ['--root', 'C:/study', '--no-open'];
  const calls: string[][] = [];
  await runManagedVaultEntry({ runVault: async received => { calls.push([...(received ?? [])]); } }, args);
  expect(calls).toEqual([args]);

  // Importing an old snapshot already ran its former top-level entry point;
  // it has no export for the new launcher to call a second time.
  let legacyTopLevelRuns = 0;
  const legacyModule = await Promise.resolve().then(() => { legacyTopLevelRuns++; return {}; });
  await runManagedVaultEntry(legacyModule, args);
  expect(legacyTopLevelRuns).toBe(1);
});
