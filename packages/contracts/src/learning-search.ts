/**
 * P4.2 local learning search (CONTRACTS.md §4.2).
 *
 * This contract describes only the local learning corpora this workspace really
 * holds — material versions, cards and knowledge. It deliberately has no
 * external-search result type, no URL entity and no read-state: the native
 * `web_search`/`web_fetch`/`ctx.web` path keeps its own structure, and a link is
 * not a `MaterialVersion` until it has really been imported.
 *
 * A hit carries the real identity it was found in, never a copy of the text
 * alone: a card or knowledge hit names its stored ref and record revision plus
 * the field the text came from, and a material hit names the immutable version
 * and the locator inside it. Read failures and out-of-scope requests are typed
 * notes, so an unreadable material is never reported as "no matches".
 */
import { z } from 'zod';
import { EntityRefSchema } from './core.ts';
import { MaterialContextSchema } from './materials.ts';

/** Corpora a caller may ask for; `memory` needs an explicit purpose and belongs to P7. */
export const LearningSearchCorpusSchema = z.enum(['material', 'card', 'knowledge', 'memory']);
export type LearningSearchCorpus = z.infer<typeof LearningSearchCorpusSchema>;

/** A preference for ordering and suggestions. It never grants or removes access. */
export const LearningSearchFocusSchema = z.object({
  materialIds: z.array(z.string().min(1)).default([]),
  targets: z.array(EntityRefSchema).default([]),
}).strict();
export type LearningSearchFocus = z.infer<typeof LearningSearchFocusSchema>;

/** Query, limit and focus only rank and truncate; the reader's own scope is the workspace. */
export const LearningSearchInputSchema = z.object({
  query: z.string().default(''),
  limit: z.number().int().positive().max(100).optional(),
  focus: LearningSearchFocusSchema.optional(),
  include: z.array(LearningSearchCorpusSchema).min(1).optional(),
}).strict();
export type LearningSearchInput = z.input<typeof LearningSearchInputSchema>;

/** Where a snippet really came from; offsets are UTF-16 inside `text`. */
export const LearningSearchSnippetSchema = z.object({
  /** Real stored field: `title`, `front`, `sections[1].body`, `body`, `page-text`, … */
  field: z.string().min(1),
  text: z.string(),
  /** Match position inside `text`; null when the query was empty and nothing was matched. */
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().nonnegative().nullable(),
}).strict();
export type LearningSearchSnippet = z.infer<typeof LearningSearchSnippetSchema>;

/** One real local object this workspace holds. */
export const LearningSearchHitSchema = z.object({
  corpus: z.enum(['material', 'card', 'knowledge']),
  /** Saved object identity (`card:…` / `knowledge:…`); null for a material hit. */
  ref: EntityRefSchema.nullable(),
  /** Immutable version plus the real locator of the match; null for a saved object. */
  source: MaterialContextSchema.nullable(),
  title: z.string().min(1),
  /** Exact record revision of the hit object; null for a material version. */
  revision: z.number().int().positive().nullable(),
  snippets: z.array(LearningSearchSnippetSchema).min(1),
}).strict();
export type LearningSearchHit = z.infer<typeof LearningSearchHitSchema>;

/** Real reasons a corpus or a version could not be searched. Diagnostic only. */
export const LearningSearchNoteSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('material_unreadable'),
    materialId: z.string().min(1), versionId: z.string().min(1), detail: z.string().min(1),
  }).strict(),
  z.object({ code: z.literal('material_no_text_layer'), materialId: z.string().min(1), versionId: z.string().min(1) }).strict(),
  z.object({ code: z.literal('corpus_unavailable'), corpus: LearningSearchCorpusSchema, detail: z.string().min(1) }).strict(),
  z.object({ code: z.literal('memory_purpose_required') }).strict(),
  z.object({ code: z.literal('memory_not_in_scope') }).strict(),
]);
export type LearningSearchNote = z.infer<typeof LearningSearchNoteSchema>;

export const LearningSearchResultSchema = z.object({
  hits: z.array(LearningSearchHitSchema),
  /** True when ranking produced more rows than `limit` returned. */
  hasMore: z.boolean(),
  /** Read failures and out-of-scope requests; student surfaces never render these. */
  notes: z.array(LearningSearchNoteSchema),
}).strict();
export type LearningSearchResult = z.infer<typeof LearningSearchResultSchema>;
