import { z } from 'zod';
import { ActorSchema, EntityRefSchema, RevisionSchema, SessionIdSchema, TimestampSchema, VersionTokenSchema, WorkspaceIdSchema } from './core.ts';

export const PurposeSchema = z.enum(['learning', 'creation']);
export type Purpose = z.infer<typeof PurposeSchema>;
/** Only trusted Host entry points construct this context. Never a model argument. */
export const HostContextSchema = z.object({
  workspaceId: WorkspaceIdSchema, sessionId: SessionIdSchema.optional(),
  actor: ActorSchema, purpose: PurposeSchema,
}).strict();
export type HostContext = z.infer<typeof HostContextSchema>;
export const MutationContextSchema = HostContextSchema.extend({
  operationId: z.string().min(1), expectedVersion: VersionTokenSchema.optional(),
});
export type MutationContext = z.infer<typeof MutationContextSchema>;
export function publicResultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), code: z.string().min(1), studentMessage: z.string().min(1), retryable: z.boolean() }).strict(),
  ]);
}
export type PublicResult<T> = { ok: true; value: T } | { ok: false; code: string; studentMessage: string; retryable: boolean };
export const ObjectChangeSchema = z.object({
  operationId: z.string().min(1), target: EntityRefSchema, sessionId: SessionIdSchema.optional(),
  actor: ActorSchema, beforeRevision: RevisionSchema.nullable(), afterRevision: RevisionSchema,
  changedFields: z.array(z.string().min(1)), committedAt: TimestampSchema,
}).strict();
export type ObjectChange = z.infer<typeof ObjectChangeSchema>;
