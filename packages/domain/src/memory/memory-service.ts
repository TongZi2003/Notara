/**
 * P7.1 revisable learner memory (plan §P7.1, SIMPLIFICATION A5).
 *
 * One memory is a judgement about this student, stored as the wording that is
 * current plus every observation that was really adopted. The input is a real
 * evidence catalogue and a free draft; the code fills identity from the accepted
 * Host operation, resolves the model's `E` aliases to real sources, and writes
 * one record. It never decides whether a conclusion is strong enough: a single
 * real observation may be saved, nothing is auto-certified, and there is no
 * two-object threshold, no `verifiedAbility` field and no global approval.
 *
 * The rules that *are* code are provenance rules: a note/revise must cite at
 * least one real adopted student utterance, including its original object
 * binding. Its semantic interpretation belongs to teaching. A correction revises the same target and appends to
 * its history, so the earlier wording and its sources stay readable; a
 * same-named new note is a new record, never an append to the old one.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MemoryContentSchema, MemoryDraftSchema, MemoryObservationSchema } from '@studyforge/contracts/memory';
import type { MemoryContent, MemoryDraft, MemoryObservation } from '@studyforge/contracts/memory';
import type { MemoryBasisView, MemoryRecord, MemorySearchInput, MemorySearchResult, MemoryView } from '@studyforge/contracts/memory';
import { EvidenceRefSchema, type EvidenceRef, type HostContext, type MutationContext } from '@studyforge/contracts';
import type { EvidenceCatalogue, EvidenceQuery } from '../evidence/evidence-query.ts';
import { RecordError, type Saved } from '../storage/record-store.ts';
import { MemoryIndex } from './memory-index.ts';

/** The record kind one memory lives under; the P7 writer saves the same kind. */
export const MEMORY_KIND = 'memory';

/** The record surface this service needs; one native `RecordStore` satisfies it. */
export interface MemoryStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<MemoryRecord>;
  list(ctx: HostContext): Saved<MemoryRecord>[];
  create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<MemoryRecord>>;
  update(ctx: MutationContext, ref: string, input: unknown, transform: (current: MemoryRecord) => unknown): Promise<Saved<MemoryRecord>>;
}

/** Which configured category keeps the student's own words; the plan's default is `preference`. */

/**
 * The same two existing contract schemas `MemoryEditInputSchema` composes, so a
 * tool cannot pass an untyped edit here; the contract remains the authority.
 */
const EditInputShape = z.object({ content: MemoryContentSchema, sources: z.array(EvidenceRefSchema).optional() }).strict();

export class MemoryService {
  private readonly records: MemoryStore;
  private readonly evidence: EvidenceQuery;
  private readonly index = new MemoryIndex();
  constructor(records: MemoryStore, evidence: EvidenceQuery) {
    this.records = records; this.evidence = evidence;
  }

  /**
   * Save one real observation as a new memory. Identity is derived from the
   * accepted operation, so a retry restores the same record and a same-named new
   * observation is a new one.
   * @throws RecordError `memory_basis_required`, `memory_preference_needs_student_words`,
   *   and the evidence query's own codes for an alias that is not in this cut.
   */
  async note(ctx: MutationContext, draft: unknown, catalogue: EvidenceCatalogue): Promise<MemoryView> {
    const input = MemoryDraftSchema.parse(draft);
    const observation = this.observation(input, catalogue);
    const id = 'm_' + createHash('sha256').update(`${ctx.workspaceId}:${ctx.operationId}`).digest('hex').slice(0, 24);
    const saved = await this.records.create(ctx, id, { content: contentOf(observation), history: [observation] });
    return viewOf(saved);
  }

  /**
   * Correct one existing memory at the revision the caller read. The old wording
   * and its sources stay in `history`; `expectedVersion` is the observed version
   * the Host tool supplied, so a stale edit is refused instead of overwriting.
   * @throws RecordError `memory_expected_version_required`, `version_conflict`,
   *   `record_missing`, and the note-time provenance codes.
   */
  async revise(ctx: MutationContext, ref: string, draft: unknown, catalogue: EvidenceCatalogue): Promise<MemoryView> {
    const input = MemoryDraftSchema.parse(draft);
    if (ctx.expectedVersion === undefined) throw new RecordError('memory_expected_version_required');
    const observation = this.observation(input, catalogue);
    const saved = await this.records.update(ctx, ref, input, row => ({
      content: contentOf(observation), history: [...row.history, observation],
    }));
    return viewOf(saved);
  }

