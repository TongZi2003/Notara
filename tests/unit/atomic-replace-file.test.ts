import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { replaceFileAtomically } from '../../scripts/atomic-replace-file.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test('a transient Windows sharing error retries the same atomic replacement and leaves no temporary file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-atomic-patch-')); roots.push(root);
  const target = join(root, 'storage.js');
  await writeFile(target, 'original');
  const attempts: [string, string][] = [], delays: number[] = [];
  await replaceFileAtomically(target, 'patched', {
    platform: 'win32',
    async renameFile(temporary, destination) {
      attempts.push([temporary, destination]);
      if (attempts.length === 1) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
      const { rename } = await import('node:fs/promises'); await rename(temporary, destination);
    },
    async pause(milliseconds) { delays.push(milliseconds); },
  });
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(delays).toEqual([20]);
  expect(await readFile(target, 'utf8')).toBe('patched');
  expect(await readdir(root)).toEqual(['storage.js']);
});

test('a persistent rename failure preserves the original and cleans its sibling temporary file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-atomic-patch-')); roots.push(root);
  const target = join(root, 'storage.js');
  await writeFile(target, 'original');
  let attempts = 0;
  await expect(replaceFileAtomically(target, 'patched', {
    platform: 'win32',
    async renameFile() { attempts++; throw Object.assign(new Error('sharing violation'), { code: 'EACCES' }); },
    async pause() {},
  })).rejects.toMatchObject({ code: 'EACCES' });
  expect(attempts).toBe(6);
  expect(await readFile(target, 'utf8')).toBe('original');
  expect(await readdir(root)).toEqual(['storage.js']);
});
