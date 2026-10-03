import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { acquireVaultBuildLock, withVaultBuild, withVaultBuiltSnapshot } from '../../scripts/vault-build-lock.ts';
import { packageBin } from '../../scripts/package-bin.ts';

const execFileAsync = promisify(execFile);
const project = resolve('.');
const generated = ['client.js', 'teaching/skills/math.md', 'fonts/wenkai.woff2', 'lazy/pdf.min.mjs', 'academy/catalog.json'];
async function generation(source: string, value: string): Promise<void> {
  for (const name of generated) {
    await mkdir(dirname(join(source, name)), { recursive: true });
    await writeFile(join(source, name), value);
  }
}

test('a cross-process snapshot and writer cannot enter a half-built checkout, including through a directory alias', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notara-build-lock-'));
  const checkout = join(directory, 'source'), source = join(checkout, 'examples/native-vault');
  const snapshot = join(directory, 'snapshot'), entered = join(directory, 'entered');
  let release: (() => Promise<void>) | undefined;
  try {
    await generation(source, 'A');
    const alias = join(directory, 'alias');
    await symlink(checkout, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const worker = join(directory, 'snapshot.mjs');
    await writeFile(worker, `
import { cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withVaultBuildLock, withVaultBuiltSnapshot } from ${JSON.stringify(pathToFileURL(join(project, 'scripts/vault-build-lock.ts')).href)};
const [checkout, snapshot, entered, mode] = process.argv.slice(2);
try {
  const copy = async () => { await writeFile(entered, 'entered'); await cp(join(checkout, 'examples/native-vault'), snapshot, { recursive: true }); };
  if (mode === 'writer') await withVaultBuildLock(checkout, copy, { retries: 0 });
  else await withVaultBuiltSnapshot(checkout, ['native-vault'], copy, { retries: 0 });
  console.log(JSON.stringify({ copied: true }));
} catch (error) { console.log(JSON.stringify({ code: error.code, message: error.message })); }
`);
    const run = async (mode: string) => {
      const result = await execFileAsync(process.execPath, [packageBin(project, 'tsx', 'tsx'), worker, alias, snapshot, entered, mode], { cwd: project, windowsHide: true, timeout: 10_000 });
      return JSON.parse(result.stdout.trim()) as { code?: string; copied?: boolean };
    };
    release = await acquireVaultBuildLock(checkout);
    await writeFile(join(source, 'client.js'), 'B');
    await rm(join(source, 'teaching'), { recursive: true });
    for (const mode of ['reader', 'writer']) {
      expect(await run(mode)).toMatchObject({ code: 'ELOCKED' });
      expect(await lstat(entered).catch(() => undefined)).toBeUndefined();
      expect(await lstat(snapshot).catch(() => undefined)).toBeUndefined();
    }
    await generation(source, 'B');
    await release(); release = undefined;
    expect(await run('reader')).toEqual({ copied: true });
    for (const name of generated) expect(await readFile(join(snapshot, name), 'utf8')).toBe('B');
    expect(await lstat(join(snapshot, '.runtime')).catch(() => undefined)).toBeUndefined();
  } finally {
    await release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed build releases its lock but blocks incomplete snapshots until a successful rebuild', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notara-build-failed-'));
  const source = join(directory, 'examples/native-vault'), snapshot = join(directory, 'snapshot');
  try {
    await generation(source, 'A');
    await expect(withVaultBuild(directory, 'native-vault', async () => {
      await rm(join(source, 'teaching'), { recursive: true });
      throw new Error('synthetic build failure');
    })).rejects.toThrow('synthetic build failure');
    const copy = () => cp(source, snapshot, { recursive: true });
    await expect(withVaultBuiltSnapshot(directory, ['native-vault'], copy, { retries: 0 })).rejects.toThrow(/上次构建未完成/);
    expect(await lstat(snapshot).catch(() => undefined)).toBeUndefined();
    await withVaultBuild(directory, 'native-vault', () => generation(source, 'B'));
    await withVaultBuiltSnapshot(directory, ['native-vault'], copy, { retries: 0 });
    for (const name of generated) expect(await readFile(join(snapshot, name), 'utf8')).toBe('B');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('two independent source processes build and start complete classroom snapshots concurrently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notara-source-concurrent-'));
  try {
    const worker = join(directory, 'launch.mjs');
    await writeFile(worker, `
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from ${JSON.stringify(pathToFileURL(join(project, 'scripts/dev-isolated.ts')).href)};
import { connectVault } from ${JSON.stringify(pathToFileURL(join(project, 'tests/fixtures/vault-http.ts')).href)};
const runtime = await startVaultIsolated({ testModel: true });
let client;
try {
  for (const name of ${JSON.stringify(generated)}) {
    const path = join(runtime.root, 'vault-plugin', name === 'teaching/skills/math.md' ? 'teaching/manifest.json' : name);
    if (!(await readFile(path)).length) throw new Error('empty generated asset: ' + name);
  }
  client = await connectVault(runtime);
  if (!(await client.createSession())) throw new Error('Host could not create a classroom');
  console.log('COMPLETE_CLASSROOM_SNAPSHOT');
} finally { await client?.close(); await runtime.stop(); }
if (await lstat(runtime.root).catch(() => undefined)) throw new Error('isolated runtime was not removed');
`);
    const outcomes = await Promise.allSettled([0, 1].map(() => execFileAsync(process.execPath, [packageBin(project, 'tsx', 'tsx'), worker], { cwd: project, windowsHide: true, timeout: 25_000, maxBuffer: 100_000 })));
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason;
      expect(outcome.value.stdout).toContain('COMPLETE_CLASSROOM_SNAPSHOT');
    }
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});
