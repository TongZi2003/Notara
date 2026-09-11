export type { ProbeReply, ProbeService } from './probe.ts';
export * from './core.ts';
export * from './execution.ts';
export * from './materials.ts';
export { LessonMaterialsSchema } from './lesson-materials.ts';
export type { LessonMaterials } from './lesson-materials.ts';
export * from './cards.ts';
export * from './knowledge.ts';
export * from './memory.ts';
export * from './evidence.ts';

import { z } from 'zod';
import { CardContentSchema } from './cards.ts';
import { KnowledgeContentSchema } from './knowledge.ts';
import { MemoryContentSchema, MemoryDraftSchema, MemoryObservationSchema } from './memory.ts';
import { HostContextSchema, MutationContextSchema, ObjectChangeSchema } from './execution.ts';
import { SourceLocatorSchema, SourceAnchorSchema, NormalizedRectSchema, MessageEnvelopeSchema } from './materials.ts';
import { LessonMaterialsSchema } from './lesson-materials.ts';

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
} as const;
/** JSON structural rules and TS come from Zod; cross-field refinements run at the Host boundary. */
export const CONTRACT_JSON_SCHEMAS = Object.fromEntries(Object.entries(CONTRACT_SCHEMAS)
  .map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })]));
