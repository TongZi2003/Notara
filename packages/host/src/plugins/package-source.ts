import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile, copyFile, realpath, stat, rm } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { initProfile, resolveProfileDir, readProfileManifest, resolveBundleDir } from '@deepseek-ai/dsh-app-boot';
import { PluginManifestSchema, PluginSourceSchema, WorldbookDocumentSchema, type PluginSource, type PluginVersion } from '@studyforge/contracts/plugins';

const require = createRequire(import.meta.url);
export const dshAnchor = require.resolve('@deepseek-ai/dsh/package.json');
const dshBin = join(dirname(dshAnchor), 'lib/bin.js');
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const pluginRoot = (workspace: string): string => join(workspace, '.studyforge', 'plugins');
export function inside(root: string, path: string): string {
  const absolute = resolve(root, path), delta = relative(root, absolute);
  if (!delta || delta.startsWith('..' + sep) || delta === '..' || resolve(delta) === delta) throw new Error('plugin_path_invalid');
  return absolute;
}
export function snapshotFile(workspace: string, version: PluginVersion, path: string): string {
  const root = inside(pluginRoot(workspace), version.snapshot), packageRoot = inside(root, version.packagePath), file = inside(packageRoot, path);
  const canonical = realpathSync(file);
  if (canonical !== file) throw new Error('plugin_snapshot_changed');
  const expected = version.files.find(item => item.path === path);
  if (!expected || hash(readFileSync(file)) !== expected.digest) throw new Error('plugin_snapshot_changed');
  return file;
}
export function readPluginText(workspace: string, version: PluginVersion, entry: string): string { return readFileSync(snapshotFile(workspace, version, entry), 'utf8'); }
export async function runPackageManager(profileHome: string, profile: string, source: string): Promise<void> {
  await new Promise<void>((resolveDone, reject) => {
    const child = spawn(process.execPath, [dshBin, 'plugin', '--profile', profile, 'add', 'file:' + source, '--ignore-scripts', '--config.manage-package-manager-versions=false', '--config.confirmModulesPurge=false'], {
      cwd: profileHome, env: { ...process.env, DSH_HOME: profileHome, DSH_TELEMETRY_DISABLED: '1', COREPACK_ENABLE_AUTO_PIN: '0', CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Keep dependency-manager diagnostics out of student-visible Remote errors.
    child.stdout.resume(); child.stderr.resume();
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('plugin_install_timeout')); }, 90_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('plugin_package_manager_unavailable')); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolveDone() : reject(new Error('plugin_dependencies_failed')); });
  });
}
async function inventory(root: string, destination?: string): Promise<{ path: string; digest: string }[]> {
  const files: { path: string; digest: string }[] = []; let total = 0;
  async function walk(path = ''): Promise<void> {
    for (const entry of (await readdir(join(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const name = path ? path + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('plugin_links_unsupported');
      if (entry.isDirectory()) { if (destination) await mkdir(join(destination, name), { recursive: true }); await walk(name); continue; }
      const size = (await stat(join(root, name))).size; total += size;
      if (total > 30_000_000 || files.length >= 3000) throw new Error('plugin_package_too_large');
      const bytes = await readFile(join(root, name)); files.push({ path: name, digest: hash(bytes) });
      if (destination) await copyFile(join(root, name), join(destination, name));
    }
  }
  await walk(); return files;
}
export async function preparePackage(workspace: string, input: PluginSource): Promise<PluginVersion> {
  const source = PluginSourceSchema.parse(input), snapshot = randomBytes(16).toString('hex'), root = join(pluginRoot(workspace), snapshot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    let path: string;
    if (source.kind === 'directory') {
      const original = await realpath(source.path);
      // Never recursively copy the destination workspace's plugin storage into itself.
      if (root === original || root.startsWith(original + sep)) throw new Error('plugin_directory_invalid');
      path = join(root, 'source'); await mkdir(path); await inventory(original, path);
    } else {
      const bytes = Buffer.from(source.base64, 'base64');
      if (bytes.length > 30_000_000 || bytes.toString('base64') !== source.base64) throw new Error('plugin_archive_invalid');
      path = join(root, 'source.tgz'); await writeFile(path, bytes, { mode: 0o600 });
    }
    const home = join(root, 'home'), profile = resolveProfileDir('plugin', home);
    initProfile(profile, [], 'startup');
    await runPackageManager(home, 'plugin', path);
    const installed = readProfileManifest('dsh', profile), names = Object.keys(installed.dependencies ?? {});
    if (names.length !== 1) throw new Error('plugin_package_invalid');
    const packageRoot = await realpath(resolveBundleDir('dsh', names[0]!, dshAnchor, profile));
    if (!packageRoot.startsWith(root + sep)) throw new Error('plugin_snapshot_invalid');
    const raw = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (raw.dsh?.client) throw new Error('plugin_native_client_unsupported');
    const manifest = PluginManifestSchema.parse({ name: raw.name, version: raw.version, notara: raw.notara });
    const files = await inventory(packageRoot);
    const all = [...manifest.notara.skills, ...manifest.notara.teaching, ...manifest.notara.subjects, ...manifest.notara.workbenches, ...manifest.notara.worldbooks];
    if (!all.length && !raw.dsh?.bundle?.patch) throw new Error('plugin_empty');
    for (const entry of all) {
      const match = files.find(file => file.path === entry.entry);
      if (!match || (await stat(join(packageRoot, entry.entry))).size > 1_000_000 || !(await readFile(join(packageRoot, entry.entry), 'utf8')).trim()) throw new Error('plugin_entry_missing');
    }
    for (const entry of manifest.notara.worldbooks) WorldbookDocumentSchema.parse(JSON.parse(await readFile(join(packageRoot, entry.entry), 'utf8')));
    const version: PluginVersion = { manifest, digest: hash(JSON.stringify(files)), snapshot, files, native: !!raw.dsh?.bundle?.patch,
      packagePath: relative(root, packageRoot).split(sep).join('/'), profilePath: relative(root, profile).split(sep).join('/'), installedAt: new Date().toISOString() };
    await writeFile(join(root, 'candidate.json'), JSON.stringify(version), { mode: 0o600 });
    return version;
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
