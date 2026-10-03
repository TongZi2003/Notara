import { lstat, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { LockOptions } from 'proper-lockfile';

type BuildKind = 'native-vault' | 'pixel-classroom';
type Options = Pick<LockOptions, 'retries'>;
const pendingBuild = (project: string, kind: BuildKind) => join(project, '.runtime', `vault-build-${kind}.pending`);

/** Writers and snapshot readers share one checkout lock across processes. */
export async function acquireVaultBuildLock(project: string, options: Options = {}): Promise<() => Promise<void>> {
  const directory = join(await realpath(project), '.runtime');
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'vault-build');
  const file = await open(target, 'a', 0o600);
  await file.close();
  return lockfile.lock(target, {
    stale: 30_000,
    retries: options.retries ?? { retries: 120, minTimeout: 100, maxTimeout: 500, factor: 1.1 },
  });
}

export async function withVaultBuildLock<T>(project: string, operation: () => Promise<T>, options: Options = {}): Promise<T> {
  const release = await acquireVaultBuildLock(project, options);
  try { return await operation(); } finally { await release(); }
}

/** An interrupted build must not become a supposedly complete runtime snapshot. */
export async function withVaultBuild<T>(project: string, kind: BuildKind, operation: () => Promise<T>): Promise<T> {
  return withVaultBuildLock(project, async () => {
    const pending = pendingBuild(project, kind);
    await writeFile(pending, `${process.pid}\n`, { mode: 0o600 });
    const result = await operation();
    await rm(pending);
    return result;
  });
}

export async function withVaultBuiltSnapshot<T>(project: string, kinds: BuildKind[], operation: () => Promise<T>, options: Options = {}): Promise<T> {
  return withVaultBuildLock(project, async () => {
    for (const kind of kinds) {
      const pending = await lstat(pendingBuild(project, kind)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (pending) throw new Error(`Notara ${kind} 的上次构建未完成，请先运行 npm run build:${kind}，再启动或打包。`);
    }
    return operation();
  }, options);
}
