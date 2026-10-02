import { mkdtemp, readFile, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';

const permissionCalls = vi.hoisted(() => ({ windows: vi.fn(), posix: vi.fn() }));
// A failed boundary regression must never alter the actual checkout's ACL.
// Observe both permission APIs while retaining real path/junction resolution.
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      permissionCalls.windows(...args.slice(0, -1));
      (args.at(-1) as (error: null, stdout: string, stderr: string) => void)(null, '', '');
    },
  };
});
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  chmod: permissionCalls.posix,
}));

import {
  assertPrivateDirectoryOutsideCheckout, assertPrivatePathOutsideCheckout,
  ensurePrivateDirectory, readRemoteConfig, securePrivatePath, writePrivateFile,
} from '../../scripts/remote-access-config.ts';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const permissionCount = () => permissionCalls.windows.mock.calls.length + permissionCalls.posix.mock.calls.length;

async function removeTemporaryRoot(directory: string, prefix: string, alias: string): Promise<void> {
  const actual = await realpath(directory);
  const parent = await realpath(tmpdir());
  const compare = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  if (compare(dirname(actual)) !== compare(parent) || !basename(actual).startsWith(prefix)) {
    throw new Error(`Refusing to remove a path outside this test's mkdtemp root: ${actual}`);
  }
  // Remove the link itself first, so recursive cleanup cannot reach its target.
  try { await unlink(join(actual, basename(alias))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await rm(actual, { recursive: true, force: true });
}

test('private directory entry points reject checkout ancestors before attempting any permission change', async () => {
  const ancestor = dirname(checkout);
  const before = await stat(ancestor);
  const calls = permissionCount();
  await expect(ensurePrivateDirectory(ancestor)).rejects.toThrow(/contain.*checkout/i);
  await expect(assertPrivateDirectoryOutsideCheckout(ancestor)).rejects.toThrow(/contain.*checkout/i);
  await expect(securePrivatePath(ancestor, true)).rejects.toThrow(/contain.*checkout/i);
  // Windows selects directory inheritance from the actual path type, so
  // omitting the optional flag must not bypass directory protection.
  await expect(securePrivatePath(ancestor)).rejects.toThrow(/contain.*checkout/i);
  await expect(readRemoteConfig(join(ancestor, 'notara-must-not-read-private-state.json'))).rejects.toThrow(/contain.*checkout/i);
  await expect(ensurePrivateDirectory(parse(checkout).root)).rejects.toThrow(/checkout|root/i);
  await expect(ensurePrivateDirectory(homedir())).rejects.toThrow(/checkout|user home/i);
  expect(permissionCount()).toBe(calls);
  const after = await stat(ancestor);
  expect([after.ctimeMs, after.mode]).toEqual([before.ctimeMs, before.mode]);
  // A configuration FILE outside the checkout still has the original rule;
  // only its containing directory is forbidden from inheriting into the code.
  expect(assertPrivatePathOutsideCheckout(join(ancestor, 'control.json'))).toBe(join(ancestor, 'control.json'));
});

test('junction or symlink aliases cannot secure a checkout ancestor or create private state inside the checkout', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'Notara private path boundary '));
  const alias = join(temporary, 'checkout ancestor alias');
  const ancestor = dirname(checkout);
  const before = await stat(ancestor);
  const calls = permissionCount();
  try {
    await symlink(ancestor, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(ensurePrivateDirectory(alias)).rejects.toThrow(/contain.*checkout/i);
    await expect(securePrivatePath(alias)).rejects.toThrow(/contain.*checkout/i);
    await expect(readRemoteConfig(join(alias, 'notara-must-not-read-private-state.json'))).rejects.toThrow(/contain.*checkout/i);
    await expect(ensurePrivateDirectory(join(alias, basename(checkout)))).rejects.toThrow(/checkout/i);
    expect(permissionCount()).toBe(calls);
    const after = await stat(ancestor);
    expect([after.ctimeMs, after.mode]).toEqual([before.ctimeMs, before.mode]);
  } finally { await removeTemporaryRoot(temporary, 'Notara private path boundary ', alias); }
});

test('a dedicated sibling directory and its junction remain valid private storage', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'Notara private sibling '));
  const directory = join(temporary, 'private control');
  const alias = join(temporary, 'private alias');
  try {
    await ensurePrivateDirectory(directory);
    await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(ensurePrivateDirectory(alias)).resolves.toBeUndefined();
    await writePrivateFile(join(directory, 'control.json'), '{"format":1}\n');
    expect(await readFile(join(alias, 'control.json'), 'utf8')).toBe('{"format":1}\n');
    // An ordinary private file also remains allowed when no directory flag is passed.
    const plainFile = join(temporary, 'ordinary-private-file.json');
    await writeFile(plainFile, '{}');
    await expect(securePrivatePath(plainFile)).resolves.toBeUndefined();
  } finally { await removeTemporaryRoot(temporary, 'Notara private sibling ', alias); }
});
