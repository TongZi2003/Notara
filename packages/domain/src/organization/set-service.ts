/**
 * P6.1 the learning-set writer (plan §P6.1, CONTRACTS.md §5).
 *
 * A set is organisation: a bookshelf grouping, the originals it groups, an
 * explicit member list and one optional review ladder. It is never an
 * authorisation scope — a card that belongs to no set is visible everywhere,
 * and the subjects list is a hint, not a gate.
 *
 * Where a card belongs is *derived* from facts this service already holds: the
 * sets whose own `materials` list names a material the card really sources,
 * *union* explicit membership. A set names its originals exactly once
 * (`SetRecord.materials`); there is no second material→set ledger, and the
 * Host only answers the one thing the domain cannot know on its own — whether
 * a material id really exists (`MaterialRefs`).
 *
 * The effective ladder of one card is the shortest ladder among the sets that
 * own it, compared the way B (`set_store._ladder_key`) does: last step, then
 * number of steps, then lexicographic — never a sum. A card owned by no set, or
 * by sets with no policy of their own, falls back to the default ladder.
 *
 * Changing a ladder, a set's materials or its membership refits the due dates
 * of exactly the cards whose *effective* ladder really moved — clearing a
 * policy or dropping a material falls back to another owning set or the default
 * ladder, and a card this set has nothing to do with keeps even a due date that
 * does not match its own ladder. A refit only rewrites `review.nextDue` — it
 * never activates an unlearned card, never adds history, never touches
 * `lastAccessed`/`reviewCount` — and every affected row (a create, or the set
 * edit plus each card) is published by one `owner.atomic` call, so a halfway
 * publication cannot exist.
 */
import { createHash } from 'node:crypto';
import { MutationContextSchema } from '@studyforge/contracts';
import { DEFAULT_LADDER } from '@studyforge/contracts/reviews';
import { SetCreateSchema, SetPatchSchema, SetViewSchema } from '@studyforge/contracts/sets';
import type { CardRecord, EntityRef, HostContext, MutationContext } from '@studyforge/contracts';
import type { SetCreate, SetPatch, SetRecord, SetView } from '@studyforge/contracts/sets';
import type { Clock } from '../clock.ts';
import { addDays, daysBetween } from '../review/schedule-step.ts';
import { RecordError, type PreparedRecordChange, type Saved } from '../storage/record-store.ts';

/** The record kind a learning set lives under. */
export const SET_KIND = 'set';

/** The record surface this service needs; one native `RecordStore` satisfies it. */
export interface SetRecordStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<SetRecord>;
  list(ctx: HostContext): Saved<SetRecord>[];
  create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<SetRecord>>;
  update(ctx: MutationContext, ref: string, input: unknown, transform: (current: SetRecord) => unknown): Promise<Saved<SetRecord>>;
  prepareCreate(ctx: MutationContext, id: string, input: unknown): PreparedRecordChange<SetRecord>;
  prepareUpdate(ctx: MutationContext, ref: string, input: unknown, transform: (current: SetRecord) => unknown): PreparedRecordChange<SetRecord>;
}

/** The card side this service needs: real membership targets and the cards a refit may touch. */
export interface SetCardStore {
  read(ctx: HostContext, ref: string, revision?: number): Saved<CardRecord>;
  list(ctx: HostContext): Saved<CardRecord>[];
  prepareUpdate(ctx: MutationContext, ref: string, input: unknown, transform: (current: CardRecord) => unknown): PreparedRecordChange<CardRecord>;
}

/**
 * The one thing a set cannot decide for itself: whether a material id names a
 * real original version in this workspace. A set records the materials it
 * groups, so the Host only owes existence; it owns no material→set mapping.
 */
export interface MaterialRefs {
  hasMaterial(ctx: HostContext, materialId: string): Promise<boolean>;
}

/** The one native publication the workspace owner has (`owner.atomic`). */
export interface RecordPublisher {
  atomic(changes: readonly PreparedRecordChange[]): Promise<void>;
}

/** A refused set write, with the exact rule that refused it. */
export class SetError extends Error {
  readonly code: string;
  readonly problems: readonly string[];
  /** The code travels inside the message; see `RouteError` for why. */
  constructor(code: string, problems: readonly string[] = []) {
    super(problems.length === 0 ? code : `${code}: ${problems.join('; ')}`);
    this.code = code;
    this.problems = problems;
    this.name = 'SetError';
  }
}

export class SetService {
  private readonly records: SetRecordStore;
  private readonly cards: SetCardStore;
  private readonly materials: MaterialRefs;
  private readonly clock: Clock;
  private readonly publish: RecordPublisher | undefined;

