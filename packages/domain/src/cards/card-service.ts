/**
 * P5.1 the ordinary-card writer (plan §P5.1, CONTRACTS.md §5).
 *
 * A card is one native record: the author's own `content` plus the system's
 * review ledger (`history`/`review`). Creating a card is not reviewing it, so a
 * fresh card carries no `review` and no history row; P5.4's ReviewService appends
 * those on the same record through the same store, which is what keeps one
 * accepted edit and one review occurrence atomic per object.
 *
 * Identity comes from the Host operation, never a clock or a random call:
 * replaying one accepted creation derives the same `card_<id>` and finds the
 * same row, so a retry is one effect.
 *
 * An edit states only what it changes. An omitted field is left exactly as it
 * was — a metadata edit can never silently reset the face, the sources or the
 * tags somebody already wrote — and the two explicit "none" forms are
 * `chapter: null` (no book hook) and `front: ''` (an empty face). Relations move
 * by increment (`links_add`/`links_remove`) so a teacher's addition cannot
 * clobber a relation the student removed; only the student may remove, matching
 * B `card-authoring`/`/api/links`.
 *
 * What this writer really checks, and only for what this write produced:
 *  - every source anchor resolves to the immutable bytes of the version it pins
 *    (`resolveAnchor`, so a stale locator or a misquote is refused here too);
 *  - `chapter`, when it is set or its sources moved, is a real node of the
 *    skeleton of one of this card's own source books — or, when a
 *    {@link ChapterPlacement} is wired, a level this card may mint: a card
 *    pinned to exactly one source book can claim a well-formed path, and the
 *    write itself grows it as an outline node anchored to this card's own
 *    sources, in the same atomic unit. Anchored content mints structure;
 *    placement stays correctable through the skeleton's own repath/remove
 *    cascade afterwards;
 *  - `topic`, when set, is a well-formed path in the workspace knowledge map
 *    (atlas), which a wired {@link ChapterPlacement} port mints as an outline
 *    level in the same atomic unit — with no single-book rule, since a
 *    workspace path has no book ambiguity. Unwired, any topic is refused.
 *  - math delimiters in the authored text this write actually rewrote. Text
 *    already stored is never re-validated, so an old card with a broken fence
 *    can still have its tags, sources or chapter corrected;
 *  - every relation this write introduces really exists. `EntityRef` is an
 *    opaque string, so a link is proven against the Host's own object stores
 *    through {@link LinkTargets} before it may become a relation; without that
 *    resolver an introduced link is refused rather than silently stored.
 *
 * A card may be source-only (`front` empty, real sources) or carry no source at
 * all (an ordinary proposition card); neither is an error.
 */
import { createHash } from 'node:crypto';
import { CardListInputSchema, CardListResultSchema, type CardListInput, type CardListResult } from '@studyforge/contracts/cards';
import type { SetView } from '@studyforge/contracts/sets';
import { DaySchema } from '@studyforge/contracts/reviews';
import { CardContentSchema, CardPatchSchema, MutationContextSchema } from '@studyforge/contracts';
import type { CardContent, CardPatch, CardRecord, CardView, EntityRef, HostContext, MutationContext, ObjectChange, SourceAnchor, VersionToken } from '@studyforge/contracts';
import { SkeletonPathSchema } from '@studyforge/contracts/skeleton';
import { ATLAS_SCOPE } from '@studyforge/contracts/atlas';
import { type MaterialResolver, resolveAnchor } from '../materials/read-material.ts';
import { RecordError, type PreparedRecordChange, type Saved } from '../storage/record-store.ts';
import { changedTextFields, formatMathIssue, mathProblems, type AuthorTextField, type MathIssue } from './content-projection.ts';

/** The record kind a card lives under; the review service writes the same one. */
export const CARD_KIND = 'card';

/** The record surface this service needs; one native `RecordStore` satisfies it. */
export interface CardRecordStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<CardRecord>;
  list(ctx: HostContext): Saved<CardRecord>[];
  changes(ctx: HostContext, ref: string): ObjectChange[];
  create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<CardRecord>>;
  update(ctx: MutationContext, ref: string, input: unknown, transform: (current: CardRecord) => unknown): Promise<Saved<CardRecord>>;
  prepareCreate(ctx: MutationContext, id: string, input: unknown): PreparedRecordChange<CardRecord>;
  prepareUpdate(ctx: MutationContext, ref: string, input: unknown, transform: (current: CardRecord) => unknown): PreparedRecordChange<CardRecord>;
}

