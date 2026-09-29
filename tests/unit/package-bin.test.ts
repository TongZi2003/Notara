import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packageBin, outputNamed } from '../../scripts/package-bin.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('package entry points run under node on every platform', () => {
  // node_modules/.bin holds npm's shims: a symlink on POSIX, but a POSIX shell
  // script (plus .cmd/.ps1) on Windows, which node cannot execute.
  it('resolves the dsh and vitest executables to their JavaScript entry files', () => {
    for (const [name, pkg] of [['dsh', '@deepseek-ai/dsh'], ['vitest', 'vitest']] as const) {
      const entry = packageBin(project, pkg, name);
      expect(entry).toMatch(/\.(?:c|m)?js$/);
      expect(entry).not.toContain(`${'node_modules'}/.bin`);
      expect(readFileSync(entry, 'utf8').startsWith('#!/bin/sh')).toBe(false);
    }
  });
  it('names an unknown executable in its error', () => {
    expect(() => packageBin(project, '@deepseek-ai/dsh', 'no-such-bin')).toThrow(/no-such-bin/);
  });
});

describe('build outputs are found by name whatever the path separator', () => {
  it('matches forward and backward slashes', () => {
    const files = [{ path: 'C:\\repo\\dist\\client.js' }, { path: '/repo/dist/client.css' }, { path: '/repo/dist/other-client.js' }];
    expect(outputNamed(files, 'client.js')?.path).toBe('C:\\repo\\dist\\client.js');
    expect(outputNamed(files, 'client.css')?.path).toBe('/repo/dist/client.css');
    expect(outputNamed(files, 'missing.js')).toBeUndefined();
  });
});
