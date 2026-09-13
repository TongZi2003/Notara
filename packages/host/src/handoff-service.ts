/**
 * P7.5 Host wiring for confirmed close (plan §P7.5, CONTRACTS.md §7).
 *
 * The domain layer owns the protocol: one confirmation writes the summary and the
 * closing fact in one native publication, a retry of the same operation restores
 * what the first attempt really froze. This module owns the three things only the
 * Host can know, and keeps them out of the model's hands:
 *
 *   · the exact native input cutoff the summary accounts for — the point where the
 *     teacher's own `propose_handoff` call happened, not "now";
 *   · the system facts that were really held at that moment (lesson materials,
 *     applied receipts, still-pending proposals of this very lesson);
 *   · the handoff revision this lesson continued from, frozen when it opened.
 *
 * The teacher model writes only `title`/`body`. Nothing here lets a body text,
 * a cutoff, a fact or a pin be invented by the model, and nothing here writes a
 * record directly: the summary and the closing fact go through
 * `owner.atomic` inside the domain close writer.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-session-query';
import { SessionId } from '@deepseek-ai/dsh-session';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { EntityRefSchema, type HostContext, type MutationContext } from '@studyforge/contracts';
import { HandoffCorrectionSchema, HandoffViewSchema,
  type HandoffCloseInput, type HandoffCloseResult, type HandoffCorrection, type HandoffCutoff, type HandoffFact, type HandoffPin, type HandoffView } from '@studyforge/contracts/handoffs';
import { ProposalEffectRejected, type ProposalEffectItem } from '@studyforge/domain/proposals';
import { nativeOpen, plannedSessionId } from './runtime/native-open.ts';
import { studentContext } from './learning-service.ts';
import type { PinnedHandoffReader } from './teaching/lesson-brief.ts';

/** The saved-summary surface this Host needs; the domain `HandoffService` satisfies it. */
export interface HandoffReader extends PinnedHandoffReader {
  read(ctx: HostContext, ref: string, revision?: number): HandoffView;
  list(ctx: HostContext): HandoffView[];
  correct(ctx: MutationContext, ref: string, correction: HandoffCorrection): Promise<HandoffView>;
}

/** The one confirmed close writer; the domain `ClassCloseService` satisfies it. */
export interface HandoffCloser {
  close(ctx: MutationContext, input: HandoffCloseInput): Promise<HandoffCloseResult>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    studyforgeHandoffService: HandoffReader;
    /** Provided by the confirmed `handoff` proposal effect; no tool writes here directly. */
    studyforgeHandoffClose: HandoffCloser;
  }
}

/** Every refusal the close layer raises happens before its single native
 * publication, so those codes mean "definitely nothing written" — the student may
 * still edit or cancel. Anything else stays commit-unknown and is only retried. */
const NO_WRITE = new Set(['course_already_closed', 'learning_session_required', 'close_requires_confirmation',
  'close_confirmation_missing', 'close_confirmation_closed', 'handoff_requires_native_origin', 'handoff_propose_call_missing',
  'record_exists', 'record_missing', 'version_conflict']);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value as Record<string, unknown>).sort()
    .map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/**
 * The real cutoff of one summary: the last **student input** in the native log at
 * or before the teacher's own `propose_handoff` call. The teacher can only have
 * summarized input they were shown, so assistant messages, tool calls/results and
 * system receipts between that input and the propose call are not the cutoff.
 * Everything after the propose call (the confirmation itself, receipts, later
 * discussion) was never part of the summary either.
 * @throws `handoff_propose_call_missing` when the call is not in the native log.
 */
export async function handoffCutoff(host: Context, sessionId: string, callId: string): Promise<HandoffCutoff> {
  const observation = await host.sessionQuery.observeSession(SessionId(sessionId));
  try {
    const at = observation.events.findIndex(event => event.type === 'tool/call' && event.data.callId === callId);
    if (at < 0) throw new Error('handoff_propose_call_missing');
    const student = observation.events.slice(0, at)
      .findLast(event => event.type === 'user/message' && event.data.source.kind === 'user');
    return { sessionId, sequence: student?.seq ?? 0, at: new Date(student?.time ?? observation.header.createdAt).toISOString() };
  } finally { observation[Symbol.dispose](); }
}

