import type { Context } from '@deepseek-ai/cordis';
import type { ImportMaterialInput, NewMaterialVersionInput, MaterialView } from '@studyforge/contracts/material-records';
import { encodeBase64 } from './files.ts';

/** Bytes per staged chunk; the base64 on the wire stays ~33% larger than this. */
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

/** Everything one upload attempt needs, kept whole so a retry re-runs the same
 * operation with the same `operationId` instead of becoming a second import. */
export interface MaterialUploadRequest {
  readonly kind: 'import' | 'version';
  readonly operationId: string;
  readonly file: File;
  readonly material: ImportMaterialInput | NewMaterialVersionInput;
  readonly expectedVersion?: number;
  readonly onProgress?: (received: number, total: number) => void;
}

/** Upload one original. Small files still take the one-shot call; anything
 * needing more than one chunk goes through the staged begin/chunk/commit
 * session so the wire never carries one giant message. Throws the remote's
 * refusal message so callers keep their settled-refusal matching. */
export async function uploadMaterialFile(ctx: Context, request: MaterialUploadRequest): Promise<MaterialView> {
  if (request.file.size <= UPLOAD_CHUNK_BYTES) {
    const base64 = encodeBase64(new Uint8Array(await request.file.arrayBuffer()));
    const reply = request.kind === 'import'
      ? await ctx.remote.studyforgeMaterials.import({ operationId: request.operationId, material: request.material as ImportMaterialInput, base64 })
      : await ctx.remote.studyforgeMaterials.createVersion({ operationId: request.operationId, expectedVersion: request.expectedVersion!, material: request.material as NewMaterialVersionInput, base64 });
    if (!reply.ok) throw new Error(reply.error.message);
    return reply.value;
  }
  const begin = await ctx.remote.studyforgeMaterials.uploadBegin({
    operationId: request.operationId, kind: request.kind, material: request.material,
    ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
    total: request.file.size,
  });
  if (!begin.ok) throw new Error(begin.error.message);
  const uploadId = begin.value.uploadId;
  try {
    for (let offset = 0; offset < request.file.size; offset += UPLOAD_CHUNK_BYTES) {
      const chunk = await request.file.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer();
      const ack = await ctx.remote.studyforgeMaterials.uploadChunk({ uploadId, offset, base64: encodeBase64(new Uint8Array(chunk)) });
      if (!ack.ok) throw new Error(ack.error.message);
      request.onProgress?.(ack.value.received, request.file.size);
    }
    const commit = await ctx.remote.studyforgeMaterials.uploadCommit({ uploadId });
    if (!commit.ok) throw new Error(commit.error.message);
    return commit.value;
  } catch (error) {
    try { await ctx.remote.studyforgeMaterials.uploadAbort({ uploadId }); }
    catch { /* Staging expires on its own; the abort is only prompt cleanup. */ }
    throw error;
  }
}
