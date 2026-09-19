import { z } from 'zod';
import { SourceAnchorSchema } from './materials.ts';

const Title = z.string().trim().min(1).max(160), Text = z.string().max(8000);

/** One helper the round binds to a real native child. */
export const RoundRoleSchema = z.enum(['problem', 'peer', 'assistant']);
export type RoundRole = z.infer<typeof RoundRoleSchema>;

/** A material excerpt the teacher quotes into the round — the only evidence
 * peer and assistant may read, in the same shape the delegation tasks take. */
export const RoundMaterialSchema = z.object({
  title: z.string().trim().min(1).describe('材料标题或书名'),
  text: z.string().min(1).describe('材料原文片段，逐字引用'),
}).strict();
export type RoundMaterial = z.infer<typeof RoundMaterialSchema>;

export const RoundStageSchema = z.enum(['writing', 'answering', 'awaiting_correction', 'completed', 'failed', 'stopped']);
export type RoundStage = z.infer<typeof RoundStageSchema>;

export const RoundActorSchema = z.object({
  role: RoundRoleSchema,
  state: z.enum(['queued', 'running', 'completed', 'failed', 'stopped']),
  childId: z.string().optional(),
  /** The helper's own words, verbatim — never the teacher's paraphrase. */
  text: z.string().max(40000),
  /** Why a failed or stopped actor ended that way; honest, never empty praise. */
  detail: z.string().max(2000).optional(),
}).strict();
export type RoundActor = z.infer<typeof RoundActorSchema>;

/**
 * One multi-role teaching round, persisted: a question written by the problem
 * helper, the student's own answer turn, a peer review that never sees the
 * reference standard, then an assistant correction that does. The record holds
 * the standard — the student-facing view never returns it.
 */
export const TeachingRoundRecordSchema = z.object({
  sessionId: z.string(),
  topic: Title,
  materials: z.array(RoundMaterialSchema).min(1).max(8),
  standard: Text,
  stage: RoundStageSchema,
  cardRef: z.string().optional(),
  questionTitle: z.string().optional(),
  questionFront: z.string().optional(),
  answer: z.string().max(8000).optional(),
  actors: z.array(RoundActorSchema).length(3),
}).strict();
export type TeachingRoundRecord = z.infer<typeof TeachingRoundRecordSchema>;

export const RoundActorViewSchema = RoundActorSchema.omit({ childId: true, detail: true }).strict();
export type RoundActorView = z.infer<typeof RoundActorViewSchema>;

/** What a caller may see: the round without its standard and child ids. */
export const TeachingRoundViewSchema = z.object({
  ref: z.string().min(1),
  revision: z.number().int().nonnegative(),
  topic: z.string(),
  stage: RoundStageSchema,
  cardRef: z.string().optional(),
  questionTitle: z.string().optional(),
  questionFront: z.string().optional(),
  answer: z.string().optional(),
  materialTitles: z.array(z.string()),
  actors: z.array(RoundActorViewSchema).length(3),
}).strict();
export type TeachingRoundView = z.infer<typeof TeachingRoundViewSchema>;
export const TeachingRoundListSchema = z.array(TeachingRoundViewSchema);

/** Open a round: the question target plus the evidence the helpers may read. */
export const RoundOpenInputSchema = z.object({
  topic: Title.describe('这一轮要练什么，也是题面写作目标'),
  materials: z.array(RoundMaterialSchema).min(1).max(8).describe('同伴与助教只能依据的材料原文片段，逐字引用'),
  standard: Text.refine(text => text.trim().length > 0, 'standard_required').describe('勘误用的参考标准或参考解；没有标准就不开回合'),
  constraints: z.string().trim().min(1).optional().describe('题目约束，例如难度要求'),
  sources: z.array(SourceAnchorSchema).max(8).default([]).describe('题目真实依据的材料位置，登记时原样挂卡'),
}).strict();
export type RoundOpenInput = z.infer<typeof RoundOpenInputSchema>;

export const RoundAnswerInputSchema = z.object({ ref: z.string().min(1), text: z.string().trim().min(1).max(8000) }).strict();
export const RoundRefInputSchema = z.object({ ref: z.string().min(1) }).strict();
