/**
 * P4.2 local learning search (CONTRACTS.md §4.2).
 *
 * The corpus is this workspace's own learning objects: material versions,
 * cards and knowledge. Nothing here narrows the reader by learning set or
 * subject — the workspace is the scope, and `focus` only reorders suggestions.
 *
 * Material text never comes from the first read of a file. A Markdown or text
 * file is read whole, a DOCX is indexed through the same canonical
 * {@link indexDocx} the reader uses (stable part/block ids, UTF-16 offsets), and
 * a PDF is read page by page from the text layer it actually contains. A scan
 * without a text layer, or a version that cannot be read at all, is reported as
 * a typed note — never as "no matches", and never with invented text from OCR.
 *
 * Cards are searched on their face and authored back (title, front, sections);
 * the teacher's own `notes` are not part of a card's searchable content.
 * Knowledge is searched on its single body. Private learning facts are out of
 * scope: asking for them without an explicit purpose is a typed refusal, and the
 * P7 interface will own that read.
 */
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { CardContent, EntityRef, HostContext, KnowledgeContent, SourceLocator } from '@studyforge/contracts';
import { LearningSearchInputSchema, LearningSearchResultSchema } from '@studyforge/contracts/learning-search';
import type { LearningSearchInput, LearningSearchNote, LearningSearchResult } from '@studyforge/contracts/learning-search';
import type { MaterialRecord } from '@studyforge/contracts/material-records';
import type { Saved } from '../storage/record-store.ts';
import { indexDocx } from './docx/index-docx.ts';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_LIMIT = 20;
/** How many matching fields one hit may carry, so one long document cannot flood the reply. */
const MAX_SNIPPETS = 3;
const SNIPPET_BEFORE = 32;
const SNIPPET_AFTER = 96;
/** Corpus order used when nothing else separates two hits. */
const CORPUS_ORDER = { material: 0, card: 1, knowledge: 2 } as const;
type Corpus = keyof typeof CORPUS_ORDER;

/** The read surface of one learning-object store; a native `RecordStore` satisfies it. */
export interface LearningObjectStore<T> { list(ctx: HostContext): Saved<T>[]; }

/** The same resolve shape a material reader uses; `MaterialService` satisfies it. */
export interface MaterialVersionResolver {
  resolve(ctx: HostContext, ref: { materialId: string; versionId: string }): Promise<{
    version: { title: string; mediaType: string; fileName: string };
    absolutePath: string;
  }>;
}

/** One piece of real text with the locator it starts at. */
export interface MaterialTextSegment { readonly text: string; readonly locator: SourceLocator; }

/** What one version really contains, or why it could not be read. */
export type MaterialText =
  | { readonly state: 'text'; readonly segments: readonly MaterialTextSegment[] }
  /** The format can hold text but this version holds none (a scan, an empty file). */
  | { readonly state: 'no_text_layer' }
  /** The format carries no searchable text at all (an image, an SVG, another binary). */
  | { readonly state: 'not_searchable' }
  | { readonly state: 'unreadable'; readonly detail: string };

export type MaterialTextIndexer = (input: {
  readonly materialId: string; readonly versionId: string; readonly mediaType: string; readonly absolutePath: string;
}) => Promise<MaterialText>;

/** Everything the query reads; an unwired corpus is reported, not silently empty. */
export interface LearningSearchSources {
  readonly materials?: LearningObjectStore<MaterialRecord>;
  readonly resolve?: MaterialVersionResolver;
  readonly cards?: LearningObjectStore<CardContent>;
  readonly knowledge?: LearningObjectStore<KnowledgeContent>;
  /** Override the per-format text read, e.g. a caller that already indexed a large book. */
  readonly indexText?: MaterialTextIndexer;
}

/** One field of one candidate object, with where its text sits in the source. */
interface SearchField { readonly field: string; readonly text: string; readonly locator: SourceLocator | null; }
interface Candidate {
  readonly corpus: Corpus;
  readonly title: string;
  readonly ref: EntityRef | null;
  readonly revision: number | null;
  readonly materialId: string | null;
  readonly versionId: string | null;
  readonly order: number;
  readonly fields: readonly SearchField[];
}
interface Snippet { readonly field: string; readonly text: string; readonly start: number | null; readonly end: number | null; readonly locator: SourceLocator | null; }
interface Matched { readonly candidate: Candidate; readonly snippets: readonly Snippet[]; readonly at: number; }

