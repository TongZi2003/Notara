import type { Context } from '@deepseek-ai/cordis';
import { SubjectBindingSchema } from './teaching/subject-context.ts';
import { LibraryRelationSchema } from '@studyforge/contracts/library';
import { ThoughtGraphSchema } from '@studyforge/contracts/classroom-trace';
import { StudyForgeTrace, registerThoughtTool } from './classroom-trace-service.ts';
import { StudyForgeLibrary } from './library-service.ts';
import type {} from '@deepseek-ai/dsh-storage';
import type {} from '@deepseek-ai/dsh-workspace';
import Schema from '@deepseek-ai/schemastery';
import { fileURLToPath } from 'node:url';
import { createClock } from '@studyforge/domain/clock';
import { openWorkspaceRecords } from './storage.ts';
import { StudyForgeProbe } from './probe-service.ts';
import { installExecutionAccess } from './access/context.ts';
import { CourseMetadataSchema, type HostContext } from '@studyforge/contracts';
import { CourseMetadata, COURSE_METADATA_SCHEMA_VERSION, migrateCourseMetadata } from '@studyforge/domain/courses';
import { StudyForgeCourses } from './course-service.ts';
import { MaterialRecordSchema } from '@studyforge/contracts/material-records';
import { MaterialService } from '@studyforge/domain/materials';
import { StudyForgeMaterials } from './materials/resource-service.ts';
import { registerMaterialTools } from './tools/material-tools.ts';
import { registerSourceUseTools } from './tools/source-use-tools.ts';
import { SkeletonRecordSchema } from '@studyforge/contracts/skeleton';
import { AtlasRecordSchema } from '@studyforge/contracts/atlas';
import { SkeletonService } from '@studyforge/domain/skeleton';
import { StudyForgeSources } from './source-service.ts';
import { registerSearchTools } from './tools/search-tools.ts';
import { CardRecordSchema } from '@studyforge/contracts/cards';
import { KnowledgeRecordSchema } from '@studyforge/contracts/knowledge';
import { CardService } from '@studyforge/domain/cards';
import { KnowledgeService } from '@studyforge/domain/knowledge';
import { ReviewService, reviewDigest } from '@studyforge/domain/review';
import { SetRecordSchema } from '@studyforge/contracts/sets';
import { RouteRecordSchema } from '@studyforge/contracts/routes';
import { PlanContentSchema } from '@studyforge/contracts/plans';
import { SetService } from '@studyforge/domain/sets';
import { RouteService } from '@studyforge/domain/routes';
import { PlanService } from '@studyforge/domain/plans';
import { SkeletonAuthoring } from '@studyforge/domain/skeleton-authoring';
import { ChapterDeriver } from '@studyforge/domain/chapter-deriver';
import { AtlasAuthoring, AtlasDeriver, AtlasService } from '@studyforge/domain/atlas';
import { BookExploration } from '@studyforge/domain/book-exploration';
import { StudyForgeOrganization, nativeLessons, routeValidators } from './organization-service.ts';
import { nativeOpen } from './runtime/native-open.ts';
import { StudyForgeLearning } from './learning-service.ts';
import { registerCardTools } from './tools/card-tools.ts';
import { registerKnowledgeTools } from './tools/knowledge-tools.ts';
import { lessonOutputs } from './outputs.ts';
import { ProposalRecordSchema } from '@studyforge/contracts/proposals';
import { TeachingOverrideSchema } from '@studyforge/contracts/teaching';
import { ProposalService } from '@studyforge/domain/proposals';
import { ReceiptOutbox } from '@studyforge/domain/receipt-outbox';
import { StudyForgeProposals } from './proposals-service.ts';
import { ReceiptDispatcher } from './receipts/dispatcher.ts';
import { proposalExecutor } from './proposal-executor.ts';
import { registerProposalTools } from './tools/proposal-tools.ts';
import { registerReviewTools } from './tools/review-tools.ts';
import { registerOrganizationTools } from './tools/organization-tools.ts';
import { MemoryRecordSchema } from '@studyforge/contracts/memory';
import { MemoryService } from '@studyforge/domain/memory';
import { EvidenceQuery } from '@studyforge/domain/evidence';
import { StudyForgeMemory } from './memory-service.ts';
import { registerMemoryTools } from './tools/memory-tools.ts';
import { TeachingCatalog, StudyForgeTeaching, installTeaching } from './teaching/teaching-context.ts';
import { DailyReportSettingsSchema } from '@studyforge/contracts/calendar';
import { DailyReportService } from '@studyforge/domain/daily-report';
import { NativeCalendar, StudyForgeCalendar, installDailyReportTimer, type ChangeReader } from './calendar-service.ts';
import { registerDelegationTools } from './teaching/native-delegation.ts';
import { registerFacadeTools } from './tools/tool-facades.ts';
import { HandoffRecordSchema } from '@studyforge/contracts/handoffs';
import { HandoffService } from '@studyforge/domain/handoffs';
import { ClassCloseService } from '@studyforge/domain/class-close';
import { StudyForgeHandoffs } from './handoff-service.ts';
import { registerHandoffTools } from './tools/handoff-tools.ts';
import { registerTeachingTools } from './tools/teaching-tools.ts';
import { CreationRecordSchema, InstalledArtifactSchema } from '@studyforge/contracts/creation';
import { StudyForgeCreation, installCreationContext } from './creation-service.ts';
import { PluginRecordSchema, PluginPinSchema, WorldbookRecordSchema, WorldbookUseSchema, WorkbenchDraftSchema, WorkbenchActivitySchema } from '@studyforge/contracts/plugins';
import { WorkbenchData } from './plugins/workbench-data.ts';
import { BoardActivity } from './plugins/board-activity.ts';
import { PluginDocumentRecordSchema, SeminarRecordSchema } from '@studyforge/contracts/plugin-learning';
import { Seminar } from './plugins/seminar.ts';
import { TeachingRounds } from './teaching/rounds.ts';
import { TeachingRoundRecordSchema } from '@studyforge/contracts/teaching-rounds';
import { StudyForgeRounds } from './rounds-service.ts';
import { registerRoundTools } from './tools/round-tools.ts';
import { LearningWorkbenches, registerWorkbenchTools } from './plugins/learning-workbenches.ts';
import { PluginLearningRemote } from './plugin-learning-service.ts';
import { PluginManager } from './plugins/plugin-manager.ts';
import { StudyForgePlugins } from './plugins-service.ts';
import { ClassroomTaskRecordSchema, ClassroomSessionRecordSchema, ClassroomCueRecordSchema } from '@studyforge/contracts/classroom';
import { ClassroomRuntime } from './plugins/classroom-runtime.ts';
import { ClassroomRemote, registerClassroomTools } from './classroom-service.ts';
export { ClassroomRemote } from './classroom-service.ts';
export { StudyForgePlugins } from './plugins-service.ts';
export { StudyForgeCreation } from './creation-service.ts';
export { StudyForgeHandoffs } from './handoff-service.ts';
export { StudyForgeProposals } from './proposals-service.ts';
export { StudyForgeOrganization } from './organization-service.ts';
export { StudyForgeMemory } from './memory-service.ts';
export { StudyForgeTeaching } from './teaching/teaching-context.ts';
export { StudyForgeCalendar } from './calendar-service.ts';
export { StudyForgeLearning } from './learning-service.ts';
export { StudyForgeSources } from './source-service.ts';
export { StudyForgeMaterials } from './materials/resource-service.ts';
export { StudyForgeProbe } from './probe-service.ts';
export { StudyForgeCourses } from './course-service.ts';
export type { CourseView, CourseUpdate } from '@studyforge/contracts';
export type { ProbeReply } from '@studyforge/contracts';

