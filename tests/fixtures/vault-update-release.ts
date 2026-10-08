import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { buildRelease } from '../../scripts/build-vault-release.ts';
import { codeContract, prepareRelease } from '../../scripts/vault-updates.ts';
import type { Release } from '../../scripts/vault-updates.ts';

/** Synthetic update diagnostics contain phase names and elapsed time only. */
export async function updatePhase<T>(phase: string, operation: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  writeSync(1, `[synthetic-update] ${phase} started\n`);
  try { return await operation(); }
  finally { writeSync(1, `[synthetic-update] ${phase} elapsed_ms=${Math.round(performance.now() - started)}\n`); }
}

/** A synthetic next release with the real installation layout and dependencies. */
export async function futureRelease(base: string, { brokenStartup = false } = {}): Promise<{ release: Release; prepare(): Promise<string> }> {
  const project = resolve('.'), contract = await codeContract(project);
  const current = /^(\d+)\.(\d+)\.(\d+)(-dev\.\d+)?$/.exec(contract.version);
  if (!current) throw new Error('Unexpected source version for synthetic release');
  const version = `${current[1]}.${current[2]}.${Number(current[3]) + (current[4] ? 0 : 1)}`;
  // This synthetic update runs on the current platform. Linux restart tests
  // do not need to download Windows-only shell assets; real Windows updates
  // and both production packagers still include the verified native bundle.
  const built = await updatePhase('build-release', () => buildRelease(join(base, 'bundle'), project, process.platform === 'win32' ? {} : {
    windowsPosix: async () => ({ executable: '', files: [] }),
  }));
  const archive = await updatePhase('read-archive', () => readFile(built.archive));
  writeSync(1, `[synthetic-update] archive_bytes=${archive.length}\n`);
  const files = await updatePhase('unzip-archive', () => unzipSync(new Uint8Array(archive)));
  const pkg = JSON.parse(strFromU8(files['notara/examples/native-vault/package.json']!));
  files['notara/examples/native-vault/package.json'] = strToU8(JSON.stringify({ ...pkg, version }));
  files['notara/examples/native-vault/update-marker.txt'] = strToU8('synthetic release installed');
  if (brokenStartup) files['notara/scripts/vault-process.ts'] = strToU8('throw new Error("synthetic next-release startup failure");\n');
  const bytes = await updatePhase('repack-archive', () => zipSync(files, { level: 1 }));
  const release: Release = { version, url: `https://github.com/TongZi2003/Notara/releases/tag/v${version}`, archiveUrl: `https://github.com/TongZi2003/Notara/releases/download/v${version}/notara-${version}.zip`, sha256: createHash('sha256').update(bytes).digest('hex'), runtime: contract.runtime, compatible: true };
  await mkdir(join(base, 'releases'), { recursive: true });
  const fetcher: typeof fetch = async url => {
    if (String(url) !== release.archiveUrl) throw new Error('unexpected fixture download');
    return new Response(bytes);
  };
  return { release, prepare: () => updatePhase('prepare-release', () => prepareRelease(release, fetcher, join(base, 'releases'))) };
}
