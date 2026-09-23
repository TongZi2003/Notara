import { cp, lstat, mkdir, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import lockfile from 'proper-lockfile';
import { readVaultState, validateVaultPort, writeVaultState } from './vault-launcher-state.ts';

/** Explicit, offline relocation. Copy credentials opaquely and never rewrite classroom logs. */
export async function relocateVaultRuntime(sourceInput: string, destinationInput: string, port: number): Promise<{ root: string; backup: string }> {
  validateVaultPort(port);
  if (port === 0) throw new Error('Migration requires the existing fixed port');
  const source = await realpath(sourceInput), destination = resolve(destinationInput), backup = source + '.pre-persistent';
  if (destination === source || destination.startsWith(source + sep) || source.startsWith(destination + sep)) throw new Error('Vault roots must be separate');
  for (const path of [destination, backup]) {
    if (await lstat(path).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Migration target or backup already exists');
  }
  const release = await lockfile.lock(source, { retries: 0, realpath: false });
  let copied = false, moved = false, aliased = false;
  try {
    const launcher = JSON.parse(await readFile(join(source, 'launcher.json'), 'utf8')) as { pid: number };
    if (!Number.isInteger(launcher.pid) || launcher.pid < 1) throw new Error('Invalid source launcher');
    let active = true;
    try { process.kill(launcher.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') active = false; else throw error; }
    if (active) throw new Error('Stop the source Vault before migrating');
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await mkdir(destination, { mode: 0o700 });
    copied = true;
    // destination is an exclusively created, empty directory owned by this
    // migration; directory copy must allow that root to exist.
    await cp(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true, force: false });
    const file = join(destination, 'home/storages/workspace.json');
    const registry = JSON.parse(await readFile(file, 'utf8'));
    if (!registry?.tables?.workspaces) throw new Error('Unsupported workspace registry');
    // Only directory metadata moves. User-owned external workspace paths and
    // every workspace/session id stay exactly as they were.
    for (const entry of Object.values(registry.tables.workspaces) as { path: string }[]) {
      for (const old of [source, resolve(sourceInput)]) {
        if (entry.path === old || entry.path.startsWith(old + sep)) { entry.path = destination + entry.path.slice(old.length); break; }
      }
    }
    await writeFile(file, JSON.stringify(registry, null, 2));
    const previous = await readVaultState(source);
    await writeVaultState(destination, {
      kind: 'notara-vault-persistent', version: 1, port, testModel: previous?.testModel ?? false,
      legacyRoots: [...new Set([...(previous?.legacyRoots ?? []), source])],
    });
    await rename(source, backup); moved = true;
    await symlink(destination, source, process.platform === 'win32' ? 'junction' : 'dir'); aliased = true;
    return { root: destination, backup };
  } catch (error) {
    if (aliased) await unlink(source);
    if (moved) await rename(backup, source);
    if (copied) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally { await release(); }
}
