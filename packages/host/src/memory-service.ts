import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { EntityRefSchema, type HostContext } from '@studyforge/contracts';
import { MemoryDraftSchema, MemoryEditInputSchema, MemorySearchInputSchema,
  type MemoryDraft, type MemoryEditInput, type MemorySearchResult, type MemoryView } from '@studyforge/contracts/memory';
import { EvidenceQuery, type EvidenceCatalogue } from '@studyforge/domain/evidence';
import type { MemoryService } from '@studyforge/domain/memory';
import { observeEvidence } from './evidence-query.ts';
import { sourceEvidenceObjects } from './runtime/context-envelope.ts';
import { studentContext } from './learning-service.ts';
import { rejected } from './tools/learning-context.ts';

/**
 * The narrow learner-memory port is the domain service itself, declared here so
 * the Remote generator sees a public subpath type (`@studyforge/domain/memory`)
 * instead of a boundary-local alias.
 */
declare module '@deepseek-ai/cordis' {
  interface Context { studyforgeMemory: StudyForgeMemory; studyforgeMemoryService: MemoryService; }
}

const SessionInput = z.object({ sessionId: z.string().min(1).optional() }).strict();
const NoteInput = z.object({ operationId: z.string().min(1), sessionId: z.string().min(1).optional(), draft: MemoryDraftSchema }).strict();
const ReviseInput = z.object({
  operationId: z.string().min(1), sessionId: z.string().min(1).optional(),
  target: EntityRefSchema, expectedVersion: z.number().int().positive(), draft: MemoryDraftSchema,
}).strict();
const EditInput = z.object({
  operationId: z.string().min(1), sessionId: z.string().min(1).optional(),
  target: EntityRefSchema, expectedVersion: z.number().int().positive(), edit: MemoryEditInputSchema,
}).strict();
const ReadInput = z.object({ target: EntityRefSchema, version: z.number().int().positive().optional() }).strict();

/**
 * P7.1 the narrow Host surface for one student's own learner memory.
 *
 * Every identity here comes from the Host: the workspace and optional lesson
 * from the authorized student context, the accepted evidence cut from the native
 * Session log, and the model's `E` aliases resolved against that exact cut — a
 * model never supplies an id, a time or a version. `catalogue` reads only;
 * `note`/`revise` write through the domain port, and `revise` carries the
 * `expectedVersion` the tool layer observed, so a stale edit is refused instead
 * of silently overwriting a newer wording.
 */
export class StudyForgeMemory extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeMemory'); }

  /** The accepted cut this turn may cite; it never writes and never calls a model. */
  @Remote('catalogue')
  async catalogue(input: { sessionId?: string }): Promise<EvidenceCatalogue> {
    const parsed = SessionInput.parse(input), context = await studentContext(this.ctx, parsed.sessionId);
    return this.cut(context);
  }

  /** Save one real observation as a new memory; identity is derived from the operation. */
  @Remote('note')
  async note(input: { operationId: string; sessionId?: string; draft: MemoryDraft }): Promise<MemoryView> {
    const parsed = NoteInput.parse(input), context = await studentContext(this.ctx, parsed.sessionId);
    return this.ctx.studyforgeMemoryService.note({ ...context, operationId: parsed.operationId }, parsed.draft, await this.cut(context));
  }

  /** Correct one memory at the observed revision; the earlier wording stays in its history. */
  @Remote('revise')
  async revise(input: { operationId: string; sessionId?: string; target: string; expectedVersion: number; draft: MemoryDraft }): Promise<MemoryView> {
    const parsed = ReviseInput.parse(input), context = await studentContext(this.ctx, parsed.sessionId);
    return this.ctx.studyforgeMemoryService.revise(
      { ...context, operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.target, parsed.draft, await this.cut(context));
  }

  /**
   * Save the student's own wording for one memory. It may be opened with no
   * lesson at all (no session id), so it never needs a fresh evidence
   * catalogue: omitted `sources` keeps what the record already adopted, and
   * supplied `sources` must name sources this record really adopted. Either way
   * this is an edit, not a new observation.
   */
  @Remote('edit')
  async edit(input: { operationId: string; sessionId?: string; target: string; expectedVersion: number; edit: MemoryEditInput }): Promise<MemoryView> {
    const parsed = EditInput.parse(input), context = await studentContext(this.ctx, parsed.sessionId);
    return this.ctx.studyforgeMemoryService.edit(
      { ...context, operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.target, parsed.edit);
  }

  /** One exact read, current or at a named older revision. */
  @Remote('read')
  async read(input: { target: string; version?: number }): Promise<MemoryView> {
    const parsed = ReadInput.parse(input), context = await studentContext(this.ctx);
    return this.ctx.studyforgeMemoryService.read(context, parsed.target, parsed.version);
  }

  /** The student's own memory across every subject; scope is not a fence for the owner. */
  @Remote('list')
  async list(): Promise<MemoryView[]> {
    return this.ctx.studyforgeMemoryService.list(await studentContext(this.ctx));
  }

  /** On-demand scan over the records this workspace already holds. */
  @Remote('search')
  async search(input: { query: string; kinds?: string[]; limit?: number }): Promise<MemorySearchResult> {
    const parsed = MemorySearchInputSchema.parse(input);
    return this.ctx.studyforgeMemoryService.search(await studentContext(this.ctx), parsed);
  }

  /** The real accepted cut for the resolved lesson; objects are the ones the message really bound. */
  private async cut(context: HostContext): Promise<EvidenceCatalogue> {
    if (!context.sessionId) throw rejected('本工具只能在课堂会话中使用');
    const sessionId = context.sessionId;
    return new EvidenceQuery().catalogue(await observeEvidence(this.ctx, sessionId, {
      resolveObjects: query => sourceEvidenceObjects(this.ctx, context, query.fragments ?? []),
    }));
  }
}
