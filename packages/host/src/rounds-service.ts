import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { studentContext } from './learning-service.ts';
import {
  RoundAnswerInputSchema, RoundRefInputSchema, type TeachingRoundView,
} from '@studyforge/contracts/teaching-rounds';

const Session = z.object({ sessionId: z.string().min(1) }).strict();
const RoundSignal = (): AbortSignal => AbortSignal.timeout(180_000);
const mutation = (context: Awaited<ReturnType<typeof studentContext>>, tag: string) =>
  ({ ...context, operationId: `round:${tag}:${randomUUID()}` });

/**
 * The student-side round surface: the panel lists the lesson's rounds, sends
 * the student's own answer, asks for the correction and stops a live round.
 * Opening a round stays a teacher verb (`round_open`) — the panel never
 * fabricates a question of its own. Every stage runs against the same
 * persisted record the teacher verbs write, so either side sees the other's
 * effect immediately.
 */
export class StudyForgeRounds extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeRounds'); }

  @Remote('list')
  async list(input: { sessionId: string }): Promise<TeachingRoundView[]> {
    const data = Session.parse(input);
    const context = await studentContext(this.ctx, data.sessionId);
    return this.ctx.notaraRounds.list(context);
  }

  @Remote('read')
  async read(input: { sessionId: string; ref: string }): Promise<TeachingRoundView> {
    const data = Session.extend(RoundRefInputSchema.shape).parse(input);
    const context = await studentContext(this.ctx, data.sessionId);
    return this.ctx.notaraRounds.read(context, data.ref);
  }

  @Remote('answer')
  async answer(input: { sessionId: string; ref: string; text: string }): Promise<TeachingRoundView> {
    const data = Session.extend(RoundAnswerInputSchema.shape).parse(input);
    const context = await studentContext(this.ctx, data.sessionId);
    return this.ctx.notaraRounds.answer(mutation(context, 'answer'), data.ref, data.text, RoundSignal());
  }

  @Remote('correct')
  async correct(input: { sessionId: string; ref: string }): Promise<TeachingRoundView> {
    const data = Session.extend(RoundRefInputSchema.shape).parse(input);
    const context = await studentContext(this.ctx, data.sessionId);
    return this.ctx.notaraRounds.correct(mutation(context, 'correct'), data.ref, RoundSignal());
  }

  @Remote('stop')
  async stop(input: { sessionId: string; ref: string }): Promise<TeachingRoundView> {
    const data = Session.extend(RoundRefInputSchema.shape).parse(input);
    const context = await studentContext(this.ctx, data.sessionId);
    return this.ctx.notaraRounds.stop(mutation(context, 'stop'), data.ref);
  }
}
