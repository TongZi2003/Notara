import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { HostContext } from '@studyforge/contracts';
import type { RecordStore } from '@studyforge/domain/storage';
import { SeminarStartSchema, type SeminarRecordSchema, type SeminarView, type SeminarRole } from '@studyforge/contracts/plugin-learning';
import { z } from 'zod';
const roles: Record<SeminarRole, { title: string; persona: string }> = {
  peer: { title: '同伴', persona: '你是独立同伴，只阅读给定的讨论材料。指出你能否跟上这段解释，具体说明卡住的连接，不猜学生能力，不代替老师评分。先给一条最值得讨论的问题。' },
  critic: { title: '质疑者', persona: '你是独立质疑者，只依据给定材料检验前提、反例与边界。区分证据不足、推理错误和价值分歧，不为反对而反对。不要编造来源，不读取学生学情。' },
  assistant: { title: '助教', persona: '你是独立助教，仅依据给定材料和参考标准给出核对结果；无证据处说不确定。不读取学生学情，不自行发明标准。' },
};
declare module '@deepseek-ai/cordis' { interface Context { notaraSeminar: Seminar } }
export class Seminar {
  readonly host: Context; readonly records: RecordStore<typeof SeminarRecordSchema>; private tail = Promise.resolve();
  constructor(host: Context, records: RecordStore<typeof SeminarRecordSchema>) { this.host = host; this.records = records;
    host.effect(() => host.studyforgePluginsManager.subscribe(() => { void this.stopDisabled().catch(() => {}); }));
  }
  private row(context: HostContext, id: string, ref: string) { const row = this.records.read(context, ref); if (row.data.sessionId !== context.sessionId || row.data.id !== id) throw new Error('seminar_owner_mismatch'); return row; }
  async list(context: HostContext, id: string): Promise<SeminarView[]> {
    await this.host.studyforgeLearningWorkbenches.authorize(context.sessionId!, id, 'seminar');
    const catalog = await this.host.subagents.remoteExportList(SessionId(context.sessionId!), AbortSignal.timeout(10000));
    const rows = this.records.list(context).filter(row => row.data.sessionId === context.sessionId && row.data.id === id).slice(-12).reverse();
    return Promise.all(rows.map(async row => {
      const participants = await Promise.all(row.data.participants.map(async p => {
        if (!p.childId) return p;
        const state = catalog.entries.find(c => String(c.id) === p.childId);
        try {
          const observation = await this.host.sessionQuery.observeSession(SessionId(p.childId));
          try {
            const events = observation.events, end = events.findLast(e => e.type === 'turn/end'), start = events.findLast(e => e.type === 'turn/start');
            const output = events.filter(e => e.type === 'assistant/message').flatMap(e => e.data.message.content.filter(b => b.type === 'text').map(b => b.text)).join('\n\n').slice(-40000);
            const live = this.host.agents.get(SessionId(p.childId));
            const running = state?.kind === 'child' && state.activity === 'running' || live?.status === 'running';
            const inbox: Record<'next-turn'|'next-step', number[]> = {'next-turn':[], 'next-step':[]};
            for (const e of events) if (e.type === 'agent/inbox/spliced') { const queue = inbox[e.data.target]; queue.splice(e.data.start, e.data.removedCount ?? queue.length - e.data.start, ...e.data.inserted.map(() => 1)); }
            const pending = inbox['next-turn'].length + inbox['next-step'].length;
            const reason = end && (!start || end.seq > start.seq) ? end.data.reason.kind : undefined;
            return { ...p, text: output, state: running ? 'running' as const : pending > 0 || !start && !!live ? 'queued' as const : reason === 'completed' ? 'completed' as const : reason === 'aborted' ? 'canceled' as const : !reason || reason === 'interrupted' ? 'interrupted' as const : 'failed' as const };
          } finally { observation[Symbol.dispose](); }
        } catch { return { ...p, state: 'interrupted' as const, text: '这位帮手的记录暂时不可读，可稍后刷新。' }; }
      }));
      return { ref: row.ref, revision: row.version, topic: row.data.topic, participants };
    }));
  }
  start(context: HostContext, id: string, input: z.infer<typeof SeminarStartSchema>): Promise<SeminarView[]> {
    const job = this.tail.then(async () => {
      const content = await this.host.studyforgeLearningWorkbenches.authorize(context.sessionId!, id, 'seminar');
      const data = SeminarStartSchema.parse(input); if ((await this.list(context, id)).some(r => r.participants.some(p => p.state === 'running' || p.state === 'queued'))) throw new Error('seminar_busy');
      const parent = await this.host.sessionController.resolveAgent(SessionId(context.sessionId!)); if ('error' in parent) throw new Error('seminar_parent_unavailable');
      let row = await this.records.create({ ...context, operationId: randomUUID() }, randomUUID(), { sessionId: context.sessionId!, id, digest: content.digest, topic: data.topic, materials: data.materials, standard: data.standard, participants: data.roles.map(role => ({ role, state: 'queued', text: '' })) });
      // Native continuations own queues, execution, cancellation and restoration.
      // The record only binds the selected roles to their real child sessions.
      for (let index = 0; index < data.roles.length; index++) {
        const role = data.roles[index]!, spec = roles[role]; let childId: string | undefined;
        try {
          const started = await this.host.subagents.startContinuable({ provider: 'spawn', label: spec.title, request: { parent: parent.agent, persona: spec.persona, toolFilter: { allow: [] }, maxDepth: 1,
            prompt: [{ type: 'text', text: `讨论主题：${data.topic}\n用户提供的材料：\n${data.materials}\n${role === 'assistant' ? '参考标准：\n' + data.standard : ''}\n只返回你本人的意见，不模拟其他发言者。` }] }, signal: AbortSignal.timeout(30000) });
          childId = String(started.childId);
          const next = { ...row.data, participants: row.data.participants.map((p, i) => i === index ? { ...p, childId, state: 'running' as const } : p) };
          row = await this.records.update({ ...context, operationId: randomUUID(), expectedVersion: row.version }, row.ref, next, () => next);
        } catch {
          if (childId) try { this.host.subagents.interrupt(SessionId(childId), { kind: 'user', parentSessionId: SessionId(context.sessionId!) }); } catch { /* Keep the child binding available for a later stop. */ }
          const next = { ...row.data, participants: row.data.participants.map((p, i) => i === index ? { ...p, ...(childId ? {childId} : {}), state: 'failed' as const, text: '未能开始，请核对课堂模型连接后重新讨论。' } : p) };
          row = await this.records.update({ ...context, operationId: randomUUID(), expectedVersion: row.version }, row.ref, next, () => next);
        }
      }
      return this.list(context, id);
    }); this.tail = job.then(() => {}, () => {}); return job;
  }
  async follow(context: HostContext, id: string, ref: string, role: SeminarRole, text: string, operationId: string): Promise<void> {
    await this.host.studyforgeLearningWorkbenches.authorize(context.sessionId!, id, 'seminar');
    const child = this.row(context, id, ref).data.participants.find(p => p.role === role)?.childId; if (!child) throw new Error('seminar_child_missing');
    const parent = await this.host.sessionController.resolveAgent(SessionId(context.sessionId!)); if ('error' in parent) throw new Error('seminar_parent_unavailable');
    await this.host.subagents.prompt({ requestId: operationId as never, parentSessionId: SessionId(context.sessionId!), childSessionId: SessionId(child), mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text }] }, AbortSignal.timeout(30000));
  }
  async stop(context: HostContext, id: string, ref: string): Promise<void> {
    const row = this.row(context, id, ref);
    const results = await Promise.allSettled(row.data.participants.filter(p => p.childId).map(async p => this.host.subagents.interrupt(SessionId(p.childId!), { kind: 'user', parentSessionId: SessionId(context.sessionId!) })));
    if (results.some(result => result.status === 'rejected')) throw new Error('seminar_stop_incomplete');
  }
  private async stopDisabled(): Promise<void> {
    const context = this.host.studyforgePluginsManager.context();
    for (const row of this.records.list(context)) if (!this.host.studyforgePluginsManager.workbenches(row.data.sessionId).some(w => w.id === row.data.id)) await this.stop({ ...context, sessionId: row.data.sessionId }, row.data.id, row.ref);
  }
}
