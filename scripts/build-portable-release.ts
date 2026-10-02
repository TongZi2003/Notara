import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync, writeFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Zip, ZipDeflate } from 'fflate';
import { buildRelease } from './build-vault-release.ts';
import { extractRelease } from './vault-updates.ts';
import { PORTABLE_MARKER, verifyPrebuiltVault, type PortableManifest } from './prebuilt-vault.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Stream file contents while encoding ZIP paths explicitly as UTF-8. System
 * tar's ZIP filename encoding depends on the Windows runner's active locale. */
export async function writePortableArchive(root: string, archive: string): Promise<void> {
  const fd = openSync(archive, 'w');
  const zip = new Zip((error, bytes) => {
    if (error) throw error;
    writeFileSync(fd, bytes);
  });
  try {
    const addDirectory = async (directory: string, prefix: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const path = join(directory, entry.name), name = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await addDirectory(path, name);
        else if (entry.isFile()) {
          const file = new ZipDeflate(name, { level: 6 });
          zip.add(file);
          for await (const chunk of createReadStream(path, { highWaterMark: 256 * 1024 })) file.push(chunk, false);
          file.push(new Uint8Array(), true);
        } else throw new Error(`便携包不能包含链接或特殊文件：${name}`);
      }
    };
    await addDirectory(root, 'notara');
    zip.end();
  } finally { zip.terminate(); closeSync(fd); }
}

/** Build only with the real Windows x64 dependency tree; Linux native modules
 * cannot be repackaged into a usable Windows application. No user runtime is copied. */
export async function buildPortableRelease(output: string, source = project): Promise<{ archive: string; checksum: string; version: string }> {
  if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) < 24) throw new Error('便携版必须在 Windows x64 + Node.js 24 或更新版本上构建。');
  const destination = resolve(output);
  await mkdir(destination, { recursive: true });
  const work = await mkdtemp(join(destination, '.portable-build-'));
  try {
    const released = await buildRelease(join(work, 'source'), source);
    const bytes = await readFile(released.archive);
    const stage = join(work, 'notara');
    await mkdir(stage);
    await extractRelease(bytes, hash(bytes), stage);
    const inventory = JSON.parse(await readFile(join(stage, 'notara-files.json'), 'utf8')) as { files: Record<string, string> };
    // The ready package has no dependency-install step. Keep the source release
    // installer separate so it cannot replace this bundled runtime by mistake.
    await rm(join(stage, 'install-notara.cmd'));
    delete inventory.files['install-notara.cmd'];
    await rm(join(stage, 'notara-files.json'));
    await cp(join(source, 'node_modules'), join(stage, 'node_modules'), { recursive: true, dereference: true });
    const nodeRoot = dirname(process.execPath), runtime = join(stage, 'runtime');
    await mkdir(join(runtime, 'node_modules'), { recursive: true });
    await cp(process.execPath, join(runtime, 'node.exe'));
    await cp(join(nodeRoot, 'LICENSE'), join(runtime, 'LICENSE'));
    await cp(join(nodeRoot, 'node_modules/npm'), join(runtime, 'node_modules/npm'), { recursive: true, dereference: true });
    const manifest: PortableManifest = { format: 1, platform: 'win32', arch: 'x64', version: released.version, nodeVersion: process.versions.node,
      files: { ...inventory.files, 'runtime/node.exe': hash(await readFile(join(runtime, 'node.exe'))), 'runtime/LICENSE': hash(await readFile(join(runtime, 'LICENSE'))) } };
    await writeFile(join(stage, PORTABLE_MARKER), JSON.stringify(manifest, null, 2) + '\n');
    await verifyPrebuiltVault(stage);
    const archive = join(destination, `notara-portable-${released.version}-win-x64.zip`);
    await writePortableArchive(stage, archive);
    const checksum = `${archive}.sha256`;
    await writeFile(checksum, `${hash(await readFile(archive))}  notara-portable-${released.version}-win-x64.zip\n`);
    return { archive, checksum, version: released.version };
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await import('./build-native-vault.ts');
  await (await import('./build-pixel-classroom.ts')).buildPixelClassroom();
  console.log(await buildPortableRelease(process.argv[2] ?? '.runtime/portable-release'));
}
