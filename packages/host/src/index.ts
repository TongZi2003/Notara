import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-storage';
import type {} from '@deepseek-ai/dsh-workspace';
import Schema from '@deepseek-ai/schemastery';
import { createClock } from '@studyforge/domain/clock';
import { openWorkspaceRecords } from './storage.ts';
import { StudyForgeProbe } from './probe-service.ts';
import { installExecutionAccess } from './access/context.ts';
import { CourseMetadataSchema } from '@studyforge/contracts';
import { CourseMetadata } from '@studyforge/domain/courses';
import { StudyForgeCourses } from './course-service.ts';
export { StudyForgeProbe } from './probe-service.ts';
export { StudyForgeCourses } from './course-service.ts';
export type { CourseView, CourseUpdate } from '@studyforge/contracts';
export type { ProbeReply } from '@studyforge/contracts';

export interface Config { root: string; timeZone: string; }
export const Config: Schema<Config> = Schema.object({ root: Schema.string().required(), timeZone: Schema.string().default('UTC') });
export const inject = ['storage', 'workspaceRegistry', 'sessionQuery', 'typert', 'tools', 'agentPresets'];
declare module '@deepseek-ai/cordis' {
  interface Context {
    studyforgeRecords: Awaited<ReturnType<typeof openWorkspaceRecords>>;
  }
}
/** The product Host owns one explicit student workspace, never the development checkout. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const clock = createClock(config.timeZone);
  const workspace = await ctx.workspaceRegistry.create(config.root, '学习空间');
  const owner = await openWorkspaceRecords(ctx, config.root, workspace.id, clock);
  try {
    const unprovide = ctx.reflect.provide('studyforgeRecords', owner);
    ctx.effect(() => async () => { unprovide(); await owner.close(); });
    await installExecutionAccess(ctx, config.root, workspace.id);
    const courses = new CourseMetadata(await owner.collection('course', CourseMetadataSchema));
    ctx.effect(() => ctx.reflect.provide('studyforgeCourseMetadata', courses));
    ctx.plugin(StudyForgeCourses);
    ctx.plugin(StudyForgeProbe);
  } catch (error) { await owner.close(); throw error; }
}
