import { z } from 'zod';
import { MaterialContextSchema, SourceAnchorSchema } from './materials.ts';

export const ReadMaterialInputSchema = z.object({ source: MaterialContextSchema }).strict();
export type ReadMaterialInput = z.infer<typeof ReadMaterialInputSchema>;
/** Only bytes actually returned to the caller are represented as images. */
export const MaterialReadSchema = z.object({
  title: z.string(), source: SourceAnchorSchema,
  text: z.string().optional(),
  image: z.object({ mediaType: z.literal('image/png'), base64: z.string(), width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional(),
  pageCount: z.number().int().positive().optional(),
  textLayer: z.boolean().optional(), truncated: z.boolean(),
}).strict();
export type MaterialRead = z.infer<typeof MaterialReadSchema>;
