import { z } from 'zod';
import { ClassroomDefinitionSchema, Key } from './classroom.ts';
import { ActorSchema, TimestampSchema } from './core.ts';

const EntryPath = z.string().max(240).refine(value => !!value && !value.startsWith('/') && !value.includes('\\') && value.split('/').every(part => !!part && part !== '.' && part !== '..'), 'entry must stay inside the package');
const Contribution = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), title: z.string().trim().min(1).max(120), description: z.string().max(1000).default(''), entry: EntryPath }).strict();
export const PluginCapabilitiesSchema = z.object({
  apiVersion: z.literal(1), title: z.string().trim().min(1).max(160), description: z.string().max(2000).default(''),
  skills: z.array(Contribution.extend({ scope: z.enum(['learning', 'creation']).default('learning') })).max(30).default([]), teaching: z.array(Contribution).max(20).default([]),
  subjects: z.array(Contribution.extend({ subjects: z.array(z.string().trim().min(1).max(80)).min(1).max(12) })).max(20).default([]),
  workbenches: z.array(Contribution.extend({ permissions: z.array(z.enum(['save-note', 'draft', 'document', 'sources', 'compose', 'seminar', 'worldbook-context'])).max(7).default([]),
    document: z.object({ kind: z.enum(['blackboard','clinic','evidence','atlas','simulation','math']), seed: EntryPath }).strict().optional(),
  })).max(12).default([]),
  worldbooks: z.array(Contribution.extend({ templates: EntryPath.optional() })).max(8).default([]),
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
  creation: z.object({ ref: z.string(), digest: z.string(), kind: z.enum(['skill', 'html', 'subject', 'teaching', 'classroom']) }).strict().optional(),
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
export interface WorkbenchContent extends WorkbenchChoice { html: string; permissions: string[]; documentKind?: string; kind?: 'html' | 'worldbook' | 'classroom' }
export const PluginPinSchema = z.object({ sessionId: z.string(), pluginRef: z.string(), contributionId: z.string(), digest: z.string() }).strict();
export const WorkbenchNoteSchema = z.object({ title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(100_000), documentRevision: z.number().int().nonnegative().optional() }).strict();
export const WorldbookEntrySchema = z.object({
  title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(2000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20), enabled: z.boolean(), always: z.boolean(),
  kind: z.enum(['background', 'instruction']).optional(),
  scope: z.enum(['turn', 'stage', 'lesson']).optional(),
  /** Lorebook-style refinement: primary keyword(s) must hit first, then this
   * secondary-key logic decides. Only applies to keyword-triggered entries. */
  secondaryKeywords: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  selective: z.enum(['and-any', 'and-all', 'not-any', 'not-all']).optional(),
  /** Bound to a classroom role: counts only while that classmate is in play this
   * turn (dispatched or mentioned). Teacher-side by default. */
  role: Key.optional(),
  roleVisible: z.boolean().optional().describe('同时带进这位同学自己的扮演上下文；默认只给老师侧。'),
  /** Gate on the bound role's effective intimacy toward the student; needs role. */
  intimacyAtLeast: z.number().int().min(0).max(100).optional(),
}).strict();
export const WorldbookDocumentSchema = z.object({ entries: z.array(WorldbookEntrySchema).max(60), classroom: ClassroomDefinitionSchema.optional() }).strict()
  .refine(value => JSON.stringify(value).length <= 50_000, 'worldbook_too_large')
  .superRefine((value, ctx) => {
    const ids = new Set(value.classroom?.roles.map(role => role.id) ?? []);
    value.entries.forEach((entry, index) => {
      if (entry.role && !ids.has(entry.role)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'role'], message: 'worldbook_role_missing' });
      if (entry.intimacyAtLeast !== undefined && !entry.role) ctx.addIssue({ code: 'custom', path: ['entries', index, 'intimacyAtLeast'], message: 'worldbook_intimacy_needs_role' });
      if (entry.roleVisible && !entry.role) ctx.addIssue({ code: 'custom', path: ['entries', index, 'roleVisible'], message: 'worldbook_role_visible_needs_role' });
    });
  });
export type WorldbookDocument = z.infer<typeof WorldbookDocumentSchema>;
export const ClassroomTemplatesSchema = z.array(z.object({ title: z.string().trim().min(1).max(100), description: z.string().max(300), document: WorldbookDocumentSchema.safeExtend({ classroom: ClassroomDefinitionSchema }) }).strict()).max(12);
export const WorldbookRecordSchema = z.object({ id: z.string(), document: WorldbookDocumentSchema }).strict();
export const WorldbookUseSchema = z.object({ sessionId: z.string(), id: z.string(), enabled: z.boolean() }).strict();
export interface WorldbookView { document: WorldbookDocument; revision: number; enabled: boolean; useRevision: number }
export interface WorldbookSelection { entries: (WorldbookDocument['entries'][number] & { book: string })[]; omitted: number; text: string }
export const WorkbenchDraftValueSchema = z.json().refine(value => JSON.stringify(value).length <= 64_000, 'draft_too_large');
export type WorkbenchDraftValue = z.infer<typeof WorkbenchDraftValueSchema>;
export const WorkbenchDraftSchema = z.object({ sessionId: z.string(), id: z.string(), digest: z.string(), value: WorkbenchDraftValueSchema }).strict();
/** JSON travels as text because the pinned Typert generator rejects external recursive JSONType. */
export interface WorkbenchDraftView { revision: number; json: string }
/** Semantic labels the board attaches to a write; the Host stores them with the
 * derived diff so the trail stays readable after the iframe is gone. */
export const WorkbenchOpSchema = z.object({ labels: z.array(z.string().trim().min(1).max(160)).max(8).optional() }).strict();
export type WorkbenchOp = z.infer<typeof WorkbenchOpSchema>;
/** One observed write on a board instance: who, when, what kind of store it
 * touched, the resulting revision, optional board-reported labels and a
 * Host-derived summary of what actually changed. */
export const WorkbenchActivityEntrySchema = z.object({
  at: TimestampSchema, actor: ActorSchema,
  kind: z.enum(['document', 'draft', 'worldbook', 'note']),
  revision: z.number().int().nonnegative().optional(),
  labels: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
  detail: z.string().max(600).optional(),
}).strict();
export type WorkbenchActivityEntry = z.infer<typeof WorkbenchActivityEntrySchema>;
/** Activity outlives a plugin upgrade: keyed by session+workbench, not digest. */
export const WorkbenchActivitySchema = z.object({
  sessionId: z.string().min(1), id: z.string().min(1),
  events: z.array(WorkbenchActivityEntrySchema).max(160),
}).strict();
export type WorkbenchActivity = z.infer<typeof WorkbenchActivitySchema>;