/**
 * What the system really held for this lesson when the summary was accepted:
 * the lesson's own materials, every applied receipt of this lesson, and the
 * proposals still waiting for the student. The handoff's own item is excluded —
 * it is being applied right now, not still pending.
 */
export async function handoffFacts(host: Context, ctx: HostContext, exclude?: { proposalRef: string; itemId: string }): Promise<HandoffFact[]> {
  const facts: HandoffFact[] = [], seen = new Set<string>();
  const add = (fact: HandoffFact): void => {
    const key = fact.kind + '\u0000' + fact.title;
    if (!seen.has(key)) { seen.add(key); facts.push(fact); }
  };
  const course = host.studyforgeCourseMetadata.read(ctx);
  for (const material of course.data.lessonMaterials.materials) {
    try {
      const title = material.kind === 'source'
        ? (await host.studyforgeMaterialService.get(ctx, material.source.materialId)).title
        : host.studyforgeCardService.read(ctx, material.cardRef).content.title;
      add({ kind: 'material', title });
    } catch { /* A reference that no longer resolves is not a fact we can name. */ }
  }
  if (ctx.sessionId !== undefined) {
    for (const proposal of host.studyforgeProposalService.list(ctx)) {
      if (proposal.origin.kind !== 'native' || proposal.origin.sessionId !== ctx.sessionId) continue;
      for (const item of proposal.items) {
        if (exclude !== undefined && proposal.ref === exclude.proposalRef && item.id === exclude.itemId) continue;
        if (item.status === 'applied' && item.receipt) add({ kind: 'saved', title: item.receipt.title, target: item.receipt.target });
        else if (item.status === 'pending') add({ kind: 'pending', title: proposal.title });
      }
    }
  }
  return facts;
}

/**
 * Everything the Host freezes at propose time and the student then accepts: the
 * real student-input cutoff, the system facts held right then, and the handoff
 * this lesson continued from. Freezing here (not at confirmation) is what keeps
 * "所见确认一致": the digest the student accepts covers exactly these bytes, and
 * a list that grew between proposing and confirming never silently replaces them.
 */
export interface HandoffSnapshot { readonly cutoff: HandoffCutoff; readonly facts: HandoffFact[]; readonly continuation?: HandoffPin; }

export async function handoffSnapshot(host: Context, ctx: HostContext, callId: string): Promise<HandoffSnapshot> {
  const sessionId = ctx.sessionId;
  if (sessionId === undefined) throw new Error('learning_session_required');
  const cutoff = await handoffCutoff(host, sessionId, callId);
  const facts = await handoffFacts(host, ctx);
  const continuation = host.studyforgeCourseMetadata.read(ctx).data.continuation;
  return { cutoff, facts, ...(continuation === undefined ? {} : { continuation }) };
}

/** Refuse a second close before the proposal is even frozen; the domain refuses
 * it again at write time, this only keeps the teacher from proposing a dead item. */
export function checkHandoffProposal(host: Context, ctx: HostContext): void {
  if (host.studyforgeCourseMetadata.read(ctx).data.closure !== null) throw new Error('course_already_closed');
}

/**
 * The `handoff` proposal effect: close the lesson with the summary the student
 * confirmed, injecting the Host-only cutoff, facts and continuation.
 * @throws ProposalEffectRejected for a definite no-write; anything else stays
 *   commit-unknown so the same operation is retried instead of losing an effect.
 */
