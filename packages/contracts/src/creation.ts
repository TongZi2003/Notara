import { z } from 'zod';
import { MaterialContextSchema } from './materials.ts';
import { WorldbookDocumentSchema } from './plugins.ts';
import { ClassroomDefinitionSchema } from './classroom.ts';

export const ClassroomDocumentSchema = WorldbookDocumentSchema.safeExtend({ classroom: ClassroomDefinitionSchema });
export const artifactEntry = (kind: string): 'content.md' | 'index.html' | 'worldbook.json' => kind === 'html' ? 'index.html' : kind === 'classroom' ? 'worldbook.json' : 'content.md';

export const ArtifactKindSchema = z.enum(['subject', 'teaching', 'skill', 'html', 'markdown', 'classroom']);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export const ArtifactManifestSchema = z.object({
  title: z.string().trim().min(1).max(160), kind: ArtifactKindSchema,
  description: z.string().max(2000).default(''), subjects: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  entry: z.enum(['content.md', 'index.html', 'worldbook.json']),
}).strict().refine(value => value.entry === artifactEntry(value.kind), 'entry must match artifact kind');
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;
export const ArtifactTargetSchema = z.object({ ref: z.string().min(1), version: z.number().int().positive() }).strict();
export const CreationRecordSchema = z.object({
  name: z.string().regex(/^work-[a-f0-9]{24}$/), sessionId: z.string().min(1),
  seedDigest: z.string().min(1),
  initial: ArtifactManifestSchema, references: z.array(MaterialContextSchema),
  target: ArtifactTargetSchema.optional(), originSessionId: z.string().optional(),
}).strict();
export type CreationRecord = z.infer<typeof CreationRecordSchema>;
export const ArtifactFileSchema = z.object({ path: z.string(), body: z.string(), digest: z.string() }).strict();
export const ArtifactViewSchema = z.object({
  ref: z.string(), sessionId: z.string(), revision: z.number().int().positive(),
  manifest: ArtifactManifestSchema.nullable(), manifestError: z.boolean(), files: z.array(ArtifactFileSchema), digest: z.string(),
  target: ArtifactTargetSchema.optional(),
  originSessionId: z.string().optional(),
}).strict();
export type ArtifactView = z.infer<typeof ArtifactViewSchema>;
export const ArtifactCreateSchema = z.object({
  operationId: z.string().min(1), title: z.string().trim().min(1).max(160), kind: ArtifactKindSchema,
  description: z.string().max(2000).optional(), subjects: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  references: z.array(MaterialContextSchema).max(30).default([]), content: z.string().max(1_000_000).optional(),
  target: ArtifactTargetSchema.optional(), originSessionId: z.string().optional(),
}).strict();
export type ArtifactCreate = z.infer<typeof ArtifactCreateSchema>;
export const ArtifactSaveSchema = z.object({ ref: z.string().min(1), path: z.enum(['manifest.json', 'content.md', 'index.html', 'worldbook.json']), expectedDigest: z.string().min(1), content: z.string().max(1_000_000) }).strict();

export const InstalledArtifactSchema = z.object({
  projectRef: z.string(), activeDigest: z.string(), enabled: z.boolean(), removed: z.boolean().optional(),
  versions: z.array(z.object({ digest: z.string(), manifest: ArtifactManifestSchema, files: z.array(z.object({ path: z.string(), digest: z.string() }).strict()), installedAt: z.string(),
    publication: z.object({ ref: z.string(), revision: z.number().int().positive() }).strict().optional(),
  }).strict()).min(1),
}).strict();
export type InstalledArtifact = z.infer<typeof InstalledArtifactSchema>;
export interface ArtifactInstallation { revision: number; enabled: boolean; digest: string; title: string; kind: ArtifactKind; publication?: { ref: string; revision: number } }
export interface ArtifactCheck { digest: string; issues: string[]; installation?: ArtifactInstallation }
