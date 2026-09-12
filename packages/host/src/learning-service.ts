import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { EntityRefSchema, type HostContext } from '@studyforge/contracts';
import type { ObjectChange } from '@studyforge/contracts/execution';
import { CardContentSchema, CardPatchSchema, CardViewSchema, type CardContent, type CardPatch, type CardView, type CardRecordSchema } from '@studyforge/contracts/cards';
import { KnowledgeNoteSchema, KnowledgePatchSchema, KnowledgeViewSchema, type KnowledgeNote, type KnowledgePatch, type KnowledgeView, type KnowledgeRecordSchema } from '@studyforge/contracts/knowledge';
import { ReviewMarkSchema, type ReviewMark } from '@studyforge/contracts/reviews';
import type { CardService } from '@studyforge/domain/cards';
import type { KnowledgeService } from '@studyforge/domain/knowledge';
import type { RecordStore } from '@studyforge/domain/storage';
import type { Clock } from '@studyforge/domain/clock';
import { type ReviewService, type ReviewResult } from '@studyforge/domain/review';
import { learningRecords, type LearningRecord } from '@studyforge/domain/learning-records';
import { cardChanges } from '@studyforge/domain/card-changes';
import type { CardChangeView } from '@studyforge/contracts/changes';

declare module '@deepseek-ai/cordis' {
  interface Context {
    studyforgeLearning: StudyForgeLearning;
    studyforgeCardService: CardService;
    studyforgeKnowledgeService: KnowledgeService;
    studyforgeReviewService: ReviewService;
    studyforgeCardRecords: RecordStore<typeof CardRecordSchema>;
    studyforgeKnowledgeRecords: RecordStore<typeof KnowledgeRecordSchema>;
    studyforgeClock: Clock;
  }
}
const ReadSchema = z.object({ target: EntityRefSchema, version: z.number().int().positive().optional() }).strict();
const WriteSchema = z.object({ operationId: z.string().min(1), sessionId: z.string().min(1).optional() }).strict();

/** Resolve the explicit initiating lesson; workspace-only edits never borrow a recent lesson. */
export async function studentContext(host: Context, sessionId?: string): Promise<HostContext> {
  if (!sessionId) return { workspaceId: host.studyforgeAccess.workspaceId, purpose: 'learning', actor: 'student' };
  const binding = await host.studyforgeAccess.forSession(sessionId);
  if (binding.purpose !== 'learning') throw new Error('learning_session_required');
  return { workspaceId: binding.workspaceId, sessionId: binding.sessionId, purpose: binding.purpose, actor: 'student' };
}

