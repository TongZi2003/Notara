import { type Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type HostContext } from '@studyforge/contracts';
import { CourseUpdateSchema, type CourseUpdate, type CourseView, type CourseUsage } from '@studyforge/contracts/courses';
import { CourseMetadata } from '@studyforge/domain/courses';
import { EvidenceQuery, type EvidenceCatalogue } from '@studyforge/domain/evidence';
import { observeEvidence } from './evidence-query.ts';
import { nativeCourseUsage } from './native-usage.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeCourses: StudyForgeCourses; studyforgeCourseMetadata: CourseMetadata; } }

/** Only teaching metadata is exposed here; native session Remote remains the classroom API. */
export class StudyForgeCourses extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeCourses'); }
  private async context(sessionId: string): Promise<HostContext> {
    const binding = await this.ctx.studyforgeAccess.forSession(sessionId);
    return { sessionId: binding.sessionId, workspaceId: binding.workspaceId, purpose: binding.purpose, actor: 'student' };
  }
  /** Read optional teaching additions without starting a model or writing a row. */
  @Remote('read')
  async read(input: { sessionId: string }): Promise<CourseView> {
    return this.ctx.studyforgeCourseMetadata.read(await this.context(input.sessionId));
  }
  /** Derive accepted student evidence from the same authorized native Session. */
  @Remote('evidence')
  async evidence(input: { sessionId: string }): Promise<EvidenceCatalogue> {
    const context = await this.context(input.sessionId);
    this.ctx.studyforgeCourseMetadata.read(context);
    return new EvidenceQuery().catalogue(await observeEvidence(this.ctx, input.sessionId));
  }
  /** Read native full-session consumption and separate context estimates with coverage. */
  @Remote('usage')
  async usage(input: { sessionId: string }): Promise<CourseUsage> {
    await this.context(input.sessionId);
    return nativeCourseUsage(this.ctx, input.sessionId);
  }
  /** Save the exact displayed teaching-metadata version, preserving native Session identity. */
  @Remote('update')
  async update(input: CourseUpdate): Promise<CourseView> {
    const parsed = CourseUpdateSchema.parse(input), context = await this.context(parsed.sessionId);
    return this.ctx.studyforgeCourseMetadata.update({ ...context, operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.patch);
  }
}
