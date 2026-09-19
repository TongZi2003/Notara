/**
 * Multi-role teaching rounds: a persisted Host orchestration, not a prompt
 * trick. One round binds three real native children — the problem helper that
 * writes the question, the peer that reviews the student's own words without
 * ever seeing the standard, and the assistant that corrects against it. The
 * student answer is a real turn between stages, which is exactly why this is
 * a record with stages rather than a single delegated pipeline.
 *
 * What this module owns: the record's stage machine, the role briefs each
 * stage feeds into `TeachingDelegation`, and the view that strips the
 * standard and child identities before anything student-facing reads it.
 * Child lifecycle, tool allowlists and delivery stay with `ctx.subagents` and
 * `TeachingDelegation` — privacy is enforced by the role contracts there,
 * not by wording here.
 */
import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { HostContext, MutationContext } from '@studyforge/contracts';
import type { RecordStore, Saved } from '@studyforge/domain/storage';
import {
  RoundOpenInputSchema, type RoundActor, type RoundRole, type RoundStage,
  type TeachingRoundRecord, type TeachingRoundRecordSchema, type TeachingRoundView,
} from '@studyforge/contracts/teaching-rounds';
import { rejected } from '../tools/learning-context.ts';
import { assistantTask, peerTask, type TeachingDelegation } from './native-delegation.ts';

declare module '@deepseek-ai/cordis' { interface Context { notaraRounds: TeachingRounds } }

type Row = Saved<TeachingRoundRecord>;
type ActorPatch = Partial<Omit<RoundActor, 'role'>> & Pick<RoundActor, 'state'>;

/** The student-facing view: no standard, no child session identities. */
function viewOf(row: Row): TeachingRoundView {
  const data = row.data;
  return {
    ref: row.ref, revision: row.version, topic: data.topic, stage: data.stage,
    materialTitles: data.materials.map(material => material.title),
    actors: data.actors.map(({ childId: _childId, detail: _detail, ...actor }) => actor),
    ...(data.cardRef === undefined ? {} : { cardRef: data.cardRef }),
    ...(data.questionTitle === undefined ? {} : { questionTitle: data.questionTitle }),
    ...(data.questionFront === undefined ? {} : { questionFront: data.questionFront }),
    ...(data.answer === undefined ? {} : { answer: data.answer }),
  };
}

function setActor(actors: readonly RoundActor[], role: RoundRole, patch: ActorPatch): RoundActor[] {
  return actors.map(actor => actor.role === role ? { ...actor, ...patch } : actor);
}

export class TeachingRounds {
  readonly host: Context;
  readonly records: RecordStore<typeof TeachingRoundRecordSchema>;
  readonly delegation: TeachingDelegation;
  private tail = Promise.resolve();
  private readonly stopRequests = new Set<string>();
  constructor(host: Context, records: RecordStore<typeof TeachingRoundRecordSchema>, delegation: TeachingDelegation) {
    this.host = host; this.records = records; this.delegation = delegation;
  }

  private row(context: HostContext, ref: string): Row {
    const row = this.records.read(context, ref);
    if (row.data.sessionId !== context.sessionId) throw new Error('round_owner_mismatch');
    return row;
  }

  private async update(context: HostContext, row: Row, change: (data: TeachingRoundRecord) => TeachingRoundRecord): Promise<Row> {
    const next = change(row.data);
    return this.records.update({ ...context, operationId: randomUUID(), expectedVersion: row.version }, row.ref, next, () => next);
  }

  /** The session's own teacher agent is every round child's native parent. */
  private async parent(context: HostContext) {
    const parent = await this.host.sessionController.resolveAgent(SessionId(context.sessionId!));
    if ('error' in parent) throw new Error('round_parent_unavailable');
    return parent.agent;
  }

  list(context: HostContext): TeachingRoundView[] {
    return this.records.list(context)
      .filter(row => row.data.sessionId === context.sessionId)
      .slice(-12).reverse().map(viewOf);
  }

  read(context: HostContext, ref: string): TeachingRoundView {
    return viewOf(this.row(context, ref));
  }