export class StudyForgeLearning extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeLearning'); }
  @Remote('cards')
  async cards(): Promise<CardView[]> {
    const ctx = await studentContext(this.ctx);
    return this.ctx.studyforgeCardRecords.list(ctx).map(row => CardViewSchema.parse({ ref: row.ref, version: row.version, ...row.data }));
  }
  @Remote('knowledge')
  async knowledge(): Promise<KnowledgeView[]> {
    const ctx = await studentContext(this.ctx);
    return this.ctx.studyforgeKnowledgeRecords.list(ctx).map(row => KnowledgeViewSchema.parse({ ref: row.ref, version: row.version, ...row.data }));
  }
  @Remote('card')
  async card(input: { target: string; version?: number }): Promise<CardView> {
    const parsed = ReadSchema.parse(input);
    return this.ctx.studyforgeCardService.read(await studentContext(this.ctx), parsed.target, parsed.version);
  }
  @Remote('method')
  async method(input: { target: string; version?: number }): Promise<KnowledgeView> {
    const parsed = ReadSchema.parse(input);
    return this.ctx.studyforgeKnowledgeService.read(await studentContext(this.ctx), parsed.target, parsed.version);
  }
  @Remote('createCard')
  async createCard(input: { operationId: string; sessionId?: string; content: CardContent }): Promise<CardView> {
    const parsed = WriteSchema.extend({ content: CardContentSchema }).parse(input);
    return this.ctx.studyforgeCardService.create({ ...await studentContext(this.ctx, parsed.sessionId), operationId: parsed.operationId }, parsed.content);
  }
  @Remote('editCard')
  async editCard(input: { operationId: string; sessionId?: string; target: string; expectedVersion: number; patch: CardPatch }): Promise<CardView> {
    const parsed = WriteSchema.extend({ target: EntityRefSchema, expectedVersion: z.number().int().positive(), patch: CardPatchSchema }).parse(input);
    return this.ctx.studyforgeCardService.edit({ ...await studentContext(this.ctx, parsed.sessionId), operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.target, parsed.patch);
  }
  @Remote('previewCard')
  async previewCard(input: { target: string; expectedVersion: number; patch: CardPatch }): Promise<CardContent> {
    const parsed = z.object({ target: EntityRefSchema, expectedVersion: z.number().int().positive(), patch: CardPatchSchema }).strict().parse(input);
    return this.ctx.studyforgeCardService.preview(await studentContext(this.ctx), parsed.target, parsed.expectedVersion, parsed.patch);
  }
  @Remote('noteMethod')
  async noteMethod(input: { operationId: string; sessionId?: string; content: KnowledgeNote }): Promise<KnowledgeView> {
    const parsed = WriteSchema.extend({ content: KnowledgeNoteSchema }).parse(input);
    return this.ctx.studyforgeKnowledgeService.note({ ...await studentContext(this.ctx, parsed.sessionId), operationId: parsed.operationId }, parsed.content);
  }
  @Remote('reviseMethod')
  async reviseMethod(input: { operationId: string; sessionId?: string; target: string; expectedVersion: number; patch: KnowledgePatch }): Promise<KnowledgeView> {
    const parsed = WriteSchema.extend({ target: EntityRefSchema, expectedVersion: z.number().int().positive(), patch: KnowledgePatchSchema }).parse(input);
    return this.ctx.studyforgeKnowledgeService.revise({ ...await studentContext(this.ctx, parsed.sessionId), operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.target, parsed.patch);
  }
  @Remote('deleteMethod')
  async deleteMethod(input: { operationId: string; target: string; expectedVersion: number }): Promise<{ deleted: true }> {
    const parsed = z.object({ operationId: z.string().min(1), target: EntityRefSchema, expectedVersion: z.number().int().positive() }).strict().parse(input);
    await this.ctx.studyforgeKnowledgeService.remove({ ...await studentContext(this.ctx), operationId: parsed.operationId, expectedVersion: parsed.expectedVersion }, parsed.target);
    return { deleted: true };
  }
  @Remote('review')
  async review(input: { operationId: string; target: string; mark: ReviewMark; note?: string }): Promise<ReviewResult> {
    const parsed = z.object({ operationId: z.string().min(1), target: EntityRefSchema, mark: ReviewMarkSchema, note: z.string().default('') }).strict().parse(input);
    const ctx = await studentContext(this.ctx), service = this.ctx.studyforgeReviewService;
    const card = this.ctx.studyforgeCardService.read(ctx, parsed.target), id = 'student:' + parsed.operationId;
    const occurrence = card.history.find(row => row.occurrence.id === id)?.occurrence ?? service.freeze(ctx, parsed.target, {
      id, occurredAt: this.ctx.studyforgeClock.now(), timeZone: this.ctx.studyforgeClock.timeZone, order: null,
    });
    return service.record({ ...ctx, operationId: parsed.operationId }, parsed.target, { occurrence, mark: parsed.mark, channel: '课外', note: parsed.note, basis: [] });
  }
  @Remote('records')
  async records(): Promise<LearningRecord[]> { return learningRecords(await this.cards()); }
  @Remote('changes')
  async changes(input: { target: string; sessionId?: string }): Promise<ObjectChange[]> {
    const parsed = z.object({ target: EntityRefSchema, sessionId: z.string().optional() }).strict().parse(input);
    const ctx = await studentContext(this.ctx, parsed.sessionId);
    const store = parsed.target.startsWith('card:') ? this.ctx.studyforgeCardRecords : this.ctx.studyforgeKnowledgeRecords;
    return store.changes(ctx, parsed.target).filter(change => !parsed.sessionId || change.sessionId === parsed.sessionId);
  }
  @Remote('cardChanges')
  async cardChanges(input: { target: string; sessionId?: string; showBack?: boolean }): Promise<CardChangeView[]> {
    const parsed = z.object({ target: EntityRefSchema, sessionId: z.string().optional(), showBack: z.boolean().optional() }).strict().parse(input);
    const { target } = parsed;
    const options = { ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}), ...(parsed.showBack !== undefined ? { showBack: parsed.showBack } : {}) };
    return cardChanges(this.ctx.studyforgeCardRecords, await studentContext(this.ctx, parsed.sessionId), target, options);
  }
}
