import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-storage';
import { DomainFacility, defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain';
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json';
import { z } from 'zod';
import lockfile from 'proper-lockfile';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecordStore, RecordError, recordSchema, storedFingerprint, type StoredRecord, type PreparedRecordChange } from '@studyforge/domain/storage';
import type { Clock } from '@studyforge/domain/clock';

const WorkspaceSnapshotSchema = z.object({ workspaceId: z.string().min(1),
  collections: z.record(z.string(), z.record(z.string(), recordSchema(z.json()))),
}).strict();
type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

/** One native atomic unit for related learning records. Individual schemas,
 * revisions and operations stay with RecordStore; bytes stay in materials/ and
 * conversations stay in native Session storage. No parallel journal/cache. */
export async function openWorkspaceRecords(ctx: Context, root: string, workspaceId: string, clock: Clock) {
  const canonical = await realpath(root), dataRoot = join(canonical, '.studyforge');
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(canonical, { lockfilePath: join(dataRoot, 'writer.lock'), stale: 5000, update: 1000, retries: 0 });
  const backend = new JsonStorageBackend(dataRoot), name = 'sf-' + randomUUID();
  let unregister: (() => void) | undefined;
  try { unregister = ctx.storage.backend.register(name, backend); }
  catch (error) { await release(); throw error; }
  const facility = new DomainFacility(ctx, { backend: name });
  const domains: { close(): Promise<void> }[] = [];
  let closed = false, closing: Promise<void> | undefined;
  let statePromise: Promise<KvTable<string, WorkspaceSnapshot>> | undefined;
  const schemas = new Map<string, z.ZodType<StoredRecord>>();
  const opening = new Set<string>();
  const assertOpen = (): void => { if (closed) throw new RecordError('workspace_closed'); };
  const state = (): Promise<KvTable<string, WorkspaceSnapshot>> => statePromise ??= (async () => {
    const spec = defineDomain({ name: 'sf_records', version: 1, layout: 'single' as const, tables: { state: domainTable(WorkspaceSnapshotSchema) } });
    const domain = await facility.open(spec); domains.push(domain);
    const table = domain.table('state');
    if (!table.get('workspace')) await table.put('workspace', { workspaceId, collections: {} });
    if (table.get('workspace')!.workspaceId !== workspaceId) throw new RecordError('workspace_mismatch');
    return table;
  })();
  const snapshot = (table: KvTable<string, WorkspaceSnapshot>): WorkspaceSnapshot => {
    assertOpen();
    const value = table.get('workspace');
    if (!value) throw new RecordError('record_corrupt');
    return value;
  };
  return {
    async collection<S extends z.ZodType>(kind: string, schema: S): Promise<RecordStore<S>> {
      if (closed || !/^[a-z][a-z0-9_]*$/.test(kind)) throw new Error('Invalid or closed collection');
      if (opening.has(kind)) throw new RecordError('collection_already_open');
      opening.add(kind);
      const table = await state(), validator = recordSchema(schema);
      for (const [key, value] of Object.entries(snapshot(table).collections[kind] ?? {})) {
        const parsed = validator.parse(value);
        if (parsed.id !== key || parsed.workspaceId !== workspaceId) throw new RecordError('record_corrupt');
      }
      schemas.set(kind, validator);
      const read = (): Record<string, StoredRecord> => snapshot(table).collections[kind] ?? {};
      const facade: KvTable<string, StoredRecord> = {
        get: key => read()[key],
        entries: () => Object.entries(read())[Symbol.iterator](), keys: () => Object.keys(read())[Symbol.iterator](),
        get size() { return Object.keys(read()).length; },
        async put(key, value) {
          assertOpen(); const parsed = validator.parse(value);
          if (parsed.id !== key || parsed.workspaceId !== workspaceId) throw new RecordError('record_corrupt');
          await table.update('workspace', row => {
            if (row.collections[kind]?.[key]) throw new RecordError('record_exists');
            return { ...row, collections: { ...row.collections, [kind]: { ...row.collections[kind], [key]: parsed } } };
          });
        },
        async update(key, fn) {
          assertOpen(); let value: StoredRecord | undefined;
          await table.update('workspace', row => {
            const current = row.collections[kind]?.[key];
            if (!current) throw new RecordError('record_missing');
            value = validator.parse(fn(current));
            if (value.id !== key || value.workspaceId !== workspaceId) throw new RecordError('record_corrupt');
            return { ...row, collections: { ...row.collections, [kind]: { ...row.collections[kind], [key]: value } } };
          });
          if (!value) throw new RecordError('record_corrupt'); return value;
        },
        async delete(key) {
          assertOpen(); const absent = {}; let deleted = false;
          await table.update('workspace', row => {
            if (!row.collections[kind]?.[key]) throw absent;
            const next = { ...row.collections[kind] }; delete next[key]; deleted = true;
            return { ...row, collections: { ...row.collections, [kind]: next } };
          }).catch(error => { if (error !== absent) throw error; });
          return deleted;
        },
      };
      return new RecordStore(facade, schema, kind, workspaceId, clock);
    },
    /** All preflighted records are compared and published by ONE native update.
     * A failed comparison or validator publishes none; an ack-loss retry uses
     * each record's existing operation, not a newly generated batch identity. */
    async atomic(changes: readonly PreparedRecordChange[]): Promise<void> {
      assertOpen(); if (!changes.length) throw new RecordError('empty_atomic_change');
      const table = await state(), seen = new Set<string>();
      const plans = changes.map(change => {
        if (change.workspaceId !== workspaceId) throw new RecordError('workspace_mismatch');
        const key = `${change.kind}:${change.key}`;
        if (seen.has(key)) throw new RecordError('duplicate_atomic_target'); seen.add(key);
        const validator = schemas.get(change.kind);
        if (!validator) throw new RecordError('collection_not_open');
        const next = validator.parse(change.next);
        if (next.id !== change.key || next.workspaceId !== workspaceId) throw new RecordError('record_corrupt');
        return { ...change, next };
      });
      const unchanged = {};
      await table.update('workspace', row => {
        for (const change of plans) {
          const prior = row.collections[change.kind]?.[change.key];
          if ((prior ? storedFingerprint(prior) : null) !== change.before) throw new RecordError('version_conflict');
        }
        if (plans.every(change => change.before === storedFingerprint(change.next))) throw unchanged;
        const collections = { ...row.collections };
        for (const change of plans) collections[change.kind] = { ...collections[change.kind], [change.key]: change.next };
        return { ...row, collections };
      }).catch(error => { if (error !== unchanged) throw error; });
    },
    close(): Promise<void> {
      closed = true;
      closing ??= (async () => { try {
        await statePromise?.catch(() => {});
        for (const domain of domains) await domain.close(); await backend.close();
      } finally { unregister?.(); await release(); } })();
      return closing;
    },
  };
}
