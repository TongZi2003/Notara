/**
 * P5.2 the private-knowledge writer (plan §P5.2, CONTRACTS.md §5).
 *
 * A knowledge row is one identity with one free body. Collecting it is not
 * copying it: the same record gains a `collection` receipt and nothing else —
 * no second card, no review ladder, no rewritten text, and its public sources
 * stay the exact versions the note was written from. B's 锦囊 behaves the same
 * way, which is why there is no second concept bucket here.
 *
 * `publicSources` name installed public teaching package entries, not materials
 * of this workspace: a `{packageId, entryId, version}` triple is resolved by the
 * catalog dependency P7/P8 wires in, and an entry nobody installed is refused
 * instead of being invented. A note that came from nothing public carries the
 * empty list and is perfectly legal.
 *
 * A relation must point at an object this workspace really holds: `EntityRef`
 * is an opaque string, so the Host wires {@link LinkTargets} over its own
 * stores and an introduced link that cannot be proven is refused instead of
 * quietly becoming a relation. `CardService` takes the structurally identical
 * port, so one Host object can satisfy both.
 *
 * Only the trusted confirmation writer may collect, so `collect` requires
 * `actor === 'system'`; the student's own click is what produces that receipt.
 * A repeated confirmation is idempotent and a different one is a conflict, so a
 * retry can never quietly overwrite an earlier collection.
 */
import { createHash } from 'node:crypto';
import { KnowledgeCollectionSchema, KnowledgeContentSchema, KnowledgeNoteSchema, KnowledgePatchSchema, KnowledgeViewSchema, MutationContextSchema } from '@studyforge/contracts';
import type {
  EntityRef, HostContext, KnowledgeCollection, KnowledgeContent, KnowledgeNote, KnowledgePatch, KnowledgeRecord,
  KnowledgeView, MutationContext, PublicTeachingRef,
} from '@studyforge/contracts';
import { RecordError, type Saved } from '../storage/record-store.ts';

/** The record kind private knowledge lives under. */
export const KNOWLEDGE_KIND = 'knowledge';

/** The record surface this service needs; one native `RecordStore` satisfies it. */
export interface KnowledgeRecordStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<KnowledgeRecord>;
  list(ctx: HostContext): Saved<KnowledgeRecord>[];
  create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<KnowledgeRecord>>;
  update(ctx: MutationContext, ref: string, input: unknown, transform: (current: KnowledgeRecord) => unknown): Promise<Saved<KnowledgeRecord>>;
  remove(ctx: MutationContext, ref: string): Promise<void>;
}

/**
 * P5.2 a relation this write introduces must name a real object. The Host wires
 * this over its own stores; without it an introduced link is refused.
 */
export interface LinkTargets {
  has(ctx: HostContext, ref: EntityRef): Promise<boolean>;
}

/**
 * The installed public teaching catalog, supplied by P7/P8. It answers one
 * question only: does this workspace really hold that pinned entry? `null`
 * means no, and the note is refused rather than pointing at invented bytes.
 */
export interface PublicSourceResolver {
  resolve(ctx: HostContext, ref: PublicTeachingRef): Promise<PublicTeachingRef | null>;
}

/** A refused knowledge write, with the exact rule that refused it. */
export class KnowledgeError extends Error {
  readonly code: string;
  readonly problems: readonly string[];
  constructor(code: string, problems: readonly string[] = []) {
    super(problems.length ? `${code}: ${problems.join('; ')}` : code);
    this.code = code;
    this.problems = problems;
    this.name = 'KnowledgeError';
  }
}

export class KnowledgeService {
  async remove(ctx: MutationContext, ref: string): Promise<void> {
    if (ctx.actor !== 'student') throw new KnowledgeError('knowledge_delete_requires_student');
    await this.records.remove(ctx, ref);
  }
  private readonly records: KnowledgeRecordStore;
  private readonly catalog: PublicSourceResolver | undefined;
  private readonly targets: LinkTargets | undefined;

  constructor(records: KnowledgeRecordStore, catalog?: PublicSourceResolver, targets?: LinkTargets) {
    this.records = records;
    this.catalog = catalog;
    this.targets = targets;
  }

