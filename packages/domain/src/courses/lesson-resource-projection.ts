/**
 * P4.1 lesson resource projection (CONTRACTS.md §4).
 *
 * "本课资料" is a read-only projection of three real things: the lesson's own
 * explicit teaching references, the sources accepted student messages really
 * carried, and the learning objects this lesson really saved. It is not a deck
 * ledger — nothing here is written when a tab opens, closes or is switched, and
 * closing a lesson never removes the originals or the old messages.
 *
 * The order the lesson recorded its references in is preserved. One original in
 * two places stays two rows, because each position is its own way back to the
 * source; only a row that is the *same* identity twice (same version and same
 * locator) collapses, and it then reports every place it came from.
 *
 * A row carries what a native tab and the resolver need: `tabKey` is the
 * content identity a native file address uses, so it is the material *version*
 * (two versions of one original are two different files, and an old anchor must
 * never be replaced by the current one). Two positions inside one version are
 * still two rows that focus the same tab, because they differ only by locator.
 *
 * Every input must really belong to this lesson: a teaching row or an output
 * projection naming another session is refused instead of being counted here.
 * Pending drafts are not resources until they are really saved, and an output
 * whose state cannot be read is passed through as an anomaly, never dropped.
 */
import type { EntityRef, LessonMaterial, LessonMaterials, MaterialContext, SourceAnchor, SourceLocator } from '@studyforge/contracts';
import { RecordError } from '../storage/record-store.ts';
import type { CourseState, CourseStatus } from './course-projection.ts';
import type { OutputKind, OutputProjection } from './output-projection.ts';

/** What one row is: a material version, or a saved learning object. */
export type LessonResourceKind = 'material' | OutputKind;

/** One accepted student message, already reduced by the P4 ContextEnvelope to what it referenced. */
export interface AcceptedMessageSources {
  readonly messageId: string;
  /** The frozen selection sources this accepted message carried, in its own order. */
  readonly sources?: readonly SourceAnchor[];
  /** The message's current item, when the real envelope had one. */
  readonly currentMaterial?: LessonMaterial;
}

/** Where one row really came from, in discovery order. */
export type LessonResourceOrigin =
  | { readonly from: 'course' }
  | { readonly from: 'message'; readonly messageId: string }
  | { readonly from: 'output'; readonly operationId: string | null; readonly revision: number | null };

/** One openable row of the lesson's materials. */
export interface LessonResource {
  readonly kind: LessonResourceKind;
  /** Native tab identity: same text focuses the existing tab, whatever the position below. */
  readonly tabKey: string;
  /** Immutable version plus the exact position, for a material row. */
  readonly source: MaterialContext | null;
  /** Saved object identity, for a card/knowledge/… row. */
  readonly target: EntityRef | null;
  /** A lesson or accepted message may explicitly pin a card revision. */
  readonly cardVersion?: number;
  readonly title: string | null;
  /** The frozen quote a message used to justify this row, when it had one. */
  readonly quote: string | null;
  readonly origins: readonly LessonResourceOrigin[];
}

/** A declared resource whose real object could not be read; diagnostic only. */
export interface LessonResourceAnomaly { readonly target: EntityRef; readonly code: string; }

/** Raised when a caller hands in a row or a projection that belongs to another lesson. */
export const LESSON_BINDING_MISMATCH = 'lesson_binding_mismatch';

export interface LessonResourcesProjection {
  readonly sessionId: string;
  /** The teaching revision this deck was projected from; null when no course state was read. */
  readonly courseRevision: number | null;
  /**
   * `closed` only says the lesson ended — the resources below stay exactly as
   * they were. Null means no course state was read, not that the lesson ended.
   */
  readonly status: CourseStatus | null;
  readonly resources: readonly LessonResource[];
  readonly anomalies: readonly LessonResourceAnomaly[];
}

/** Read-only inputs. Every one is something the Host already has. */
export interface LessonResourceInput {
  readonly sessionId: string;
  /** The lesson's real teaching state; a closed lesson still lists the same materials. */
  readonly course?: CourseState;
  readonly messages?: readonly AcceptedMessageSources[];
  /**
   * The whole lesson output projection. The complete object is required so its
   * own `sessionId` can be checked: another lesson's output is never this
   * lesson's material, and a pending draft contributes nothing.
   */
  readonly outputs?: OutputProjection;
}

/**
 * Project the lesson's materials from the real references it holds.
 * @param input - course state, accepted message sources and saved outputs.
 * @returns rows in discovery order plus any declared object that could not be read.
 */
