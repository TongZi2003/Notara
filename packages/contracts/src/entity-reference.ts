import { z } from 'zod';
import { MaterialContextSchema } from './materials.ts';
import { SkeletonPathSchema } from './skeleton.ts';

export const ENTITY_REFERENCE_PREFIX = '#studyforge/reference/';
export const LibraryEntityReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), source: MaterialContextSchema }).strict(),
  z.object({ kind: z.literal('section'), materialId: z.string().min(1), skeletonRevision: z.number().int().positive(), path: SkeletonPathSchema }).strict(),
  z.object({ kind: z.literal('card'), ref: z.string().startsWith('card:').min(6), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('knowledge'), ref: z.string().startsWith('knowledge:').min(11), version: z.number().int().positive() }).strict(),
]);
export type LibraryEntityReference = z.infer<typeof LibraryEntityReferenceSchema>;
export interface ResolvedEntityReference {
  reference: LibraryEntityReference;
  title: string;
  sources: z.infer<typeof MaterialContextSchema>[];
  chapter?: string;
  historical: boolean;
}
/** A portable identity, not a URL to a server or a second citation registry. */
export function entityHref(target: LibraryEntityReference): string {
  const text = JSON.stringify(LibraryEntityReferenceSchema.parse(target));
  if (text.length > 6000) throw new Error('reference_too_long');
  return ENTITY_REFERENCE_PREFIX + btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function parseEntityHref(href: string): LibraryEntityReference | undefined {
  if (!href.startsWith(ENTITY_REFERENCE_PREFIX) || href.length > 12000) return undefined;
  const payload = href.slice(ENTITY_REFERENCE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
    const target = LibraryEntityReferenceSchema.parse(JSON.parse(text));
    return entityHref(target) === href ? target : undefined;
  } catch { return undefined; }
}
export function entityLink(title: string, target: LibraryEntityReference): string {
  return '[' + title.replace(/[\r\n]+/g, ' ').replace(/[\\\[\]]/g, '\\$&') + '](' + entityHref(target) + ')';
}

/** Plain-text projections (message previews and graph titles) retain the label,
 * never the encoded destination. Code examples and ordinary links stay literal. */
export function entityReferenceText(text: string): string {
  let fence: string | undefined;
  return text.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return line;
    }
    if (fence) return line;
    // Alternating complete inline-code spans and potential Markdown links.
    return line.replace(/(`+)[\s\S]*?\1(?!`)|\[((?:\\.|[^\]\\])*)\]\((#studyforge\/reference\/[A-Za-z0-9_-]+)\)/g,
      (whole, code: string | undefined, title: string, href: string) => code || !parseEntityHref(href) ? whole : title.replace(/\\([\\\[\]])/g, '$1'));
  }).join('\n');
}
