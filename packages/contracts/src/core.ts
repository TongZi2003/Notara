import { z } from 'zod';
export type { SessionId } from '@deepseek-ai/dsh-session/types';

/** Opaque identities are resolved and authorized by the Host, never by schema alone. */
export const EntityRefSchema = z.string().trim().min(1);
export type EntityRef = z.infer<typeof EntityRefSchema>;
export const WorkspaceIdSchema = z.string().min(1);
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export const SessionIdSchema = z.string().min(1);
export const RevisionSchema = z.number().int().nonnegative();
export type Revision = z.infer<typeof RevisionSchema>;
export const DigestSchema = z.string().min(1);
export type Digest = z.infer<typeof DigestSchema>;
export const VersionTokenSchema = z.union([RevisionSchema, DigestSchema]);
export type VersionToken = z.infer<typeof VersionTokenSchema>;
export const ActorSchema = z.enum(['student', 'teacher', 'system']);
export type Actor = z.infer<typeof ActorSchema>;
export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;
/** Applicability, not account authorization. Omission means general. */
export const RecordScopeSchema = z.object({ subjects: z.array(z.string().trim().min(1)).optional() }).strict();
export type RecordScope = z.infer<typeof RecordScopeSchema>;
