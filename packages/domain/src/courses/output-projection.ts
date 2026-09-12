/**
 * P2.5 lesson output projection.
 *
 * The output list is rebuilt every time from two real sources — committed
 * `ObjectChange` rows plus the still-existing objects a reader can actually
 * load — and never from a stored "what this lesson produced" ledger. A
 * candidate whose object is gone is dropped; a candidate whose state cannot be
 * determined is reported as unknown instead of being guessed.
 *
 * Only writes this lesson really made count, so another lesson's or an unbound
 * out-of-class edit never leaks in. One real target is one output row: several
 * in-lesson edits collapse to the newest provenance and exactly one read of the
 * current object, so a row can never mix two states. The per-edit operation
 * list belongs to the P5.7 detail view, not here.
 *
 * A not-yet-confirmed draft keeps its own row by proposal id, including a
 * proposed edit of an object that is already saved: the saved object keeps its
 * deck place and the draft keeps its own entry point until the source stops
 * reporting it.
 *
 * Nothing here decides what was produced. The typed kind comes from the real
 * reference prefix (`card:`/`knowledge:`/…), not from a UI field, so a
 * knowledge or memory object is never dressed up as a card. Only a saved,
 * ordinary problem card enters the question deck.
 *
 * Inside the deck, questions that really point into one material version order
 * by their own source position (page / line / image box), so a lesson reads in
 * reading order rather than in commit order. The reorder only rewrites the slots
 * those questions already occupy: a card spanning several sources, one without a
 * locator, another material, or another DOCX part/block keeps its first-commit
 * position. Offsets are only comparable inside one DOCX part+block until P3 has
 * a block order, so those never sort against each other.
 */
import type { CardContent, EntityRef, ObjectChange, SourceAnchor, SourceLocator, Timestamp } from '@studyforge/contracts';

/** Typed lesson outputs; each keeps its own identity and entry point. */
export type OutputKind = 'card' | 'knowledge' | 'memory' | 'handoff' | 'diagram' | 'set' | 'route' | 'plan' | 'skeleton' | 'course';
const OUTPUT_KINDS: readonly string[] = ['card', 'knowledge', 'memory', 'handoff', 'diagram', 'set', 'route', 'plan', 'skeleton', 'course'];

/** 已保存 / 待确认 / 状态未知. */
export type OutputStatus = 'saved' | 'pending' | 'unknown';

/** What a real read of one target says right now. */
export type OutputRead =
  | {
    readonly state: 'present';
    readonly title: string;
    readonly presentation?: CardContent['presentation'];
    readonly revision: number;
    /** The card's own `sources`, exactly as stored; omitted when the object is not a card. */
    readonly sources?: CardContent['sources'];
  }
  | { readonly state: 'gone' }
  | { readonly state: 'unknown'; readonly code: string };

/** Explicit dependency: read one existing learning object, or say it is gone. */
export type OutputReader = (target: EntityRef) => OutputRead;

/**
 * One not-yet-saved output reported by the future P5 confirmation source.
 * Read-only projection of what that source already knows; this module stores nothing.
 */
export interface OutputProposal {
  /** The lesson this claim belongs to; a claim from another lesson is not this lesson's output. */
  readonly sessionId: string;
  /** Identity of the not-yet-confirmed draft; a proposed edit keeps its own row beside the saved object. */
  readonly proposalId: string;
  readonly kind: OutputKind;
  readonly title: string;
  readonly status: 'pending' | 'unknown';
  /** The object the confirmation would write, when the source already names one. */
  readonly target?: EntityRef;
}

/** One row of the rebuilt output list. */
export interface OutputEntry {
  readonly target: EntityRef | null;
  readonly kind: OutputKind;
  readonly title: string | null;
  readonly status: OutputStatus;
  /** True only for a saved ordinary problem card. */
  readonly deck: boolean;
  readonly revision: number | null;
  readonly committedAt: Timestamp | null;
  readonly operationId: string | null;
  /**
   * The pending draft this row stands for, so a not-yet-created output can still
   * be opened by identity. Null once a real object carries the row.
   */
  readonly proposalId: string | null;
  /** Real `CardContent.sources` of a saved card; empty when the reader supplied none. */
  readonly sources: readonly SourceAnchor[];
}

/** Diagnostic only: an object whose real state could not be read. Never rendered to students. */
export interface OutputAnomaly { readonly target: EntityRef; readonly code: string; }

export interface OutputProjection {
  readonly sessionId: string;
  /** One row per committed target in first-appearance order, then one row per pending draft id. */
  readonly entries: readonly OutputEntry[];
  readonly anomalies: readonly OutputAnomaly[];
}

export interface OutputProjectionInput {
  readonly sessionId: string;
  /** Real `RecordStore.changes` rows, in commit order; rows bound to another lesson are ignored. */
  readonly changes: readonly ObjectChange[];
  /** Read-only claims from the future P5 confirmation source, each naming its own lesson. */
  readonly proposals?: readonly OutputProposal[];
  readonly read: OutputReader;
}

/** The typed kind of a real reference, or null when it is not a lesson output target. */
export function outputKindOf(target: EntityRef): OutputKind | null {
  const separator = target.indexOf(':');
  if (separator <= 0) return null;
  const prefix = target.slice(0, separator);
  return OUTPUT_KINDS.includes(prefix) ? prefix as OutputKind : null;
}

