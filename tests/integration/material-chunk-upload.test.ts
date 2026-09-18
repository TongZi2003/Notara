import { afterEach, expect, test } from 'vitest';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { MaterialBytes, UploadTicket, UploadChunkAck } from '@studyforge/contracts/material-api';
import { MAX_MATERIAL_BYTES } from '@studyforge/contracts/material-records';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }
function code(result: RemoteResult<unknown>): string { return result.ok ? '' : String((result.error as { message?: string }).message ?? ''); }

const MATERIAL = { title: '大块讲义', fileName: '大块.md', mediaType: 'text/markdown' } as const;

async function begin(client: Awaited<ReturnType<typeof connectRuntime>>, input: Record<string, unknown>): Promise<RemoteResult<UploadTicket>> {
  return client.rpc<UploadTicket>('studyforgeMaterials/uploadBegin', { input });
}
async function chunk(client: Awaited<ReturnType<typeof connectRuntime>>, uploadId: string, offset: number, bytes: Buffer): Promise<RemoteResult<UploadChunkAck>> {
  return client.rpc<UploadChunkAck>('studyforgeMaterials/uploadChunk', { input: { uploadId, offset, base64: bytes.toString('base64') } });
}

test('chunked import publishes the assembled bytes and dedups a retried operation', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const bytes = Buffer.alloc(9 * 1024 * 1024);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = 35 + (index % 90);
  const operationId = crypto.randomUUID();
  const ticket = value(await begin(client, { operationId, kind: 'import', material: MATERIAL, total: bytes.length }));
  expect(ticket).toMatchObject({ received: 0, total: bytes.length });
  const chunks = [bytes.subarray(0, 4 * 1024 * 1024), bytes.subarray(4 * 1024 * 1024, 8 * 1024 * 1024), bytes.subarray(8 * 1024 * 1024)];
  let offset = 0;
  for (const piece of chunks) {
    const ack = value(await chunk(client, ticket.uploadId, offset, piece));
    offset += piece.length;
    expect(ack.received).toBe(offset);
  }
  const imported = value(await client.rpc<MaterialView>('studyforgeMaterials/uploadCommit', { input: { uploadId: ticket.uploadId } }));
  expect(imported.title).toBe(MATERIAL.title);
  const round = value(await client.rpc<MaterialBytes>('studyforgeMaterials/bytes', { input: { materialId: imported.materialId, versionId: imported.currentVersion.versionId } }));
  expect(Buffer.from(round.base64, 'base64')).toEqual(bytes);
  // A retried flow with the same operation id lands on the same import, not a copy.
  const again = value(await begin(client, { operationId, kind: 'import', material: MATERIAL, total: bytes.length }));
  value(await chunk(client, again.uploadId, 0, bytes.subarray(0, 1024)));
  expect(code(await client.rpc('studyforgeMaterials/uploadCommit', { input: { uploadId: again.uploadId } }))).toContain('upload_incomplete');
}, 30_000);

test('chunked version append lands as the next immutable version', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const imported = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: crypto.randomUUID(), material: MATERIAL, base64: Buffer.from('第一版').toString('base64') } }));
  const next = Buffer.from('第二版：'.repeat(2000));
  const ticket = value(await begin(client, {
    operationId: crypto.randomUUID(), kind: 'version', expectedVersion: imported.revision,
    material: { ...MATERIAL, materialId: imported.materialId }, total: next.length,
  }));
  const half = Math.floor(next.length / 2);
  value(await chunk(client, ticket.uploadId, 0, next.subarray(0, half)));
  value(await chunk(client, ticket.uploadId, half, next.subarray(half)));
  const updated = value(await client.rpc<MaterialView>('studyforgeMaterials/uploadCommit', { input: { uploadId: ticket.uploadId } }));
  expect(updated.versions).toHaveLength(2);
  const round = value(await client.rpc<MaterialBytes>('studyforgeMaterials/bytes', { input: { materialId: updated.materialId, versionId: updated.currentVersion.versionId } }));
  expect(Buffer.from(round.base64, 'base64')).toEqual(next);
}, 30_000);

test('chunk session refuses oversize, out-of-order, overrun and stale ids honestly', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  expect(code(await begin(client, { operationId: crypto.randomUUID(), kind: 'import', material: MATERIAL, total: MAX_MATERIAL_BYTES + 1 }))).toContain('material_too_large');
  expect(code(await begin(client, { operationId: crypto.randomUUID(), kind: 'version', material: { ...MATERIAL, materialId: `mat_${'a'.repeat(16)}` }, total: 8 }))).toContain('upload_version_fields_missing');
  expect(code(await begin(client, { operationId: crypto.randomUUID(), kind: 'version', expectedVersion: 1, material: MATERIAL, total: 8 }))).toContain('upload_version_fields_missing');
  const ticket = value(await begin(client, { operationId: crypto.randomUUID(), kind: 'import', material: MATERIAL, total: 10 }));
  expect(code(await chunk(client, ticket.uploadId, 4, Buffer.from('ab')))).toContain('upload_offset_mismatch');
  expect(code(await chunk(client, ticket.uploadId, 0, Buffer.alloc(11)))).toContain('upload_overrun');
  expect(code(await client.rpc('studyforgeMaterials/uploadChunk', { input: { uploadId: ticket.uploadId, offset: 0, base64: '!!!' } }))).toContain('material_encoding_invalid');
  value(await chunk(client, ticket.uploadId, 0, Buffer.from('0123456789')));
  const commit = value(await client.rpc<MaterialView>('studyforgeMaterials/uploadCommit', { input: { uploadId: ticket.uploadId } }));
  expect(commit.title).toBe(MATERIAL.title);
  expect(code(await client.rpc('studyforgeMaterials/uploadCommit', { input: { uploadId: ticket.uploadId } }))).toContain('upload_expired');
  expect(code(await chunk(client, 'upload_missing', 0, Buffer.from('x')))).toContain('upload_expired');
  const aborted = value(await begin(client, { operationId: crypto.randomUUID(), kind: 'import', material: MATERIAL, total: 4 }));
  const ack = value(await client.rpc<UploadChunkAck>('studyforgeMaterials/uploadAbort', { input: { uploadId: aborted.uploadId } }));
  expect(ack.received).toBe(0);
  expect(code(await chunk(client, aborted.uploadId, 0, Buffer.from('x')))).toContain('upload_expired');
  expect(code(await client.rpc('studyforgeMaterials/uploadAbort', { input: { uploadId: 'upload_missing' } }))).toBe('');
}, 30_000);
