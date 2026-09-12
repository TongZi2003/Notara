import { z } from 'zod';
import { EntityRefSchema, RecordScopeSchema, TimestampSchema } from './core.ts';

/** Same knowledge identity before and after collection; never a second reviewable card. */
export const KnowledgeContentSchema = z.object({
  title: z.string().trim().min(1), body: z.string().min(1).describe('共同知识的唯一自由正文'),
  scope: RecordScopeSchema.optional(), category: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]), links: z.array(EntityRefSchema).default([]),
}).strict();
export type KnowledgeContent = z.infer<typeof KnowledgeContentSchema>;

/**
 * P5.2 one public teaching source: an installed package entry pinned to the
 * exact version it was read from. B keeps the same row as
 * `{package_id, entry_id, revision}` (`method_store._sources` over
 * `catalog.public_entries`), renamed here so it cannot be confused with a
 * record revision.
 *
 * This is deliberately *not* a `SourceAnchor`: a public teaching pack entry is
 * not a material version of this workspace, and dressing it up as
 * `{materialId, versionId, locator}` would claim bytes nobody imported. Which
 * installed entries really exist at which version is P7/P8's dependency; the
 * knowledge service never invents one, and a note with no public source simply
 * carries the empty list.
 */
export const PublicTeachingRefSchema = z.object({
  packageId: z.string().min(1), entryId: z.string().min(1), version: z.string().min(1),
}).strict();
export type PublicTeachingRef = z.infer<typeof PublicTeachingRefSchema>;

/**
 * P5.2 the private note a teacher or student writes before it is collected.
 * `publicSources` pin exact installed entry versions; they are never
 * re-resolved to "latest", and an empty list is a legal note that came from
 * nothing public.
 */
export const KnowledgeNoteSchema = KnowledgeContentSchema.extend({
  publicSources: z.array(PublicTeachingRefSchema).default([]),
}).strict();
export type KnowledgeNote = z.infer<typeof KnowledgeNoteSchema>;

/**
 * P5.2 author-facing edit of one knowledge record. Omitted fields keep their
 * stored text; `body` is the single free body and is never rewritten by a
 * relation change. Relations move by increment, like a card's, and the public
 * sources stay the exact pin the note was created with.
 */
export const KnowledgePatchSchema = z.object({
  title: KnowledgeContentSchema.shape.title.optional(),
  body: KnowledgeContentSchema.shape.body.optional(),
  scope: RecordScopeSchema.nullable().optional(),
  category: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  links_add: z.array(EntityRefSchema).default([]),
  links_remove: z.array(EntityRefSchema).default([]),
  reason: z.string().min(1).optional(),
}).strict();
export type KnowledgePatch = z.infer<typeof KnowledgePatchSchema>;

/** The receipt of one confirmed collection; only the trusted confirmation writer sets it. */
export const KnowledgeCollectionSchema = z.object({
  confirmationId: z.string().min(1),
  collectedAt: TimestampSchema,
}).strict();
export type KnowledgeCollection = z.infer<typeof KnowledgeCollectionSchema>;

/**
 * P5.2 stored knowledge row: one identity, one free body. Collecting changes
 * `collection` and nothing else — the same record is never copied into a second
 * card and never gains a review ladder.
 */
export const KnowledgeRecordSchema = z.object({
  content: KnowledgeContentSchema,
  publicSources: z.array(PublicTeachingRefSchema).default([]),
  collection: KnowledgeCollectionSchema.optional(),
}).strict();
export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>;

/** One consistent read of a knowledge record, current or at an exact older revision. */
export const KnowledgeViewSchema = z.object({
  ref: EntityRefSchema,
  version: z.number().int().positive(),
  content: KnowledgeContentSchema,
  publicSources: z.array(PublicTeachingRefSchema),
  collection: KnowledgeCollectionSchema.optional(),
}).strict();
export type KnowledgeView = z.infer<typeof KnowledgeViewSchema>;
