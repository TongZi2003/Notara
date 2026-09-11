import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { HostContext } from '@studyforge/contracts';
import type { RecordStore } from '../storage/record-store.ts';

export const LEARNING_COMPOSITION = 'studyforge-learning';
export const CREATION_COMPOSITION = 'studyforge-creation';
const base = { sessionId: z.string().min(1), cwd: z.string().min(1) };
export const ExecutionBindingSchema = z.discriminatedUnion('purpose', [
  z.object({ ...base, purpose: z.literal('learning') }).strict(),
  z.object({ ...base, purpose: z.literal('creation'), projectRoot: z.string().min(1), references: z.array(z.string().min(1)) }).strict(),
]);
export type ExecutionBinding = z.infer<typeof ExecutionBindingSchema> & { revision: number; workspaceId: string };
/** A narrow projection of a native observation, supplied by the Host adapter. */
export interface NativeExecution { sessionId: string; cwd: string | undefined; preset: string | undefined; }
export class AccessError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'AccessError'; }
}
export function under(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === '' || (!suffix.startsWith('..' + sep) && suffix !== '..' && !isAbsolute(suffix));
}
/** Resolve existing ancestors too, so an absent create target cannot escape through a symlink. */
export function canonicalPath(path: string, cwd: string): string {
  let current = resolve(cwd, path); const missing: string[] = [];
  for (;;) {
    try { return resolve(realpathSync(current), ...missing); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const parent = dirname(current); if (parent === current) throw error;
      missing.unshift(basename(current)); current = parent;
    }
  }
}
const PREFIX = 'studyforge-scope:';
/** Native identities remain authoritative; only product-specific grants are persisted. */
export class ExecutionAccess {
  readonly root: string;
  readonly workspaceId: string;
  private readonly records: RecordStore<typeof ExecutionBindingSchema>;
  private readonly observe: (id: string) => Promise<NativeExecution>;
  private readonly scopes = new Map<string, ExecutionBinding>();
  private readonly local = new AsyncLocalStorage<ExecutionBinding>();
  constructor(root: string, workspaceId: string, records: RecordStore<typeof ExecutionBindingSchema>, observe: (id: string) => Promise<NativeExecution>) {
    this.root = realpathSync(root); this.workspaceId = workspaceId; this.records = records; this.observe = observe;
  }
  private id(sessionId: string): string { return createHash('sha256').update(sessionId).digest('hex'); }
  private context(sessionId: string): HostContext { return { workspaceId: this.workspaceId, sessionId, actor: 'system', purpose: 'learning' }; }
  private async native(sessionId: string): Promise<NativeExecution> {
    const fact = await this.observe(sessionId);
    if (fact.sessionId !== sessionId || !fact.cwd || canonicalPath(fact.cwd, this.root) !== this.root) throw new AccessError('binding_workspace_denied');
    if (fact.preset !== LEARNING_COMPOSITION && fact.preset !== CREATION_COMPOSITION) throw new AccessError('binding_purpose_missing');
    return fact;
  }
  async forSession(sessionId: string): Promise<ExecutionBinding> {
    try { return await this.resolveBinding(sessionId); }
    catch (error) { this.scopes.delete(sessionId); throw error; }
  }
  clear(): void { this.scopes.clear(); }
  private async resolveBinding(sessionId: string): Promise<ExecutionBinding> {
    const native = await this.native(sessionId), ctx = this.context(sessionId), id = this.id(sessionId);
    let record;
    try { record = this.records.read(ctx, 'binding:' + id); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'record_missing') throw error;
      if (native.preset !== LEARNING_COMPOSITION) throw new AccessError('creation_selection_required');
      record = await this.records.create({ ...ctx, operationId: 'bind:' + sessionId }, id, { sessionId, cwd: this.root, purpose: 'learning' });
    }
    const data = record.data;
    const expected = data.purpose === 'learning' ? LEARNING_COMPOSITION : CREATION_COMPOSITION;
    if (data.sessionId !== sessionId || data.cwd !== this.root || expected !== native.preset) throw new AccessError('binding_mismatch');
    if (data.purpose === 'creation') {
      const project = canonicalPath(data.projectRoot, this.root), packs = join(this.root, 'packs');
      if (!under(packs, project) || project === packs || project !== data.projectRoot || data.references.some(path => !under(this.root, canonicalPath(path, this.root)) || path !== canonicalPath(path, this.root) || !statSync(path).isFile())) throw new AccessError('binding_corrupt');
    }
    const binding = { ...data, revision: record.version, workspaceId: this.workspaceId };
    this.scopes.set(sessionId, binding); return binding;
  }
  /** Trusted student selection; never a teaching-prompt field or model tool. */
  async selectCreation(sessionId: string, project: string, references: string[], expectedVersion?: number): Promise<ExecutionBinding> {
    if ((await this.native(sessionId)).preset !== CREATION_COMPOSITION || !/^[A-Za-z0-9_\-\u4e00-\u9fff]+$/.test(project)) throw new AccessError('creation_selection_invalid');
    const projectRoot = realpathSync(join(this.root, 'packs', project));
    if (!under(join(this.root, 'packs'), projectRoot)) throw new AccessError('creation_selection_invalid');
    const allowed = references.map(path => realpathSync(resolve(this.root, path)));
    if (allowed.some(path => !under(this.root, path) || !statSync(path).isFile())) throw new AccessError('reference_denied');
    const ctx = this.context(sessionId), id = this.id(sessionId), ref = 'binding:' + id;
    const data = { sessionId, cwd: this.root, purpose: 'creation' as const, projectRoot, references: allowed };
    if (expectedVersion === undefined) await this.records.create({ ...ctx, actor: 'student', operationId: 'bind:' + sessionId }, id, data);
    else await this.records.update({ ...ctx, actor: 'student', operationId: 'grant:' + sessionId + ':' + expectedVersion, expectedVersion }, ref, data, () => data);
    return this.forSession(sessionId);
  }
  scope(binding: ExecutionBinding): string { return PREFIX + encodeURIComponent(binding.sessionId); }
  fromScope(value: string): ExecutionBinding | undefined {
    if (!value.startsWith(PREFIX)) return undefined;
    let id: string; try { id = decodeURIComponent(value.slice(PREFIX.length)); } catch { throw new AccessError('binding_invalid'); }
    const binding = this.scopes.get(id);
    if (!binding || (this.local.getStore() && this.local.getStore()?.sessionId !== id)) throw new AccessError('binding_missing');
    return binding;
  }
  active(): ExecutionBinding | undefined { return this.local.getStore(); }
  run<T>(binding: ExecutionBinding, work: () => T): T { return this.local.run(binding, work); }
  isCurrent(binding: ExecutionBinding): boolean { return this.scopes.get(binding.sessionId)?.revision === binding.revision; }
  path(binding: ExecutionBinding, path: string, cwd = binding.cwd): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw new AccessError('path_protocol_denied');
    const base = this.fromScope(cwd)?.cwd ?? cwd;
    if (!under(this.root, canonicalPath(base, this.root))) throw new AccessError('binding_workspace_denied');
    return canonicalPath(path, base);
  }
  permits(binding: ExecutionBinding, path: string, write = false): boolean {
    if (!this.isCurrent(binding) || !under(this.root, path)) return false;
    if (binding.purpose === 'learning') return !write;
    return under(binding.projectRoot, path) || (!write && binding.references.includes(path));
  }
  assert(binding: ExecutionBinding, path: string, write = false): void {
    if (!this.permits(binding, path, write)) throw new AccessError(write ? 'write_denied' : 'read_denied');
  }
}