/**
 * P5.1 a relation must point at an object this workspace really holds. The Host
 * wires this over its own stores (a card row, a knowledge row, …), because one
 * kind's store cannot answer for another kind and an `EntityRef` string carries
 * no meaning of its own. `KnowledgeService` takes the structurally identical
 * port, so one Host object can satisfy both.
 */
export interface LinkTargets {
  has(ctx: HostContext, ref: EntityRef): Promise<boolean>;
}

/** The structure side this service needs; one real `SkeletonService` satisfies it. */
export interface ChapterSkeletonReader {
  /** A book that was never split reads as an empty node list, not as an error. */
  read(ctx: HostContext, materialId: string): Promise<{ readonly nodes: readonly { readonly path: string }[] }>;
}

/** One card's claim about a structural level it belongs at (book chapter or workspace topic). */
export interface ChapterClaim {
  readonly path: string;
  readonly anchors: readonly SourceAnchor[];
}

/**
 * The skeleton side a card write may grow. `plan` returns the skeleton changes
 * the claimed levels still need — at most one change per book — and `atomic`
 * publishes them in the same unit as the card change itself, so a card and the
 * level it claims land or fail together. A service wired without one keeps the
 * older, stricter rule: a chapter must already be a real node.
 */
export interface ChapterPlacement {
  plan(ctx: MutationContext, claims: ReadonlyMap<string, readonly ChapterClaim[]>): Promise<PreparedRecordChange[]>;
  atomic(changes: readonly PreparedRecordChange[]): Promise<void>;
}

/** A refused card write, with the exact rule that refused it. */
export class CardError extends Error {
  readonly code: string;
  /** One student-readable line per refused field, when the rule can name them. */
  readonly problems: readonly string[];
  constructor(code: string, problems: readonly string[] = []) {
    super(problems.length ? `${code}: ${problems.join('; ')}` : code);
    this.code = code;
    this.problems = problems;
    this.name = 'CardError';
  }
}

/** Shared read-side selection: exact tags and chapter boundaries; no review writes. */
export function selectCardRows(rows: readonly Saved<CardRecord>[], input: CardListInput, today: string, sets: readonly SetView[] = []): Saved<CardRecord>[] {
  const query = CardListInputSchema.parse(input), date = DaySchema.parse(today);
  const set = query.learningSetRef === undefined ? undefined : sets.find(set => set.ref === query.learningSetRef);
  if (query.learningSetRef !== undefined && !set) throw new CardError('card_list_set_missing');
  return rows.filter(row => {
    const { content, review } = row.data;
    if (query.state === 'due' && (!review || review.nextDue > date)) return false;
    if (query.state === 'upcoming' && (!review || review.nextDue <= date)) return false;
    if (query.state === 'unlearned' && review) return false;
    if (!query.tags.every(tag => content.tags.includes(tag))) return false;
    if (query.chapter && content.chapter !== query.chapter && !content.chapter?.startsWith(query.chapter + '/')) return false;
    if (query.topic && content.topic !== query.topic && !content.topic?.startsWith(query.topic + '/')) return false;
    if (query.materialId && !content.sources.some(source => source.materialId === query.materialId)) return false;
    if (set && !set.members.includes(row.ref) && !content.sources.some(source => set.materials.includes(source.materialId))) return false;
    return true;
  }).sort((a, b) => {
    const left = a.data.review?.nextDue ?? '9999-99-99', right = b.data.review?.nextDue ?? '9999-99-99';
    return left < right ? -1 : left > right ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
  });
}

/** Candidate discovery does not present a full version and cannot authorize an edit. */
export function listCardSummaries(rows: readonly Saved<CardRecord>[], input: CardListInput, today: string, sets: readonly SetView[] = []): CardListResult {
  const query = CardListInputSchema.parse(input), selected = selectCardRows(rows, query, today, sets);
  const end = query.offset + query.limit;
  return CardListResultSchema.parse({ date: today,
    cards: selected.slice(query.offset, end).map(({ ref, version, data }) => ({ ref, version, title: data.content.title,
      tags: data.content.tags, chapter: data.content.chapter ?? null, topic: data.content.topic ?? null, nextDue: data.review?.nextDue ?? null,
      state: !data.review ? 'unlearned' : data.review.nextDue <= today ? 'due' : 'upcoming' })),
    nextOffset: end < selected.length ? end : null,
  });
}

export class CardService {
  private readonly records: CardRecordStore;
  private readonly materials: MaterialResolver;
  private readonly skeletons: ChapterSkeletonReader;
  private readonly targets: LinkTargets | undefined;
  private readonly chapters: ChapterPlacement | undefined;
  private readonly topics: ChapterPlacement | undefined;