  /**
   * Save one private note that is not collected yet. Its identity is derived
   * from the accepted operation, so a retry re-finds the same record.
   * @throws KnowledgeError `knowledge_public_source_unavailable` when a public
   *   source is given but no installed catalog is wired, and
   *   `knowledge_public_source_missing` for an entry this workspace does not hold.
   */
  async note(ctx: MutationContext, input: unknown): Promise<KnowledgeView> {
    MutationContextSchema.parse(ctx);
    const note = await this.check(ctx, input);
    const { publicSources, ...fields } = note;
    const record: KnowledgeRecord = { content: KnowledgeContentSchema.parse(fields), publicSources };
    const id = derive('kn_', `${ctx.workspaceId}:${ctx.operationId}`);
    return toView(await this.records.create(withoutVersion(ctx), id, record));
  }

  /**
   * Check one note without writing it, so a future batch writer can prove every
   * item before the first one lands. No record, revision or collection is
   * created here.
   */
  async check(ctx: HostContext, input: unknown): Promise<KnowledgeNote> {
    const note = KnowledgeNoteSchema.parse(input);
    await this.assertLinks(ctx, note.links);
    return { ...note, publicSources: await this.resolvePublicSources(ctx, note.publicSources) };
  }

  /** One consistent read, either the current revision or an exact older one. */
  read(ctx: HostContext, ref: string, revision?: number): KnowledgeView {
    return toView(this.records.read(ctx, ref, revision));
  }

  /**
   * Apply one author edit along the exact target. Omitted fields keep their
   * stored text, `body` stays the single free body, relations move by increment
   * and the public sources keep the version they were pinned to.
   * @throws KnowledgeError `knowledge_expected_version_required` without a
   *   baseline and `knowledge_links_remove_forbidden` when a non-student drops
   *   a relation; `RecordError` `version_conflict` when the baseline moved.
   */
  async revise(ctx: MutationContext, ref: string, patch: unknown): Promise<KnowledgeView> {
    MutationContextSchema.parse(ctx);
    if (ctx.expectedVersion === undefined) throw new KnowledgeError('knowledge_expected_version_required');
    // These rows carry numeric revisions; a digest token names nothing here, so
    // it is the same refusal the store's own comparison would produce.
    if (typeof ctx.expectedVersion !== 'number') throw new RecordError('version_conflict');
    const change = KnowledgePatchSchema.parse(patch);
    // The merged result comes from the frozen baseline this operation was
    // accepted against, not from whatever the record says now: a retried
    // operation whose ACK was lost must be recognised by the store and handed
    // back its own revision instead of being refused here. The store still owns
    // the current-version CAS and the operation replay.
    const before = this.baseline(ctx, ref, ctx.expectedVersion).data.content;
    const after = applyPatch(ctx, before, change);
    await this.assertLinks(ctx, introducedLinks(before.links, change));
    return toView(await this.records.update(ctx, ref, change, row => ({ ...row, content: after })));
  }

  /**
   * Record that the student confirmed collecting this same knowledge identity.
   * Only the trusted confirmation writer calls this, and it changes nothing but
   * `collection`: the text, the public sources and every relation stay put.
   * @throws KnowledgeError `knowledge_collection_untrusted` for a caller that is
   *   not the confirmation writer, `knowledge_expected_version_required` without
   *   the frozen baseline, and `knowledge_already_collected` when another
   *   confirmation already claimed this record.
   */
  async collect(ctx: MutationContext, ref: string, receipt: unknown): Promise<KnowledgeView> {
    MutationContextSchema.parse(ctx);
    if (ctx.actor !== 'system') throw new KnowledgeError('knowledge_collection_untrusted');
    if (ctx.expectedVersion === undefined) throw new KnowledgeError('knowledge_expected_version_required');
    const collection = KnowledgeCollectionSchema.parse(receipt);
    // Same refusal codes as every other writer for a missing or foreign target.
    // This read is for the refusal only: the receipt itself is judged *inside*
    // the update, so nothing can be answered behind the store's back.
    this.records.read(ctx, ref);
    // The real operation always goes through the store, because that is what
    // gives a retried operation its own frozen revision: after the student edits
    // the note again, replaying the accepted collection still answers with the
    // revision the collection produced, and the fingerprint stays the
    // authority. `collectedAt` is the Host's frozen confirmation attempt — this
    // service never reads a clock of its own.
    return toView(await this.records.update(ctx, ref, { collection }, row => {
      const existing = row.collection;
      if (existing === undefined) return { ...row, collection };
      // Another confirmation already owns this record: never rewrite it.
      if (existing.confirmationId !== collection.confirmationId) throw new KnowledgeError('knowledge_already_collected');
      // One confirmation carries one frozen receipt; a changed one is a
      // different claim dressed up as a retry.
      if (existing.collectedAt !== collection.collectedAt) throw new KnowledgeError('knowledge_collection_conflict');
      // The identical confirmed effect under a fresh operation id is not a new
      // effect: no new revision, no rewritten receipt.
      return row;
    }));
  }

