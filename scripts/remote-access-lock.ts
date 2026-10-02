import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { assertPrivateDirectoryOutsideCheckout, securePrivatePath } from './remote-access-config.ts';

export async function acquireRemoteAccessLock(runtimeRoot: string): Promise<() => Promise<void>> {
  const directory = join(resolve(runtimeRoot), '.notara', 'remote-access');
  await assertPrivateDirectoryOutsideCheckout(directory);
  const target = join(directory, 'active');
  const handle = await open(target, 'a', 0o600);
  await handle.close();
  await securePrivatePath(target);
  try {
    return await lockfile.lock(target, { retries: 0, stale: 15_000, update: 5_000 });
  } catch (error) {
    throw new Error('remote_busy', { cause: error });
  }
}
