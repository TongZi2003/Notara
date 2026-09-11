/**
 * P2.4 read-only classroom state.
 *
 * A classroom's identity is its native Session; this module only projects the
 * teaching additions the Host already stored through `CourseMetadata`. It is a
 * pure function over that one row, so refreshing, navigating, switching
 * lessons, going idle or sending another native prompt cannot end or reopen a
 * lesson. The only writer of `closure` is the confirmed close writer in P7, and
 * nothing here can clear or forge it.
 *
 * The projection carries the exact metadata revision, so a view binding and the
 * teaching projection move together, and a row that cannot be read faithfully
 * is reported as its own state instead of being flattened into "open".
 */
import type { CourseClosure, CourseView, EntityRef, HostContext, LessonMaterials } from '@studyforge/contracts';

/** Whether the classroom is still open, was closed by the confirmed P7 writer, or cannot be read. */
export type CourseStatus = 'open' | 'closed' | 'unknown';

/** One consistent read-back of a lesson's teaching additions. */
export interface CourseState {
  readonly sessionId: string;
  /** Exact CourseMetadata revision; a view binding follows this same revision. */
  readonly revision: number;
  readonly status: CourseStatus;
  /** The real close fact written by the P7 confirmed writer; null while the lesson is open. */
  readonly closure: CourseClosure | null;
  readonly archived: boolean;
  readonly lessonMaterials: LessonMaterials;
  readonly learningSetRef: EntityRef | null;
  /** Diagnostic code only; student surfaces must never render it. */
  readonly anomaly: string | null;
}

/** The single dependency this query needs: a real teaching-metadata row read. */
export interface CourseMetadataReader {
  read(ctx: HostContext): CourseView;
}

/** Rows that exist but no longer describe themselves faithfully; reported separately, never as "open". */
function unavailable(sessionId: string, anomaly: string): CourseState {
  return {
    sessionId, revision: 0, status: 'unknown', closure: null, archived: false,
    lessonMaterials: { materials: [] }, learningSetRef: null, anomaly,
  };
}

/**
 * Project one read teaching-metadata row.
 * @param view - the exact stored row plus its revision.
 * @returns the consistent read-back; `closed` comes only from the stored closure fact.
 */
export function projectCourse(view: CourseView): CourseState {
  const closure = view.data.closure;
  return {
    sessionId: view.data.sessionId,
    revision: view.version,
    status: closure === null ? 'open' : 'closed',
    closure,
    archived: view.data.archived,
    lessonMaterials: view.data.lessonMaterials,
    learningSetRef: view.data.learningSetRef,
    anomaly: null,
  };
}

/**
 * Classify a store read failure without relying on one class instance, which a
 * second loaded copy of the same module would defeat.
 */
function troubleOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.length > 0) return code;
  return (error as { name?: unknown } | null)?.name === 'ZodError' ? 'course_corrupt' : null;
}

/**
 * Read and project one lesson's teaching additions.
 * @param reader - the real metadata read (a `CourseMetadata` instance satisfies this).
 * @param ctx - Host context; caller mistakes (missing learning session, foreign workspace) still throw.
 * @throws the original error when the request itself is invalid or the failure is unknown, so a bad caller or a real bug is never hidden.
 */
export function readCourseState(reader: CourseMetadataReader, ctx: HostContext): CourseState {
  try {
    return projectCourse(reader.read(ctx));
  } catch (error) {
    const trouble = troubleOf(error);
    const sessionId = ctx.sessionId ?? '';
    if (trouble === 'course_binding_mismatch') return unavailable(sessionId, trouble);
    // A row that fails its own revision/validation checks reads as one corrupt state.
    if (trouble === 'record_corrupt' || trouble === 'course_corrupt') return unavailable(sessionId, 'course_corrupt');
    throw error;
  }
}
