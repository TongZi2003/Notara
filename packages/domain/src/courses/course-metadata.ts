import { createHash } from 'node:crypto';
import { CourseClosureSchema, CoursePatchSchema, type CourseClosure, type CourseMetadataData, type CourseMetadataSchema, type CourseView, type HostContext, type MutationContext } from '@studyforge/contracts';
import type { HandoffPin } from '@studyforge/contracts/handoffs';
import { RecordError, type PreparedRecordChange, type RecordStore, type Saved } from '../storage/record-store.ts';

/** The row a lesson has before anything teaching-specific was written for it. */
function initialMetadata(sessionId: string): CourseMetadataData {
  return { sessionId, lessonMaterials: { materials: [] }, learningSetRef: null, archived: false, closure: null };
}

/**
 * The one native id a lesson's teaching row lives under: `sha256(sessionId)`.
 * Exported so a Host that must name the row (or the ref built from it) derives the
 * same value this class does, instead of re-implementing the hash.
 */
export function courseRecordId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

/** The ref of that row; the native store keys both by `course:<id>`. */
export function courseRecordRef(sessionId: string): string {
  return 'course:' + courseRecordId(sessionId);
}

/** Native id is the sole classroom identity. An untouched lesson needs no extra row. */
export class CourseMetadata {
  private readonly records: RecordStore<typeof CourseMetadataSchema>;
  constructor(records: RecordStore<typeof CourseMetadataSchema>) { this.records = records; }
  private session(ctx: HostContext): string {
    if (ctx.purpose !== 'learning' || !ctx.sessionId) throw new RecordError('learning_session_required');
    if (ctx.workspaceId !== this.records.workspaceId) throw new RecordError('workspace_mismatch');
    return ctx.sessionId;
  }
  private id(ctx: HostContext): string { return courseRecordId(this.session(ctx)); }
  read(ctx: HostContext): CourseView {
    const sessionId = this.session(ctx);
    try {
      const saved = this.records.read(ctx, 'course:' + this.id(ctx));
      if (saved.data.sessionId !== sessionId) throw new RecordError('course_binding_mismatch');
      return { version: saved.version, data: saved.data };
    } catch (error) {
      if (codeOf(error) !== 'record_missing') throw error;
      return { version: 0, data: initialMetadata(sessionId) };
    }
  }

  /** The one row this lesson's teaching additions live in; absent means never written. */
  private optional(ctx: HostContext): Saved<CourseMetadataData> | undefined {
    try { return this.records.read(ctx, 'course:' + this.id(ctx)); }
    catch (error) { if (codeOf(error) === 'record_missing') return undefined; throw error; }
  }
  /** Mutates only course additions; retries never create or rename a native Session. */
  async update(ctx: MutationContext, patch: unknown): Promise<CourseView> {
    const parsed = CoursePatchSchema.parse(patch);
    return this.change(ctx, parsed, current => ({ ...current,
      ...(parsed.lessonMaterials === undefined ? {} : { lessonMaterials: parsed.lessonMaterials }),
      ...(parsed.learningSetRef === undefined ? {} : { learningSetRef: parsed.learningSetRef }),
      ...(parsed.archived === undefined ? {} : { archived: parsed.archived }),
      ...(parsed.teachingRef === undefined ? {} : { teachingRef: parsed.teachingRef }),
      ...(parsed.temporaryInstructions === undefined ? {} : { temporaryInstructions: parsed.temporaryInstructions }),
      ...(parsed.stance === undefined ? {} : { stance: parsed.stance }),
    }));
  }
  /** Called by the confirmed close writer in P7; navigation never calls it. */
  async recordClosure(ctx: MutationContext, closure: CourseClosure): Promise<CourseView> {
    const parsed = CourseClosureSchema.parse(closure);
    return this.change(ctx, { closure: parsed }, current => {
      if (current.closure !== null) throw new RecordError('course_already_closed');
      return { ...current, closure: parsed };
    });
  }

