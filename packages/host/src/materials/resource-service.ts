import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { HostContext } from '@studyforge/contracts';
import { MaterialContextSchema, type MaterialContext } from '@studyforge/contracts/materials';
import { ImportMaterialInputSchema, NewMaterialVersionInputSchema, MAX_MATERIAL_BYTES,
  type MaterialRef, type MaterialView } from '@studyforge/contracts/material-records';
import type { ImportUpload, VersionUpload, MaterialResource, MaterialBytes,
  UploadBeginInput, UploadTicket, UploadChunkInput, UploadChunkAck, UploadCommitInput, UploadAbortInput } from '@studyforge/contracts/material-api';
import { MaterialService } from '@studyforge/domain/materials';
import { readMaterial } from '@studyforge/domain/material-read';
import type { MaterialRead } from '@studyforge/contracts/material-read';
import { indexDocx, type DocxIndex } from '@studyforge/domain/docx';
import type { SkeletonService } from '@studyforge/domain/skeleton';
import type { SkeletonView } from '@studyforge/contracts/skeleton';
import { sessionResources } from './session-resource.ts';
import { contentHistory } from './content-history.ts';
import type { ContentHistory, ContentHistoryQuery } from '@studyforge/contracts/content-history';
import type { LessonResourcesProjection } from '@studyforge/domain/lesson-resources';
import { searchLearning } from '../tools/search-tools.ts';
import type { LearningSearchInput, LearningSearchResult } from '@studyforge/contracts/learning-search';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeMaterials: StudyForgeMaterials; studyforgeMaterialService: MaterialService; studyforgeSkeletonService: SkeletonService; } }

/** Staged chunked upload: bytes accumulate in order until `commit` publishes
 * them through the same service the one-shot calls use. Nothing is imported or
 * versioned before every declared byte has arrived. */
interface PendingUpload {
  readonly kind: 'import' | 'version';
  readonly material: z.infer<typeof ImportMaterialInputSchema> | z.infer<typeof NewMaterialVersionInputSchema>;
  readonly expectedVersion?: number;
  readonly operationId: string;
  readonly total: number;
  received: number;
  readonly chunks: Buffer[];
  expires: number;
}
const UPLOAD_TTL_MS = 15 * 60 * 1000;
const UPLOAD_MAX_PENDING = 16;
const UPLOAD_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
const UploadBeginSchema = z.object({
  operationId: z.string().min(1),
  kind: z.enum(['import', 'version']),
  material: z.union([ImportMaterialInputSchema, NewMaterialVersionInputSchema]),
  expectedVersion: z.number().int().positive().optional(),
  total: z.number().int().positive(),
}).strict();
const UploadChunkSchema = z.object({ uploadId: z.string().min(1), offset: z.number().int().min(0), base64: z.string() }).strict();
const UploadIdSchema = z.object({ uploadId: z.string().min(1) }).strict();

