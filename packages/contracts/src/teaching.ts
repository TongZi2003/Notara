import { z } from 'zod';
export const TeachingChoiceSchema = z.object({ id: z.string().min(1), title: z.string().min(1), description: z.string().min(1) }).strict();
export type TeachingChoice = z.infer<typeof TeachingChoiceSchema>;
export const TeachingManifestSchema = z.object({
  default: z.string().min(1),
  choices: z.array(TeachingChoiceSchema.extend({ file: z.string().regex(/^[a-z0-9-]+\.md$/) }).strict()).min(1),
}).strict().refine(value => new Set(value.choices.map(row => row.id)).size === value.choices.length && value.choices.some(row => row.id === value.default), 'teaching choices need unique ids and a real default');

/**
 * One workspace-level override of a bundled teaching text. The bundled file
 * stays the factory default; the override shadows it at prompt assembly, skill
 * invocation and delegation persona. Record history keeps every earlier body.
 */
export const TeachingOverrideSchema = z.object({
  /** `base` | `guided` | `preset/<id>` | `skill/<id>` | `assistant/<role>`. */
  nodeId: z.string().min(1).max(160),
  body: z.string().min(1),
}).strict();
export type TeachingOverride = z.infer<typeof TeachingOverrideSchema>;

/** One row of the teaching tree the student-facing page lists. */
export const TeachingNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['base', 'guided', 'preset', 'skill', 'assistant', 'artifact']),
  origin: z.enum(['bundled', 'creation', 'plugin']),
  overridden: z.boolean(),
  editable: z.boolean(),
}).strict();
export type TeachingNode = z.infer<typeof TeachingNodeSchema>;

/** The full read of one node: effective text, bundled baseline, override revision. */
export const TeachingResourceSchema = TeachingNodeSchema.extend({
  body: z.string(),
  bundledBody: z.string().nullable(),
  version: z.number().int().positive().nullable(),
}).strict();
export type TeachingResource = z.infer<typeof TeachingResourceSchema>;
