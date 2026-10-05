import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, realpath, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { STORAGE_JSON_PATCH, patchStorageJson } from '../../scripts/storage-json-patch.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = join(project, 'node_modules', STORAGE_JSON_PATCH.artifact);
const sha = (source: string): string => createHash('sha256').update(source).digest('hex');
type Rename = (tmp: string, path: string, renameFile?: (tmp: string, path: string) => Promise<void>, platform?: string, pause?: (ms: number) => Promise<void>) => Promise<void>;
type JsonUnit = { putRecord(table: string, key: string, value: object): Promise<void>; loadAll(): Promise<{ tables: Record<string, Record<string, { stage: string }>> }>; close(): Promise<void> };
type PatchedModule = { notaraRenameAtomicWithRetry: Rename; JsonStorageBackend: new (root: string) => { kv: { open(descriptor: object): Promise<JsonUnit> }; close(): Promise<void> } };
let moduleRoot: string | undefined;
let patchedModule: Promise<PatchedModule> | undefined;

async function loaded(): Promise<PatchedModule> {
  patchedModule ??= (async () => {
    const source = patchStorageJson(await readFile(sourcePath, 'utf8'));
    const deps = ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-storage'];
    let standalone = source;
    for (const dep of deps) {
      const target = import.meta.resolve(dep);
      const old = `from "${dep}"`;
      if (standalone.split(old).length !== 2) throw new Error(`Unexpected DSH import: ${dep}`);
      standalone = standalone.replace(old, `from "${target}"`);
    }
    // Test-only counter forwards to the very same imported rename. The
    // production patch remains hash-checked and uninstrumented.
    const call = '\t\tawait notaraRenameAtomicWithRetry(tmp, path);';
    if (standalone.split(call).length !== 2) throw new Error('Unexpected DSH atomic rename call site');
    standalone = standalone.replace(call, '\t\tawait notaraRenameAtomicWithRetry(tmp, path, async (from, to) => { globalThis.__notaraStorageRenameAttempts = (globalThis.__notaraStorageRenameAttempts ?? 0) + 1; return rename(from, to); });');
    // Expose exactly the copied helper in the external test module only.
    standalone += '\nexport { notaraRenameAtomicWithRetry };\n';
    moduleRoot = await mkdtemp(join(tmpdir(), 'notara-storage-patch-module-'));
    const path = join(moduleRoot, 'index.mjs');
    await writeFile(path, standalone);
    return await import(pathToFileURL(path).href) as PatchedModule;
  })();
  return patchedModule;
}

async function cleanFlatTemp(root: string): Promise<void> {
  const actual = await realpath(root), temporary = await realpath(tmpdir());
  if (dirname(actual).toLowerCase() !== temporary.toLowerCase() || !/^notara-storage-patch-/.test(actual.slice(temporary.length + 1))) throw new Error(`Unsafe test cleanup path: ${actual}`);
  for (const name of await readdir(actual)) {
    const path = join(actual, name);
    if (!(await lstat(path)).isFile()) throw new Error(`Unexpected test directory entry: ${path}`);
    await unlink(path);
  }
  await rmdir(actual);
}

afterAll(async () => { if (moduleRoot) await cleanFlatTemp(moduleRoot); });

test('locked DSH storage patch is hash-guarded and idempotent', async () => {
  const installed = await readFile(sourcePath, 'utf8');
  const original = sha(installed) === STORAGE_JSON_PATCH.patchedSha
    ? installed.replace(STORAGE_JSON_PATCH.retryRename + '\nasync function writeAtomic(path, data) {', 'async function writeAtomic(path, data) {')
      .replace('\t\tawait notaraRenameAtomicWithRetry(tmp, path);', '\t\tawait rename(tmp, path);')
    : installed;
  expect(sha(original)).toBe(STORAGE_JSON_PATCH.originalSha);
  const patched = patchStorageJson(original);
  expect(sha(patched)).toBe(STORAGE_JSON_PATCH.patchedSha);
  expect(patchStorageJson(patched)).toBe(patched);
  expect(() => patchStorageJson(original + '\n// unexpected artifact')).toThrow(/Unknown DSH JSON storage artifact/);
});

test('retry helper reuses one temp path and preserves the first sharing error after a finite budget', async () => {
  const retry = (await loaded()).notaraRenameAtomicWithRetry;
  const first = Object.assign(new Error('first sharing failure'), { code: 'EPERM' });
  const attempts: [string, string][] = [], delays: number[] = [];
  await expect(retry('same.tmp', 'workspace.json', async (tmp, path) => { attempts.push([tmp, path]); throw first; }, 'win32', async ms => { delays.push(ms); })).rejects.toBe(first);
  expect(attempts).toEqual(Array.from({ length: 6 }, () => ['same.tmp', 'workspace.json']));
  expect(delays).toEqual([20, 40, 80, 160, 240]);
  const transient = Object.assign(new Error('temporary'), { code: 'EACCES' });
  let calls = 0;
  await retry('same.tmp', 'workspace.json', async () => { if (++calls < 3) throw transient; }, 'win32', async () => {});
  expect(calls).toBe(3);
});

