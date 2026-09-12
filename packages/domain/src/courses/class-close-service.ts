/**
 * P7.5 确认收课（plan §P7.5，CONTRACTS.md §7）。
 *
 * 一节课只有学生确认了所见小结才关。这里不建第二个确认账：关闭认的是提案记录里
 * **已经真正落盘的 attempt**——哪一项、哪一版稿、什么摘要、用哪个 operation。领域层
 * 回读提案，对不上就拒；模型直写没有这条 attempt，写不进去。
 *
 * 确认通过后，小结与关闭事实由 `owner.atomic` 的**一次原生提交**同时写入：不会出现
 * 「小结在但课没关」或「课关了但没有小结」。同一个 operation 重试是幂等的——两次预检
 * 都把已经落盘的那一半算作无变化，只把缺的那一半补上；失败重试因此要么是完整旧态、
 * 要么是完整新态。关闭之后原课照常继续讨论：后续教学字段的更新不动 `closure`，
 * 而另一份小结不能把已经关过的课再关一次。
 */
import type { HostContext, MutationContext } from '@studyforge/contracts';
import type { CourseClosure } from '@studyforge/contracts/courses';
import type { HandoffCloseInput, HandoffCloseResult } from '@studyforge/contracts/handoffs';
import type { ProposalView } from '@studyforge/contracts/proposals';
import { RecordError, type PreparedRecordChange } from '../storage/record-store.ts';
import type { CourseMetadata } from './course-metadata.ts';
import type { HandoffService } from './handoff-service.ts';

/** The workspace owner's one native publication boundary. */
export interface AtomicPublisher { atomic(changes: readonly PreparedRecordChange[]): Promise<void>; }

/** The read side of the confirmation record; the real `ProposalService` satisfies it. */
export interface ProposalDecisionReader { read(ctx: HostContext, ref: string, revision?: number): ProposalView; }

export class ClassCloseService {
  private readonly handoffs: HandoffService;
  private readonly courses: CourseMetadata;
  private readonly decisions: ProposalDecisionReader;
  private readonly publisher: AtomicPublisher;
  constructor(handoffs: HandoffService, courses: CourseMetadata, decisions: ProposalDecisionReader, publisher: AtomicPublisher) {
    this.handoffs = handoffs; this.courses = courses; this.decisions = decisions; this.publisher = publisher;
  }

  /**
   * Close one lesson with the summary the student confirmed. The summary and the
   * closing fact land in one native update; the handoff receives the exact
   * revision the closure pins.
   * @throws RecordError `learning_session_required`, `close_confirmation_missing`,
   *   `close_requires_confirmation` (no attempt for this operation, or a digest /
   *   draft that is not the one that was really frozen), `close_confirmation_closed`
   *   (the confirmation was cancelled), `course_already_closed`, `version_conflict`.
   */
  async close(ctx: MutationContext, input: HandoffCloseInput): Promise<HandoffCloseResult> {
    const sessionId = requiredSession(ctx);
    this.confirmed(ctx, input);
    const prepared = this.handoffs.prepareClose(withSuffix(ctx, 'handoff'), input);
    const version = prepared.change.result.version;
    const closure: CourseClosure = { closedAt: prepared.record.createdAt, handoffRef: prepared.ref, handoffVersion: version };
    // The one native publication is all-or-nothing, so a lesson that already
    // carries exactly this summary and this instant already completed this very
    // operation. Return it instead of preparing a second write: the closing fact
    // is idempotent by identity, not by re-observing a moved version.
    const current = this.courses.read(withSuffix(ctx, 'close')).data.closure;
    if (current !== null && current.handoffRef === prepared.ref && current.handoffVersion === version) {
      return {
        handoff: { ref: prepared.ref, version },
        closure: { sessionId, handoffRef: prepared.ref, handoffVersion: version, closedAt: closure.closedAt },
      };
    }
    const course = this.courses.prepareClosure(withSuffix(ctx, 'close'), closure);
    await this.publisher.atomic([prepared.change, course]);
    return {
      handoff: { ref: prepared.ref, version },
      closure: { sessionId, handoffRef: prepared.ref, handoffVersion: version, closedAt: closure.closedAt },
    };
  }

  /**
   * The student's confirmation, read back from the real proposal record. The
   * attempt is written before the executor ever runs, so it is the one thing a
   * model cannot mint: it names this very operation and the frozen draft/digest.
   */
  private confirmed(ctx: MutationContext, input: HandoffCloseInput): void {
    const confirmation = input.confirmation;
    const view = this.decisions.read(ctx, confirmation.proposalRef);
    const item = view.items.find(entry => entry.id === confirmation.itemId);
    if (item === undefined) throw new RecordError('close_confirmation_missing');
    const attempt = item.attempt;
    const draft = item.drafts.find(entry => entry.revision === confirmation.draftRevision);
    if (attempt === undefined || draft === undefined
      || attempt.operationId !== ctx.operationId || attempt.draft !== confirmation.draftRevision
      || attempt.digest !== confirmation.digest || draft.digest !== confirmation.digest) {
      throw new RecordError('close_requires_confirmation');
    }
    if (item.status === 'rejected') throw new RecordError('close_confirmation_closed');
  }
}

function requiredSession(ctx: HostContext): string {
  if (ctx.purpose !== 'learning' || !ctx.sessionId) throw new RecordError('learning_session_required');
  return ctx.sessionId;
}

/**
 * One mechanical sub-operation of the close. A single confirmation legitimately
 * writes two rows (the summary, then the closing fact); each keeps its own stable
 * operation id, so a retry replays both instead of colliding on one fingerprint.
 */
function withSuffix(ctx: MutationContext, suffix: string): MutationContext {
  const { expectedVersion: _ignored, ...rest } = ctx;
  return { ...rest, operationId: `${ctx.operationId}:${suffix}` };
}