/**
 * Local learning search over the real stores this workspace holds.
 * @throws the store's own `workspace_mismatch`/`target_invalid`, because a bad
 * caller is not a missing corpus; a corpus that cannot be read is a typed note.
 */
export class LearningSearch {
  private readonly sources: LearningSearchSources;
  constructor(sources: LearningSearchSources) { this.sources = sources; }

  async search(ctx: HostContext, input: LearningSearchInput = {}): Promise<LearningSearchResult> {
    const request = LearningSearchInputSchema.parse(input);
    const notes: LearningSearchNote[] = [];
    const include = new Set<Corpus>((request.include ?? ['material', 'card', 'knowledge']).filter((corpus): corpus is Corpus => corpus !== 'memory'));
    if (request.include?.includes('memory')) {
      // Private learning facts are read only by a purpose-bound P7 interface.
      notes.push({ code: 'memory_purpose_required' });
    }
    const focus = {
      materialIds: new Set(request.focus?.materialIds ?? []),
      targets: new Set(request.focus?.targets ?? []),
    };
    const candidates: Candidate[] = [];
    if (include.has('material')) candidates.push(...await this.materialCandidates(ctx, notes));
    if (include.has('card')) candidates.push(...this.cardCandidates(ctx, notes));
    if (include.has('knowledge')) candidates.push(...this.knowledgeCandidates(ctx, notes));

    const matched: Matched[] = [];
    for (const candidate of candidates) {
      const found = matchCandidate(candidate, request.query);
      if (found !== null) matched.push(found);
    }
    const focused = (candidate: Candidate): number =>
      (candidate.materialId !== null && focus.materialIds.has(candidate.materialId))
      || (candidate.ref !== null && focus.targets.has(candidate.ref)) ? 0 : 1;
    matched.sort((left, right) =>
      focused(left.candidate) - focused(right.candidate)
      || CORPUS_ORDER[left.candidate.corpus] - CORPUS_ORDER[right.candidate.corpus]
      || left.at - right.at
      || left.candidate.order - right.candidate.order);

    const limit = request.limit ?? DEFAULT_LIMIT;
    return LearningSearchResultSchema.parse({
      hits: matched.slice(0, limit).map(toHit),
      hasMore: matched.length > limit,
      notes,
    });
  }

  /** One candidate per material version this workspace currently points at. */
  private async materialCandidates(ctx: HostContext, notes: LearningSearchNote[]): Promise<Candidate[]> {
    const store = this.sources.materials, resolver = this.sources.resolve;
    if (store === undefined) { notes.push({ code: 'corpus_unavailable', corpus: 'material', detail: 'material store not connected' }); return []; }
    if (resolver === undefined) { notes.push({ code: 'corpus_unavailable', corpus: 'material', detail: 'material version read not connected' }); return []; }
    let rows: Saved<MaterialRecord>[];
    try { rows = store.list(ctx); }
    catch (error) { if (isCallerError(error)) throw error; notes.push({ code: 'corpus_unavailable', corpus: 'material', detail: detailOf(error) }); return []; }

    const index = this.sources.indexText ?? indexMaterialText;
    const candidates: Candidate[] = [];
    for (const [order, row] of rows.entries()) {
      const version = row.data.versions.find(item => item.versionId === row.data.currentVersionId);
      if (version === undefined) { notes.push({ code: 'material_unreadable', materialId: row.data.materialId, versionId: row.data.currentVersionId, detail: 'current_version_missing' }); continue; }
      let opened: { absolutePath: string };
      try { opened = await resolver.resolve(ctx, { materialId: version.materialId, versionId: version.versionId }); }
      catch (error) { if (isCallerError(error)) throw error; notes.push({ code: 'material_unreadable', materialId: version.materialId, versionId: version.versionId, detail: detailOf(error) }); continue; }
      const text = await index({ materialId: version.materialId, versionId: version.versionId, mediaType: version.mediaType, absolutePath: opened.absolutePath });
      if (text.state === 'unreadable') { notes.push({ code: 'material_unreadable', materialId: version.materialId, versionId: version.versionId, detail: text.detail }); continue; }
      if (text.state === 'no_text_layer') { notes.push({ code: 'material_no_text_layer', materialId: version.materialId, versionId: version.versionId }); continue; }
      // An image or another binary simply holds no text to search; that is a format fact, not a failure.
      if (text.state === 'not_searchable') continue;
      const fields = text.segments.filter(segment => segment.text.length > 0)
        .map(segment => ({ field: fieldOfSegment(segment.locator), text: segment.text, locator: segment.locator }));
      if (fields.length === 0) continue;
      candidates.push({
        corpus: 'material', title: version.title, ref: null, revision: null,
        materialId: version.materialId, versionId: version.versionId, order, fields,
      });
    }
    return candidates;
  }