export async function closeConfirmedHandoff(host: Context, context: MutationContext,
  item: ProposalEffectItem): Promise<{ target: string; revision: number; title: string }> {
  if (item.effect.kind !== 'handoff') throw new Error('proposal_effect_kind_mismatch');
  const sessionId = context.sessionId;
  if (context.purpose !== 'learning' || sessionId === undefined) throw new ProposalEffectRejected('learning_session_required');
  const proposal = host.studyforgeProposalService.read(context, item.proposalRef);
  if (proposal.origin.kind !== 'native') throw new ProposalEffectRejected('handoff_requires_native_origin');
  // The cutoff, the facts and the continuation were frozen when the teacher
  // proposed and the student is confirming them; nothing here re-reads "now".
  // A later edit may reword the body, but it may not swap the Host snapshot.
  const original = proposal.items.find(entry => entry.id === item.itemId)?.original.effect;
  if (original === undefined || original.kind !== 'handoff') throw new ProposalEffectRejected('handoff_original_missing');
  if (canonical(original.cutoff) !== canonical(item.effect.cutoff)
    || canonical(original.facts) !== canonical(item.effect.facts)
    || canonical(original.continuation ?? null) !== canonical(item.effect.continuation ?? null)) throw new ProposalEffectRejected('handoff_facts_fixed');
  const { cutoff, facts, continuation } = item.effect;
  try {
    const result = await host.studyforgeHandoffClose.close(context, {
      draft: item.effect.draft, cutoff, facts,
      ...(continuation === undefined ? {} : { continuation }),
      confirmation: { proposalRef: item.proposalRef, itemId: item.itemId, draftRevision: item.draftRevision, digest: item.digest },
    });
    return { target: result.handoff.ref, revision: result.handoff.version, title: item.effect.draft.title };
  } catch (error) {
    const code = codeOf(error);
    if (code !== undefined && NO_WRITE.has(code)) throw new ProposalEffectRejected(code);
    throw error;
  }
}

/** The student-facing read/revise surface. It never closes a lesson: only the
 * confirmed `handoff` effect does, and it always writes a new immutable revision. */
