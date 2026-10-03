import fs from 'node:fs';
import { lstat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import lockfile from 'proper-lockfile';

const staleMs = 10_000;
const retryable = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

/** Release is shared by concurrent Stop calls. Upstream consumes its handle
 * before rmdir, so an exhausted release must remain rejected, never retried
 * later against a lock that another process may have acquired. */
export async function acquireVaultRootLock(root: string, filesystem: typeof fs = fs): Promise<() => Promise<void>> {
  // Use the same callback realpath as proper-lockfile; on Windows the promise
  // native variant may expand a short path differently.
  const canonical = await new Promise<string>((resolveRoot, reject) => {
    filesystem.realpath(root, (error, path) => { if (error) reject(error); else resolveRoot(path); });
  });
  const lockPath = `${canonical}.lock`;
  let owned = false;
  const adapter = {
    ...filesystem,
    rmdir(path: fs.PathLike, callback: fs.NoParamCallback): void {
      // During acquisition proper-lockfile may remove an old stale lock. Only
      // this acquired root's release gets the short sharing-violation retry.
      if (!owned || String(path) !== lockPath) { filesystem.rmdir(path, callback); return; }
      const remove = async (): Promise<void> => {
        const identity = await lstat(lockPath, { bigint: true });
        let lastError: unknown;
        for (let attempt = 0; ; attempt++) {
          if (attempt) {
            // Four attempts total; delays 100 + 200 + 300 = 600ms.
            await delay(attempt * 100);
            const current = await lstat(lockPath, { bigint: true });
            if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino ||
                current.birthtimeNs !== identity.birthtimeNs || Date.now() >= Number(current.mtimeNs / 1_000_000n) + staleMs) {
              throw lastError;
            }
          }
          try {
            await new Promise<void>((resolveRemoval, reject) => {
              filesystem.rmdir(path, error => { if (error) reject(error); else resolveRemoval(); });
            });
            return;
          } catch (error) {
            if (attempt === 3 || !retryable.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
            lastError = error;
          }
        }
      };
      void remove().then(() => callback(null), error => callback(error));
    },
  };
  const release = await lockfile.lock(root, { retries: 0, stale: staleMs, fs: adapter });
  owned = true;
  let releasing: Promise<void> | undefined;
  return () => (releasing ??= release());
}
