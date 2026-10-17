import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireVaultRootLock } from './vault-root-lock.ts';

const waitMs = 200;
const waitLimitMs = 15_000;

export interface OwnedVaultLauncher {
  readonly pid: number;
  readonly parentPid: number;
  readonly authUrl: string;
  /** Exact bytes prevent a later launcher generation from inheriting ownership. */
  readonly bytes: Buffer;
}

export interface VaultLauncherCleanupDependencies {
  isPidAlive?: (pid: number) => boolean | Promise<boolean>;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

function positivePid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function pidMayBeAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // Only ESRCH proves absence. Permission or platform errors must fail closed.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function readRecord(path: string): Promise<{ bytes: Buffer; record: Record<string, unknown> } | undefined> {
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Cannot safely inspect the Vault launcher record.');
  }
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return { bytes, record: value as Record<string, unknown> };
  } catch {
    // Malformed content is never claimed or removed; do not echo it in errors.
    return undefined;
  }
}

/** Capture only the launcher record published by this exact worker generation. */
export async function captureOwnedVaultLauncher(root: string, parentPid: number, authUrl: string): Promise<OwnedVaultLauncher | undefined> {
  if (!positivePid(parentPid) || typeof authUrl !== 'string' || !authUrl) return undefined;
  const current = await readRecord(join(root, 'launcher.json'));
  if (!current) return undefined;
  const { pid, parentPid: recordParent, authUrl: recordUrl } = current.record;
  if (!positivePid(pid) || recordParent !== parentPid || recordUrl !== authUrl) return undefined;
  return { pid, parentPid, authUrl, bytes: Buffer.from(current.bytes) };
}

function stillOwns(current: Awaited<ReturnType<typeof readRecord>>, owned: OwnedVaultLauncher): boolean {
  return !!current && current.bytes.equals(owned.bytes) && current.record.pid === owned.pid &&
    current.record.parentPid === owned.parentPid && current.record.authUrl === owned.authUrl;
}

/** Remove only our stopped worker's exact record while holding its runtime-root lock. */
export async function cleanupStoppedVaultLauncher(
  root: string,
  owned: OwnedVaultLauncher | undefined,
  dependencies: VaultLauncherCleanupDependencies = {},
): Promise<void> {
  if (!owned) return;
  const path = join(root, 'launcher.json');
  const isAlive = dependencies.isPidAlive ?? pidMayBeAlive;
  const wait = dependencies.delay ?? (milliseconds => delay(milliseconds).then(() => undefined));
  const now = dependencies.now ?? Date.now;
  const deadline = now() + waitLimitMs;
  const assertStopped = async (): Promise<void> => {
    if (await isAlive(owned.pid) || await isAlive(owned.parentPid)) {
      throw new Error('Cannot clean the Vault launcher record while its owned process may still be alive.');
    }
  };

  for (;;) {
    const beforeLock = await readRecord(path);
    if (!stillOwns(beforeLock, owned)) return;
    await assertStopped();

    let release: () => Promise<void>;
    try { release = await acquireVaultRootLock(root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') throw new Error('Cannot safely acquire the Vault root lock to clean its launcher record.');
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('Timed out waiting for Vault root ownership before launcher cleanup.');
      await wait(Math.min(waitMs, remaining));
      continue;
    }
    try {
      const current = await readRecord(path);
      if (!stillOwns(current, owned)) return;
      await assertStopped();
      try { await unlink(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot safely remove the stopped Vault launcher record.'); }
      return;
    } finally { await release(); }
  }
}