export interface Config { root: string; timeZone: string; }
export const Config: Schema<Config> = Schema.object({ root: Schema.string().required(), timeZone: Schema.string().default('UTC') });
export const inject = ['storage', 'workspaceRegistry', 'sessions', 'sessionQuery', 'sessionProjections', 'sessionController', 'typert', 'tools', 'agentPresets', 'agents', 'attachments', 'llm', 'systemPrompt', 'skills', 'subagents', 'timer', 'loader', 'clientModules'];
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
    const pluginRecords = await owner.collection('plugin', PluginRecordSchema);
    const pluginPins = await owner.collection('pluginpin', PluginPinSchema);
    const plugins = new PluginManager(ctx, pluginRecords, pluginPins);
    ctx.effect(() => ctx.reflect.provide('studyforgePluginsManager', plugins));
    const workbenchData = new WorkbenchData(ctx, await owner.collection('worldbook', WorldbookRecordSchema), await owner.collection('worldbookuse', WorldbookUseSchema), await owner.collection('workbenchdraft', WorkbenchDraftSchema));
    ctx.effect(() => ctx.reflect.provide('studyforgeWorkbenchData', workbenchData));
    const boardActivity = new BoardActivity(ctx, await owner.collection('workbenchactivity', WorkbenchActivitySchema), clock);
    ctx.effect(() => ctx.reflect.provide('studyforgeBoardActivity', boardActivity));
    const learningWorkbenches = new LearningWorkbenches(ctx, await owner.collection('plugindocument', PluginDocumentRecordSchema));
    ctx.effect(() => ctx.reflect.provide('studyforgeLearningWorkbenches', learningWorkbenches));
    ctx.plugin(PluginLearningRemote); registerWorkbenchTools(ctx);
    const seminar = new Seminar(ctx, await owner.collection('seminar', SeminarRecordSchema));
    ctx.effect(() => ctx.reflect.provide('notaraSeminar', seminar));
    const classroom = new ClassroomRuntime(ctx, await owner.collection('classroomtask', ClassroomTaskRecordSchema), await owner.collection('classroomsession', ClassroomSessionRecordSchema), await owner.collection('classroomcue', ClassroomCueRecordSchema));
    ctx.effect(() => ctx.reflect.provide('notaraClassroom', classroom));
    ctx.plugin(ClassroomRemote); registerClassroomTools(ctx);
    ctx.effect(() => () => plugins.dispose());
    ctx.plugin(StudyForgePlugins);

    const courseRecords = await owner.collection('course', CourseMetadataSchema, { schemaVersion: COURSE_METADATA_SCHEMA_VERSION, migrate: migrateCourseMetadata });
    const relations = await owner.collection('relation', LibraryRelationSchema);
    ctx.effect(() => ctx.reflect.provide('studyforgeRelations', relations));
    ctx.plugin(StudyForgeLibrary);
    const thoughts = await owner.collection('thought', ThoughtGraphSchema);
    ctx.effect(() => ctx.reflect.provide('studyforgeThoughts', thoughts));
    ctx.plugin(StudyForgeTrace);
    ctx.inject(['studyforgeTrace'], scope => registerThoughtTool(scope));
    const courses = new CourseMetadata(courseRecords);
    const creationRecords = await owner.collection('creation', CreationRecordSchema);
    const installedArtifacts = await owner.collection('artifact', InstalledArtifactSchema);
    const subjectBindings = await owner.collection('subjectbinding', SubjectBindingSchema);
    const teachingOverrides = await owner.collection('teaching', TeachingOverrideSchema);
    ctx.effect(() => ctx.reflect.provide('studyforgeSubjectBindings', subjectBindings));
    ctx.effect(() => ctx.reflect.provide('studyforgeInstalledArtifacts', installedArtifacts));
    ctx.effect(() => ctx.reflect.provide('studyforgeCreationRecords', creationRecords));
    ctx.plugin(StudyForgeCreation);
    installCreationContext(ctx);
    ctx.effect(() => ctx.reflect.provide('studyforgeCourseMetadata', courses));
    ctx.effect(() => ctx.reflect.provide('studyforgeTeachingOverrides', teachingOverrides));
    const teaching = new TeachingCatalog(fileURLToPath(new URL('../teaching-resources', import.meta.url)));
    ctx.effect(() => ctx.reflect.provide('studyforgeTeachingCatalog', teaching));
    installTeaching(ctx, teaching);
    ctx.plugin(StudyForgeTeaching);
    ctx.plugin(StudyForgeCourses);
    const materialRecords = await owner.collection('material', MaterialRecordSchema);
    const materials = new MaterialService(materialRecords, config.root, clock);
    ctx.effect(() => ctx.reflect.provide('studyforgeMaterialService', materials));
    const skeletonRecords = await owner.collection('skeleton', SkeletonRecordSchema);
    const skeletons = new SkeletonService(skeletonRecords, materials);
    ctx.effect(() => ctx.reflect.provide('studyforgeSkeletonService', skeletons));
    ctx.plugin(StudyForgeMaterials);
    ctx.plugin(StudyForgeSources);
    const cardRecords = await owner.collection('card', CardRecordSchema);
    const knowledgeRecords = await owner.collection('knowledge', KnowledgeRecordSchema);
    const targets = { async has(context: HostContext, ref: string): Promise<boolean> {
      const store = ref.startsWith('card:') ? cardRecords : ref.startsWith('knowledge:') ? knowledgeRecords : undefined;
      if (!store) return false;
      try { store.read(context, ref); return true; }
      catch (error) { if ((error as { code?: string }).code === 'record_missing') return false; throw error; }
    } };
    const atlasRecords = await owner.collection('atlas', AtlasRecordSchema);
    const atlas = new AtlasService(atlasRecords, materials);
    ctx.effect(() => ctx.reflect.provide('studyforgeAtlasService', atlas));
    const cards = new CardService(cardRecords, materials, skeletons, targets, new ChapterDeriver(skeletonRecords, skeletons, owner), new AtlasDeriver(atlasRecords, atlas, owner));
    const knowledge = new KnowledgeService(knowledgeRecords, undefined, targets);
    const setRecords = await owner.collection('set', SetRecordSchema);
    const sets = new SetService(setRecords, cardRecords, { async hasMaterial(context, id) {
      try { await materials.get(context, id); return true; }
      catch (error) { if ((error as { code?: string }).code === 'record_missing') return false; throw error; }
    } }, clock, owner);
    const routeRecords = await owner.collection('route', RouteRecordSchema);
    const routes = new RouteService(routeRecords, nativeOpen(ctx), clock, routeValidators(ctx, teaching.choices.map(choice => choice.id)), nativeLessons(ctx));
    const planRecords = await owner.collection('plan', PlanContentSchema);
    const plans = new PlanService(planRecords, materials, skeletons, {
      hasCard(context, ref) { try { cardRecords.read(context, ref); return true; } catch { return false; } },
      hasSet(context, ref) { try { setRecords.read(context, ref); return true; } catch { return false; } },
    });
    const skeletonAuthoring = new SkeletonAuthoring(skeletonRecords, cardRecords, planRecords, skeletons, owner);
    const atlasAuthoring = new AtlasAuthoring(atlasRecords, cardRecords, atlas, owner);
    const books = new BookExploration(materials, skeletons, cardRecords, knowledgeRecords);
    ctx.effect(() => ctx.reflect.provide('studyforgeSetService', sets));
    ctx.effect(() => ctx.reflect.provide('studyforgeRouteService', routes));
    ctx.effect(() => ctx.reflect.provide('studyforgePlanService', plans));
    ctx.effect(() => ctx.reflect.provide('studyforgeSkeletonAuthoring', skeletonAuthoring));
    ctx.effect(() => ctx.reflect.provide('studyforgeAtlasAuthoring', atlasAuthoring));
    ctx.effect(() => ctx.reflect.provide('studyforgeBookExploration', books));
    ctx.plugin(StudyForgeOrganization);
    const reviews = new ReviewService(cardRecords, (context, ref) => {
      const steps = sets.effectiveLadder(context, ref);
      return { steps, version: reviewDigest(steps) };
    });
    ctx.effect(() => ctx.reflect.provide('studyforgeClock', clock));
    ctx.effect(() => ctx.reflect.provide('studyforgeCardRecords', cardRecords));
    ctx.effect(() => ctx.reflect.provide('studyforgeKnowledgeRecords', knowledgeRecords));
    ctx.effect(() => ctx.reflect.provide('studyforgeCardService', cards));
    ctx.effect(() => ctx.reflect.provide('studyforgeKnowledgeService', knowledge));
    ctx.effect(() => ctx.reflect.provide('studyforgeReviewService', reviews));
    ctx.effect(() => ctx.reflect.provide('studyforgeCardContext', { read: async (context: HostContext, ref: string, version?: number) => cards.read(context, ref, version) }));
    ctx.effect(() => ctx.reflect.provide('studyforgeSearchSources', { materials: materialRecords,
      cards: { list: (context: HostContext) => cardRecords.list(context).map(row => ({ ...row, data: row.data.content })) },
      knowledge: { list: (context: HostContext) => knowledgeRecords.list(context).map(row => ({ ...row, data: row.data.content })) },
    }));
    ctx.plugin(StudyForgeLearning);
    const memoryRecords = await owner.collection('memory', MemoryRecordSchema);
    const memories = new MemoryService(memoryRecords, new EvidenceQuery());
    ctx.effect(() => ctx.reflect.provide('studyforgeMemoryService', memories));
    ctx.plugin(StudyForgeMemory);
    const handoffRecords = await owner.collection('handoff', HandoffRecordSchema);
    const handoffs = new HandoffService(handoffRecords, clock);
    ctx.effect(() => ctx.reflect.provide('studyforgeHandoffService', handoffs));
    ctx.plugin(StudyForgeHandoffs);
    const outputSources: ChangeReader[] = [
      { kind: 'card', list: context => cardRecords.list(context), changes: (context, target) => cardRecords.changes(context, target) },
      { kind: 'knowledge', list: context => knowledgeRecords.list(context), changes: (context, target) => knowledgeRecords.changes(context, target) },
      { kind: 'memory', list: context => memoryRecords.list(context), changes: (context, target) => memoryRecords.changes(context, target) },
      { kind: 'plan', list: context => planRecords.list(context), changes: (context, target) => planRecords.changes(context, target) },
      { kind: 'skeleton', list: context => skeletonRecords.list(context), changes: (context, target) => skeletonRecords.changes(context, target) },
      { kind: 'atlas', list: context => atlasRecords.list(context), changes: (context, target) => atlasRecords.changes(context, target) },
      { kind: 'set', list: context => setRecords.list(context), changes: (context, target) => setRecords.changes(context, target) },
      { kind: 'route', list: context => routeRecords.list(context), changes: (context, target) => routeRecords.changes(context, target) },
      { kind: 'handoff', list: context => handoffRecords.list(context), changes: (context, target) => handoffRecords.changes(context, target) },
      { kind: 'course', list: context => courseRecords.list(context), changes: (context, target) => courseRecords.changes(context, target) },
    ];
    ctx.effect(() => ctx.reflect.provide('studyforgeOutputSources', outputSources));
    const calendar = new NativeCalendar(ctx, outputSources);
    const reports = new DailyReportService(await owner.collection('dailyreport', DailyReportSettingsSchema), calendar, clock);
    ctx.effect(() => ctx.reflect.provide('studyforgeCalendarReader', calendar));
    ctx.effect(() => ctx.reflect.provide('studyforgeDailyReports', reports));
    ctx.plugin(StudyForgeCalendar);
    installDailyReportTimer(ctx);
    const proposalRecords = await owner.collection('proposal', ProposalRecordSchema);
    const proposals = new ProposalService(proposalRecords, clock, proposalExecutor(ctx));
    ctx.effect(() => ctx.reflect.provide('studyforgeHandoffClose', new ClassCloseService(handoffs, courses, proposals, owner)));
    const outbox = new ReceiptOutbox(proposalRecords, clock);
    const dispatcher = new ReceiptDispatcher(ctx, proposals, outbox);
    ctx.effect(() => ctx.reflect.provide('studyforgeProposalService', proposals));
    ctx.effect(() => ctx.reflect.provide('studyforgeReceiptOutbox', outbox));
    ctx.effect(() => ctx.reflect.provide('studyforgeReceiptDispatcher', dispatcher));
    ctx.plugin(StudyForgeProposals);
    ctx.effect(() => ctx.reflect.provide('studyforgeOutputReader', (context: HostContext) => lessonOutputs(ctx, context)));
    registerMaterialTools(ctx);
    registerSourceUseTools(ctx);
    registerSearchTools(ctx);
    registerCardTools(ctx);
    registerKnowledgeTools(ctx);
    registerProposalTools(ctx);
    registerReviewTools(ctx);
    registerOrganizationTools(ctx);
    registerMemoryTools(ctx);
    registerHandoffTools(ctx);
    registerTeachingTools(ctx);
    const delegation = registerDelegationTools(ctx, { assistantsDir: fileURLToPath(new URL('../teaching-resources/assistants', import.meta.url)) });
    const rounds = new TeachingRounds(ctx, await owner.collection('teachinground', TeachingRoundRecordSchema), delegation);
    ctx.effect(() => ctx.reflect.provide('notaraRounds', rounds));
    ctx.plugin(StudyForgeRounds);
    registerRoundTools(ctx);
    registerFacadeTools(ctx);
    try { await dispatcher.flush({ workspaceId: workspace.id, purpose: 'learning', actor: 'system' }); }
    catch { /* Stored pending receipts remain available for explicit retry. */ }
    await plugins.restore();
    await classroom.restore();
    ctx.plugin(StudyForgeProbe);
  } catch (error) { await owner.close(); throw error; }
}
