export type { ProbeReply, ProbeService } from './probe.ts';
export * from './core.ts';
export * from './execution.ts';
export * from './materials.ts';
export * from './material-records.ts';
export * from './material-read.ts';
export { LessonMaterialsSchema } from './lesson-materials.ts';
export type { LessonMaterials } from './lesson-materials.ts';
export * from './cards.ts';
export * from './knowledge.ts';
export * from './memory.ts';
export * from './evidence.ts';
export * from './courses.ts';
export * from './reviews.ts';
export * from './proposals.ts';
export * from './source-context.ts';
export * from './learning-search.ts';
export * from './changes.ts';
export * from './sets.ts';
export * from './routes.ts';
export * from './plans.ts';
export * from './book-exploration.ts';
export * from './calendar.ts';
export * from './teaching.ts';
export * from './handoffs.ts';

import { z } from 'zod';
import { CardContentSchema, CardPatchSchema, CardRecordSchema, CardViewSchema,
  CardListInputSchema, CardListResultSchema, CardBatchReadInputSchema, CardBatchReadResultSchema } from './cards.ts';
import { KnowledgeContentSchema, KnowledgeNoteSchema, KnowledgePatchSchema, KnowledgeRecordSchema, KnowledgeViewSchema, PublicTeachingRefSchema } from './knowledge.ts';
import { MemoryContentSchema, MemoryDraftSchema, MemoryObservationSchema, MemoryRecordSchema, MemoryViewSchema, MemoryEditInputSchema, MemorySearchInputSchema, MemorySearchResultSchema, MemoryBasisViewSchema } from './memory.ts';
import { HandoffRecordSchema, HandoffViewSchema, HandoffCloseInputSchema, HandoffCloseResultSchema } from './handoffs.ts';
import { HostContextSchema, MutationContextSchema, ObjectChangeSchema } from './execution.ts';
import { SourceLocatorSchema, SourceAnchorSchema, NormalizedRectSchema, MessageEnvelopeSchema } from './materials.ts';
import { LessonMaterialsSchema } from './lesson-materials.ts';
import { CourseMetadataSchema, CourseUpdateSchema, CourseViewSchema } from './courses.ts';
import { ImportMaterialInputSchema, MaterialRecordSchema, MaterialViewSchema, MaterialRefSchema } from './material-records.ts';
import { MaterialReadSchema, ReadMaterialInputSchema } from './material-read.ts';
import { SkeletonNodesSchema, SkeletonRecordSchema, SkeletonViewSchema } from './skeleton.ts';
import { ReviewOccurrenceSchema, ReviewScheduleSchema, ReviewHistorySchema, LadderSchema } from './reviews.ts';
import { ProposalInputSchema, ProposalRecordSchema, ProposalViewSchema, ProposalEditInputSchema, ProposalSelectionSchema } from './proposals.ts';
import { SourceContextSchema, SourceFragmentSchema, FrozenSourceSchema } from './source-context.ts';
import { LearningSearchInputSchema, LearningSearchResultSchema } from './learning-search.ts';
import { SetRecordSchema, SetCreateSchema, SetPatchSchema, SetViewSchema } from './sets.ts';
import { RouteRecordSchema, RouteNodeInputSchema, RouteNodePatchSchema, RoutePlacementSchema, RouteViewSchema } from './routes.ts';
import { PlanContentSchema, PlanPatchSchema, PlanViewSchema, SkeletonChangeSchema } from './plans.ts';
import { BookStructureSchema, BookBreakdownIntentSchema } from './book-exploration.ts';
import { DateQuerySchema, CalendarDaySchema, RoadmapDateFilterSchema, RoadmapFilterResultSchema, DailyReportSettingsSchema, DailyReportSchema } from './calendar.ts';
import { TeachingChoiceSchema, TeachingManifestSchema } from './teaching.ts';