/** Authenticated workspace browsing needs no native Session and creates none. */
export class StudyForgeMaterials extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeMaterials'); }
  private readonly pendingUploads = new Map<string, PendingUpload>();
  private context(): HostContext {
    return { workspaceId: this.ctx.studyforgeAccess.workspaceId, actor: 'student', purpose: 'learning' };
  }
  @Remote('list')
  async list(): Promise<MaterialView[]> { return this.ctx.studyforgeMaterialService.list(this.context()); }
  @Remote('contentHistory')
  async contentHistory(input: ContentHistoryQuery): Promise<ContentHistory> { return contentHistory(this.ctx, this.context(), input); }
  @Remote('lessonResources')
  async lessonResources(input: { sessionId: string }): Promise<LessonResourcesProjection> { return sessionResources(this.ctx, input.sessionId); }
  @Remote('search')
  async search(input: LearningSearchInput): Promise<LearningSearchResult> { return searchLearning(this.ctx, this.context(), input); }
  @Remote('get')
  async get(input: { materialId: string }): Promise<MaterialView> {
    return this.ctx.studyforgeMaterialService.get(this.context(), input.materialId);
  }
  @Remote('import')
  async import(input: ImportUpload): Promise<MaterialView> {
    const parsed = z.object({ operationId: z.string().min(1), material: ImportMaterialInputSchema, base64: z.string() }).strict().parse(input);
    return this.ctx.studyforgeMaterialService.import({ ...this.context(), operationId: parsed.operationId }, { ...parsed.material, bytes: decodeUpload(parsed.base64) });
  }
  @Remote('createVersion')
  async createVersion(input: VersionUpload): Promise<MaterialView> {
    const parsed = z.object({ operationId: z.string().min(1), expectedVersion: z.number().int().positive(), material: NewMaterialVersionInputSchema, base64: z.string() }).strict().parse(input);
    return this.ctx.studyforgeMaterialService.createVersion({ ...this.context(), operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, { ...parsed.material, bytes: decodeUpload(parsed.base64) });
  }
  /** Begin a staged upload. The declared `total` is bounded here so an
   * oversized original is refused before a single byte is staged. */
  @Remote('uploadBegin')
  async uploadBegin(input: UploadBeginInput): Promise<UploadTicket> {
    const parsed = UploadBeginSchema.parse(input);
    if (parsed.total > MAX_MATERIAL_BYTES) throw new Error('material_too_large');
    if (parsed.kind === 'version' && (parsed.expectedVersion === undefined || !('materialId' in parsed.material))) throw new Error('upload_version_fields_missing');
    const now = Date.now();
    for (const [id, pending] of this.pendingUploads) if (pending.expires <= now) this.pendingUploads.delete(id);
    if (this.pendingUploads.size >= UPLOAD_MAX_PENDING) throw new Error('upload_pending_limit');
    const uploadId = `upload_${randomUUID()}`;
    this.pendingUploads.set(uploadId, {
      kind: parsed.kind, material: parsed.material, operationId: parsed.operationId,
      total: parsed.total, received: 0, chunks: [], expires: now + UPLOAD_TTL_MS,
      ...(parsed.expectedVersion === undefined ? {} : { expectedVersion: parsed.expectedVersion }),
    });
    return { uploadId, received: 0, total: parsed.total };
  }
  /** Append one ordered chunk. Offsets must arrive sequentially so a retry of
   * the same position is honest instead of silently doubling bytes. */
  @Remote('uploadChunk')
  async uploadChunk(input: UploadChunkInput): Promise<UploadChunkAck> {
    const parsed = UploadChunkSchema.parse(input);
    const pending = this.pendingUploads.get(parsed.uploadId);
    if (!pending || pending.expires <= Date.now()) { this.pendingUploads.delete(parsed.uploadId); throw new Error('upload_expired'); }
    if (parsed.offset !== pending.received) throw new Error('upload_offset_mismatch');
    if (parsed.base64.length > Math.ceil(UPLOAD_CHUNK_MAX_BYTES / 3) * 4) throw new Error('upload_chunk_too_large');
    if (parsed.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.base64)) throw new Error('material_encoding_invalid');
    const bytes = Buffer.from(parsed.base64, 'base64');
    if (bytes.length === 0 || pending.received + bytes.length > pending.total) throw new Error('upload_overrun');
    pending.chunks.push(bytes);
    pending.received += bytes.length;
    pending.expires = Date.now() + UPLOAD_TTL_MS;
    return { uploadId: parsed.uploadId, received: pending.received };
  }
  /** Publish the staged bytes through the normal import/version path. The
   * staging entry is always released: a refused import cannot be re-committed
   * because the refusal belongs to the bytes, not the session. */
  @Remote('uploadCommit')
  async uploadCommit(input: UploadCommitInput): Promise<MaterialView> {
    const parsed = UploadIdSchema.parse(input);
    const pending = this.pendingUploads.get(parsed.uploadId);
    if (!pending || pending.expires <= Date.now()) { this.pendingUploads.delete(parsed.uploadId); throw new Error('upload_expired'); }
    this.pendingUploads.delete(parsed.uploadId);
    if (pending.received !== pending.total) throw new Error('upload_incomplete');
    const bytes = Buffer.concat(pending.chunks);
    return pending.kind === 'version'
      ? this.ctx.studyforgeMaterialService.createVersion(
          { ...this.context(), operationId: pending.operationId, expectedVersion: pending.expectedVersion! },
          { ...(pending.material as z.infer<typeof NewMaterialVersionInputSchema>), bytes })
      : this.ctx.studyforgeMaterialService.import(
          { ...this.context(), operationId: pending.operationId },
          { ...(pending.material as z.infer<typeof ImportMaterialInputSchema>), bytes });
  }
  /** Discard staged bytes; retry begins a fresh session. Idempotent so a
   * client can always clean up without tracking whether chunks landed. */
  @Remote('uploadAbort')
  async uploadAbort(input: UploadAbortInput): Promise<UploadChunkAck> {
    const parsed = UploadIdSchema.parse(input);
    const pending = this.pendingUploads.get(parsed.uploadId);
    this.pendingUploads.delete(parsed.uploadId);
    return { uploadId: parsed.uploadId, received: pending?.received ?? 0 };
  }
  /** Resolve an immutable version through the actual target Session's read grants. */
  @Remote('resolveForSession')
  async resolveForSession(input: { sessionId: string; source: MaterialContext }): Promise<MaterialResource> {
    const source = MaterialContextSchema.parse(input.source);
    const binding = await this.ctx.studyforgeAccess.forSession(input.sessionId);
    const resolved = await this.ctx.studyforgeMaterialService.resolve({ ...this.context(), sessionId: binding.sessionId, purpose: binding.purpose }, { materialId: source.materialId, versionId: source.versionId });
    this.ctx.studyforgeAccess.assert(binding, resolved.absolutePath);
    return { address: fileAddressFor(binding.sessionId, binding.cwd, resolved.absolutePath), version: resolved.version };
  }
  /** Workspace-authorized original bytes for the standalone library viewer. */
  @Remote('bytes')
  async bytes(input: MaterialRef): Promise<MaterialBytes> {
    const { version, absolutePath } = await this.ctx.studyforgeMaterialService.resolve(this.context(), input);
    return { version, base64: (await readFile(absolutePath)).toString('base64') };
  }
  @Remote('read')
  async read(input: { source: MaterialContext }): Promise<MaterialRead> {
    return readMaterial(this.ctx.studyforgeMaterialService, this.context(), input.source);
  }
  @Remote('docxIndex')
  async docxIndex(input: MaterialRef): Promise<DocxIndex> {
    const { version, absolutePath } = await this.ctx.studyforgeMaterialService.resolve(this.context(), input);
    if (version.mediaType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') throw new Error('material_not_docx');
    return indexDocx(await readFile(absolutePath));
  }
  @Remote('skeleton')
  async skeleton(input: { materialId: string }): Promise<SkeletonView> {
    return this.ctx.studyforgeSkeletonService.read(this.context(), input.materialId);
  }
}

/** Canonical base64 and the same byte limit as the importer; reject before allocating. */
export function decodeUpload(base64: string): Uint8Array {
  if (base64.length > Math.ceil(MAX_MATERIAL_BYTES / 3) * 4) throw new Error('material_too_large');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('material_encoding_invalid');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64 || bytes.length > MAX_MATERIAL_BYTES) throw new Error('material_encoding_invalid');
  return bytes;
}
