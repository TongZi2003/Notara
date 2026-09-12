/**
 * P5.2 the knowledge read index (plan §P5.2, CONTRACTS.md §5).
 *
 * One read-only projection of the knowledge rows this workspace really holds.
 * It is not a second search service and not a second ledger: P4's
 * `LearningSearch` owns query, ranking and snippets, and it needs the *content*
 * of each row. The stored row also carries the public-source pin and the
 * collection receipt, so this module offers the two shapes a caller can want —
 * a flat index row for a list/筛选视图, and the content reader P4 consumes — and
 * nothing else. An unwired store stays unwired; nothing is created here.
 */
import type { EntityRef, HostContext, KnowledgeCollection, KnowledgeContent, KnowledgeRecord, PublicTeachingRef, RecordScope } from '@studyforge/contracts';
import type { Saved } from '../storage/record-store.ts';

/** The read side one knowledge store really has; a native `RecordStore` satisfies it. */
export interface KnowledgeRecordReader {
  list(ctx: HostContext): Saved<KnowledgeRecord>[];
}

/** One knowledge row as a list/filter view reads it; `null` means "not set". */
export interface KnowledgeIndexRow {
  readonly ref: EntityRef;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly scope: RecordScope | null;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly links: readonly EntityRef[];
  readonly publicSources: readonly PublicTeachingRef[];
  readonly collection: KnowledgeCollection | null;
}

/**
 * Every knowledge row of this workspace in the store's own order, with its real
 * revision and collection state. Reading never collects, never adds a public
 * source and never touches a card.
 */
export function indexKnowledge(ctx: HostContext, records: KnowledgeRecordReader): KnowledgeIndexRow[] {
  return records.list(ctx).map(row => ({
    ref: row.ref,
    version: row.version,
    title: row.data.content.title,
    body: row.data.content.body,
    scope: row.data.content.scope ?? null,
    category: row.data.content.category ?? null,
    tags: [...row.data.content.tags],
    links: [...row.data.content.links],
    publicSources: [...row.data.publicSources],
    collection: row.data.collection ?? null,
  }));
}

/** What P4's learning search consumes: the single free body, never the receipt. */
export interface KnowledgeContentReader {
  list(ctx: HostContext): Saved<KnowledgeContent>[];
}

/** Author content with its real ref and revision, so one query sees one corpus. */
export function knowledgeContentReader(records: KnowledgeRecordReader): KnowledgeContentReader {
  return { list: ctx => records.list(ctx).map(row => ({ ...row, data: row.data.content })) };
}
