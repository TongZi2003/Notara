import { readFile, writeFile, rename, chmod, lstat, symlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { httpUrlPort, isBrowserBlockedPort } from '../examples/native-vault/http-port.js';
export { httpUrlPort, isBrowserBlockedPort } from '../examples/native-vault/http-port.js';

export interface VaultState { kind: 'notara-vault-persistent'; version: 1; port: number; testModel: boolean; legacyRoots?: string[] }
function validatePortNumber(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Vault port');
}
export function validateVaultPort(port: number): void {
  validatePortNumber(port);
  // Zero is the launcher's automatic-selection sentinel, never a live URL.
  if (port !== 0 && isBrowserBlockedPort(port)) throw new Error(`端口 ${port} 被浏览器禁止访问；请改用其他端口，或使用 --port 0 自动选择。`);
}
export async function readVaultState(root: string): Promise<VaultState | undefined> {
  let raw: string;
  try { raw = await readFile(join(root, 'vault-runtime.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const state = JSON.parse(raw) as VaultState;
  if (state?.kind !== 'notara-vault-persistent' || state.version !== 1 || typeof state.testModel !== 'boolean') throw new Error('Invalid Vault runtime registration');
  // Older launchers could save an inaccessible port. Still read that record so
  // an explicit --port override can recover the same instance without data loss.
  validatePortNumber(state.port);
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
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || httpUrlPort(url) !== state.port || !url.searchParams.has('token')) throw new Error('Invalid Vault login address');
  try { process.kill(record.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return undefined; throw error; }
  let response: Response;
  try { response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) }); }
  catch (error) {
    // Nothing listens on the recorded port: the pid now belongs to another
    // process (Windows reuses ids quickly), so no Vault is running here.
    if (((error as { cause?: NodeJS.ErrnoException }).cause)?.code === 'ECONNREFUSED') return undefined;
    throw new Error('无法核对运行中的 Vault；未尝试替换服务。', { cause: error });
  }
  try {
    await response.body?.cancel();
    // DSH 0.2.0 answers with a relative `./`; what matters is that it lands on the root without the token.
    const landing = new URL(response.headers.get('location') ?? '', url);
    if (response.status !== 303 || landing.origin !== url.origin || landing.pathname !== '/' || landing.search !== '' || !response.headers.getSetCookie().some(value => value.startsWith('dsh-auth-'))) throw new Error('运行中的服务与保存的登录入口不一致；请检查该实例，不要另起服务。');
  } catch (error) { throw new Error('无法核对运行中的 Vault；未尝试替换服务。', { cause: error }); }
  await chmod(join(root, 'launcher.json'), 0o600);
  return record.authUrl;
}

async function packageVersion(dir: string): Promise<string | undefined> {
  try { return (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { version?: string }).version; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
/** The plugin version an instance runs, and the one the checkout at `project` would install. */
export const vaultPluginLinks = (root: string): string[] => ['workspace', 'home/profiles/web'].map(prefix => join(root, prefix, 'node_modules/@notara/vault-native'));

/** Earlier installs linked a versioned snapshot; the module links are authoritative. */
export async function installedPluginRoot(root: string): Promise<string> {
  const targets = await Promise.all(vaultPluginLinks(root).map(path => realpath(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  })));
  const installed = [...new Set(targets.filter((path): path is string => path !== undefined))];
  if (installed.length > 1) throw new Error('Vault 的两处插件链接指向不同快照；请先核对安装目录。');
  return installed[0] ?? join(resolve(root), 'vault-plugin');
}

export async function pluginVersions(root: string, project: string): Promise<{ snapshot: string | undefined; checkout: string | undefined }> {
  return { snapshot: await packageVersion(await installedPluginRoot(root)), checkout: await packageVersion(join(project, 'examples/native-vault')) };
}

/** The Vault release that moved to DSH 0.2.0. */
const DSH_020_VAULT = [0, 21, 0];
const release = (version: string): number[] | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? match.slice(1).map(Number) : undefined;
};
const before = (a: number[], b: number[]): boolean => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]!; return false; };
/**
 * DSH 0.2.0 (Vault 0.21.0) cannot boot an older snapshot and converts each
 * lesson it opens, which the older DSH then cannot read: a directory on an
 * older snapshot is backed up and upgraded before a 0.21+ checkout starts it.
 */
export function mustUpgradeBeforeStart({ snapshot, checkout }: { snapshot: string | undefined; checkout: string | undefined }): boolean {
  const from = snapshot === undefined ? undefined : release(snapshot), to = checkout === undefined ? undefined : release(checkout);
  return !!from && !!to && before(from, DSH_020_VAULT) && !before(to, DSH_020_VAULT);
}
