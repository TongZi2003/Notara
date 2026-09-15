/**
 * P3.1 original materials and their immutable versions (CONTRACTS.md §4).
 *
 * One imported file is one material; every import or explicit new version
 * publishes the bytes under `<workspace>/materials/<materialId>/<versionId>/`
 * first and writes the metadata row that names them second. A crash in between
 * therefore leaves bytes nobody can address, never a half-visible material, and
 * an existing version's own path is never rewritten, so an old anchor keeps
 * resolving the exact bytes it was created from.
 *
 * Identity is derived from the Host operation, not from a clock or a random
 * call: replaying one accepted operation finds the same material and version.
 */
import { createHash } from 'node:crypto';
import { MutationContextSchema, type HostContext, type MutationContext } from '@studyforge/contracts';
import type { MaterialContext } from '@studyforge/contracts/materials';
import {
  ImportMaterialInputSchema, MaterialIdSchema, MaterialRefSchema, MaterialViewSchema, NewMaterialVersionInputSchema,
  type ImportMaterialInput, type MaterialRecord, type MaterialRef, type MaterialVersion, type MaterialView, type NewMaterialVersionInput,
} from '@studyforge/contracts/material-records';
import type { Clock } from '../clock.ts';
import { RecordError, type Saved, type PreparedRecordChange } from '../storage/record-store.ts';
import { validateMaterial } from './import-validation.ts';
import { VersionStore, digestOf } from './version-store.ts';

/** The record surface this service needs; one native store satisfies it. */
export interface MaterialRecordStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<MaterialRecord>;
  list(ctx: HostContext): Saved<MaterialRecord>[];
  create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<MaterialRecord>>;
  update(ctx: MutationContext, ref: string, input: unknown, transform: (current: MaterialRecord) => unknown): Promise<Saved<MaterialRecord>>;
  prepareCreate?(ctx: MutationContext, id: string, input: unknown): PreparedRecordChange<MaterialRecord>;
  prepareUpdate?(ctx: MutationContext, ref: string, input: unknown, transform: (current: MaterialRecord) => unknown): PreparedRecordChange<MaterialRecord>;
}

/** One exact version plus where its bytes really are; the path never leaves the Host. */
export interface ResolvedMaterial { readonly version: MaterialVersion; readonly absolutePath: string; }

export const MATERIAL_KIND = 'material';
/** One operation may carry its bytes; the record itself never does. */
export type ImportMaterialRequest = ImportMaterialInput & { readonly bytes: Uint8Array; readonly sources?: readonly MaterialContext[] };
export type NewMaterialVersionRequest = NewMaterialVersionInput & { readonly bytes: Uint8Array; readonly sources?: readonly MaterialContext[] };

export class MaterialService {
  private readonly records: MaterialRecordStore;
  private readonly store: VersionStore;
  private readonly clock: Clock;
  // Name checks and publication must not interleave: two concurrent imports of
  // the same file name would otherwise both pass the check and both publish.
  private tail: Promise<void> = Promise.resolve();

  constructor(records: MaterialRecordStore, root: string, clock: Clock) {
    this.records = records; this.store = new VersionStore(root); this.clock = clock;
  }

  /** Import one new original; no learning set, card or lesson is created. */
  async import(ctx: MutationContext, input: ImportMaterialRequest, publish?: (change: PreparedRecordChange<MaterialRecord>, view: MaterialView) => Promise<void>): Promise<MaterialView> {
    const { bytes, sources, ...fields } = input;
    const parsed = ImportMaterialInputSchema.parse(fields);
    const validated = await validateMaterial({ fileName: parsed.fileName, mediaType: parsed.mediaType, bytes });
    const materialId = derive('mat_', `${ctx.workspaceId}:${ctx.operationId}:import`);
    const versionId = derive('ver_', `${ctx.workspaceId}:${ctx.operationId}:import:v1`);
    return this.serial(async () => {
      const ref = refOf(materialId);
      // Replaying this exact accepted import has to rebuild the identical row,
      // so its time comes from that operation's own immutable version, never a
      // fresh clock read. Whether the replay is allowed at all is still the
      // record store's decision: the same operation id under another actor,
      // purpose or session is a conflict, and the reply is that operation's own
      // revision, not whatever the material points at today.
      const existing = this.optional(ctx, ref);
      const importedAt = existing?.data.versions.find(version => version.versionId === versionId)?.importedAt
        ?? existing?.data.createdAt ?? this.clock.now();
      const version: MaterialVersion = {
        materialId, versionId, title: parsed.title, mediaType: validated.mediaType,
        digest: validated.digest, byteLength: validated.byteLength, importedAt, fileName: validated.fileName,
        ...(sources && sources.length ? { sources: [...sources] } : {}),
      };
      const record: MaterialRecord = {
        materialId, title: parsed.title, fileName: validated.fileName, mediaType: validated.mediaType,
        currentVersionId: versionId, versions: [version], createdAt: importedAt,
      };
      this.assertNameFree(ctx, record.fileName, record.title, materialId);
      await this.store.publish({ materialId, versionId, fileName: version.fileName, bytes, digest: version.digest });
      if (publish) {
        if (!this.records.prepareCreate) throw new RecordError('material_atomic_unavailable');
        const change = this.records.prepareCreate(operation(ctx), materialId, record), view = toView(change.result);
        await publish(change, view); return view;
      }
      return toView(await this.records.create(operation(ctx), materialId, record));
    });
  }

