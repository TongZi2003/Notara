import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
import { ActorSchema, HostContextSchema, MutationContextSchema, TimestampSchema, type HostContext, type MutationContext, type ObjectChange } from '@studyforge/contracts';
import type { Clock } from '../clock.ts';
import { objectRef } from '../ids.ts';

export function recordSchema(content: z.ZodType) {
  return z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/), workspaceId: z.string().min(1),
    versions: z.array(z.object({ revision: z.number().int().positive(), content: z.json() }).strict()).min(1),
    operations: z.array(z.object({
      id: z.string().min(1), fingerprint: z.string().min(1), before: z.number().int().positive().nullable(),
      after: z.number().int().positive(), actor: ActorSchema, sessionId: z.string().min(1).optional(), at: TimestampSchema,
    }).strict()).min(1),
    deleted: z.object({ operationId: z.string().min(1), revision: z.number().int().positive(), at: TimestampSchema }).strict().optional(),
  }).strict().superRefine((row, ctx) => {
    row.versions.forEach((version, index) => {
      if (version.revision !== index + 1 || !content.safeParse(version.content).success) ctx.addIssue({ code: 'custom', path: ['versions', index], message: 'invalid revision or content' });
    });
    if (new Set(row.operations.map(op => op.id)).size !== row.operations.length) ctx.addIssue({ code: 'custom', path: ['operations'], message: 'duplicate operation' });
    for (const op of row.operations) if (!row.versions.some(v => v.revision === op.after) || (op.before !== null && !row.versions.some(v => v.revision === op.before))) ctx.addIssue({ code: 'custom', path: ['operations'], message: 'operation references missing version' });
  });
}
export type StoredRecord = z.output<ReturnType<typeof recordSchema>>;
type Stored = StoredRecord;
export interface Saved<T> { ref: string; version: number; data: T; duplicate: boolean; }
/** Prepared by a real schema/authority owner, published only by its workspace. */
export interface PreparedRecordChange<T = unknown> {
  kind: string; workspaceId: string; key: string; before: string | null; next: StoredRecord; result: Saved<T>;
}
export class RecordError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'RecordError'; }
}

function canonical(value: z.output<ReturnType<typeof z.json>>): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key]!)).join(',') + '}';
  return JSON.stringify(value);
}
function fingerprint(input: unknown, ctx: MutationContext): string {
  const authority = { actor: ctx.actor, purpose: ctx.purpose, ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}), ...(ctx.expectedVersion !== undefined ? { expectedVersion: ctx.expectedVersion } : {}) };
  return createHash('sha256').update(canonical(z.json().parse({ input, authority }))).digest('hex');
}
export function storedFingerprint(row: StoredRecord): string { return createHash('sha256').update(canonical(z.json().parse(row))).digest('hex'); }