  /**
   * Save the student's own wording for one memory. This is an edit, not an
   * observation: it never touches `history` and never needs an evidence
   * catalogue, so a student may fix their own memory with no lesson open.
   * `sources` omitted keeps what the record already adopted; supplied, it must
   * name sources this record already adopted, and the wording is re-pointed at
   * that real older version instead of a new one being invented.
   * @throws RecordError `memory_expected_version_required`, `version_conflict`,
   *   `record_missing`, `memory_source_not_adopted`, `memory_source_required`.
   */
  async edit(ctx: MutationContext, ref: string, input: unknown): Promise<MemoryView> {
    const change = EditInputShape.parse(input);
    if (ctx.expectedVersion === undefined) throw new RecordError('memory_expected_version_required');
    const saved = await this.records.update(ctx, ref, change, row => {
      const sources = change.sources === undefined ? row.sources : adoptExisting(row, change.sources);
      const next: MemoryRecord = { content: change.content, history: row.history };
      if (sources !== undefined) next.sources = sources;
      return next;
    });
    return viewOf(saved);
  }

  /** One exact read, current or at a named older revision. */
  read(ctx: HostContext, ref: string, revision?: number): MemoryView {
    return viewOf(this.records.read(ctx, ref, revision));
  }

  /** Every memory this workspace holds, ordered by identity. */
  list(ctx: HostContext): MemoryView[] {
    return this.records.list(ctx).sort(byRef).map(viewOf);
  }

  /** On-demand scan; it reads the same records and writes nothing. */
  search(ctx: HostContext, input: MemorySearchInput): MemorySearchResult {
    return this.index.search(this.list(ctx), input);
  }

  /** One adopted observation, or the exact reason it cannot be one. */
  private observation(input: MemoryDraft, catalogue: EvidenceCatalogue): MemoryObservation {
    const basis = this.evidence.resolve(catalogue, input.evidenceRefs ?? []);
    if (basis.length === 0) throw new RecordError('memory_basis_required');
    // Every adopted E is a real student utterance. Attaching a card gives it
    // classroom provenance, but does not stop it being an explicit preference.
    // Whether those words support the interpretation belongs to the teacher.
    return MemoryObservationSchema.parse({
      kind: input.kind,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      body: input.body, basis,
    });
  }
}

/** The saved row plus the version projection of where its wording came from. */
function viewOf(saved: Saved<MemoryRecord>): MemoryView {
  return { ref: saved.ref, revision: saved.version, content: saved.data.content, history: saved.data.history, basis: basisOf(saved.data) };
}

/**
 * `current` is what the wording really rests on: the student's explicit
 * `sources` when an edit re-pointed it, otherwise the newest observation's
 * basis. `prior` is what earlier versions adopted, each source once and in
 * order — every history entry once an edit moved the current wording off the
 * newest observation. A source the current wording still rests on stays
 * readable in both, because it really supported both. Derived from the record
 * alone, so it can never drift from what it describes.
 */
function basisOf(row: MemoryRecord): MemoryBasisView {
  const current = [...(row.sources ?? row.history.at(-1)?.basis ?? [])];
  const earlier = row.sources === undefined ? row.history.slice(0, -1) : row.history;
  const seen = new Set<string>();
  const prior: EvidenceRef[] = [];
  for (const entry of earlier) {
    for (const ref of entry.basis) {
      const key = identity(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      prior.push(ref);
    }
  }
  return { current, prior };
}

/**
 * An explicit edit basis, restricted to sources this record really adopted. The
 * caller's copy is never stored: the record's own ref is, so an explicit choice
 * can only ever be a real older version.
 */
function adoptExisting(row: MemoryRecord, requested: readonly EvidenceRef[]): EvidenceRef[] {
  const adopted = new Map<string, EvidenceRef>();
  for (const entry of row.history) for (const ref of entry.basis) adopted.set(identity(ref), ref);
  const seen = new Set<string>();
  const picked: EvidenceRef[] = [];
  for (const ref of requested) {
    const key = identity(ref);
    const real = adopted.get(key);
    if (real === undefined) throw new RecordError('memory_source_not_adopted');
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(real);
  }
  if (picked.length === 0) throw new RecordError('memory_source_required');
  return picked;
}

/** One adopted source's real identity: message, object and its exact version. */
function identity(ref: EvidenceRef): string {
  return `${ref.messageId}\u0000${ref.object?.ref ?? ''}\u0000${String(ref.object?.version ?? '')}`;
}

/** The current wording, without the basis that belongs to the history entry. */
function contentOf(observation: MemoryObservation): MemoryContent {
  return MemoryContentSchema.parse({
    kind: observation.kind,
    ...(observation.title === undefined ? {} : { title: observation.title }),
    ...(observation.scope === undefined ? {} : { scope: observation.scope }),
    body: observation.body,
  });
}

function byRef(left: { readonly ref: string }, right: { readonly ref: string }): number {
  return left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0;
}
