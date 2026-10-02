import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import lockfile from 'proper-lockfile';
import { readVaultState, validateVaultPort, writeVaultState } from './vault-launcher-state.ts';

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function relocateLinkTarget(sourceRoot: string, destinationRoot: string, sourcePath: string, target: string): string {
  const resolvedTarget = resolve(dirname(sourcePath), target);
  if (isWithin(sourceRoot, resolvedTarget)) return resolve(destinationRoot, relative(sourceRoot, resolvedTarget));
  // Keep absolute external targets stable. A relative external target would
  // resolve from a different parent after relocation, so pin its current target.
  return isAbsolute(target) ? target : resolvedTarget;
}

/** Copy without following directory links; Windows junctions need an explicit type. */
async function copyVaultTree(sourceRoot: string, destinationRoot: string, sourceDirectory: string, destinationDirectory: string): Promise<void> {
  for (const name of await readdir(sourceDirectory)) {
    const sourcePath = join(sourceDirectory, name), destinationPath = join(destinationDirectory, name);
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) {
      const target = await readlink(sourcePath);
      const destinationTarget = relocateLinkTarget(sourceRoot, destinationRoot, sourcePath, target);
      let targetInfo: Awaited<ReturnType<typeof stat>> | undefined;
      try { targetInfo = await stat(sourcePath); }
      catch (error) {
        if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Cannot preserve dangling Windows link during Vault migration: ${sourcePath}`);
        }
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (process.platform === 'win32') {
        if (!targetInfo) throw new Error(`Cannot determine Windows link type during Vault migration: ${sourcePath}`);
        await symlink(destinationTarget, destinationPath, targetInfo.isDirectory() ? 'junction' : 'file');
      } else {
        await symlink(destinationTarget, destinationPath);
      }
    } else if (info.isDirectory()) {
      await mkdir(destinationPath, { mode: info.mode & 0o777 });
      await copyVaultTree(sourceRoot, destinationRoot, sourcePath, destinationPath);
    } else if (info.isFile()) {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    } else {
      throw new Error(`Unsupported filesystem entry during Vault migration: ${sourcePath}`);
    }
  }
}

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
    // A stopped Vault removes its launcher record; one left behind must name a dead process.
    const recorded = await readFile(join(source, 'launcher.json'), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (recorded !== undefined) {
      const launcher = JSON.parse(recorded) as { pid: number };
      if (!Number.isInteger(launcher.pid) || launcher.pid < 1) throw new Error('Invalid source launcher');
      let active = true;
      try { process.kill(launcher.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') active = false; else throw error; }
      if (active) throw new Error('Stop the source Vault before migrating');
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await mkdir(destination, { mode: 0o700 });
    copied = true;
    // destination is an exclusively created, empty directory owned by this
    // migration. Copy entries individually so directory junctions keep their
    // Windows type instead of being recreated as file symlinks by fs.cp.
    await copyVaultTree(source, destination, source, destination);
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
    const rollbackErrors: unknown[] = [];
    if (aliased) {
      try { await unlink(source); aliased = false; }
      catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (moved && !aliased) {
      try { await rename(backup, source); moved = false; }
      catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (copied && !moved && !aliased) {
      try { await rm(destination, { recursive: true, force: true }); copied = false; }
      catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Vault migration failed and rollback was incomplete');
    throw error;
  } finally { await release(); }
}