  /** The exact revision this operation was accepted against; the store still re-checks it. */
  private baseline(ctx: MutationContext, ref: string, revision: number): Saved<KnowledgeRecord> {
    try {
      return this.records.read(ctx, ref, revision);
    } catch (error) {
      // The store reports a revision that never existed as a corrupt result;
      // for a caller that is one more baseline that moved.
      if (codeOf(error) === 'record_corrupt') throw new RecordError('version_conflict');
      throw error;
    }
  }

  /**
   * A relation introduced by this write must name a real object; relations that
   * were already stored are not re-checked, so an object deleted later never
   * blocks an unrelated edit.
   */
  private async assertLinks(ctx: HostContext, refs: readonly EntityRef[]): Promise<void> {
    const unique = [...new Set(refs)];
    if (unique.length === 0) return;
    if (this.targets === undefined) throw new KnowledgeError('knowledge_link_unverifiable', unique);
    const missing: string[] = [];
    for (const ref of unique) if (!await this.targets.has(ctx, ref)) missing.push(ref);
    if (missing.length > 0) throw new KnowledgeError('knowledge_link_unresolved', missing);
  }

  /** Every pinned entry must really exist in the installed public catalog. */
  private async resolvePublicSources(ctx: HostContext, sources: readonly PublicTeachingRef[]): Promise<PublicTeachingRef[]> {
    if (sources.length === 0) return [];
    if (this.catalog === undefined) {
      throw new KnowledgeError('knowledge_public_source_unavailable', sources.map(refKey));
    }
    const resolved: PublicTeachingRef[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      const key = refKey(source);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = await this.catalog.resolve(ctx, source);
      if (entry === null) throw new KnowledgeError('knowledge_public_source_missing', [key]);
      resolved.push(entry);
    }
    return resolved;
  }
}

/** Merge one patch onto the stored content without ever defaulting a field away. */
function applyPatch(ctx: MutationContext, before: KnowledgeContent, change: KnowledgePatch): KnowledgeContent {
  const merged: Record<string, unknown> = {
    title: change.title ?? before.title,
    body: change.body ?? before.body,
    tags: change.tags ?? before.tags,
    links: applyLinks(ctx.actor, before.links, change.links_add, change.links_remove),
  };
  const scope = change.scope === null ? undefined : change.scope ?? before.scope;
  if (scope !== undefined) merged['scope'] = scope;
  const category = change.category === null ? undefined : change.category ?? before.category;
  if (category !== undefined) merged['category'] = category;
  return KnowledgeContentSchema.parse(merged);
}

/** Increments only: additions append, removals are explicit and student-only. */
function applyLinks(
  actor: MutationContext['actor'],
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  if (remove.length > 0 && actor !== 'student') throw new KnowledgeError('knowledge_links_remove_forbidden');
  const dropped = new Set(remove);
  const links = [...current];
  for (const link of add) if (!links.includes(link)) links.push(link);
  return links.filter(link => !dropped.has(link));
}

function refKey(ref: PublicTeachingRef): string {
  return `${ref.packageId}\u0000${ref.entryId}\u0000${ref.version}`;
}

function toView(saved: Saved<KnowledgeRecord>): KnowledgeView {
  return KnowledgeViewSchema.parse({
    ref: saved.ref, version: saved.version, content: saved.data.content, publicSources: saved.data.publicSources,
    ...(saved.data.collection === undefined ? {} : { collection: saved.data.collection }),
  });
}

/** The relations this write really introduces: added refs that were not already stored and that survive the patch. */
function introducedLinks(before: readonly EntityRef[], change: KnowledgePatch): EntityRef[] {
  const dropped = new Set(change.links_remove);
  return change.links_add.filter(link => !before.includes(link) && !dropped.has(link));
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/** Identity is a pure function of the accepted operation, so a retry is one effect. */
function derive(prefix: string, seed: string): string {
  return prefix + createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

/** `expectedVersion` is not part of a creation's identity: it owns no revision yet. */
function withoutVersion(ctx: MutationContext): MutationContext {
  const { expectedVersion: _ignored, ...rest } = ctx;
  return MutationContextSchema.parse(rest);
}