  /** Cards and knowledge are small rows with no source extent; the field name is the position. */
  private cardCandidates(ctx: HostContext, notes: LearningSearchNote[]): Candidate[] {
    return this.rows(ctx, 'card', this.sources.cards, notes)
      .map((row, order) => ({ corpus: 'card' as const, title: row.data.title, ref: row.ref, revision: row.version, materialId: null, versionId: null, order, fields: cardFields(row.data) }));
  }

  private knowledgeCandidates(ctx: HostContext, notes: LearningSearchNote[]): Candidate[] {
    return this.rows(ctx, 'knowledge', this.sources.knowledge, notes)
      .map((row, order) => ({ corpus: 'knowledge' as const, title: row.data.title, ref: row.ref, revision: row.version, materialId: null, versionId: null, order, fields: knowledgeFields(row.data) }));
  }

  /** A store that cannot be read is a typed note; a bad caller still throws. */
  private rows<T>(ctx: HostContext, corpus: Corpus, store: LearningObjectStore<T> | undefined, notes: LearningSearchNote[]): Saved<T>[] {
    if (store === undefined) { notes.push({ code: 'corpus_unavailable', corpus, detail: `${corpus} store not connected` }); return []; }
    try { return store.list(ctx); }
    catch (error) { if (isCallerError(error)) throw error; notes.push({ code: 'corpus_unavailable', corpus, detail: detailOf(error) }); return []; }
  }
}

/** A card's real searchable text: face and authored back, without the teacher's notes. */
function cardFields(card: CardContent): SearchField[] {
  const fields: SearchField[] = [{ field: 'title', text: card.title, locator: null }, { field: 'front', text: card.front, locator: null }];
  card.sections.forEach((section, index) => {
    fields.push({ field: `sections[${index}].heading`, text: section.heading, locator: null });
    fields.push({ field: `sections[${index}].body`, text: section.body, locator: null });
  });
  return fields.filter(field => field.text.length > 0);
}

function knowledgeFields(knowledge: KnowledgeContent): SearchField[] {
  return [{ field: 'title', text: knowledge.title, locator: null }, { field: 'body', text: knowledge.body, locator: null }].filter(field => field.text.length > 0);
}

/** The field name a material segment is reported under. */
function fieldOfSegment(locator: SourceLocator): string {
  return locator.kind === 'pdf' ? `page-${locator.page}` : locator.kind === 'docx' ? `${locator.part}#${locator.blockId}` : 'text';
}

/** Case-insensitive match that never shifts offsets; an empty query lists everything. */
function findIn(text: string, query: string): number {
  const needle = query.toLowerCase();
  const lowered = text.toLowerCase();
  return lowered.length === text.length ? lowered.indexOf(needle) : text.indexOf(query);
}

function matchCandidate(candidate: Candidate, query: string): Matched | null {
  if (query.length === 0) {
    const first = candidate.fields[0];
    if (first === undefined) return null;
    return { candidate, at: 0, snippets: [window(first, null)] };
  }
  const snippets: Snippet[] = [];
  let at = Number.POSITIVE_INFINITY;
  for (const field of candidate.fields) {
    const start = findIn(field.text, query);
    if (start < 0) continue;
    at = Math.min(at, start);
    if (snippets.length < MAX_SNIPPETS) snippets.push(window(field, { start, end: start + query.length }));
  }
  if (snippets.length === 0) return null;
  return { candidate, at, snippets };
}

/**
 * The exact window a hit points at. Offsets are UTF-16 inside the returned text,
 * and the locator is narrowed to the match when the source can express it.
 */
