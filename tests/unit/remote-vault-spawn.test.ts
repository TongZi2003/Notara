import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { statePaths, waitForController, waitForControllerProcess } from '../../scripts/remote-vault.ts';

test('a controller spawn failure rejects immediately and records a private diagnostic', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-controller-spawn-'));
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: NodeJS.Signals | null };
  child.exitCode = null;
  child.signalCode = null;
  let pollWasAborted = false;
  const paths = statePaths(join(root, 'remote.yml'));
  const waiting = waitForControllerProcess(signal => {
    signal.addEventListener('abort', () => { pollWasAborted = true; }, { once: true });
    return waitForController(paths, root, 120_000, signal);
  }, child as unknown as ChildProcess, join(root, 'controller.log'));
  child.emit('error', Object.assign(new Error('synthetic spawn failure'), { code: 'ENOENT' }));
  try {
    await expect(waiting).rejects.toThrow(/Could not start the remote controller.*controller\.log/);
    expect(await readFile(join(root, 'controller.log'), 'utf8')).toContain('synthetic spawn failure');
    expect(pollWasAborted).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
