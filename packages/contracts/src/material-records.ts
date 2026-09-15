/**
 * P3.1 original material versions (CONTRACTS.md §4).
 *
 * A material is one imported original. Every import or explicit new version
 * publishes immutable bytes and then the metadata record that names them, so an
 * existing anchor keeps resolving its own version forever. Identity and digests
 * are opaque here: only the Host turns a version into a file one real session
 * may read, and a filesystem path never travels to a client.
 */
import { z } from 'zod';
import { TimestampSchema } from './core.ts';
import { MaterialContextSchema } from './materials.ts';

/** Single size limit for one original, checked before anything is published. */
export const MAX_MATERIAL_BYTES = 64 * 1024 * 1024;

/** Formats the importer sniffs and validates; the file extension must agree with the declared type. */
export const MaterialMediaTypeSchema = z.enum([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'text/markdown',
  'text/html',
  'text/plain',
]);
export type MaterialMediaType = z.infer<typeof MaterialMediaTypeSchema>;

/** Opaque tokens that are also path segments: no separator, dot or space may appear. */
export const MaterialIdSchema = z.string().regex(/^mat_[a-z0-9]{16,}$/);
export const MaterialVersionIdSchema = z.string().regex(/^ver_[a-z0-9]{16,}$/);
export type MaterialId = z.infer<typeof MaterialIdSchema>;
export type MaterialVersionId = z.infer<typeof MaterialVersionIdSchema>;

/** Content-addressed storage token; one object picks this single comparison form. */
export const MaterialDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export type MaterialDigest = z.infer<typeof MaterialDigestSchema>;

/** One immutable original version, exactly as it was imported. */
export const MaterialVersionSchema = z.object({
  materialId: MaterialIdSchema,
  versionId: MaterialVersionIdSchema,
  title: z.string().trim().min(1),
  mediaType: MaterialMediaTypeSchema,
  digest: MaterialDigestSchema,
  byteLength: z.number().int().nonnegative(),
  importedAt: TimestampSchema,
  fileName: z.string().trim().min(1),
  /** Original material positions used while a classroom Markdown version was written. */
  sources: z.array(MaterialContextSchema).max(30).optional(),
}).strict();
export type MaterialVersion = z.infer<typeof MaterialVersionSchema>;

/** Internal metadata row: every version plus the pointer of the current one. */
export const MaterialRecordSchema = z.object({
  materialId: MaterialIdSchema,
  title: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  mediaType: MaterialMediaTypeSchema,
  currentVersionId: MaterialVersionIdSchema,
  versions: z.array(MaterialVersionSchema).min(1),
  createdAt: TimestampSchema,
}).strict().superRefine((row, ctx) => {
  if (!row.versions.some(version => version.versionId === row.currentVersionId)) {
    ctx.addIssue({ code: 'custom', path: ['currentVersionId'], message: 'currentVersionId 必须指向 versions 里的一个版本' });
  }
  if (row.versions.some(version => version.materialId !== row.materialId)) {
    ctx.addIssue({ code: 'custom', path: ['versions'], message: '版本必须属于同一条材料' });
  }
  if (new Set(row.versions.map(version => version.versionId)).size !== row.versions.length) {
    ctx.addIssue({ code: 'custom', path: ['versions'], message: '同一版本不能出现两次' });
  }
});
export type MaterialRecord = z.infer<typeof MaterialRecordSchema>;

/** What a caller reads; `revision` is the token a new version must confirm. */
export const MaterialViewSchema = z.object({
  revision: z.number().int().positive(),
  materialId: MaterialIdSchema,
  title: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  mediaType: MaterialMediaTypeSchema,
  currentVersion: MaterialVersionSchema,
  versions: z.array(MaterialVersionSchema).min(1),
}).strict();
export type MaterialView = z.infer<typeof MaterialViewSchema>;

/** Bytes travel beside this; a record never carries content. */
export const ImportMaterialInputSchema = z.object({
  title: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  mediaType: MaterialMediaTypeSchema,
}).strict();
export type ImportMaterialInput = z.infer<typeof ImportMaterialInputSchema>;

/** Explicit target of a new version of an existing material. */
export const NewMaterialVersionInputSchema = ImportMaterialInputSchema.extend({
  materialId: MaterialIdSchema,
}).strict();
export type NewMaterialVersionInput = z.infer<typeof NewMaterialVersionInputSchema>;

/** One exact original version, addressed by identity only. */
export const MaterialRefSchema = z.object({ materialId: MaterialIdSchema, versionId: MaterialVersionIdSchema }).strict();
export type MaterialRef = z.infer<typeof MaterialRefSchema>;