export function readLessonResources(input: LessonResourceInput): LessonResourcesProjection {
  // A wrong lesson can never be silently projected as this one.
  if (input.course !== undefined && input.course.sessionId !== input.sessionId) throw new RecordError(LESSON_BINDING_MISMATCH);
  if (input.outputs !== undefined && input.outputs.sessionId !== input.sessionId) throw new RecordError(LESSON_BINDING_MISMATCH);

  const resources: LessonResource[] = [];
  const at = new Map<string, number>();
  const anomalies: LessonResourceAnomaly[] = [];

  /** Same exact identity lands on one row; every other appearance is its own row. */
  const add = (row: Omit<LessonResource, 'origins' | 'quote'>, origin: LessonResourceOrigin, quote: string | null): void => {
    const key = row.source !== null
      ? `${row.kind}\u0000${row.source.materialId}\u0000${row.source.versionId}\u0000${locatorKey(row.source.locator)}`
      : `${row.kind}\u0000${row.target}\u0000${row.cardVersion ?? 'current'}`;
    const existing = at.get(key);
    if (existing === undefined) {
      at.set(key, resources.length);
      resources.push({ ...row, quote, origins: [origin] });
      return;
    }
    const current = resources[existing]!;
    resources[existing] = {
      ...current,
      quote: current.quote ?? quote,
      origins: current.origins.some(seen => sameOrigin(seen, origin)) ? current.origins : [...current.origins, origin],
    };
  };

  const materials: LessonMaterials = input.course?.lessonMaterials ?? { materials: [] };
  for (const item of materials.materials) add(fromLessonMaterial(item), { from: 'course' }, null);

  for (const message of input.messages ?? []) {
    const origin: LessonResourceOrigin = { from: 'message', messageId: message.messageId };
    for (const anchor of message.sources ?? []) {
      add({
        kind: 'material', tabKey: materialTabKey(anchor.materialId, anchor.versionId),
        source: { materialId: anchor.materialId, versionId: anchor.versionId, locator: anchor.locator },
        target: null, title: null,
      }, origin, anchor.quote ?? null);
    }
    if (message.currentMaterial !== undefined) add(fromLessonMaterial(message.currentMaterial), origin, null);
  }

  if (input.outputs !== undefined) {
    // The projection's own anomalies carry the real read codes; they are passed
    // through instead of being re-derived from an entry's state.
    anomalies.push(...input.outputs.anomalies);
    for (const output of input.outputs.entries) {
      // A not-yet-confirmed draft stays in the output projection, not in this deck.
      if (output.status !== 'saved' || output.target === null) continue;
      const origin: LessonResourceOrigin = { from: 'output', operationId: output.operationId, revision: output.revision };
      add({ kind: output.kind, tabKey: output.target, source: null, target: output.target, title: output.title }, origin, null);
      // A saved object's own sources are the rest of the chain it was built
      // from: a multi-source card contributes each material position it cites.
      for (const anchor of output.sources) {
        add({
          kind: 'material', tabKey: materialTabKey(anchor.materialId, anchor.versionId),
          source: { materialId: anchor.materialId, versionId: anchor.versionId, locator: anchor.locator },
          target: null, title: null,
        }, origin, anchor.quote ?? null);
      }
    }
  }

  return {
    sessionId: input.sessionId,
    courseRevision: input.course?.revision ?? null,
    status: input.course?.status ?? null,
    resources,
    anomalies,
  };
}

/**
 * The native content identity of one immutable version. Two versions of one
 * original are two files, so opening v2 must not focus v1's tab.
 */
function materialTabKey(materialId: string, versionId: string): string {
  return `material:${materialId}@${versionId}`;
}

/** One explicit teaching reference, as either a material version or a saved object. */
function fromLessonMaterial(item: LessonMaterial): Omit<LessonResource, 'origins' | 'quote'> {
  return item.kind === 'source'
    ? {
      kind: 'material', tabKey: materialTabKey(item.source.materialId, item.source.versionId),
      source: { materialId: item.source.materialId, versionId: item.source.versionId, ...(item.source.locator === undefined ? {} : { locator: item.source.locator }) },
      target: null, title: null,
    }
    : { kind: 'card', tabKey: item.cardVersion === undefined ? item.cardRef : `${item.cardRef}@${item.cardVersion}`,
      source: null, target: item.cardRef, title: null, ...(item.cardVersion === undefined ? {} : { cardVersion: item.cardVersion }) };
}

/** A locator's comparable form; two rows are the same position only when this matches. */
function locatorKey(locator: SourceLocator | undefined): string {
  if (locator === undefined) return 'none';
  switch (locator.kind) {
    case 'pdf': return `pdf:${locator.page}:${locator.rect?.join(',') ?? ''}`;
    case 'image': return `image:${locator.rect?.join(',') ?? ''}`;
    case 'text': return `text:${locator.start.line}:${locator.start.column}:${locator.end.line}:${locator.end.column}`;
    case 'docx': return `docx:${locator.part}:${locator.blockId}:${locator.start}:${locator.end}`;
  }
}

function sameOrigin(left: LessonResourceOrigin, right: LessonResourceOrigin): boolean {
  if (left.from !== right.from) return false;
  if (left.from === 'course' && right.from === 'course') return true;
  if (left.from === 'message' && right.from === 'message') return left.messageId === right.messageId;
  if (left.from === 'output' && right.from === 'output') return left.operationId === right.operationId && left.revision === right.revision;
  return false;
}
