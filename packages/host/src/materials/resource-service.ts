import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { HostContext } from '@studyforge/contracts';
import { MaterialContextSchema, type MaterialContext } from '@studyforge/contracts/materials';
import { ImportMaterialInputSchema, NewMaterialVersionInputSchema, MAX_MATERIAL_BYTES,
  type MaterialRef, type MaterialView } from '@studyforge/contracts/material-records';
import type { ImportUpload, VersionUpload, MaterialResource, MaterialBytes } from '@studyforge/contracts/material-api';
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

/** Authenticated workspace browsing needs no native Session and creates none. */
export class StudyForgeMaterials extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeMaterials'); }
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
