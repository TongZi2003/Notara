import { expect, test } from 'vitest';
import { vaultRootsOverlap } from '../../scripts/migrate-vault-runtime.ts';

test('Windows Vault root containment compares case-insensitively and respects path boundaries', () => {
  expect(vaultRootsOverlap('C:\\Study\\Vault', 'c:\\study\\vault', 'win32')).toBe(true);
  expect(vaultRootsOverlap('C:\\Study\\Vault', 'c:\\STUDY\\VAULT\\child', 'win32')).toBe(true);
  expect(vaultRootsOverlap('C:\\Study\\Vault', 'C:\\Study\\Vault-old', 'win32')).toBe(false);
  expect(vaultRootsOverlap('C:\\Study\\Vault', 'D:\\Study\\Vault', 'win32')).toBe(false);
});
