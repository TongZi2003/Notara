import { z } from 'zod';
import { MaterialContextSchema } from './materials.ts';
import { MathSceneBaseSchema, mathSceneProblems } from './math-scene.ts';
export const PluginLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), title: z.string().min(1).max(240), source: MaterialContextSchema }).strict(),
  z.object({ kind: z.literal('card'), title: z.string().min(1).max(240), ref: z.string().min(1), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('lesson'), title: z.string().min(1).max(240), sessionId: z.string().min(1) }).strict(),
]);
export type PluginLink = z.infer<typeof PluginLinkSchema>;
const Title = z.string().trim().min(1).max(160), Text = z.string().max(8000);
const Links = z.array(PluginLinkSchema).max(12).default([]);
export const BlackboardSchema = z.object({ kind: z.literal('blackboard'), title: Title, blocks: z.array(z.object({ title: Title, body: Text, links: Links,
  diagram: z.object({ nodes: z.array(z.object({ label: Title, x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict()).min(1).max(20), edges: z.array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }).strict()).max(40) }).strict().optional(),
}).strict()).max(60) }).strict();
export const ClinicSchema = z.object({ kind: z.literal('clinic'), title: Title, question: Text, steps: z.array(z.string().min(1).max(1200)).min(2).max(20), errorIndex: z.number().int().nonnegative(), explanation: Text, repair: Text, links: Links }).strict();
export const EvidenceSchema = z.object({ kind: z.literal('evidence'), title: Title, fictional: z.boolean(), question: Text,
  entries: z.array(z.object({ title: Title, body: Text, category: z.enum(['unclassified','record','hearsay','inference']), reason: Text, links: Links }).strict()).max(40), conclusion: Text }).strict();
export const AtlasSchema = z.object({ kind: z.literal('atlas'), title: Title, fictional: z.boolean(), events: z.array(z.object({ title: Title, year: z.number().int().min(-10000).max(10000), place: z.string().max(160), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), body: Text, links: Links }).strict()).max(80) }).strict();
export const SimulationSchema = z.object({ kind: z.literal('simulation'), title: Title, background: Text, rounds: z.number().int().min(1).max(20),
  resources: z.array(z.object({ title: Title, initial: z.number().min(0).max(10000), minimum: z.number().min(0).max(10000), maximum: z.number().min(1).max(10000) }).strict()).min(1).max(6),
  choices: z.array(z.object({ title: Title, description: Text, effects: z.array(z.number().min(-1000).max(1000)).min(1).max(6) }).strict()).min(2).max(8),
}).strict();
export const MathDocumentSchema = MathSceneBaseSchema.extend({ links: Links });
export const PluginDocumentSchema = z.discriminatedUnion('kind', [BlackboardSchema, ClinicSchema, EvidenceSchema, AtlasSchema, SimulationSchema, MathDocumentSchema]).superRefine((doc, ctx) => {
  if (JSON.stringify(doc).length > 60000) ctx.addIssue({ code: 'custom', message: 'document_too_large' });
  if (doc.kind === 'math') for (const message of mathSceneProblems(doc)) ctx.addIssue({ code: 'custom', message });
  if (doc.kind === 'clinic' && doc.errorIndex >= doc.steps.length) ctx.addIssue({ code: 'custom', message: 'error_index_out_of_range' });
  if (doc.kind === 'blackboard') for (const block of doc.blocks) if (block.diagram?.edges.some(edge => edge.from >= block.diagram!.nodes.length || edge.to >= block.diagram!.nodes.length)) ctx.addIssue({ code: 'custom', message: 'diagram_edge_missing' });
  if (doc.kind === 'simulation') {
    if (new Set(doc.resources.map(r => r.title)).size !== doc.resources.length || doc.resources.some(r => r.minimum > r.initial || r.initial > r.maximum) || doc.choices.some(c => c.effects.length !== doc.resources.length)) ctx.addIssue({ code: 'custom', message: 'simulation_resource_mismatch' });
  }
});
export type PluginDocument = z.infer<typeof PluginDocumentSchema>;
export const PluginDocumentRecordSchema = z.object({ sessionId: z.string(), id: z.string(), digest: z.string(), document: PluginDocumentSchema }).strict();
export interface PluginDocumentView { revision: number; document: PluginDocument }
export const SeminarRoleSchema = z.enum(['peer','critic','assistant']);
export type SeminarRole = z.infer<typeof SeminarRoleSchema>;
const SeminarParticipantRecordSchema = z.object({ role: SeminarRoleSchema, state: z.enum(['queued','running','completed','failed','canceled','interrupted']), childId: z.string().optional(), text: z.string().max(40000) }).strict();
export const SeminarRecordSchema = z.object({ sessionId: z.string(), id: z.string(), digest: z.string(), topic: Title, materials: Text, standard: Text,
  participants: z.array(SeminarParticipantRecordSchema).min(1).max(3),
}).strict();
const SeminarParticipantViewSchema = SeminarParticipantRecordSchema.omit({ childId: true }).strict();
export const SeminarViewSchema = z.object({ ref: z.string(), revision: z.number().int().nonnegative(), topic: Title,
  participants: z.array(SeminarParticipantViewSchema).min(1).max(3),
}).strict();
export type SeminarView = z.infer<typeof SeminarViewSchema>;
export const SeminarStartSchema = z.object({ topic: Title, materials: Text, standard: Text, roles: z.array(SeminarRoleSchema).min(1).max(3) }).strict().refine(v => new Set(v.roles).size === v.roles.length && (!v.roles.includes('assistant') || !!v.standard.trim()), 'assistant_requires_standard');
