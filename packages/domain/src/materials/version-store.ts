/**
 * P3.1 immutable original bytes on disk.
 *
 * One version owns one directory, `<workspace>/materials/<materialId>/<versionId>/`,
 * and its file is never rewritten. Publishing stages the bytes, verifies the
 * digest that really landed, and only then links the file into place; `link`
 * refuses to overwrite, so an existing version's bytes are permanent.
 *
 * Every path is rebuilt from the *canonical* workspace root, and each directory
 * that has to exist is compared with its own `realpath`. A workspace root may
 * itself be reached through a link (macOS `/var` is one), but nothing below it
 * may be: a `materials`, a material directory, a version directory or the file
 * that resolves somewhere else is refused instead of read or written through.
 */
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { RecordError } from '../storage/record-store.ts';

/** Content token for one original; the single digest form this store uses. */
export function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * One identity or file-name segment that is safe to concatenate into a path.
 * Rejects rather than rewrites, so a caller never gets a silently renamed file.
 */
export function safeSegment(value: string, code: string): string {
  const segment = value.trim();
  if (segment.length === 0 || segment.length > 200) throw new RecordError(code);
  if (segment === '.' || segment === '..' || segment.startsWith('.')) throw new RecordError(code);
  if (/[/\\\u0000-\u001f]/.test(segment)) throw new RecordError(code);
  return segment;
}

/** The original file name as it is stored and shown. */
export function safeFileName(fileName: string): string {
  return safeSegment(fileName, 'material_name_invalid');
}

export interface PublishInput {
  readonly materialId: string;
  readonly versionId: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
}

export interface PublishedVersion { readonly absolutePath: string; readonly published: boolean; }
export interface OpenedVersion { readonly absolutePath: string; readonly bytes: Uint8Array; }

export class VersionStore {
  /** `<workspace>/materials`, exactly as the Host named the workspace. */
  readonly root: string;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.root = join(this.workspaceRoot, 'materials');
  }

  /**
   * The real `materials` directory, or the path it must be created at.
   * @param mustExist - a read needs the store; a publish may create it once.
   * @throws `material_path_unsafe` when the workspace or the store is a link, so
   * a redirected store can never be read from or written into.
   */
  private async storeRoot(mustExist: boolean): Promise<string> {
    const workspace = await realpath(this.workspaceRoot).catch(() => null);
    if (workspace === null) throw new RecordError('material_missing');
    const expected = join(workspace, 'materials');
    const real = await realpath(expected).catch(() => null);
    if (real === null) {
      if (mustExist) throw new RecordError('material_missing');
      return expected;
    }
    if (real !== expected) throw new RecordError('material_path_unsafe');
    return real;
  }

  /** A directory this store just created must really be the path it computed. */
  private async assertReal(path: string): Promise<void> {
    if (await realpath(path).catch(() => null) !== path) throw new RecordError('material_path_unsafe');
  }

  /** Parent was already checked; never recursively create through a symlink. */
  private async ensureDirectory(path: string): Promise<void> {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if ((error as { code?: unknown })?.code !== 'EEXIST') throw error; }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new RecordError('material_path_unsafe');
    await this.assertReal(path);
  }

  private versionDir(storeRoot: string, materialId: string, versionId: string): string {
    const path = join(storeRoot, safeSegment(materialId, 'material_id_invalid'), safeSegment(versionId, 'material_id_invalid'));
    if (!path.startsWith(storeRoot + sep)) throw new RecordError('material_path_unsafe');
    return path;
  }

  /** What the path holds, without following a link: a file, something else, or nothing. */
  private async present(path: string): Promise<'file' | 'other' | null> {
    try {
      const info = await lstat(path);
      return info.isFile() ? 'file' : 'other';
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'ENOENT') return null;
      throw error;
    }
  }

  private async digestAt(path: string): Promise<string | null> {
    const bytes = await readFile(path).catch(error => {
      if ((error as { code?: unknown } | null)?.code === 'ENOENT') return null;
      throw error;
    });
    return bytes === null ? null : digestOf(new Uint8Array(bytes));
  }

  /**
   * Publish one version's bytes under its immutable path.
   * @returns the path plus whether this call created it; an existing file with
   * the same digest is reused, and one with other bytes is refused outright.
   */
  async publish(input: PublishInput): Promise<PublishedVersion> {
    const storeRoot = await this.storeRoot(false);
    await this.ensureDirectory(storeRoot);
    await this.ensureDirectory(join(storeRoot, safeSegment(input.materialId, 'material_id_invalid')));
    const directory = this.versionDir(storeRoot, input.materialId, input.versionId);
    await this.ensureDirectory(directory);
    const target = join(directory, safeFileName(input.fileName));
    const held = await this.present(target);
    if (held === 'other') throw new RecordError('material_path_unsafe');
    if (held === 'file') {
      if (await this.digestAt(target) !== input.digest) throw new RecordError('material_version_immutable');
      return { absolutePath: target, published: false };
    }
    const stagingDirectory = join(storeRoot, '.staging');
    await this.ensureDirectory(stagingDirectory);
    const staging = join(stagingDirectory, `${input.materialId}-${input.versionId}-${randomUUID()}`);
    try {
      await writeFile(staging, input.bytes, { mode: 0o600, flag: 'wx' });
      if (await this.digestAt(staging) !== input.digest) throw new RecordError('material_publish_corrupt');
      try {
        await link(staging, target);
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== 'EEXIST') throw error;
        // Someone published this exact path first; only identical bytes may stand.
        if (await this.digestAt(target) !== input.digest) throw new RecordError('material_version_immutable');
        return { absolutePath: target, published: false };
      }
      return { absolutePath: target, published: true };
    } finally {
      await unlink(staging).catch(() => undefined);
    }
  }

  /**
   * Read one version's bytes by identity, refusing escapes.
   * @throws `material_missing` when absent, `material_path_unsafe` when the real
   * path is not exactly the path this store computed from the canonical root.
   */
  async open(materialId: string, versionId: string, fileName: string): Promise<OpenedVersion> {
    const storeRoot = await this.storeRoot(true);
    const expected = join(this.versionDir(storeRoot, materialId, versionId), safeFileName(fileName));
    if (await realpath(expected).catch(() => null) !== expected) throw new RecordError('material_path_unsafe');
    return { absolutePath: expected, bytes: new Uint8Array(await readFile(expected)) };
  }
}