function window(field: SearchField, match: { start: number; end: number } | null): Snippet {
  if (match === null) return { field: field.field, text: field.text.slice(0, SNIPPET_AFTER), start: null, end: null, locator: null };
  const from = Math.max(0, match.start - SNIPPET_BEFORE);
  const to = Math.min(field.text.length, match.end + SNIPPET_AFTER);
  return {
    field: field.field, text: field.text.slice(from, to),
    start: match.start - from, end: match.end - from,
    locator: refine(field, match.start, match.end),
  };
}

/** Narrow a segment's locator to the match; only kinds with real offsets can move. */
function refine(field: SearchField, start: number, end: number): SourceLocator | null {
  const locator = field.locator;
  if (locator === null) return null;
  if (locator.kind === 'docx') return { kind: 'docx', part: locator.part, blockId: locator.blockId, start, end };
  if (locator.kind === 'text') return { kind: 'text', start: pointAt(field.text, start), end: pointAt(field.text, end) };
  return locator;
}

/** 1-based line, 0-based UTF-16 column; the unit `SourceLocator` declares. */
function pointAt(text: string, offset: number): { line: number; column: number } {
  const head = text.slice(0, offset);
  const line = head.split('\n').length;
  return { line, column: head.length - (head.lastIndexOf('\n') + 1) };
}

function toHit(matched: Matched): Record<string, unknown> {
  const { candidate, snippets } = matched;
  const locator = snippets[0]?.locator ?? null;
  return {
    corpus: candidate.corpus,
    ref: candidate.ref,
    // A material hit keeps its immutable version and the real locator of the match.
    source: candidate.materialId === null || candidate.versionId === null
      ? null
      : { materialId: candidate.materialId, versionId: candidate.versionId, ...(locator === null ? {} : { locator }) },
    title: candidate.title,
    revision: candidate.revision,
    snippets: snippets.map(snippet => ({ field: snippet.field, text: snippet.text, start: snippet.start, end: snippet.end })),
  };
}

/** A caller mistake must stay visible; only a real read failure becomes a note. */
function isCallerError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'workspace_mismatch' || code === 'target_invalid' || code === 'learning_session_required';
}

function detailOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.length > 0) return code;
  return error instanceof Error && error.message.length > 0 ? error.message.slice(0, 200) : 'unknown';
}

/**
 * Read one version's real text.
 * @returns per-page text for a PDF, one segment per stable DOCX block, or the
 * whole file for a text format; never OCR and never a guessed position.
 */
export async function indexMaterialText(input: { materialId: string; versionId: string; mediaType: string; absolutePath: string }): Promise<MaterialText> {
  try {
    if (input.mediaType === 'application/pdf') return await pdfText(input.absolutePath);
    if (input.mediaType === DOCX) return await docxText(input.absolutePath);
    if (input.mediaType.startsWith('text/')) return await fileText(input.absolutePath);
    return { state: 'not_searchable' };
  } catch (error) {
    return { state: 'unreadable', detail: detailOf(error) };
  }
}

/** The whole file is one segment: search never sees a truncated first read. */
async function fileText(absolutePath: string): Promise<MaterialText> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(absolutePath));
  if (text.length === 0) return { state: 'no_text_layer' };
  return { state: 'text', segments: [{ text, locator: { kind: 'text', start: { line: 1, column: 0 }, end: pointAt(text, text.length) } }] };
}

async function docxText(absolutePath: string): Promise<MaterialText> {
  const bytes = new Uint8Array(await readFile(absolutePath));
  // The canonical index owns the OOXML read; a foreign namespace is refused there.
  const index = await indexDocx(bytes);
  const segments = index.blocks.filter(block => block.text.length > 0)
    .map(block => ({ text: block.text, locator: { kind: 'docx' as const, part: block.part, blockId: block.blockId, start: 0, end: block.text.length } }));
  if (segments.length === 0) return { state: 'no_text_layer' };
  return { state: 'text', segments };
}

/** Page text as the file really contains it; a scan yields no text at all. */
async function pdfText(absolutePath: string): Promise<MaterialText> {
  const bytes = new Uint8Array(await readFile(absolutePath));
  const task = getDocument({ data: bytes, disableFontFace: true, verbosity: 0 });
  try {
    const document = await task.promise;
    const segments: MaterialTextSegment[] = [];
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      const text = content.items.flatMap(item => 'str' in item ? [item.str] : []).join('');
      if (text.length > 0) segments.push({ text, locator: { kind: 'pdf', page } });
    }
    if (segments.length === 0) return { state: 'no_text_layer' };
    return { state: 'text', segments };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
