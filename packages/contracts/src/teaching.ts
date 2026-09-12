import { z } from 'zod';
export const TeachingChoiceSchema = z.object({ id: z.string().min(1), title: z.string().min(1), description: z.string().min(1) }).strict();
export type TeachingChoice = z.infer<typeof TeachingChoiceSchema>;
export const TeachingManifestSchema = z.object({
  default: z.string().min(1),
  choices: z.array(TeachingChoiceSchema.extend({ file: z.string().regex(/^[a-z0-9-]+\.md$/) }).strict()).min(1),
}).strict().refine(value => new Set(value.choices.map(row => row.id)).size === value.choices.length && value.choices.some(row => row.id === value.default), 'teaching choices need unique ids and a real default');