/**
 * Rebuild the lesson output list from real changes and real reads.
 * @param input - session id, committed changes, optional proposal claims, and the read dependency.
 * @returns typed entries in source order plus any unresolved object states.
 */
export function projectOutputs(input: OutputProjectionInput): OutputProjection {
  // Collapse this lesson's changes to one row per real target first, keeping the
  // first source position and the newest provenance.
  const order: { target: EntityRef; kind: OutputKind; change: ObjectChange }[] = [];
  const latest = new Map<EntityRef, number>();
  for (const change of input.changes) {
    // Another lesson's write, or an unbound out-of-class edit, is not this lesson's output.
    if (change.sessionId !== input.sessionId) continue;
    const kind = outputKindOf(change.target);
    if (kind === null) continue;
    const position = latest.get(change.target);
    if (position === undefined) {
      latest.set(change.target, order.length);
      order.push({ target: change.target, kind, change });
    } else order[position] = { target: change.target, kind, change };
  }

  const entries: OutputEntry[] = [];
  const anomalies: OutputAnomaly[] = [];
  for (const { target, kind, change } of order) {
    // Exactly one read per target per projection, so one row cannot show two states.
    let read: OutputRead;
    try { read = input.read(target); }
    catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      read = { state: 'unknown', code: typeof code === 'string' && code.length > 0 ? code : 'read_failed' };
    }
    // A deleted object is not a produced output and is never resurrected.
    if (read.state === 'gone') continue;
    if (read.state === 'unknown') {
      anomalies.push({ target, code: read.code });
      entries.push({
        target, kind, title: null, status: 'unknown', deck: false,
        revision: null, committedAt: change.committedAt, operationId: change.operationId, proposalId: null, sources: [],
      });
      continue;
    }
    entries.push({
      target, kind, title: read.title, status: 'saved',
      deck: kind === 'card' && read.presentation === 'problem',
      revision: read.revision, committedAt: change.committedAt, operationId: change.operationId, proposalId: null,
      sources: read.sources ?? [],
    });
  }

  const claimed = new Set<string>();
  for (const proposal of input.proposals ?? []) {
    if (proposal.sessionId !== input.sessionId) continue;
    // A draft is its own row, keyed by identity — including a proposed edit of an
    // already saved object. It leaves the list only when the source stops
    // reporting it, which happens after the confirmation really lands.
    if (claimed.has(proposal.proposalId)) continue;
    claimed.add(proposal.proposalId);
    entries.push({
      target: proposal.target ?? null, kind: proposal.kind, title: proposal.title,
      status: proposal.status, deck: false, revision: null, committedAt: null, operationId: null,
      proposalId: proposal.proposalId, sources: [],
    });
  }
  return { sessionId: input.sessionId, entries, anomalies };
}

/**
 * One comparable position inside a source version; lower sorts first.
 * PDF/image use the page or box top-left, text its start line/column, DOCX its offset.
 */
function locatorPosition(locator: SourceLocator): readonly number[] {
  switch (locator.kind) {
    case 'pdf': {
      const box = locator.rect ?? [0, 0, 1, 1];
      return [0, locator.page, box[1], box[0]];
    }
    case 'image': {
      const box = locator.rect ?? [0, 0, 1, 1];
      return [1, 0, box[1], box[0]];
    }
    case 'text': return [2, locator.start.line, locator.start.column, 0];
    case 'docx': return [3, 0, locator.start, 0];
  }
}

function comparePosition(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The sortable group and source position of a question, when it has exactly one
 * located source. A DOCX anchor also groups by part and block id, because two
 * blocks' offsets are not comparable before P3 publishes a block order.
 */
function locatedAt(entry: OutputEntry): { readonly key: string; readonly position: readonly number[] } | null {
  if (entry.sources.length !== 1) return null;
  const anchor = entry.sources[0]!;
  const head = `${anchor.materialId}\u0000${anchor.versionId}`;
  const locator = anchor.locator;
  return {
    key: locator.kind === 'docx' ? `${head}\u0000${locator.part}\u0000${locator.blockId}` : head,
    position: locatorPosition(locator),
  };
}

/**
 * Saved ordinary problem cards, ordered for the question deck.
 * Questions inside one sortable source group are re-sorted into the exact slots
 * they already occupy, so every other card — another material, a card spanning
 * several sources, one without a locator, or another DOCX part/block — keeps its
 * first-commit position. Ties keep first-commit order.
 */
export function questionDeck(projection: OutputProjection): readonly OutputEntry[] {
  const deck = projection.entries.filter(entry => entry.deck && entry.status === 'saved' && entry.kind === 'card');
  const groups = new Map<string, { slots: number[]; members: { entry: OutputEntry; position: readonly number[] }[] }>();
  deck.forEach((entry, slot) => {
    const located = locatedAt(entry);
    if (located === null) return;
    const group = groups.get(located.key);
    if (group === undefined) groups.set(located.key, { slots: [slot], members: [{ entry, position: located.position }] });
    else { group.slots.push(slot); group.members.push({ entry, position: located.position }); }
  });
  const ordered = [...deck];
  for (const group of groups.values()) {
    // A lone occupant already sits where it belongs; only shared slots are rewritten.
    if (group.slots.length < 2) continue;
    const sorted = [...group.members].sort((left, right) => comparePosition(left.position, right.position));
    group.slots.forEach((slot, index) => { ordered[slot] = sorted[index]!.entry; });
  }
  return ordered;
}
