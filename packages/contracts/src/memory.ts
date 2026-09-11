import { z } from 'zod';
import { RecordScopeSchema } from './core.ts';
import { AdoptedBasisSchema } from './evidence.ts';

export const DEFAULT_MEMORY_KINDS = ['ability', 'habit', 'preference'] as const;
export const LearnerMemoryKindSchema = z.string().trim().min(1);
export type LearnerMemoryKind = z.infer<typeof LearnerMemoryKindSchema>;
/** Classification grants no permission or automatic certification. */
export const MemoryContentSchema = z.object({
  kind: LearnerMemoryKindSchema, title: z.string().min(1).optional(),
  scope: RecordScopeSchema.optional(), body: z.string().min(1),
}).strict();
export type MemoryContent = z.infer<typeof MemoryContentSchema>;
/** Model chooses supplied E aliases; the Host resolves identities, times and quotes. */
export const MemoryDraftSchema = MemoryContentSchema.extend({
  evidenceRefs: z.array(z.string().min(1)).min(1).describe('本轮依据目录中的真实E引用，不能捏造原话'),
});
export type MemoryDraft = z.infer<typeof MemoryDraftSchema>;
/** Bound content saved by the Host, after resolution of the selected E aliases. */
export const MemoryObservationSchema = MemoryContentSchema.extend({ basis: AdoptedBasisSchema.min(1) });
export type MemoryObservation = z.infer<typeof MemoryObservationSchema>;
