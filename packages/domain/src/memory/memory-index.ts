/**
 * P7.1 on-demand memory scan (plan §P7.1, SIMPLIFICATION A8).
 *
 * There is no stored memory index. The scan reads the records this workspace
 * really holds, on the way through, and ranks nothing: a hit is the record that
 * matched, the real field it matched in, and the exact offsets inside it. An
 * empty query lists the current wording, so "what do we have" never has to be a
 * second projection with its own revision.
 */
import type { MemorySearchHit, MemorySearchInput, MemorySearchResult, MemoryView } from '@studyforge/contracts/memory';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SNIPPET_BEFORE = 32;
const SNIPPET_AFTER = 96;

interface Field { readonly field: string; readonly text: string; }

/** The real stored fields a memory scan may read, in the order they are shown. */
function fieldsOf(view: MemoryView): Field[] {
  const fields: Field[] = [{ field: 'body', text: view.content.body }];
  if (view.content.title !== undefined) fields.push({ field: 'title', text: view.content.title });
  return fields;
}

export class MemoryIndex {
  /** One scan of the passed records; `input` only filters and truncates. */
  search(views: readonly MemoryView[], input: MemorySearchInput): MemorySearchResult {
    const query = (input.query ?? '').trim();
    const kinds = input.kinds === undefined ? undefined : new Set(input.kinds);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(input.limit ?? DEFAULT_LIMIT)));
    const hits: MemorySearchHit[] = [];
    for (const view of [...views].sort(byRef)) {
      if (kinds !== undefined && !kinds.has(view.content.kind)) continue;
      const hit = this.match(view, query);
      if (hit !== null) hits.push(hit);
    }
    return { hits: hits.slice(0, limit), hasMore: hits.length > limit };
  }

  private match(view: MemoryView, query: string): MemorySearchHit | null {
    const fields = fieldsOf(view);
    if (query.length === 0) {
      const first = fields[0]!;
      return { ref: view.ref, revision: view.revision, kind: view.content.kind, title: view.content.title ?? null, snippet: window(first, null) };
    }
    for (const field of fields) {
      const start = findIn(field.text, query);
      if (start < 0) continue;
      return { ref: view.ref, revision: view.revision, kind: view.content.kind, title: view.content.title ?? null, snippet: window(field, { start, end: start + query.length }) };
    }
    return null;
  }
}

/** Case-insensitive match that never shifts offsets. */
function findIn(text: string, query: string): number {
  const needle = query.toLowerCase();
  if (needle.length === 0) return 0;
  return text.toLowerCase().indexOf(needle);
}

/** A bounded window around the match; an empty query shows the head and marks no position. */
function window(field: Field, match: { start: number; end: number } | null): MemorySearchHit['snippet'] {
  if (match === null) return { field: field.field, text: field.text.slice(0, SNIPPET_AFTER), start: null, end: null };
  const from = Math.max(0, match.start - SNIPPET_BEFORE);
  const to = Math.min(field.text.length, match.end + SNIPPET_AFTER);
  return { field: field.field, text: field.text.slice(from, to), start: match.start - from, end: match.end - from };
}

/** Same-layer order is by identity, so a scan never depends on store iteration order. */
function byRef(left: { readonly ref: string }, right: { readonly ref: string }): number {
  return left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0;
}
