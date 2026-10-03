import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
test.skipIf(process.platform !== 'win32')('Windows Stop waits for the owned tree, retries sharing violations and retains ownership until cleanup succeeds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notara-owned-stop-'));
  const project = resolve('.');
  try {
    const result = await execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(project, 'tests/fixtures/stop-regression-preload.mjs')).href,
      '--import', pathToFileURL(join(project, 'node_modules/tsx/dist/loader.mjs')).href,
      join(project, 'tests/fixtures/stop-regression-worker.mjs'), directory,
    ], { cwd: project, windowsHide: true, timeout: 25_000, maxBuffer: 100_000 });
    const proof = JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Record<string, unknown>;
    expect(proof).toMatchObject({ result: 'PASS', actualHostCount: 1, taskkillCalls: 1, rmCalls: 2 });
    expect(proof.injectedBusy).toBeGreaterThanOrEqual(10);
    expect(proof.unlinkAttempts).toBeGreaterThanOrEqual(11);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); }
});
