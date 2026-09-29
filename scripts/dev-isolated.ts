// The common isolated-runtime entry point: tests and the launchers reach the
// standalone Native Vault through here. The legacy workbench that also booted
// from this file was retired with the move to DSH 0.2.0.
export type { VaultOptions, VaultRuntime } from './dev-native-vault.ts';
export async function startVaultIsolated(options: import('./dev-native-vault.ts').VaultOptions = {}): Promise<import('./dev-native-vault.ts').VaultRuntime> {
  const vault = await import('./dev-native-vault.ts');
  return vault.startVaultIsolated(options);
}

/** Explicit long-lived Vault entry; tests still pass a temporary root. */
export async function startVaultPersistent(root: string, options: import('./dev-native-vault.ts').VaultPersistentOptions = {}): Promise<import('./dev-native-vault.ts').VaultRuntime> {
  const vault = await import('./dev-native-vault.ts');
  return vault.startVaultPersistent(root, options);
}
export async function upgradeVaultPersistent(root: string): ReturnType<typeof import('./dev-native-vault.ts').upgradeVaultPersistent> {
  return (await import('./dev-native-vault.ts')).upgradeVaultPersistent(root);
}
export async function vaultVersions(root: string): ReturnType<typeof import('./dev-native-vault.ts').vaultVersions> {
  return (await import('./dev-native-vault.ts')).vaultVersions(root);
}
