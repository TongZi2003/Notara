import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { patchSidebarReady, SIDEBAR_READY_PATCH } from '../../scripts/patch-sidebar-ready.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = resolve(project, 'node_modules', SIDEBAR_READY_PATCH.artifact);
const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

function originalArtifact(): string {
  const installed = readFileSync(sourcePath, 'utf8');
  if (sha(installed) === SIDEBAR_READY_PATCH.originalSha) return installed;
  if (sha(installed) !== SIDEBAR_READY_PATCH.patchedSha) throw new Error('Unexpected installed DSH sidebar-right artifact');
  const original = installed.replace(SIDEBAR_READY_PATCH.after, SIDEBAR_READY_PATCH.before);
  if (sha(original) !== SIDEBAR_READY_PATCH.originalSha) throw new Error('Unable to reconstruct locked DSH sidebar-right fixture');
  return original;
}

test('locked DSH sidebar-right ready patch is hash guarded and idempotent', () => {
  const original = originalArtifact();
  const patched = patchSidebarReady(original);
  expect(sha(patched)).toBe(SIDEBAR_READY_PATCH.patchedSha);
  expect(patched).toContain(SIDEBAR_READY_PATCH.after);
  expect(patchSidebarReady(patched)).toBe(patched);
  expect(() => patchSidebarReady(original + '\n// unknown upstream change')).toThrow(/Unknown DSH sidebar-right artifact/);
});

test('disposed references do not log cancellation, while a live view reports open failure', async () => {
  const patched = patchSidebarReady(originalArtifact());
  expect(patched.split(SIDEBAR_READY_PATCH.after)).toHaveLength(2);
  const logs: unknown[][] = [];
  const consoleStub = { error: (...args: unknown[]) => logs.push(args) };
  const attachReadyLogger = new Function('console', SIDEBAR_READY_PATCH.after) as (this: { disposed: boolean; reference: { ready: Promise<unknown> } }, console: typeof consoleStub) => void;

  const released = new Error('Session reference "session-test" is released');
  attachReadyLogger.call({ disposed: true, reference: { ready: Promise.reject(released) } }, consoleStub);
  const openFailure = new Error('initial history read failed');
  attachReadyLogger.call({ disposed: false, reference: { ready: Promise.reject(openFailure) } }, consoleStub);
  await Promise.resolve();

  expect(logs).toEqual([['Sidebar Session opening failed:', openFailure]]);
});