  /**
   * Open a round: the problem helper drafts and the Host validates/registers
   * the question as a real unlearned card, then the stage opens for the
   * student's own answer. A failed write leaves the round honestly failed —
   * the question that never landed is never faked by the teacher.
   */
  open(context: MutationContext, input: unknown, signal: AbortSignal): Promise<TeachingRoundView> {
    const job = this.tail.then(async (): Promise<TeachingRoundView> => {
      const data = RoundOpenInputSchema.parse(input);
      let row = await this.records.create({ ...context, operationId: randomUUID() }, randomUUID(), {
        sessionId: context.sessionId!, topic: data.topic, materials: data.materials, standard: data.standard,
        stage: 'writing',
        actors: [
          { role: 'problem', state: 'running', text: '' },
          { role: 'peer', state: 'queued', text: '' },
          { role: 'assistant', state: 'queued', text: '' },
        ],
      });
      const parent = await this.parent(context);
      try {
        const outcome = await this.delegation.proposeProblems({
          parent, signal, context: { ...context, operationId: `${context.operationId}:round:${row.ref}` },
          target: data.topic, count: 1, sources: data.sources,
          onChildId: async childId => {
            row = await this.update(context, row, current => ({ ...current,
              actors: setActor(current.actors, 'problem', { state: 'running', childId }) }));
            if (this.stopRequests.has(row.ref)) await this.interrupt(context, childId);
          },
          ...(data.constraints === undefined ? {} : { constraints: data.constraints }),
        });
        const card = outcome.cards[0]!;
        row = await this.update(context, row, current => ({ ...current, stage: 'answering',
          cardRef: card.ref, questionTitle: card.title, questionFront: card.front,
          actors: setActor(current.actors, 'problem', { state: 'completed', childId: outcome.childId }) }));
      } catch {
        row = await this.update(context, row, current => ({ ...current, stage: this.stopRequests.has(row.ref) ? 'stopped' : 'failed',
          actors: current.actors.map(actor => actor.role === 'problem'
            ? { ...actor, state: this.stopRequests.has(row.ref) ? 'stopped' as const : 'failed' as const }
            : actor.state === 'queued' || actor.state === 'running' ? { ...actor, state: 'stopped' as const } : actor) }));
        if (this.stopRequests.has(row.ref)) throw rejected('这一轮已停止');
        throw rejected('这一轮的题目没有写出来，回合已记录为失败，请稍后重试');
      }
      return viewOf(row);
    });
    this.tail = job.then(() => {}, () => {});
    return job;
  }

  /**
   * The student's own answer is the turn the record was built around: it is
   * stored verbatim, then the peer reviews it against materials alone — the
   * standard never enters that child's task. A failed peer does not block the
   * correction stage; its actor row records the failed state without internals.
   */
  answer(context: MutationContext, ref: string, text: string, signal: AbortSignal): Promise<TeachingRoundView> {
    const job = this.tail.then(async (): Promise<TeachingRoundView> => {
      let row = this.row(context, ref);
      if (row.data.stage !== 'answering') throw rejected('这一轮不在作答阶段，不能重复提交答案');
      row = await this.update(context, row, current => ({ ...current, answer: text,
        actors: setActor(current.actors, 'peer', { state: 'running' }) }));
      const parent = await this.parent(context);
      try {
        const outcome = await this.delegation.run({ role: 'peer', parent, signal,
          onChildId: async childId => {
            row = await this.update(context, row, current => ({ ...current,
              actors: setActor(current.actors, 'peer', { state: 'running', childId }) }));
            if (this.stopRequests.has(row.ref)) await this.interrupt(context, childId);
          },
          task: peerTask({ materials: row.data.materials, explanation: text, question: row.data.questionFront ?? row.data.topic }) });
        row = await this.update(context, row, current => ({ ...current, stage: 'awaiting_correction',
          actors: setActor(current.actors, 'peer', { state: 'completed', childId: outcome.childId, text: outcome.output }) }));
      } catch {
        row = await this.update(context, row, current => ({ ...current, stage: this.stopRequests.has(row.ref) ? 'stopped' : 'awaiting_correction',
          actors: current.actors.map(actor => actor.role === 'peer'
            ? { ...actor, state: this.stopRequests.has(row.ref) ? 'stopped' as const : 'failed' as const }
            : this.stopRequests.has(row.ref) && (actor.state === 'queued' || actor.state === 'running')
              ? { ...actor, state: 'stopped' as const } : actor) }));
        if (this.stopRequests.has(row.ref)) return viewOf(row);
      }
      return viewOf(row);
    });
    this.tail = job.then(() => {}, () => {});
    return job;
  }