  constructor(records: CardRecordStore, materials: MaterialResolver, skeletons: ChapterSkeletonReader, targets?: LinkTargets, chapters?: ChapterPlacement, topics?: ChapterPlacement) {
    this.records = records;
    this.materials = materials;
    this.skeletons = skeletons;
    this.targets = targets;
    this.chapters = chapters;
    this.topics = topics;
  }

  /**
   * Create one card from the author's own content; id is a pure function of the
   * accepted operation, so a retry re-finds the same card instead of growing a
   * second one. `expectedVersion` is not part of a creation's identity.
   * @throws CardError for a chapter that no real skeleton holds, and the source
   *   reader's own codes for an anchor this workspace cannot really resolve.
   */
  async create(ctx: MutationContext, input: unknown): Promise<CardView> {
    MutationContextSchema.parse(ctx);
    const content = await this.check(ctx, input);
    const id = derive('card_', `${ctx.workspaceId}:${ctx.operationId}`);
    const record: CardRecord = { content, history: [] };
    const placement = await this.placementPlans(ctx, [content]);
    if (placement.length === 0) return toView(await this.records.create(withoutVersion(ctx), id, record));
    const plan = this.records.prepareCreate(withoutVersion(ctx), id, record);
    await this.publisher()!.atomic([...placement, plan]);
    return toView(plan.result);
  }

  /**
   * Check one creation without writing it, so a future batch writer can prove
   * every item before the first one lands. No object, no revision, no history
   * is created here.
   */
  async check(ctx: HostContext, input: unknown): Promise<CardContent> {
    const content = CardContentSchema.parse(input);
    await this.assertSources(ctx, content.sources);
    await this.assertChapter(ctx, content.chapter, content.sources);
    this.assertTopic(content.topic);
    this.assertMath(mathProblems(contentText(content)));
    await this.assertLinks(ctx, content.links);
    return content;
  }

  /** One consistent read, either the current revision or an exact older one. */
  read(ctx: HostContext, ref: string, revision?: number): CardView {
    return toView(this.records.read(ctx, ref, revision));
  }

  /**
   * Apply one author edit to an existing card.
   * @throws CardError `card_expected_version_required` without a baseline,
   *   `card_chapter_missing` for a hook no real skeleton holds and
   *   `card_math_invalid` for unbalanced delimiters in text this edit rewrote;
   *   `card_links_remove_forbidden` when a non-student tries to drop a relation.
   * @throws RecordError `version_conflict` when the baseline moved, and the
   *   store's own `record_missing`/`target_invalid` for a bad target.
   */
  async edit(ctx: MutationContext, ref: string, patch: unknown): Promise<CardView> {
    MutationContextSchema.parse(ctx);
    if (ctx.expectedVersion === undefined) throw new CardError('card_expected_version_required');
    const { change, after } = await this.prepare(ctx, ref, ctx.expectedVersion, patch);
    const placement = change.chapter !== undefined || change.sources !== undefined || change.topic !== undefined ? await this.placementPlans(ctx, [after]) : [];
    if (placement.length === 0) return toView(await this.records.update(ctx, ref, change, row => ({ ...row, content: after })));
    const plan = this.records.prepareUpdate(ctx, ref, change, row => ({ ...row, content: after }));
    await this.publisher()!.atomic([...placement, plan]);
    return toView(plan.result);
  }

  /**
   * The exact checks an edit would run, and nothing else: the merged author
   * content for this baseline and patch, without writing, without a revision
   * and without touching the review ledger. The student editor and the
   * proposal preflight share it, so a draft is refused for the very reason the
   * save would refuse it instead of at a later, different one.
   * @throws the same `CardError`/`RecordError` codes as {@link edit}: a bad
   *   source or chapter, rewritten text with unbalanced delimiters, a relation
   *   a non-student may not drop, or a baseline that does not exist.
   */
  async preview(ctx: HostContext, ref: string, expectedVersion: VersionToken, patch: unknown): Promise<CardContent> {
    return (await this.prepare(ctx, ref, expectedVersion, patch)).after;
  }