export class StudyForgeHandoffs extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeHandoffs'); }
  private async context(sessionId?: string): Promise<HostContext> { return studentContext(this.ctx, sessionId); }
  /**
   * The summary this lesson has: its own saved summary when it has closed, else the
   * exact revision it continued from; explicit ref/version wins over both.
   *
   * A lesson's own summary is read as the **current** revision of its record, not as
   * the revision its closure pinned: a correction appends revision 2, and reading the
   * pin would show revision 1 forever — the student could never see, re-read, or
   * further correct their own newer wording. A continuation is different: that is a
   * fixed pin the lesson was handed, so it keeps reading exactly that revision.
   */
  @Remote('read')
  async read(input: { sessionId?: string; ref?: string; version?: number }): Promise<HandoffView> {
    const parsed = z.object({ sessionId: z.string().min(1).optional(), ref: EntityRefSchema.optional(), version: z.number().int().positive().optional() }).strict().parse(input);
    const ctx = await this.context(parsed.sessionId), service = this.ctx.studyforgeHandoffService;
    if (parsed.ref !== undefined) return HandoffViewSchema.parse(service.read(ctx, parsed.ref, parsed.version));
    const course = this.ctx.studyforgeCourseMetadata.read(ctx).data;
    if (course.closure) return HandoffViewSchema.parse(service.read(ctx, course.closure.handoffRef));
    if (course.continuation !== undefined) return service.readPinned(ctx, course.continuation);
    throw new Error('handoff_missing');
  }

  /**
   * Continue this lesson from one **explicitly chosen** summary revision (plan §P7.5:
   * "新接续读取明确选定版本"). The student picks the version; nothing here resolves
   * "latest" for them. The pin is fixed once written: the same choice replays, a
   * different one is refused rather than silently re-pointing a lesson that already
   * received a revision.
   * @throws `continuation_fixed` when this lesson already continues another version.
   */
  @Remote('continue')
  async continue(input: { operationId: string; sessionId: string; ref: string; version: number }): Promise<HandoffView> {
    const parsed = z.object({ operationId: z.string().min(1), sessionId: z.string().min(1), ref: EntityRefSchema,
      version: z.number().int().positive() }).strict().parse(input);
    const ctx = await this.context(parsed.sessionId);
    // The exact revision must really exist; `readPinned` refuses a version the record
    // does not hold instead of quietly answering with another one.
    const handoff = this.ctx.studyforgeHandoffService.readPinned(ctx, { ref: parsed.ref, version: parsed.version });
    const pin = { ref: parsed.ref, version: parsed.version };
    // The fixity rule and the write happen together against the queue's current
    // row, so a retry of one operation replays its own pin instead of conflicting
    // with the very revision it wrote, and a different version is still refused.
    await this.ctx.studyforgeCourseMetadata.pinContinuation({ ...ctx, operationId: parsed.operationId }, pin);
    return HandoffViewSchema.parse(handoff);
  }

  /**
   * Open the one real next lesson that continues from an explicitly chosen summary
   * revision, and pin it to that exact revision (plan §P7.5: the student reaches
   * this from the summary itself — there is no pre-existing target lesson to hand
   * in). The lesson is created through the same `NativeOpen` seam a planned node
   * uses, under an opening key derived from this operation, so a retry of the same
   * operation adopts the same native id instead of opening a second lesson.
   *
   * Nothing is advanced by date: no plan line, route node or new summary is written
   * here. The new lesson copies only what the continued lesson really holds — its
   * material list and its teaching configuration. Its stance is the previous
   * lesson's own goal, so it is deliberately not carried over.
   * @throws RecordError `handoff_pin_missing` when that revision does not exist.
   */
  @Remote('openContinuation')
  async openContinuation(input: { operationId: string; ref: string; version: number }): Promise<{ sessionId: string }> {
    const parsed = z.object({ operationId: z.string().min(1), ref: EntityRefSchema,
      version: z.number().int().positive() }).strict().parse(input);
    const ctx = await this.context();
    // The exact revision the student chose, never "the latest one".
    const handoff = this.ctx.studyforgeHandoffService.readPinned(ctx, { ref: parsed.ref, version: parsed.version });
    const source = this.ctx.studyforgeCourseMetadata.read({ ...ctx, sessionId: handoff.sessionId }).data;
    const openingKey = 'continuation:' + parsed.operationId, sessionId = plannedSessionId(ctx.workspaceId, openingKey);
    // The course row is the marker that this operation really did open its native
    // lesson: with it there, a retry only has to finish the pin — even if the
    // continued lesson gained materials in between and the frozen opening input no
    // longer matches. A session the Host created but never rowed is still adopted.
    if (this.ctx.studyforgeCourseMetadata.read({ ...ctx, sessionId }).version === 0) {
      await nativeOpen(this.ctx).open(ctx, {
        openingKey, title: handoff.title, materials: source.lessonMaterials,
        decl: { ...(source.teachingRef === undefined ? {} : { teachingRef: source.teachingRef }) },
        ...(source.learningContext ? { study: source.learningContext } : {}),
      });
    }
    // Mechanical pin against the queue's current row: the same operation replays
    // its own write instead of conflicting with the revision it just created.
    await this.ctx.studyforgeCourseMetadata.pinContinuation(
      { ...ctx, sessionId, operationId: openingKey }, { ref: parsed.ref, version: parsed.version });
    return { sessionId };
  }
  /** Correct the teacher's own words: a new immutable revision, never a rewrite. */
  @Remote('correct')
  async correct(input: { operationId: string; ref: string; expectedVersion: number; correction: HandoffCorrection }): Promise<HandoffView> {
    const parsed = z.object({ operationId: z.string().min(1), ref: EntityRefSchema, expectedVersion: z.number().int().positive(),
      correction: HandoffCorrectionSchema }).strict().parse(input);
    const ctx = await this.context();
    return HandoffViewSchema.parse(await this.ctx.studyforgeHandoffService.correct(
      { ...ctx, operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.ref, parsed.correction));
  }
}

/**
 * The close also seals the lesson's review window for cards that did not exist
 * yet (plan §P7.5, CONTRACTS.md §7). A card first written *after* the lesson was
 * closed cannot be given an in-class occurrence from *before* the close: the card
 * was not there to be checked, so "补关课前漏记检验" is refused instead of
 * silently inventing a qualification. A genuinely later student action is a new
 * occurrence and stays allowed, and a card that already existed keeps every real
 * pre-close check it was owed.
 *
 * Returns the reason when the write must be refused, or `null` when it is fine.
 * Wiring it into `freeze()` is a review-tools change, not a close change.
 */
export function reviewBackfillProblem(host: Context, ctx: HostContext, target: string, occurredAt: string): string | null {
  if (!target.startsWith('card:')) return null;
  const closure = host.studyforgeCourseMetadata.read(ctx).data.closure;
  if (closure === null) return null;
  const history = host.studyforgeCardRecords.changes(ctx, target);
  // No recorded operation at all means the card is not in this store; let the
  // real reader report that instead of guessing here.
  if (history.length === 0 || history.some(change => change.committedAt <= closure.closedAt)) return null;
  return occurredAt > closure.closedAt ? null : 'review_after_close_new_card';
}
