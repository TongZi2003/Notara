import { z } from 'zod';
import { MaterialContextSchema } from './materials.ts';
export const ThoughtNodeSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1).max(160), body: z.string().max(20000),
  kind: z.enum(['question', 'answer', 'idea', 'conclusion', 'result']),
  sequence: z.number().int().nonnegative().optional(), turn: z.number().int().nonnegative().optional(),
  sources: z.array(MaterialContextSchema).default([]),
  targets: z.array(z.object({ ref: z.string(), version: z.number().int().positive().optional(), title: z.string() })).default([]),
  position: z.object({ x: z.number().min(0).max(50000), y: z.number().min(0).max(50000) }).optional(),
  stageBasis: z.string().optional(),
}).strict();
export type ThoughtNode = z.infer<typeof ThoughtNodeSchema>;
export const ThoughtEdgeSchema = z.object({ from: z.string(), to: z.string(), label: z.string().trim().min(1).max(80) }).strict();
export const ThoughtGraphSchema = z.object({ sessionId: z.string(), nodes: z.array(ThoughtNodeSchema).max(2000), edges: z.array(ThoughtEdgeSchema).max(5000), hidden: z.array(z.string()).default([]) }).strict();
export type ThoughtGraph = z.infer<typeof ThoughtGraphSchema>;
export interface ThoughtStage extends ThoughtNode {
  stage: { fromSequence?: number; toSequence?: number; operations: string[]; pending: boolean; basis: string; summary: 'notes' | 'edited'; messageCount: number };
}
export interface ClassroomTrace { version: number; sessionId: string; nodes: ThoughtNode[]; stages: ThoughtStage[]; edges: z.infer<typeof ThoughtEdgeSchema>[]; parent?: string; branches: { sessionId: string; title: string; parent?: string }[] }