  /**
   * Prepare — but do not publish — this lesson's closing fact, so the confirmed
   * close writer can publish it in the same native update as the summary it closes
   * with. Either both land or neither does; a retry keeps the operation's own row
   * and time instead of writing a second close.
   * @throws RecordError `learning_session_required`, `workspace_mismatch`,
   *   `course_already_closed` when another summary would close this same lesson.
   */
  prepareClosure(ctx: MutationContext, closure: CourseClosure): PreparedRecordChange<CourseMetadataData> {
    const sessionId = this.session(ctx), id = this.id(ctx), existing = this.optional(ctx);
    // Append the closing fact mechanically. A lesson that already carries real
    // teaching additions is amended at exactly the revision just read; a lesson
    // with no row yet is created. Either way one native publication carries both
    // the summary and this fact, and the publisher re-checks `before` itself.
    if (existing === undefined) {
      const initial: CourseMetadataData = { ...initialMetadata(sessionId), closure };
      return this.records.prepareCreate(ctx, id, initial);
    }
    return this.records.prepareUpdate({ ...ctx, expectedVersion: existing.version }, 'course:' + id, { closure }, current => {
      if (current.closure !== null && current.closure.handoffRef !== closure.handoffRef) throw new RecordError('course_already_closed');
      return { ...current, closure };
    });
  }

  /**
   * Fix the handoff revision this lesson continued from. Mechanical: the Host sets
   * it from the real continuation when the lesson opens, and nothing here re-points
   * an already-set one by itself — `null` is the explicit clear.
   */
  async setContinuation(ctx: MutationContext, pin: HandoffPin | null): Promise<CourseView> {
    return this.change(ctx, { continuation: pin }, current => {
      const next: CourseMetadataData = { ...current };
      if (pin === null) delete next.continuation; else next.continuation = pin;
      return next;
    });
  }

  /**
   * Pin this lesson to one summary revision, mechanically: the caller's operation
   * alone identifies every step, so a retry after a crash replays the step it already
   * did instead of conflicting with the revision that step moved. That is the right
   * shape here because the caller owns the pin exactly — the lesson was opened by this
   * operation, or the student is pinning the lesson in front of them — and the fixity
   * rule is re-checked against the queue's current row, so two different versions can
   * never both land. A lesson that never had a teaching row yet gets one.
   * @throws RecordError `continuation_fixed` when another version is already pinned,
   *   `course_binding_mismatch`, `learning_session_required`, `workspace_mismatch`.
   */
  async pinContinuation(ctx: Omit<MutationContext, 'expectedVersion'>, pin: HandoffPin): Promise<CourseView> {
    const sessionId = this.session(ctx), id = this.id(ctx), existing = this.optional({ ...ctx, sessionId });
    const held = (current: CourseMetadataData): CourseMetadataData => {
      const already = current.continuation;
      if (already !== undefined && (already.ref !== pin.ref || already.version !== pin.version)) throw new RecordError('continuation_fixed');
      return current;
    };
    if (existing === undefined) {
      const saved = await this.records.create({ ...ctx, sessionId, operationId: ctx.operationId + ':row' }, id,
        { ...held(initialMetadata(sessionId)), continuation: pin });
      return { version: saved.version, data: saved.data };
    }
    const saved = await this.records.updateCurrent({ ...ctx, sessionId, operationId: ctx.operationId + ':pin' }, 'course:' + id,
      { continuation: pin }, current => {
        if (current.sessionId !== sessionId) throw new RecordError('course_binding_mismatch');
        return { ...held(current), continuation: pin };
      });
    return { version: saved.version, data: saved.data };
  }
  private async change(ctx: MutationContext, input: unknown, transform: (data: CourseMetadataData) => CourseMetadataData): Promise<CourseView> {
    const id = this.id(ctx);
    // Version zero denotes an absent optional teaching row. Its first atomic
    // create shares the same native id; a conflict cannot allocate another class.
    if (ctx.expectedVersion === 0) {
      const initial = initialMetadata(this.session(ctx));
      try {
        const saved = await this.records.create(ctx, id, transform(initial));
        return { version: saved.version, data: saved.data };
      } catch (error) {
        if (codeOf(error) === 'record_exists') throw new RecordError('version_conflict');
        throw error;
      }
    }
    const saved = await this.records.update(ctx, 'course:' + id, input, current => {
      if (current.sessionId !== this.session(ctx)) throw new RecordError('course_binding_mismatch');
      return transform(current);
    });
    return { version: saved.version, data: saved.data };
  }
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
