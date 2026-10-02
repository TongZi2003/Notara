import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { ensureWindowsPosix } from '../../scripts/windows-posix.ts';

test.skipIf(process.platform !== 'win32')('administrator-only default DACLs support native pipes without sharing sandbox temp capabilities', async () => {
  const binary = await ensureWindowsPosix(resolve('.'));
  // The synthetic default DACL belongs only to this disposable helper's token,
  // never the Vitest process, a DSH Host, or a real user's runtime.
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../fixtures/windows-admin-token-pipe.mjs', import.meta.url)), binary], {
    cwd: resolve('.'), windowsHide: true, timeout: 90_000, maxBuffer: 1024 * 1024,
  });
  expect(stderr).toBe('');
  const evidence = JSON.parse(stdout) as { allAssertionsPassed: boolean; cases: { mode: string; pipes: unknown[]; rows: { name: string; exitCode: number }[] }[] };
  expect(evidence.allAssertionsPassed).toBe(true);
  expect(evidence.cases.map(row => row.mode)).toEqual(['workspace-write', 'read-only']);
  for (const row of evidence.cases) {
    expect(row.pipes).toHaveLength(6);
    expect(row.rows).toHaveLength(8);
    expect(row.rows.filter(item => item.name === 'peer-temp-write' || item.name.startsWith('outside-')).every(item => item.exitCode !== 0)).toBe(true);
  }
}, 120_000);
