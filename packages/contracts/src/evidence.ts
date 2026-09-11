import { z } from 'zod';
import { EntityRefSchema, SessionIdSchema, TimestampSchema, VersionTokenSchema } from './core.ts';

/** Adopted native provenance only. Query results are not an additional input ledger. */
export const EvidenceRefSchema = z.object({
  sessionId: SessionIdSchema,
  messageId: z.string().min(1),
  occurredAt: TimestampSchema,
  source: z.enum(['student_statement', 'classroom_evidence']),
  quote: z.string().min(1),
  object: z.object({ ref: EntityRefSchema, version: VersionTokenSchema }).strict().optional(),
}).strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export const AdoptedBasisSchema = z.array(EvidenceRefSchema);
export type AdoptedBasis = z.infer<typeof AdoptedBasisSchema>;
