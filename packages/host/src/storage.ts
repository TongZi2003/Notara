import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-storage';
import { DomainFacility, defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json';
import type { z } from 'zod';
import lockfile from 'proper-lockfile';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecordStore, recordSchema } from '@studyforge/domain/storage';
import type { Clock } from '@studyforge/domain/clock';

/** One actual writer per canonical student workspace; DSH owns every record publication. */
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
  return {
    async collection<S extends z.ZodType>(kind: string, schema: S): Promise<RecordStore<S>> {
      if (closed || !/^[a-z][a-z0-9_]*$/.test(kind)) throw new Error('Invalid or closed collection');
      const spec = defineDomain({ name: 'sf_' + kind, version: 1, layout: 'single' as const, tables: { records: domainTable(recordSchema(schema)) } });
      const domain = await facility.open(spec); domains.push(domain);
      return new RecordStore(domain.table('records'), schema, kind, workspaceId, clock);
    },
    close(): Promise<void> {
      closed = true;
      closing ??= (async () => { try { for (const domain of domains) await domain.close(); await backend.close(); } finally { unregister?.(); await release(); } })();
      return closing;
    },
  };
}
