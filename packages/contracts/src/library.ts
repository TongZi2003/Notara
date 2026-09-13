import { z } from 'zod';
export const LibraryRelationSchema = z.object({ from: z.string().min(1), to: z.string().min(1), label: z.string().trim().min(1).max(80) }).strict().refine(value => value.from !== value.to);
export interface LibraryRelation { ref: string; version: number; from: string; to: string; label: string }