  /**
   * The skeleton writes these contents' claimed levels still need — one minted
   * outline node per missing level, anchored to that card's own sources — ready
   * to fold into the same atomic unit as the card changes themselves, so a card
   * and the level it claims land or fail together. Batch writers call this for
   * their whole set; create and edit call it for one. The workspace-map port
   * plans claimed `topic` levels the same way, keyed under the single map
   * scope. Without a wired {@link ChapterPlacement} there is nothing to grow
   * and this returns empty.
   */
  async placementPlans(ctx: MutationContext, contents: readonly CardContent[]): Promise<PreparedRecordChange[]> {
    const chapterClaims = new Map<string, ChapterClaim[]>();
    const topicClaims = new Map<string, ChapterClaim[]>();
    for (const content of contents) {
      if (content.chapter !== undefined) {
        const materialIds = new Set(content.sources.map(source => source.materialId));
        if (materialIds.size === 1) {
          const materialId = materialIds.values().next().value!;
          const rows = chapterClaims.get(materialId) ?? [];
          rows.push({ path: content.chapter, anchors: [...content.sources] });
          chapterClaims.set(materialId, rows);
        }
      }
      if (content.topic !== undefined) {
        const rows = topicClaims.get(ATLAS_SCOPE) ?? [];
        rows.push({ path: content.topic, anchors: [...content.sources] });
        topicClaims.set(ATLAS_SCOPE, rows);
      }
    }
    const plans: PreparedRecordChange[] = [];
    if (this.chapters !== undefined && chapterClaims.size > 0) plans.push(...await this.chapters.plan(ctx, chapterClaims));
    if (this.topics !== undefined && topicClaims.size > 0) plans.push(...await this.topics.plan(ctx, topicClaims));
    return plans;
  }

  /**
   * Everything both `edit` and `preview` must agree on. Validation and the
   * merged result come from the frozen baseline this operation was accepted
   * against, never from whatever the card says now: a retried operation whose
   * ACK was lost must re-run the identical checks and let the store hand back
   * its own revision, and a source that moved since must not turn a valid old
   * edit into a false refusal. The store still owns the current-version CAS and
   * the operation replay.
   */
  private async prepare(
    ctx: HostContext,
    ref: string,
    expectedVersion: VersionToken,
    patch: unknown,
  ): Promise<{ change: CardPatch; before: CardContent; after: CardContent }> {
    // These rows carry numeric revisions; a digest token names nothing here, so
    // it is the same refusal the store's own comparison would produce.
    if (typeof expectedVersion !== 'number') throw new RecordError('version_conflict');
    const change = CardPatchSchema.parse(patch);
    const before = this.baseline(ctx, ref, expectedVersion).data.content;
    const after = applyPatch(ctx, before, change);
    if (change.sources !== undefined) await this.assertSources(ctx, after.sources);
    if (change.chapter !== undefined || change.sources !== undefined) await this.assertChapter(ctx, after.chapter, after.sources);
    if (change.topic !== undefined) this.assertTopic(after.topic);
    this.assertMath(mathProblems(changedTextFields(before, after)));
    await this.assertLinks(ctx, introducedLinks(before.links, change));
    return { change, before, after };
  }

  /**
   * Every anchor must resolve inside the immutable bytes of the version it
   * pins. Two anchors of one version are two positions: each keeps its own
   * locator and quote, so each is checked — only a literally identical anchor
   * (same version, same locator, same quote) is read once.
   */
  private async assertSources(ctx: HostContext, sources: readonly SourceAnchor[]): Promise<void> {
    const seen = new Set<string>();
    for (const source of sources) {
      const key = anchorKey(source);
      if (seen.has(key)) continue;
      seen.add(key);
      // The reader's own codes (`material_missing`, `source_quote_mismatch`, …)
      // stay intact: a repair needs to know which rule refused the anchor.
      await resolveAnchor(this.materials, ctx, source);
    }
  }

  /**
   * A relation introduced by this write must name a real object. Relations that
   * were already stored are not re-checked: they were proven when they were
   * added, and an object the student deleted later must not make an unrelated
   * edit impossible. Without the resolver an introduced link is refused, so an
   * opaque string can never quietly become a relation.
   */
  private async assertLinks(ctx: HostContext, refs: readonly EntityRef[]): Promise<void> {
    const unique = [...new Set(refs)];
    if (unique.length === 0) return;
    if (this.targets === undefined) throw new CardError('card_link_unverifiable', unique);
    const missing: string[] = [];
    for (const ref of unique) if (!await this.targets.has(ctx, ref)) missing.push(ref);
    if (missing.length > 0) throw new CardError('card_link_unresolved', missing);
  }

