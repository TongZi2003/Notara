import { readFile, writeFile, rename, chmod, lstat, symlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export interface VaultState { kind: 'notara-vault-persistent'; version: 1; port: number; testModel: boolean; legacyRoots?: string[] }
export function validateVaultPort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Vault port');
}
export async function readVaultState(root: string): Promise<VaultState | undefined> {
  let raw: string;
  try { raw = await readFile(join(root, 'vault-runtime.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const state = JSON.parse(raw) as VaultState;
  if (state?.kind !== 'notara-vault-persistent' || state.version !== 1 || typeof state.testModel !== 'boolean') throw new Error('Invalid Vault runtime registration');
  validateVaultPort(state.port);
  if (state.legacyRoots !== undefined && (!Array.isArray(state.legacyRoots) || state.legacyRoots.some(path => typeof path !== 'string' || !isAbsolute(path)))) throw new Error('Invalid legacy Vault roots');
  return state;
}
/** Old native session headers keep their cwd; preserve those paths without editing logs. */
export async function ensureVaultAliases(root: string, state: VaultState): Promise<void> {
  for (const legacy of state.legacyRoots ?? []) {
    if (resolve(legacy) === resolve(root)) throw new Error('Invalid self-referencing Vault alias');
    const info = await lstat(legacy).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!info) await symlink(root, legacy, process.platform === 'win32' ? 'junction' : 'dir');
    else if (!info.isSymbolicLink() || await realpath(legacy) !== await realpath(root)) throw new Error('Legacy Vault path is occupied; no files were replaced');
  }
}
export async function writeVaultState(root: string, state: VaultState): Promise<void> {
  validateVaultPort(state.port);
  const path = join(root, 'vault-runtime.json');
  await writeFile(path + '.next', JSON.stringify(state), { mode: 0o600 });
  await rename(path + '.next', path);
}

/** Only return a live process's current, loopback login URL. Never a saved plain origin. */
export async function liveVaultUrl(root: string): Promise<string | undefined> {
  let record: { pid: number; authUrl: string };
  try { record = JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const state = await readVaultState(root);
  if (!state || !Number.isInteger(record.pid) || record.pid < 1) return undefined;
  const url = new URL(record.authUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || Number(url.port) !== state.port || !url.searchParams.has('token')) throw new Error('Invalid Vault login address');
  try { process.kill(record.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return undefined; throw error; }
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    if (response.status !== 303 || response.headers.get('location') !== '/' || !response.headers.getSetCookie().some(value => value.startsWith('dsh-auth-'))) throw new Error('运行中的服务与保存的登录入口不一致；请检查该实例，不要另起服务。');
  } catch (error) { throw new Error('无法核对运行中的 Vault；未尝试替换服务。', { cause: error }); }
  await chmod(join(root, 'launcher.json'), 0o600);
  return record.authUrl;
}
