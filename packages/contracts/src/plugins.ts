import { z } from 'zod';

const EntryPath = z.string().max(240).refine(value => !!value && !value.startsWith('/') && !value.includes('\\') && value.split('/').every(part => !!part && part !== '.' && part !== '..'), 'entry must stay inside the package');
const Contribution = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), title: z.string().trim().min(1).max(120), description: z.string().max(1000).default(''), entry: EntryPath }).strict();
export const PluginCapabilitiesSchema = z.object({
  apiVersion: z.literal(1), title: z.string().trim().min(1).max(160), description: z.string().max(2000).default(''),
  skills: z.array(Contribution).max(30).default([]), teaching: z.array(Contribution).max(20).default([]),
  subjects: z.array(Contribution.extend({ subjects: z.array(z.string().trim().min(1).max(80)).min(1).max(12) })).max(20).default([]),
  workbenches: z.array(Contribution.extend({ permissions: z.array(z.enum(['save-note', 'draft', 'document', 'sources', 'compose', 'seminar', 'worldbook-context'])).max(7).default([]),
    document: z.object({ kind: z.enum(['blackboard','clinic','evidence','atlas','simulation','math']), seed: EntryPath }).strict().optional(),
  })).max(12).default([]),
  worldbooks: z.array(Contribution).max(8).default([]),
}).strict().superRefine((value, ctx) => {
  const all = [...value.skills, ...value.teaching, ...value.subjects, ...value.workbenches, ...value.worldbooks];
  if (new Set(all.map(entry => entry.id)).size !== all.length) ctx.addIssue({ code: 'custom', message: 'contribution ids must be unique' });
  if (value.workbenches.some(item => item.permissions.includes('document') !== !!item.document)) ctx.addIssue({ code: 'custom', message: 'document_permission_requires_seed' });
});
export const PluginManifestSchema = z.object({
  name: z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/).max(214),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
  notara: PluginCapabilitiesSchema,
}).strict();
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginContribution = z.infer<typeof Contribution>;
export type PluginSource = { kind: 'directory'; path: string } | { kind: 'archive'; fileName: string; base64: string };
export const PluginSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('directory'), path: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('archive'), fileName: z.string().regex(/\.(?:tgz|tar\.gz)$/), base64: z.string().max(42_000_000) }).strict(),
]);
export const PluginVersionSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/), manifest: PluginManifestSchema,
  snapshot: z.string().regex(/^[a-f0-9]{32}$/), packagePath: EntryPath, profilePath: EntryPath,
  native: z.boolean(), installedAt: z.string(),
  files: z.array(z.object({ path: EntryPath, digest: z.string() }).strict()),
  creation: z.object({ ref: z.string(), digest: z.string(), kind: z.enum(['skill', 'html', 'subject', 'teaching']) }).strict().optional(),
}).strict();
export type PluginVersion = z.infer<typeof PluginVersionSchema>;
export const PluginRecordSchema = z.object({
  name: z.string(), installed: z.boolean(), enabled: z.boolean(), activeDigest: z.string(), versions: z.array(PluginVersionSchema).min(1),
  pending: z.enum(['enable', 'disable', 'uninstall']).optional(),
}).strict();
export type PluginRecord = z.infer<typeof PluginRecordSchema>;
/** enabled is the requested setting; state is the actual loaded result and is authoritative for UI. */
export interface PluginView { ref: string; revision: number; name: string; title: string; description: string; version: string; digest: string; enabled: boolean; native: boolean; state: 'installed' | 'enabled' | 'failed' | 'restart-required'; issue?: string; manifest: PluginManifest; creationRef?: string }
export interface PluginCandidate { candidateId: string; manifest: PluginManifest; digest: string; native: boolean; current?: PluginView }
export interface WorkbenchChoice { id: string; pluginRef: string; contributionId: string; digest: string; title: string; description: string }
export interface WorkbenchContent extends WorkbenchChoice { html: string; permissions: string[]; documentKind?: string; kind?: 'html' | 'worldbook' }
export const PluginPinSchema = z.object({ sessionId: z.string(), pluginRef: z.string(), contributionId: z.string(), digest: z.string() }).strict();
export const WorkbenchNoteSchema = z.object({ title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(100_000), documentRevision: z.number().int().nonnegative().optional() }).strict();
export const WorldbookEntrySchema = z.object({
  title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(2000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20), enabled: z.boolean(), always: z.boolean(),
}).strict();
export const WorldbookDocumentSchema = z.object({ entries: z.array(WorldbookEntrySchema).max(60) }).strict()
  .refine(value => JSON.stringify(value).length <= 50_000, 'worldbook_too_large');
export type WorldbookDocument = z.infer<typeof WorldbookDocumentSchema>;
export const WorldbookRecordSchema = z.object({ id: z.string(), document: WorldbookDocumentSchema }).strict();
export const WorldbookUseSchema = z.object({ sessionId: z.string(), id: z.string(), enabled: z.boolean() }).strict();
export interface WorldbookView { document: WorldbookDocument; revision: number; enabled: boolean; useRevision: number }
export interface WorldbookSelection { entries: (WorldbookDocument['entries'][number] & { book: string })[]; omitted: number; text: string }
export const WorkbenchDraftValueSchema = z.json().refine(value => JSON.stringify(value).length <= 64_000, 'draft_too_large');
export type WorkbenchDraftValue = z.infer<typeof WorkbenchDraftValueSchema>;
export const WorkbenchDraftSchema = z.object({ sessionId: z.string(), id: z.string(), digest: z.string(), value: WorkbenchDraftValueSchema }).strict();
/** JSON travels as text because the pinned Typert generator rejects external recursive JSONType. */
export interface WorkbenchDraftView { revision: number; json: string }
