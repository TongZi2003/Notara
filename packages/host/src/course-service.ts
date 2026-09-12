import { type Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type HostContext } from '@studyforge/contracts';
import { CourseUpdateSchema, type CourseUpdate, type CourseView, type CourseUsage, type CoursePatch } from '@studyforge/contracts/courses';
import { CourseMetadata } from '@studyforge/domain/courses';
import { EvidenceQuery, type EvidenceCatalogue } from '@studyforge/domain/evidence';
import { observeEvidence } from './evidence-query.ts';
import { nativeCourseUsage } from './native-usage.ts';
import { sourceEvidenceObjects } from './runtime/context-envelope.ts';
import type { OutputProjection } from '@studyforge/domain/outputs';
import { validateLessonMaterials } from './materials/validate-lesson-materials.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeCourses: StudyForgeCourses; studyforgeCourseMetadata: CourseMetadata; } }
export async function validateCoursePatch(host: Context, context: HostContext, patch: CoursePatch): Promise<void> {
  if (patch.lessonMaterials) await validateLessonMaterials(host, context, patch.lessonMaterials);
  if (patch.teachingRef && !host.studyforgeTeachingCatalog.has(patch.teachingRef)) throw new Error('teaching_configuration_missing');
  if (patch.learningSetRef) host.studyforgeSetService.read(context, patch.learningSetRef);
}

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
  @Remote('outputs')
  async outputs(input: { sessionId: string }): Promise<OutputProjection> {
    return this.ctx.studyforgeOutputReader(await this.context(input.sessionId));
  }
  /** Derive accepted student evidence from the same authorized native Session. */
  @Remote('evidence')
  async evidence(input: { sessionId: string }): Promise<EvidenceCatalogue> {
    const context = await this.context(input.sessionId);
    this.ctx.studyforgeCourseMetadata.read(context);
    return new EvidenceQuery().catalogue(await observeEvidence(this.ctx, input.sessionId, {
      resolveObjects: query => sourceEvidenceObjects(this.ctx, context, query.fragments ?? []),
    }));
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
    await validateCoursePatch(this.ctx, context, parsed.patch);
    return this.ctx.studyforgeCourseMetadata.update({ ...context, operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.patch);
  }
}