  /** The correction stage: assistant judges the student's answer against the
   * standard — the only actor that ever receives it. Failure stays retryable. */
  correct(context: MutationContext, ref: string, signal: AbortSignal): Promise<TeachingRoundView> {
    const job = this.tail.then(async (): Promise<TeachingRoundView> => {
      let row = this.row(context, ref);
      if (row.data.stage !== 'awaiting_correction') throw rejected('这一轮还没有可以勘误的作答');
      row = await this.update(context, row, current => ({ ...current,
        actors: setActor(current.actors, 'assistant', { state: 'running' }) }));
      const parent = await this.parent(context);
      const peerText = row.data.actors.find(actor => actor.role === 'peer' && actor.state === 'completed')?.text;
      const question = [
        '要勘误的学生作答原话：', row.data.answer ?? '',
        ...(peerText === undefined ? [] : ['', '同伴此前的评审原话：', peerText]),
      ].join('\n');
      try {
        const outcome = await this.delegation.run({ role: 'assistant', parent, signal,
          onChildId: async childId => {
            row = await this.update(context, row, current => ({ ...current,
              actors: setActor(current.actors, 'assistant', { state: 'running', childId }) }));
            if (this.stopRequests.has(row.ref)) await this.interrupt(context, childId);
          },
          task: assistantTask({ materials: row.data.materials, standard: row.data.standard, question }) });
        row = await this.update(context, row, current => ({ ...current, stage: 'completed',
          actors: setActor(current.actors, 'assistant', { state: 'completed', childId: outcome.childId, text: outcome.output }) }));
      } catch {
        row = await this.update(context, row, current => ({ ...current, stage: this.stopRequests.has(row.ref) ? 'stopped' : current.stage,
          actors: current.actors.map(actor => actor.role === 'assistant'
            ? { ...actor, state: this.stopRequests.has(row.ref) ? 'stopped' as const : 'failed' as const }
            : this.stopRequests.has(row.ref) && (actor.state === 'queued' || actor.state === 'running')
              ? { ...actor, state: 'stopped' as const } : actor) }));
      }
      return viewOf(row);
    });
    this.tail = job.then(() => {}, () => {});
    return job;
  }

  /** Stop an active round: running children are interrupted, queued actors are
   * marked stopped, and the record says so — a stopped round is a fact, not a
   * silent disappearance. */
  async stop(context: MutationContext, ref: string): Promise<TeachingRoundView> {
    const row = this.row(context, ref);
    if (row.data.stage === 'completed' || row.data.stage === 'failed' || row.data.stage === 'stopped') return viewOf(row);
    this.stopRequests.add(ref);
    const running = row.data.actors.filter(actor => (actor.state === 'running' || actor.state === 'queued') && actor.childId !== undefined);
    const results = await Promise.allSettled(running.map(actor => this.interrupt(context, actor.childId!)));
    if (results.some(result => result.status === 'rejected')) { this.stopRequests.delete(ref); throw rejected('有帮手未能停止，回合没有完整收止'); }
    const job = this.tail.then(async () => {
      const latest = this.row(context, ref);
      if (latest.data.stage === 'completed' || latest.data.stage === 'failed' || latest.data.stage === 'stopped') return viewOf(latest);
      const next = await this.update(context, latest, current => ({ ...current, stage: 'stopped',
        actors: current.actors.map(actor => actor.state === 'running' || actor.state === 'queued' ? { ...actor, state: 'stopped' as const } : actor) }));
      return viewOf(next);
    }).finally(() => { this.stopRequests.delete(ref); });
    this.tail = job.then(() => {}, () => {});
    return job;
  }

  private async interrupt(context: HostContext, childId: string): Promise<void> {
    await this.host.subagents.interrupt(SessionId(childId), { kind: 'user', parentSessionId: SessionId(context.sessionId!) });
  }
}

export type { RoundStage };
