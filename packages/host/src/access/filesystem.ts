import type { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem, type Config } from '@deepseek-ai/dsh-fs-local';
import { FsError, type FsTarget, type FsVersion, type FsWriteIntent, type FsEditRequest } from '@deepseek-ai/dsh-fs';
import { type ExecutionBinding, type ExecutionAccess, canonicalPath } from '@studyforge/domain/access';
import { resolve } from 'node:path';

/** Native I/O and observation/stale guards are retained; this provider adds read/write grants. */
export class StudentFileSystem extends LocalFileSystem {
  private readonly access: ExecutionAccess;
  private readonly bindings = new WeakMap<FsTarget, { binding: ExecutionBinding; root: boolean }>();
  constructor(ctx: Context, config: Config) { super(ctx, config); this.access = ctx.studyforgeAccess; }
  override get sandboxMode() { return 'workspace-write' as const; }
  private deny(): never { throw new FsError('路径不在本次允许的范围内', 'FS_PERMISSION_DENIED'); }
  private check(target: FsTarget, write = false): ExecutionBinding {
    const record = this.bindings.get(target); if (!record || !this.access.isCurrent(record.binding)) return this.deny();
    const path = canonicalPath(super.processPath(target), record.binding.cwd);
    if (write && record.binding.purpose === 'creation' && path === resolve(record.binding.projectRoot, 'worldbook.json')) throw new FsError('教室草稿请通过 read_classroom_draft / save_classroom_draft 编辑，以保留格式校验和面板修改。', 'FS_PERMISSION_DENIED');
    if (!record.root || write) { if (!this.access.permits(record.binding, path, write)) return this.deny(); }
    return record.binding;
  }
  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const direct = this.access.fromScope(path);
    const binding = direct ?? (opts?.cwd ? this.access.fromScope(opts.cwd) : undefined) ?? this.access.active();
    if (!binding) return this.deny();
    let absolute: string;
    try { absolute = direct ? binding.cwd : this.access.path(binding, path, opts?.cwd ?? binding.cwd); }
    catch { return this.deny(); }
    if (!direct && !this.access.permits(binding, absolute)) return this.deny();
    const target = await super.resolve(absolute, { cwd: binding.cwd, ...(opts?.signal ? { signal: opts.signal } : {}) });
    this.bindings.set(target, { binding, root: direct !== undefined });
    return target;
  }
  override processPath(target: FsTarget): string { this.check(target); return super.processPath(target); }
  override processPathFromHostPath(path: string): string | undefined {
    const binding = this.access.active();
    if (!binding) return undefined;
    const canonical = canonicalPath(path, binding.cwd);
    return this.access.permits(binding, canonical) ? super.processPathFromHostPath(canonical) : undefined;
  }
  override fileUrl(target: FsTarget): string { this.check(target); return super.fileUrl(target); }
  override contains(parent: FsTarget, child: FsTarget): boolean {
    const owner = this.bindings.get(parent);
    return owner !== undefined && this.bindings.get(child)?.binding.sessionId === owner.binding.sessionId && this.access.permits(owner.binding, super.processPath(child)) && super.contains(parent, child);
  }
  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal) {
    const binding = (opts?.cwd ? this.access.fromScope(opts.cwd) : undefined) ?? this.access.active();
    if (!binding) return this.deny();
    let absolute: string;
    try { absolute = this.access.path(binding, path, opts?.cwd ?? binding.cwd); } catch { return this.deny(); }
    if (!this.access.permits(binding, absolute)) return this.deny();
    // Authorize the real target, but preserve native no-follow metadata for the final symlink.
    const cwd = this.access.fromScope(opts?.cwd ?? '')?.cwd ?? opts?.cwd ?? binding.cwd;
    return super.lstat(resolve(cwd, path), { cwd: binding.cwd }, signal);
  }
  override stat(target: FsTarget, signal?: AbortSignal) { this.check(target); return super.stat(target, signal); }
  override readText(target: FsTarget, signal?: AbortSignal) { this.check(target); return super.readText(target, signal); }
  override streamText(target: FsTarget, signal?: AbortSignal) { this.check(target); return super.streamText(target, signal); }
  override readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number) { this.check(target); return super.readBytes(target, signal, maxBytes); }
  override readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal) { this.check(target); return super.readByteRange(target, range, signal); }
  override async listDir(target: FsTarget, signal?: AbortSignal) {
    const binding = this.check(target); this.access.assert(binding, super.processPath(target));
    const entries = await this.access.run(binding, () => super.listDir(target, signal));
    return entries.filter(entry => {
      if (!this.access.permits(binding, super.processPath(entry.target))) return false;
      this.bindings.set(entry.target, { binding, root: false }); return true;
    });
  }
  override writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal) { this.check(target, true); return super.writeText(target, content, expected, signal); }
  override editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal) { this.check(target, true); return super.editText(target, edit, expected, signal); }
}