  /** Append one explicit new version and move the current pointer; v1 stays readable. */
  async createVersion(ctx: MutationContext, input: NewMaterialVersionRequest, publish?: (change: PreparedRecordChange<MaterialRecord>, view: MaterialView) => Promise<void>): Promise<MaterialView> {
    if (ctx.expectedVersion === undefined) throw new RecordError('material_expected_version_required');
    const { bytes, sources, ...fields } = input;
    const parsed = NewMaterialVersionInputSchema.parse(fields);
    const validated = await validateMaterial({ fileName: parsed.fileName, mediaType: parsed.mediaType, bytes });
    const versionId = derive('ver_', `${ctx.workspaceId}:${ctx.operationId}:${parsed.materialId}`);
    return this.serial(async () => {
      const ref = refOf(parsed.materialId);
      const current = this.require(ctx, ref);
      // The same reasoning as an import: a replayed append reuses the time this
      // operation already recorded so the store can recognise the retry, and
      // the append itself is a conditional change the store validates.
      const importedAt = current.data.versions.find(version => version.versionId === versionId)?.importedAt ?? this.clock.now();
      const version: MaterialVersion = {
        materialId: parsed.materialId, versionId, title: parsed.title, mediaType: validated.mediaType,
        digest: validated.digest, byteLength: validated.byteLength, importedAt, fileName: validated.fileName,
        ...(sources && sources.length ? { sources: [...sources] } : {}),
      };
      this.assertNameFree(ctx, version.fileName, version.title, parsed.materialId);
      await this.store.publish({ materialId: parsed.materialId, versionId, fileName: version.fileName, bytes, digest: version.digest });
      const transform = (row: MaterialRecord): MaterialRecord => ({ ...row, title: parsed.title, fileName: version.fileName, mediaType: version.mediaType, currentVersionId: versionId, versions: [...row.versions, version] });
      if (publish) {
        if (!this.records.prepareUpdate) throw new RecordError('material_atomic_unavailable');
        const change = this.records.prepareUpdate(ctx, ref, { ...parsed, version }, transform), view = toView(change.result);
        await publish(change, view); return view;
      }
      const saved = await this.records.update(ctx, ref, { ...parsed, version }, transform);
      return toView(saved);
    });
  }

  /** Every material of this workspace, newest metadata revision included. */
  async list(ctx: HostContext): Promise<MaterialView[]> { return this.records.list(ctx).map(toView); }

  async get(ctx: HostContext, materialId: string): Promise<MaterialView> {
    return toView(this.require(ctx, refOf(MaterialIdSchema.parse(materialId))));
  }

  /**
   * Resolve one exact version to its immutable bytes.
   * @throws `material_missing`/`material_version_missing`, `material_path_unsafe`
   * or `material_digest_mismatch`; the whole identity is re-checked on read.
   */
  async resolve(ctx: HostContext, ref: MaterialRef): Promise<ResolvedMaterial> {
    const parsed = MaterialRefSchema.parse(ref);
    const version = this.require(ctx, refOf(parsed.materialId)).data.versions.find(item => item.versionId === parsed.versionId);
    if (!version) throw new RecordError('material_version_missing');
    const opened = await this.store.open(parsed.materialId, parsed.versionId, version.fileName);
    if (opened.bytes.byteLength !== version.byteLength || digestOf(opened.bytes) !== version.digest) throw new RecordError('material_digest_mismatch');
    return { version, absolutePath: opened.absolutePath };
  }

  /** One publication or name check at a time; the tail never keeps a rejection. */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private optional(ctx: HostContext, ref: string): Saved<MaterialRecord> | undefined {
    try { return this.records.read(ctx, ref); }
    catch (error) { if (codeOf(error) === 'record_missing') return undefined; throw error; }
  }

  private require(ctx: HostContext, ref: string): Saved<MaterialRecord> {
    const saved = this.optional(ctx, ref);
    if (!saved) throw new RecordError('material_missing');
    return saved;
  }

  /** A name is refused against every other material of this workspace. */
  private assertNameFree(ctx: HostContext, fileName: string, title: string, own: string | null): void {
    const name = fileName.toLowerCase(), heading = title.toLowerCase();
    const clash = this.records.list(ctx).find(saved => saved.data.materialId !== own
      && (saved.data.fileName.toLowerCase() === name || saved.data.title.toLowerCase() === heading));
    if (clash) throw new RecordError('material_name_exists');
  }
}

function refOf(materialId: string): string { return `${MATERIAL_KIND}:${materialId}`; }

/** Identity is a pure function of the accepted operation, so a retry is one effect. */
function derive(prefix: string, seed: string): string {
  return prefix + createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

/** `expectedVersion` is not part of an import's identity: it owns no revision yet. */
function operation(ctx: MutationContext): MutationContext {
  const { expectedVersion: _ignored, ...rest } = ctx;
  return MutationContextSchema.parse(rest);
}

function toView(saved: Saved<MaterialRecord>): MaterialView {
  const row = saved.data;
  const currentVersion = row.versions.find(version => version.versionId === row.currentVersionId);
  if (!currentVersion) throw new RecordError('record_corrupt');
  return MaterialViewSchema.parse({
    revision: saved.version, materialId: row.materialId, title: row.title, fileName: row.fileName,
    mediaType: row.mediaType, currentVersion, versions: row.versions,
  });
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
