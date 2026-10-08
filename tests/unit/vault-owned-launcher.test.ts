import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { acquireVaultRootLock } from '../../scripts/vault-root-lock.ts';
import { captureOwnedVaultLauncher, cleanupStoppedVaultLauncher } from '../../scripts/vault-owned-launcher.ts';

const recordPath = (root: string): string => join(root, 'launcher.json');
const recordBytes = (pid: number, parentPid: number, authUrl: string): string => JSON.stringify({ pid, parentPid, authUrl, workspace: '/unused' });

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'notara-owned-launcher-'));
}

test('cleans an owned stopped launcher record without exposing its login URL', async () => {
  const root = await fixture(), parentPid = 91_001, pid = 91_002, authUrl = 'http://127.0.0.1:57093/?token=private-token';
  try {
    await writeFile(recordPath(root), recordBytes(pid, parentPid, authUrl));
    const owned = await captureOwnedVaultLauncher(root, parentPid, authUrl);
    expect(owned).toMatchObject({ pid, parentPid, authUrl });
    await cleanupStoppedVaultLauncher(root, owned, { isPidAlive: () => false });
    await expect(readFile(recordPath(root))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('does not claim or remove a replacement owner record', async () => {
  const root = await fixture(), oldParent = 91_011, oldPid = 91_012, oldUrl = 'http://127.0.0.1:57093/?token=old';
  const newBytes = recordBytes(91_022, 91_021, 'http://127.0.0.1:57094/?token=new');
  try {
    await writeFile(recordPath(root), recordBytes(oldPid, oldParent, oldUrl));
    const owned = await captureOwnedVaultLauncher(root, oldParent, oldUrl);
    expect(owned).toBeDefined();
    await writeFile(recordPath(root), newBytes);
    await cleanupStoppedVaultLauncher(root, owned, { isPidAlive: () => false });
    expect(await readFile(recordPath(root), 'utf8')).toBe(newBytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses to remove the record while either owned process may still be alive', async () => {
  const root = await fixture(), parentPid = 91_031, pid = 91_032, authUrl = 'http://127.0.0.1:57093/?token=must-not-leak';
  const bytes = recordBytes(pid, parentPid, authUrl);
  try {
    await writeFile(recordPath(root), bytes);
    const owned = await captureOwnedVaultLauncher(root, parentPid, authUrl);
    expect(owned).toBeDefined();
    await expect(cleanupStoppedVaultLauncher(root, owned, { isPidAlive: candidate => candidate === pid }))
      .rejects.toThrow('while its owned process may still be alive');
    expect(await readFile(recordPath(root), 'utf8')).toBe(bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('default PID inspection treats EPERM and a live PID as owned processes', async () => {
  const root = await fixture(), parentPid = 91_035, pid = 91_036, authUrl = 'http://127.0.0.1:57093/?token=private';
  const bytes = recordBytes(pid, parentPid, authUrl);
  const kill = vi.spyOn(process, 'kill').mockImplementation(candidate => {
    if (candidate === pid) throw Object.assign(new Error('inaccessible PID'), { code: 'EPERM' });
    return true;
  });
  try {
    await writeFile(recordPath(root), bytes);
    const owned = await captureOwnedVaultLauncher(root, parentPid, authUrl);
    expect(owned).toBeDefined();
    await expect(cleanupStoppedVaultLauncher(root, owned)).rejects.toThrow('may still be alive');
    expect(kill.mock.calls).toEqual([[pid, 0]]);
    expect(await readFile(recordPath(root), 'utf8')).toBe(bytes);
  } finally { kill.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

test('refuses cleanup when the owned parent worker remains alive after its Host exits', async () => {
  const root = await fixture(), parentPid = 91_045, pid = 91_046, authUrl = 'http://127.0.0.1:57093/?token=private';
  const bytes = recordBytes(pid, parentPid, authUrl);
  const kill = vi.spyOn(process, 'kill').mockImplementation(candidate => {
    if (candidate === pid) throw Object.assign(new Error('Host exited'), { code: 'ESRCH' });
    return true;
  });
  try {
    await writeFile(recordPath(root), bytes);
    const owned = await captureOwnedVaultLauncher(root, parentPid, authUrl);
    expect(owned).toBeDefined();
    await expect(cleanupStoppedVaultLauncher(root, owned)).rejects.toThrow('may still be alive');
    expect(kill.mock.calls).toEqual([[pid, 0], [parentPid, 0]]);
    expect(await readFile(recordPath(root), 'utf8')).toBe(bytes);
  } finally { kill.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

test('bounded root-lock wait expiry preserves the matching stopped launcher record', async () => {
  const root = await fixture(), parentPid = 91_055, pid = 91_056, authUrl = 'http://127.0.0.1:57093/?token=private';
  const bytes = recordBytes(pid, parentPid, authUrl);
  let now = 10_000, waits = 0;
  let release: (() => Promise<void>) | undefined;
  try {
    await writeFile(recordPath(root), bytes);
    const owned = await captureOwnedVaultLauncher(root, parentPid, authUrl);
    expect(owned).toBeDefined();
    release = await acquireVaultRootLock(root);
    await expect(cleanupStoppedVaultLauncher(root, owned, {
      isPidAlive: () => false,
      now: () => now,
      delay: async milliseconds => { waits++; expect(milliseconds).toBe(200); now += 15_000; },
    })).rejects.toThrow('Timed out waiting for Vault root ownership');
    expect(waits).toBe(1);
    expect(await readFile(recordPath(root), 'utf8')).toBe(bytes);
  } finally { await release?.(); await rm(root, { recursive: true, force: true }); }
});

test('does not claim a record with a different parent PID or auth URL', async () => {
  const root = await fixture(), parentPid = 91_065, pid = 91_066, authUrl = 'http://127.0.0.1:57093/?token=private';
  try {
    await writeFile(recordPath(root), recordBytes(pid, parentPid, authUrl));
    expect(await captureOwnedVaultLauncher(root, parentPid + 1, authUrl)).toBeUndefined();
    expect(await captureOwnedVaultLauncher(root, parentPid, `${authUrl}-changed`)).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rechecks ownership after waiting for the root lock and preserves a replacement generation', async () => {
  const root = await fixture(), parentPid = 91_041, pid = 91_042, authUrl = 'http://127.0.0.1:57093/?token=old';
  const replacement = recordBytes(91_052, 91_051, 'http://127.0.0.1:57094/?token=replacement');
  let signalWaiting!: () => void, continueWait!: () => void;
  const waiting = new Promise<void>(resolve => { signalWaiting = resolve; });
  const gate = new Promise<void>(resolve => { continueWait = resolve; });
  let release: (() => Promise<void>) | undefined;
  try {
    await writeFile(recordPath(root), recordBytes(pid, parentPid, authUrl));
    const owned = await captureOwnedVaultLauncher(root, parentPid, authUrl);
    expect(owned).toBeDefined();
    release = await acquireVaultRootLock(root);
    const cleanup = cleanupStoppedVaultLauncher(root, owned, {
      isPidAlive: () => false,
      delay: async milliseconds => { expect(milliseconds).toBe(200); signalWaiting(); await gate; },
    });
    await waiting;
    await writeFile(recordPath(root), replacement);
    continueWait();
    await cleanup;
    expect(await readFile(recordPath(root), 'utf8')).toBe(replacement);
  } finally {
    continueWait();
    await release?.();
    await rm(root, { recursive: true, force: true });
  }
});