  constructor(records: SetRecordStore, cards: SetCardStore, materials: MaterialRefs, clock: Clock, publish?: RecordPublisher) {
    this.records = records;
    this.cards = cards;
    this.materials = materials;
    this.clock = clock;
    this.publish = publish;
  }

  /**
   * Create one set. Its id is derived from the accepted operation, so a retry
   * re-finds the same set instead of making a second one with the same name.
   * A set may be born grouping real originals and holding real cards; if that
   * changes the effective ladder of an already-learnt card, its due date is
   * refitted in the same publication.
   * @throws SetError `set_name_exists` for a taken name,
   *   `set_material_unresolved` for an unknown original and
   *   `set_member_unresolved` for a member that is not a real card.
   */
  async create(ctx: MutationContext, input: unknown): Promise<SetView> {
    MutationContextSchema.parse(ctx);
    const parsed = SetCreateSchema.parse(input);
    const id = derive('set_', `${ctx.workspaceId}:${ctx.operationId}`);
    this.assertNameFree(ctx, parsed.name, id);
    await this.assertMaterials(ctx, parsed.materials);
    for (const member of parsed.members) this.assertCard(ctx, member);
    // A replayed creation keeps the row it already wrote, including its creation
    // time, so the store recognises the retry instead of seeing a new input.
    const existing = this.optional(ctx, refOf(id));
    const record: SetRecord = {
      name: parsed.name, subjects: parsed.subjects, ladder: parsed.ladder,
      materials: [...parsed.materials], members: [...parsed.members],
      createdAt: existing?.data.createdAt ?? this.clock.now(),
    };
    const plan = this.records.prepareCreate(withoutVersion(ctx), id, record);
    // A replay answers with the revision this operation really wrote and runs
    // no refit: the cards were already refitted, and recomputing against the
    // row current *now* would push the old policy onto later changes.
    if (plan.result.duplicate) return toView(plan.result);
    const plans = this.planRefit(ctx, id, undefined, record);
    if (this.publish === undefined) {
      if (plans.length > 0) throw new SetError('set_refit_unavailable', [refOf(id)]);
      return toView(await this.records.create(withoutVersion(ctx), id, record));
    }
    await this.publish.atomic([plan, ...plans]);
    return toView(plan.result);
  }

  /** Every set of this workspace, ordered by name; renaming moves a row, never its identity. */
  list(ctx: HostContext): SetView[] {
    return this.records.list(ctx).map(toView).sort((left, right) => left.name.localeCompare(right.name));
  }

  read(ctx: HostContext, ref: string, revision?: number): SetView {
    return toView(this.records.read(ctx, ref, revision));
  }

  /**
   * Apply one edit. A ladder, material or membership change refits the due
   * dates of the cards this set owns, and the set edit plus every card change
   * are published in one call.
   * @throws SetError `set_expected_version_required` without a baseline,
   *   `set_name_exists` for a taken name, `set_member_unresolved` for a member
   *   that is not a real card, `set_material_unresolved` for an unknown
   *   original, and `set_refit_unavailable` when this edit would refit a card
   *   but no atomic publisher is wired.
   */
  async update(ctx: MutationContext, ref: string, patch: unknown): Promise<SetView> {
    MutationContextSchema.parse(ctx);
    if (ctx.expectedVersion === undefined) throw new SetError('set_expected_version_required');
    if (typeof ctx.expectedVersion !== 'number') throw new RecordError('version_conflict');
    const change = SetPatchSchema.parse(patch);
    // The edit is confirmed against the revision the caller read, not against
    // whatever the row says now: a later policy change must never become the
    // baseline of an older accepted operation.
    const before = this.records.read(ctx, ref, ctx.expectedVersion).data;
    for (const member of change.members_add) this.assertCard(ctx, member);
    await this.assertMaterials(ctx, change.materials_add);
    const after = mergeSet(before, change);
    if (change.name !== undefined && change.name !== before.name) this.assertNameFree(ctx, after.name, idOf(ref));
    const setPlan = this.records.prepareUpdate(ctx, ref, change, row => mergeSet(row, change));
    // A replayed operation returns its own frozen result and refits nothing.
    if (setPlan.result.duplicate) return toView(setPlan.result);
    const plans = this.planRefit(ctx, idOf(ref), before, after);
    if (this.publish === undefined) {
      if (plans.length > 0) throw new SetError('set_refit_unavailable', [ref]);
      return toView(await this.records.update(ctx, ref, change, row => mergeSet(row, change)));
    }
    await this.publish.atomic([setPlan, ...plans]);
    return toView(setPlan.result);
  }

