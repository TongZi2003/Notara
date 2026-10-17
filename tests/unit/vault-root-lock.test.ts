import fs from 'node:fs';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import lockfile from 'proper-lockfile';
import { acquireVaultRootLock } from '../../scripts/vault-root-lock.ts';

async function removeEmptyFixture(root: string): Promise<void> {
  await rmdir(`${root}.lock`).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(root);
}

test('concurrent Stop releases share completion and keep the real root lock until rmdir completes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-root-release-concurrent-'));
  let enter!: () => void;
  const entered = new Promise<void>(resolveEntered => { enter = resolveEntered; });
  let finish: (() => void) | undefined;
  let calls = 0;
  const filesystem = {
    ...fs,
    rmdir(path: fs.PathLike, callback: fs.NoParamCallback): void {
      if (resolve(String(path)) !== `${resolve(root)}.lock`) { fs.rmdir(path, callback); return; }
      calls++;
      finish = () => { finish = undefined; fs.rmdir(path, callback); };
      enter();
    },
  } as typeof fs;
  const release = await acquireVaultRootLock(root, filesystem);
  const first = release(), second = release();
  let firstDone = false, secondDone = false;
  const outcomes = [first.then(() => { firstDone = true; }), second.then(() => { secondDone = true; })];
  try {
    await entered;
    expect(first).toBe(second);
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);
    expect(calls).toBe(1);
    expect(await lockfile.check(root, { stale: 10_000 })).toBe(true);
    await expect(acquireVaultRootLock(root)).rejects.toMatchObject({ code: 'ELOCKED' });
    finish!();
    await Promise.all(outcomes);
    expect(firstDone && secondDone).toBe(true);
    expect(await lockfile.check(root, { stale: 10_000 })).toBe(false);
    await release();
    expect(calls).toBe(1);
  } finally {
    finish?.();
    await Promise.allSettled(outcomes);
    await removeEmptyFixture(root);
  }
});

test('one transient owned rmdir sharing violation is retried within the original real release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-root-release-transient-'));
  let calls = 0;
  const filesystem = {
    ...fs,
    rmdir(path: fs.PathLike, callback: fs.NoParamCallback): void {
      if (resolve(String(path)) === `${resolve(root)}.lock` && ++calls === 1) {
        queueMicrotask(() => callback(Object.assign(new Error('owned sharing violation'), { code: 'EBUSY' })));
      } else fs.rmdir(path, callback);
    },
  } as typeof fs;
  try {
    const release = await acquireVaultRootLock(root, filesystem);
    await release();
    expect(calls).toBe(2);
    expect(await lockfile.check(root, { stale: 10_000 })).toBe(false);
    await release();
    expect(calls).toBe(2);
  } finally { await removeEmptyFixture(root); }
});

test('an exhausted release stays rejected on later Stop and never blindly removes the retained real lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-root-release-terminal-'));
  const failure = Object.assign(new Error('persistent owned sharing violation'), { code: 'EBUSY' });
  let calls = 0;
  const filesystem = {
    ...fs,
    rmdir(path: fs.PathLike, callback: fs.NoParamCallback): void {
      if (resolve(String(path)) !== `${resolve(root)}.lock`) { fs.rmdir(path, callback); return; }
      calls++;
      queueMicrotask(() => callback(failure));
    },
  } as typeof fs;
  try {
    const release = await acquireVaultRootLock(root, filesystem);
    const first = release();
    await expect(first).rejects.toBe(failure);
    expect(calls).toBe(4);
    expect(await lockfile.check(root, { stale: 10_000 })).toBe(true);
    const next = release();
    expect(next).toBe(first);
    await expect(next).rejects.toBe(failure);
    expect(calls).toBe(4);
    expect(await lockfile.check(root, { stale: 10_000 })).toBe(true);
    await expect(acquireVaultRootLock(root)).rejects.toMatchObject({ code: 'ELOCKED' });
  } finally { await removeEmptyFixture(root); }
});

test('late heartbeat callbacks after release cannot compromise a released lock or its new owner', async () => {
  vi.useFakeTimers();
  const root = await mkdtemp(join(tmpdir(), 'notara-root-release-heartbeat-'));
  let holdHeartbeatStat = false;
  let lateStat: ((error: NodeJS.ErrnoException | null, stats: fs.Stats) => void) | undefined;
  const lockPath = `${resolve(root)}.lock`;
  const filesystem = {
    ...fs,
    stat(path: fs.PathLike, callback: (error: NodeJS.ErrnoException | null, stats: fs.Stats) => void): void {
      if (holdHeartbeatStat && resolve(String(path)) === lockPath) { lateStat = callback; return; }
      fs.stat(path, callback);
    },
  } as typeof fs;
  let release: (() => Promise<void>) | undefined;
  let newOwner: (() => Promise<void>) | undefined;
  let released = false;
  try {
    release = await acquireVaultRootLock(root, filesystem);
    holdHeartbeatStat = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lateStat).toBeDefined();
    const oldHeartbeat = lateStat!;
    await release();
    released = true;
    expect(await lockfile.check(root, { stale: 10_000 })).toBe(false);
    const missing = Object.assign(new Error('released lock path is gone'), { code: 'ENOENT' });
    expect(() => oldHeartbeat(missing, undefined as unknown as fs.Stats)).not.toThrow();

    newOwner = await acquireVaultRootLock(root);
    const replacementStat = await new Promise<fs.Stats>((resolveStats, reject) => fs.stat(lockPath, (error, stats) => error ? reject(error) : resolveStats(stats)));
    expect(() => oldHeartbeat(null, replacementStat)).not.toThrow();
    expect(await lockfile.check(root, { stale: 10_000 })).toBe(true);
    await newOwner(); newOwner = undefined;
  } finally {
    await newOwner?.().catch(() => {});
    if (release && !released) await release().catch(() => {});
    vi.useRealTimers();
    await removeEmptyFixture(root);
  }
});

test('an active owner heartbeat ENOENT remains a proper-lockfile compromise', async () => {
  vi.useFakeTimers();
  const root = await mkdtemp(join(tmpdir(), 'notara-root-active-heartbeat-'));
  let holdHeartbeatStat = false;
  let lateStat: ((error: NodeJS.ErrnoException | null, stats: fs.Stats) => void) | undefined;
  const lockPath = `${resolve(root)}.lock`;
  const filesystem = {
    ...fs,
    stat(path: fs.PathLike, callback: (error: NodeJS.ErrnoException | null, stats: fs.Stats) => void): void {
      if (holdHeartbeatStat && resolve(String(path)) === lockPath) { lateStat = callback; return; }
      fs.stat(path, callback);
    },
  } as typeof fs;
  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireVaultRootLock(root, filesystem);
    holdHeartbeatStat = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lateStat).toBeDefined();
    const missing = Object.assign(new Error('active lock path disappeared'), { code: 'ENOENT' });
    expect(() => lateStat!(missing, undefined as unknown as fs.Stats)).toThrow(expect.objectContaining({ code: 'ECOMPROMISED' }));
  } finally {
    vi.useRealTimers();
    await release?.().catch(() => {});
    await removeEmptyFixture(root);
  }
});