test('non-sharing errors and non-Windows calls fail on the first rename', async () => {
  const retry = (await loaded()).notaraRenameAtomicWithRetry;
  for (const [platform, code] of [['win32', 'ENOENT'], ['linux', 'EPERM']] as const) {
    const error = Object.assign(new Error(code), { code });
    let calls = 0, waits = 0;
    await expect(retry('same.tmp', 'workspace.json', async () => { calls++; throw error; }, platform, async () => { waits++; })).rejects.toBe(error);
    expect(calls).toBe(1); expect(waits).toBe(0);
  }
});

const psSource = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$handle = New-Object System.IO.FileStream($env:NOTARA_PROBE_TARGET, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
try {
  [System.IO.File]::WriteAllText($env:NOTARA_PROBE_READY, 'ready')
  $until = [DateTime]::UtcNow.AddSeconds(15)
  while (-not [System.IO.File]::Exists($env:NOTARA_PROBE_RELEASE) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 20 }
} finally { $handle.Dispose() }
`;
async function holdTarget(root: string, target: string, label: string): Promise<{ release: () => Promise<void> }> {
  const ready = join(root, `${label}.ready`), release = join(root, `${label}.release`);
  const ps = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child: ChildProcess = spawn(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(psSource, 'utf16le').toString('base64')], {
    env: { ...process.env, NOTARA_PROBE_TARGET: target, NOTARA_PROBE_READY: ready, NOTARA_PROBE_RELEASE: release },
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; child.stderr?.on('data', bytes => { stderr += String(bytes); });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await stat(ready).then(() => true, () => false)) break;
    if (child.exitCode !== null) throw new Error(`Handle helper exited early: ${stderr}`);
    await new Promise(done => setTimeout(done, 20));
  }
  if (!await stat(ready).then(() => true, () => false)) { child.kill(); throw new Error(`Handle helper did not become ready: ${stderr}`); }
  return { release: async () => {
    await writeFile(release, 'release');
    const code = await new Promise<number | null>(done => {
      if (child.exitCode !== null) { done(child.exitCode); return; }
      const timer = setTimeout(() => { child.kill(); done(-1); }, 5000);
      child.once('exit', exit => { clearTimeout(timer); done(exit); });
    });
    if (code !== 0) throw new Error(`Handle helper exited ${code}: ${stderr}`);
  } };
}

test.skipIf(process.platform !== 'win32')('real Windows sharing conflicts retry the same atomic write, then preserve the old target on timeout', async () => {
  const { JsonStorageBackend } = await loaded();
  const root = await mkdtemp(join(tmpdir(), 'notara-storage-patch-real-'));
  const backend = new JsonStorageBackend(root);
  const unit = await backend.kv.open({ name: 'workspace', version: 1, tables: ['workspaces'], hasGlobal: false, layout: 'single' });
  let held: Awaited<ReturnType<typeof holdTarget>> | undefined;
  try {
    await unit.putRecord('workspaces', 'sample', { stage: 'old' });
    const target = join(root, 'workspace.json'), old = await readFile(target, 'utf8');
    held = await holdTarget(root, target, 'transient');
    let serializations = 0;
    const count = () => (globalThis as typeof globalThis & { __notaraStorageRenameAttempts?: number }).__notaraStorageRenameAttempts ?? 0;
    const attemptsBefore = count();
    // Attach a rejection handler immediately, even when a loaded CI machine
    // delays the helper's release past the retry budget.
    const pending = unit.putRecord('workspaces', 'sample', { stage: 'new', toJSON() { serializations++; return { stage: 'new' }; } })
      .then(() => ({ ok: true as const }), error => ({ ok: false as const, error: error as unknown }));
    for (let attempt = 0; count() - attemptsBefore < 2 && attempt < 100; attempt++) await new Promise(done => setTimeout(done, 10));
    expect(count() - attemptsBefore).toBeGreaterThanOrEqual(2);
    expect(await readFile(target, 'utf8')).toBe(old);
    await held.release(); held = undefined;
    expect(await pending).toEqual({ ok: true });
    expect(serializations).toBe(1);
    expect((await unit.loadAll()).tables.workspaces?.sample?.stage).toBe('new');
    expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);

    const good = await readFile(target, 'utf8');
    held = await holdTarget(root, target, 'permanent');
    const began = Date.now();
    await expect(unit.putRecord('workspaces', 'sample', { stage: 'blocked' })).rejects.toMatchObject({ code: 'EPERM', syscall: 'rename' });
    expect(Date.now() - began).toBeLessThan(5000);
    expect(await readFile(target, 'utf8')).toBe(good);
    expect((await unit.loadAll()).tables.workspaces?.sample?.stage).toBe('new');
    expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    await held.release(); held = undefined;
    await unit.putRecord('workspaces', 'sample', { stage: 'after-release' });
    expect((await unit.loadAll()).tables.workspaces?.sample?.stage).toBe('after-release');
  } finally {
    if (held) await held.release();
    await unit.close(); await backend.close(); await cleanFlatTemp(root);
  }
}, 20_000);