  /**
   * The sets that really own one card: the sets whose own material list names a
   * source the card carries, union its explicit memberships. Empty means "no
   * set", which is a legal state and not a hidden set.
   */
  async ownership(ctx: HostContext, cardRef: string): Promise<SetView[]> {
    const card = this.cards.read(ctx, cardRef);
    const sets = this.setRows(ctx);
    const ids = new Set(this.owningIds(card.ref, card.data, sets));
    return sets.filter(entry => ids.has(entry.id)).map(entry => toView(entry.saved))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** The ladder one card really reviews on; owned by no set (or no policy) means the default ladder. */
  effectiveLadder(ctx: HostContext, cardRef: string): number[] {
    return this.effectiveLadderOf(ctx, cardRef, this.cards.read(ctx, cardRef).data);
  }

  /**
   * The same effective ladder, computed synchronously from a card row the
   * caller already holds. A trusted writer inside the store's own update
   * callback (a review occurrence) needs the policy that is current *there*,
   * not an async snapshot taken before the write.
   */
  effectiveLadderOf(ctx: HostContext, cardRef: string, card: CardRecord): number[] {
    return this.ladderFor(cardRef, card, this.setRows(ctx));
  }

  /** Every card this set owns: explicit members union derived from sources, by real card ref. */
  async cardsOf(ctx: HostContext, ref: string): Promise<EntityRef[]> {
    const set = this.records.read(ctx, ref);
    const sets = this.setRows(ctx);
    const out = new Set<string>(set.data.members);
    for (const card of this.cards.list(ctx)) {
      if (this.owningIds(card.ref, card.data, sets).includes(idOf(ref))) out.add(card.ref);
    }
    return [...out].sort();
  }

  /**
   * The due-date refit one set change implies: only cards that really own a
   * learnt schedule change, and only its `nextDue`. `before` is the set as the
   * accepted operation read it (absent for a creation) and `after` is that
   * operation's own result, so the comparison never mixes in a later policy.
   */
  private planRefit(ctx: MutationContext, setId: string, before: SetRecord | undefined, after: SetRecord): PreparedRecordChange<CardRecord>[] {
    // Nothing authored changed: no card's effective ladder can move.
    if (before !== undefined && same(before.ladder, after.ladder) && sameSet(before.materials, after.materials) && sameSet(before.members, after.members)) return [];
    const current = this.setRows(ctx);
    const known = current.some(entry => entry.id === setId);
    // The two world states this one change moves between: the sets as the
    // accepted operation read them, and the sets as that operation leaves them.
    // Clearing a ladder or dropping a material therefore falls back to another
    // owning set, or to the default ladder, instead of leaving a stale policy.
    const priorSets: SetRow[] = current.map(entry => entry.id === setId && before !== undefined ? { ...entry, data: before } : entry);
    const nextSets: SetRow[] = current.map(entry => entry.id === setId ? { ...entry, data: after } : entry);
    if (!known) {
      const row: SetRow = { id: setId, saved: { ref: refOf(setId), version: 0, data: after, duplicate: false }, data: after };
      if (before !== undefined) priorSets.push({ ...row, data: before });
      nextSets.push(row);
    }
    const plans: PreparedRecordChange<CardRecord>[] = [];
    for (const card of this.cards.list(ctx)) {
      const review = card.data.review;
      // An unlearned card has no clock to move: a ladder change never activates it.
      if (review === undefined) continue;
      const prior = this.ladderFor(card.ref, card.data, priorSets);
      const next = this.ladderFor(card.ref, card.data, nextSets);
      // Only a card whose real effective ladder moved may be refitted; a card
      // this set has nothing to do with keeps its due date even when that date
      // does not match its own ladder (a refit is not a background repair).
      if (same(prior, next)) continue;
      const nextDue = refitDue(review, next);
      if (nextDue === review.nextDue) continue;
      plans.push(this.cards.prepareUpdate({ ...ctx, expectedVersion: card.version }, card.ref, { refit: nextDue }, row => {
        if (row.review === undefined) return row;
        return { ...row, review: { ...row.review, nextDue } };
      }));
    }
    return plans;
  }

  /** The effective ladder of one card: shortest among the sets that own it, by material or membership. */
  private ladderFor(cardRef: string, card: CardRecord, sets: readonly SetRow[]): number[] {
    const ids = new Set(this.owningIds(cardRef, card, sets));
    return shortest(sets.filter(entry => ids.has(entry.id) && entry.data.ladder !== null).map(entry => entry.data.ladder!));
  }

  /**
   * The sets a card belongs to, by set id. A set owns a card when its own
   * material list names a material the card sources, or the card is an explicit
   * member — the card's real sources, never a course's planned references.
   */
  private owningIds(cardRef: string, card: CardRecord, sets: readonly SetRow[]): string[] {
    const materialIds = new Set(card.content.sources.map(source => source.materialId));
    const ids = new Set<string>();
    for (const entry of sets) {
      if (entry.data.members.includes(cardRef)) { ids.add(entry.id); continue; }
      if (entry.data.materials.some(materialId => materialIds.has(materialId))) ids.add(entry.id);
    }
    return [...ids];
  }

  private setRows(ctx: HostContext): SetRow[] {
    return this.records.list(ctx).map(saved => ({ id: idOf(saved.ref), saved, data: saved.data }));
  }

  /** A member must be a card this workspace really holds; a stale ref never becomes membership. */
  private assertCard(ctx: HostContext, ref: EntityRef): void {
    try {
      this.cards.read(ctx, ref);
    } catch (error) {
      if (codeOf(error) === 'workspace_mismatch') throw error;
      throw new SetError('set_member_unresolved', [ref]);
    }
  }

  /** A set may only group originals this workspace really holds; a stale id never becomes a source. */
  private async assertMaterials(ctx: HostContext, ids: readonly string[]): Promise<void> {
    const missing: string[] = [];
    for (const id of new Set(ids)) if (!(await this.materials.hasMaterial(ctx, id))) missing.push(id);
    if (missing.length > 0) throw new SetError('set_material_unresolved', missing);
  }

  /** B refused a second set with the same name: covering one would silently re-home cards. */
  private assertNameFree(ctx: HostContext, name: string, own: string): void {
    const taken = this.records.list(ctx).find(saved => saved.ref !== refOf(own) && saved.data.name.toLowerCase() === name.toLowerCase());
    if (taken !== undefined) throw new SetError('set_name_exists', [name]);
  }

  private optional(ctx: HostContext, ref: string): Saved<SetRecord> | undefined {
    try { return this.records.read(ctx, ref); }
    catch (error) { if (codeOf(error) === 'record_missing') return undefined; throw error; }
  }
}

interface SetRow { readonly id: string; readonly saved: Saved<SetRecord>; readonly data: SetRecord; }

/** Merge one patch onto the stored set without ever defaulting a field away. */
function mergeSet(before: SetRecord, change: SetPatch): SetRecord {
  return {
    name: change.name ?? before.name,
    subjects: change.subjects ?? before.subjects,
    ladder: change.ladder === undefined ? before.ladder : change.ladder,
    materials: mergeIds(before.materials, change.materials_add, change.materials_remove),
    members: mergeIds(before.members, change.members_add, change.members_remove),
    createdAt: before.createdAt,
  };
}

/** Membership moves by increment in the order it was added, and a removal wins over a stale add. */
function mergeIds(before: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const removed = new Set(remove);
  const next = before.filter(id => !removed.has(id));
  for (const id of add) if (!removed.has(id) && !next.includes(id)) next.push(id);
  return next;
}

/** B `set_store._ladder_key`: last step, then step count, then lexicographic — never a sum. */
function shortest(ladders: readonly (readonly number[])[]): number[] {
  if (ladders.length === 0) return [...DEFAULT_LADDER];
  const key = (ladder: readonly number[]) => [ladder[ladder.length - 1]!, ladder.length, ladder] as const;
  return [...[...ladders].sort((left, right) => compare(key(left), key(right)))[0]!];
}

function compare(left: readonly [number, number, readonly number[]], right: readonly [number, number, readonly number[]]): number {
  if (left[0] !== right[0]) return left[0] - right[0];
  if (left[1] !== right[1]) return left[1] - right[1];
  for (let index = 0; index < left[2].length; index += 1) {
    if (left[2][index] !== right[2][index]) return left[2][index]! - right[2][index]!;
  }
  return 0;
}

/** B `review_evidence.level_of`: the largest step the current interval has already reached. */
function levelOf(days: number, ladder: readonly number[]): number {
  const reached = Math.max(1, Math.floor(days));
  let index = 0;
  ladder.forEach((step, at) => { if (step <= reached) index = at; });
  return index;
}

/** B `bin/review refit`: `nextDue = lastAccessed + ladder[levelOf(interval)]`. */
function refitDue(review: { readonly lastAccessed: string; readonly nextDue: string }, ladder: readonly number[]): string {
  const interval = daysBetween(review.lastAccessed, review.nextDue);
  return addDays(review.lastAccessed, ladder[levelOf(interval, ladder)]!);
}

function same(left: readonly number[] | null, right: readonly number[] | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function refOf(id: string): string { return `${SET_KIND}:${id}`; }

function idOf(ref: string): string {
  const prefix = `${SET_KIND}:`;
  if (!ref.startsWith(prefix)) throw new RecordError('target_invalid');
  return ref.slice(prefix.length);
}

function toView(saved: Saved<SetRecord>): SetView {
  return SetViewSchema.parse({
    ref: saved.ref, version: saved.version, name: saved.data.name, subjects: saved.data.subjects,
    ladder: saved.data.ladder, materials: saved.data.materials, members: saved.data.members, createdAt: saved.data.createdAt,
  });
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

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