/** Schema + conditional changes only; queueing/publication remains the native table's job. */
export class RecordStore<S extends z.ZodType> {
  private readonly schema: ReturnType<typeof recordSchema>;
  private creationTail: Promise<void> = Promise.resolve();
  private readonly table: KvTable<string, Stored>;
  private readonly content: S;
  readonly kind: string;
  readonly workspaceId: string;
  private readonly clock: Clock;
  constructor(table: KvTable<string, Stored>, content: S, kind: string, workspaceId: string, clock: Clock) {
    this.table = table; this.content = content; this.kind = kind; this.workspaceId = workspaceId; this.clock = clock;
    this.schema = recordSchema(content);
  }
  private authorize(ctx: HostContext): void {
    HostContextSchema.parse({ workspaceId: ctx.workspaceId, actor: ctx.actor, purpose: ctx.purpose, ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}) });
    if (ctx.workspaceId !== this.workspaceId) throw new RecordError('workspace_mismatch');
  }
  private key(ref: string): string {
    const prefix = this.kind + ':';
    if (!ref.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(ref.slice(prefix.length))) throw new RecordError('target_invalid');
    return ref.slice(prefix.length);
  }
  private stored(ctx: HostContext, ref: string): Stored {
    this.authorize(ctx);
    const raw = this.table.get(this.key(ref));
    if (!raw) throw new RecordError('record_missing');
    const row = this.schema.parse(raw);
    if (row.workspaceId !== this.workspaceId) throw new RecordError('workspace_mismatch');
    return row;
  }
  private result(row: Stored, revision?: number, duplicate = false): Saved<z.output<S>> {
    const value = revision === undefined ? row.versions.at(-1) : row.versions.find(v => v.revision === revision);
    if (!value) throw new RecordError('record_corrupt');
    return { ref: objectRef(this.kind, row.id), version: value.revision, data: this.content.parse(value.content), duplicate };
  }
  read(ctx: HostContext, ref: string, revision?: number): Saved<z.output<S>> {
    const row = this.stored(ctx, ref);
    if (row.deleted && revision === undefined) throw new RecordError('record_missing');
    return this.result(row, revision);
  }
  list(ctx: HostContext): Saved<z.output<S>>[] {
    this.authorize(ctx);
    return [...this.table.keys()].flatMap(id => { const row = this.stored(ctx, objectRef(this.kind, id)); return row.deleted ? [] : [this.result(row)]; });
  }
  /** Remove the current object without erasing versions pinned by old references. */
  async remove(ctx: MutationContext, ref: string): Promise<void> {
    MutationContextSchema.parse(ctx); this.authorize(ctx);
    if (ctx.actor !== 'student') throw new RecordError('delete_requires_student');
    if (typeof ctx.expectedVersion !== 'number') throw new RecordError('version_conflict');
    const revision = ctx.expectedVersion;
    const replay = {};
    await this.table.update(this.key(ref), raw => {
      const row = this.schema.parse(raw);
      if (row.workspaceId !== ctx.workspaceId) throw new RecordError('workspace_mismatch');
      if (row.deleted) {
        if (row.deleted.operationId === ctx.operationId && row.deleted.revision === revision) throw replay;
        throw new RecordError('record_missing');
      }
      if (revision !== row.versions.at(-1)?.revision) throw new RecordError('version_conflict');
      return { ...row, deleted: { operationId: ctx.operationId, revision, at: this.clock.now() } };
    }).catch(error => { if (error !== replay) throw error; });
  }
  changes(ctx: HostContext, ref: string): ObjectChange[] {
    const row = this.stored(ctx, ref);
    return row.operations.filter(op => op.before !== op.after).map(op => {
      const before = op.before === null ? {} : row.versions.find(v => v.revision === op.before)?.content;
      const after = row.versions.find(v => v.revision === op.after)?.content;
      if (before === undefined || after === undefined) throw new RecordError('record_corrupt');
      const a = z.record(z.string(), z.json()).parse(before), b = z.record(z.string(), z.json()).parse(after);
      const changedFields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
      return { operationId: op.id, target: ref, actor: op.actor, ...(op.sessionId ? { sessionId: op.sessionId } : {}), beforeRevision: op.before, afterRevision: op.after, changedFields, committedAt: op.at };
    });
  }
  async create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<z.output<S>>> {
    MutationContextSchema.parse(ctx); this.authorize(ctx);
    const ref = objectRef(this.kind, id), hash = fingerprint(input, ctx);
    // Native update needs an existing key. Only first insertion is serialized here;
    // the workspace owner separately excludes all other OS processes.
    const job = this.creationTail.then(async () => {
      const existing = this.table.get(this.key(ref));
      if (existing) {
        const row = this.schema.parse(existing), op = row.operations.find(op => op.id === ctx.operationId);
        if (row.workspaceId !== this.workspaceId) throw new RecordError('workspace_mismatch');
        if (!op || op.fingerprint !== hash) throw new RecordError('record_exists');
        return this.result(row, op.after, true);
      }
      const row = this.schema.parse({ id, workspaceId: this.workspaceId, versions: [{ revision: 1, content: this.content.parse(input) }], operations: [{ id: ctx.operationId, fingerprint: hash, before: null, after: 1, actor: ctx.actor, ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}), at: this.clock.now() }] });
      await this.table.put(id, row);
      return this.result(row);
    });
    this.creationTail = job.then(() => {}, () => {});
    return job;
  }
  /** Preflight a batch member without writing. The aggregate publisher checks
   * its entire previous row again at the single native publication boundary. */
  prepareCreate(ctx: MutationContext, id: string, input: unknown): PreparedRecordChange<z.output<S>> {
    MutationContextSchema.parse(ctx); this.authorize(ctx);
    const ref = objectRef(this.kind, id), key = this.key(ref), hash = fingerprint(input, ctx);
    const raw = this.table.get(key);
    if (raw) {
      const row = this.schema.parse(raw), op = row.operations.find(op => op.id === ctx.operationId);
      if (row.workspaceId !== this.workspaceId) throw new RecordError('workspace_mismatch');
      if (!op || op.fingerprint !== hash) throw new RecordError('record_exists');
      return { kind: this.kind, workspaceId: this.workspaceId, key, before: storedFingerprint(row), next: row, result: this.result(row, op.after, true) };
    }
    const row = this.schema.parse({ id, workspaceId: this.workspaceId, versions: [{ revision: 1, content: this.content.parse(input) }],
      operations: [{ id: ctx.operationId, fingerprint: hash, before: null, after: 1, actor: ctx.actor, ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}), at: this.clock.now() }] });
    return { kind: this.kind, workspaceId: this.workspaceId, key, before: null, next: row, result: this.result(row) };
  }
  prepareUpdate(ctx: MutationContext, ref: string, input: unknown, transform: (current: z.output<S>) => unknown): PreparedRecordChange<z.output<S>> {
    MutationContextSchema.parse(ctx); this.authorize(ctx);
    return this.prepareRow(ctx, ref, input, transform, true, this.stored(ctx, ref));
  }
  async update(ctx: MutationContext, ref: string, input: unknown, transform: (current: z.output<S>) => unknown): Promise<Saved<z.output<S>>> {
    return this.mutate(ctx, ref, input, transform, true);
  }
  /** Trusted mechanical merge against the native queue's current row, e.g. a late
   * occurrence. Human authored replacement must keep using conditional update. */
  async updateCurrent(ctx: Omit<MutationContext, 'expectedVersion'>, ref: string, input: unknown, transform: (current: z.output<S>) => unknown): Promise<Saved<z.output<S>>> {
    if ('expectedVersion' in ctx) throw new RecordError('derived_update_has_expected_version');
    return this.mutate(ctx, ref, input, transform, false);
  }
  private async mutate(ctx: MutationContext, ref: string, input: unknown, transform: (current: z.output<S>) => unknown, conditional: boolean): Promise<Saved<z.output<S>>> {
    MutationContextSchema.parse(ctx); this.authorize(ctx);
    let result: Saved<z.output<S>> | undefined;
    const replay = {};
    await this.table.update(this.key(ref), raw => {
      const change = this.prepareRow(ctx, ref, input, transform, conditional, raw);
      result = change.result;
      if (result.duplicate) throw replay;
      return change.next;
    }).catch(error => { if (error !== replay) throw error; });
    if (!result) throw new RecordError('record_corrupt');
    return result;
  }
  private prepareRow(ctx: MutationContext, ref: string, input: unknown, transform: (current: z.output<S>) => unknown, conditional: boolean, raw: Stored): PreparedRecordChange<z.output<S>> {
    const row = this.schema.parse(raw), before = storedFingerprint(row), hash = fingerprint(input, ctx);
    if (row.workspaceId !== this.workspaceId) throw new RecordError('workspace_mismatch');
    const result = (revision?: number, duplicate = false): PreparedRecordChange<z.output<S>> => ({ kind: this.kind, workspaceId: this.workspaceId, key: this.key(ref), before, next: this.schema.parse(row), result: this.result(row, revision, duplicate) });
    const prior = row.operations.find(op => op.id === ctx.operationId);
    if (prior) {
      if (prior.fingerprint !== hash) throw new RecordError('operation_conflict');
      return result(prior.after, true);
    }
    const current = this.result(row);
    if (row.deleted) throw new RecordError('record_missing');
    if (conditional && ctx.expectedVersion !== current.version) throw new RecordError('version_conflict');
    const data = this.content.parse(transform(current.data));
    const changed = canonical(z.json().parse(data)) !== canonical(z.json().parse(row.versions.at(-1)!.content));
    const revision = current.version + (changed ? 1 : 0);
    if (changed) row.versions.push({ revision, content: z.json().parse(data) });
    row.operations.push({ id: ctx.operationId, fingerprint: hash, before: current.version, after: revision, actor: ctx.actor, ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}), at: this.clock.now() });
    return result(revision);
  }
}