/** Only authoring inputs belong in the model-facing set. Native envelopes are Host-owned. */
export const MODEL_CONTENT_SCHEMAS = {
  'card-content': CardContentSchema, 'knowledge-content': KnowledgeContentSchema, 'memory-content': MemoryDraftSchema,
} as const;
export const CONTRACT_SCHEMAS = {
  ...MODEL_CONTENT_SCHEMAS, 'memory-observation': MemoryObservationSchema, 'memory-body': MemoryContentSchema,
  'source-locator': SourceLocatorSchema, 'lesson-materials': LessonMaterialsSchema,
  'message-envelope': MessageEnvelopeSchema, 'host-context': HostContextSchema,
  'mutation-context': MutationContextSchema, 'object-change': ObjectChangeSchema,
  rect: NormalizedRectSchema, 'source-anchor': SourceAnchorSchema,
  'course-metadata': CourseMetadataSchema, 'course-update': CourseUpdateSchema, 'course-view': CourseViewSchema,
  'material-import': ImportMaterialInputSchema, 'material-record': MaterialRecordSchema, 'material-view': MaterialViewSchema,
  'material-ref': MaterialRefSchema, 'material-read-input': ReadMaterialInputSchema, 'material-read': MaterialReadSchema,
  'skeleton-nodes': SkeletonNodesSchema, 'skeleton-record': SkeletonRecordSchema, 'skeleton-view': SkeletonViewSchema,
  'card-patch': CardPatchSchema, 'card-record': CardRecordSchema, 'card-view': CardViewSchema,
  'card-list-input': CardListInputSchema, 'card-list-result': CardListResultSchema,
  'card-batch-read-input': CardBatchReadInputSchema, 'card-batch-read-result': CardBatchReadResultSchema,
  'knowledge-note': KnowledgeNoteSchema, 'knowledge-patch': KnowledgePatchSchema, 'knowledge-record': KnowledgeRecordSchema,
  'knowledge-view': KnowledgeViewSchema, 'public-teaching-ref': PublicTeachingRefSchema,
  'review-occurrence': ReviewOccurrenceSchema, 'review-schedule': ReviewScheduleSchema, 'review-history': ReviewHistorySchema, 'ladder': LadderSchema,
  'proposal-input': ProposalInputSchema, 'proposal-record': ProposalRecordSchema, 'proposal-view': ProposalViewSchema,
  'proposal-edit': ProposalEditInputSchema, 'proposal-selection': ProposalSelectionSchema,
  'source-context': SourceContextSchema, 'source-fragment': SourceFragmentSchema, 'frozen-source': FrozenSourceSchema,
  'learning-search-input': LearningSearchInputSchema, 'learning-search-result': LearningSearchResultSchema,
  'set-record': SetRecordSchema, 'set-create': SetCreateSchema, 'set-patch': SetPatchSchema, 'set-view': SetViewSchema,
  'route-record': RouteRecordSchema, 'route-node-input': RouteNodeInputSchema, 'route-node-patch': RouteNodePatchSchema,
  'route-placement': RoutePlacementSchema, 'route-view': RouteViewSchema,
  'plan-content': PlanContentSchema, 'plan-patch': PlanPatchSchema, 'plan-view': PlanViewSchema, 'skeleton-change': SkeletonChangeSchema,
  'book-structure': BookStructureSchema, 'book-breakdown-intent': BookBreakdownIntentSchema,
  'date-query': DateQuerySchema, 'calendar-day': CalendarDaySchema, 'roadmap-date-filter': RoadmapDateFilterSchema,
  'roadmap-filter-result': RoadmapFilterResultSchema, 'daily-report-settings': DailyReportSettingsSchema, 'daily-report': DailyReportSchema,
  'teaching-choice': TeachingChoiceSchema, 'teaching-manifest': TeachingManifestSchema,
  'memory-record': MemoryRecordSchema, 'memory-view': MemoryViewSchema, 'memory-edit': MemoryEditInputSchema,
  'memory-search-input': MemorySearchInputSchema, 'memory-search-result': MemorySearchResultSchema, 'memory-basis': MemoryBasisViewSchema,
  'handoff-record': HandoffRecordSchema, 'handoff-view': HandoffViewSchema, 'handoff-close-input': HandoffCloseInputSchema, 'handoff-close-result': HandoffCloseResultSchema,
} as const;
/** JSON structural rules and TS come from Zod; cross-field refinements run at the Host boundary. */
export const CONTRACT_JSON_SCHEMAS = Object.fromEntries(Object.entries(CONTRACT_SCHEMAS)
  .map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })]));
