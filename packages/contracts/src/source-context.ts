import { z } from 'zod';
import { MessageEnvelopeSchema } from './materials.ts';
import { EntityRefSchema, VersionTokenSchema } from './core.ts';
import { MaterialReadSchema } from './material-read.ts';

/** One composer's teaching reference. The native accepted event supplies message identity. */
export const SourceContextSchema = MessageEnvelopeSchema.shape.context;
export type SourceContext = z.infer<typeof SourceContextSchema>;
export const SourceFragmentSchema = z.object({
  version: z.literal(1), context: SourceContextSchema,
  titles: z.array(z.object({ ref: z.string().min(1), title: z.string().min(1) }).strict()),
  objects: z.array(z.object({ ref: EntityRefSchema, version: VersionTokenSchema }).strict()).default([]),
}).strict().refine(value => value.context.selection !== undefined || value.context.currentMaterial !== undefined, { message: 'a source fragment must name an actual reference', path: ['context'] });
export type SourceFragment = z.infer<typeof SourceFragmentSchema>;
export const FrozenSourceSchema = z.object({ fragment: SourceFragmentSchema, modelText: z.string(), images: z.array(MaterialReadSchema.shape.image.unwrap()) }).strict();
export type FrozenSource = z.infer<typeof FrozenSourceSchema>;
export const SOURCE_FENCE = 'studyforge-source';

/** ReferenceCodec returns text: freeze the structured reference inside that native submission. */
export function encodeSourceFragment(input: SourceFragment): string {
  return '\n```' + SOURCE_FENCE + '\n' + JSON.stringify(SourceFragmentSchema.parse(input)) + '\n```\n';
}

/**
 * Decode only complete, valid source fragments. Other code, malformed fragments
 * and partial streamed fences remain ordinary text; no accepted message is
 * overwritten. Teacher evidence uses `text`, so quoted source is not mistaken
 * for words the student independently wrote.
 */
export function decodeSourceFragments(text: string): { text: string; fragments: SourceFragment[] } {
  const fragments: SourceFragment[] = [];
  const visible = text.replace(/(?:^|\n)```studyforge-source\n([^\n]*)\n```(?=\n|$)/g, whole => {
    const body = whole.trim().split('\n')[1];
    try {
      const parsed = SourceFragmentSchema.safeParse(JSON.parse(body ?? ''));
      if (!parsed.success) return whole;
      fragments.push(parsed.data);
      return '';
    } catch { return whole; }
  });
  return { text: visible, fragments };
}