  /** The exact revision this operation was accepted against; the store still re-checks it. */
  private baseline(ctx: HostContext, ref: string, revision: number): Saved<CardRecord> {
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
   * A chapter is a real node of one of this card's own source books' skeletons —
   * or, when the service can grow structure, a level this card may mint: a card
   * pinned to exactly one source book may claim a well-formed path it will
   * create as an outline node anchored to its own sources. A card with no
   * sources or several source books cannot say which book a missing level
   * belongs to, so it still has to name a real node.
   */
  private async assertChapter(ctx: HostContext, chapter: string | undefined, sources: readonly SourceAnchor[]): Promise<void> {
    if (chapter === undefined) return;
    const paths = new Set<string>();
    for (const materialId of new Set(sources.map(source => source.materialId))) {
      const view = await this.skeletons.read(ctx, materialId);
      for (const node of view.nodes) paths.add(node.path);
    }
    if (paths.has(chapter)) return;
    const mintable = this.chapters !== undefined && new Set(sources.map(source => source.materialId)).size === 1
      && SkeletonPathSchema.safeParse(chapter).success;
    if (!mintable) throw new CardError('card_chapter_missing', [chapter]);
  }

  /**
   * A topic is a path in the workspace knowledge map, not in any one book, so
   * there is no source-book ambiguity: a wired map port mints any well-formed
   * level the card claims (single-source, multi-source or source-less alike),
   * and only the format and the port itself gate the claim. Without a wired
   * port a topic can never be verified or grown and is refused outright.
   */
  private assertTopic(topic: string | undefined): void {
    if (topic === undefined) return;
    if (this.topics === undefined) throw new CardError('card_topic_missing', [topic]);
    if (!SkeletonPathSchema.safeParse(topic).success) throw new CardError('card_topic_invalid', [topic]);
  }

  /** The wired placement port whose publisher lands this write's plans; both ports share one publisher. */
  private publisher(): ChapterPlacement | undefined {
    return this.chapters ?? this.topics;
  }

  private assertMath(problems: readonly MathIssue[]): void {
    if (problems.length === 0) return;
    throw new CardError('card_math_invalid', problems.map(formatMathIssue));
  }
}

/** Authored text fields, used only when this creation really supplies content. */
function contentText(content: CardContent): AuthorTextField[] {
  return [{ field: 'front', text: content.front }, { field: 'notes', text: content.notes },
    ...content.sections.flatMap((section, index) => [
      { field: `sections[${index}].heading`, text: section.heading },
      { field: `sections[${index}].body`, text: section.body },
    ])];
}

/** Merge one patch onto the stored content without ever defaulting a field away. */
function applyPatch(ctx: HostContext, before: CardContent, change: CardPatch): CardContent {
  const merged: Record<string, unknown> = {
    title: change.title ?? before.title,
    presentation: change.presentation ?? before.presentation,
    front: change.front ?? before.front,
    sections: change.sections ?? before.sections,
    notes: change.notes ?? before.notes,
    sources: change.sources ?? before.sources,
    tags: change.tags ?? before.tags,
    links: applyLinks(ctx.actor, before.links, change.links_add, change.links_remove),
  };
  const chapter = change.chapter === null ? undefined : change.chapter ?? before.chapter;
  if (chapter !== undefined) merged['chapter'] = chapter;
  const topic = change.topic === null ? undefined : change.topic ?? before.topic;
  if (topic !== undefined) merged['topic'] = topic;
  return CardContentSchema.parse(merged);
}

/** Increments only: additions append, removals are explicit and student-only. */
function applyLinks(
  actor: HostContext['actor'],
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  if (remove.length > 0 && actor !== 'student') throw new CardError('card_links_remove_forbidden');
  const dropped = new Set(remove);
  const links = [...current];
  for (const link of add) if (!links.includes(link)) links.push(link);
  return links.filter(link => !dropped.has(link));
}

function toView(saved: Saved<CardRecord>): CardView {
  return {
    ref: saved.ref, version: saved.version, content: saved.data.content, history: saved.data.history,
    ...(saved.data.review === undefined ? {} : { review: saved.data.review }),
  };
}

/**
 * Canonical key for one anchor: the version, the exact position and the quote.
 * The quote belongs to the key, because two anchors may share one position and
 * still have to be checked on their own.
 */
function anchorKey(anchor: SourceAnchor): string {
  return `${anchor.versionId}\u0000${anchor.quote ?? ''}\u0000${JSON.stringify(anchor.locator)}`;
}

/** The relations this write really introduces: added refs that were not already stored and that survive the patch. */
function introducedLinks(before: readonly EntityRef[], change: CardPatch): EntityRef[] {
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
