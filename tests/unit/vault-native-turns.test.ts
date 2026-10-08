import { describe, expect, it } from 'vitest';
import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { captureNativeCut, readNativeEvents, waitForNativeTurn, type NativeTurnHost } from '../fixtures/vault-native-turns.ts';

const owner = 'synthetic-owner', requestId = 'synthetic-request';
const text = (value: string) => ({ type: 'text' as const, text: value });
function append(log: SessionWireEvent[], type: string, data: unknown, surfaceOp?: 'append'): SessionWireEvent {
  const event: SessionWireEvent = { type, seq: log.length, time: 1000 + log.length,
    data: JSON.parse(JSON.stringify(data)) as SessionWireEvent['data'], ...(surfaceOp ? { surfaceOp } : {}) };
  log.push(event); return event;
}
const human = (log: SessionWireEvent[], id: string, value = '合成学生原话') => append(log, 'user/message',
  createUserMessage({ source: { kind: 'user', rpcId: id }, content: [text(value)] }), 'append');
const model = (log: SessionWireEvent[], turn: number, step: number, value = '合成教师回复', interrupted = false) => append(log, 'assistant/message', {
  turn, step, stream: [], message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [text(value)] }),
  ...(interrupted ? { interrupted: true } : {}),
}, 'append');
const toolCall = (log: SessionWireEvent[], turn: number, step: number, id: string, name: string) => append(log, 'tool/call', {
  turn, step, callId: ToolCallId(id), name, arguments: JSON.stringify({ synthetic: name }),
});
const toolResult = (log: SessionWireEvent[], turn: number, step: number, id: string, value: string, failed = false) => append(log, 'tool/result', {
  turn, step, message: createToolResultMessage({ callId: ToolCallId(id), isError: failed, content: [text(value)] }),
}, 'append');
function start(log: SessionWireEvent[], turn: number) {
  const event = append(log, 'turn/start', { turn }); append(log, 'step/start', { turn, step: 1 }); return event;
}
function finish(log: SessionWireEvent[], turn: number, reason: Record<string, unknown> = { kind: 'completed' }) {
  append(log, 'step/end', { turn, step: 1 }); return append(log, 'turn/end', { turn, reason });
}
function turn(log: SessionWireEvent[], number: number, id: string, value = '合成教师回复') {
  start(log, number); const user = human(log, id); model(log, number, 1, value); finish(log, number); return user;
}

// Mirrors the SDK's message-aligned backwards cut; tests do not use model logs or Host.
function fixture(initial: SessionWireEvent[] = []) {
  const logs = new Map<string, SessionWireEvent[]>([[owner, initial]]);
  const pages: { sessionId: string; throughSeq: number; beforeSeq?: number; maxMessages: number }[] = [];
  const hooks = { projection: (_sessionId: string) => {}, page: () => {}, running: false, listed: true,
    transformPage: (page: unknown): unknown => page };
  const host: NativeTurnHost = {
    async rpc<T>(method: string, args: unknown): Promise<RemoteResult<T>> {
      const request = (args as { request: { sessionId?: string; address?: { sessionId: string }; throughSeq: number; beforeSeq?: number; maxMessages: number } }).request;
      let result: unknown;
      if (method === 'session/projections') {
        hooks.projection(request.sessionId!);
        const log = logs.get(request.sessionId!);
        result = log ? { asOfSeq: log.length - 1, values: {} } : null;
      } else if (method === 'session/page') {
        const sessionId = request.address!.sessionId, log = logs.get(sessionId)!;
        pages.push({ sessionId, throughSeq: request.throughSeq, maxMessages: request.maxMessages,
          ...(request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq }) });
        hooks.page();
        const end = Math.min(request.throughSeq + 1, request.beforeSeq ?? request.throughSeq + 1);
        let count = 0, cut = 0;
        for (let index = end - 1; index >= 0; index--) {
          const event = log[index]!;
          if (!['user/message', 'assistant/message'].includes(event.type) || event.surfaceOp !== 'append') continue;
          if (++count >= request.maxMessages) { cut = index; break; }
        }
        result = hooks.transformPage({ records: log.slice(cut, end).map(event => ({ type: 'event', event })), hasMore: cut > 0 });
      } else throw new Error(`Unexpected RPC ${method}`);
      return { ok: true, value: result as T };
    },
    value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; },
    async sessions() { return hooks.listed ? [...logs.keys()].map(sessionId => ({ sessionId, running: hooks.running })) : []; },
  };
  return { host, logs, log: initial, hooks, pages };
}

describe('native turn observer independent of synthetic provider request logs', () => {
  it('captures an exact cut and traverses more than 1000 events at that fixed cut despite later appends', async () => {
    const f = fixture();
    for (let index = 0; index < 1205; index++) human(f.log, `history-${index}`);
    const baseline = await captureNativeCut(f.host, owner);
    let appended = false;
    f.hooks.page = () => { if (!appended) { appended = true; human(f.log, 'late-append'); } };
    const events = await readNativeEvents(f.host, owner, baseline.asOfSeq, -1, { pageMessages: 31 });
    expect(events).toHaveLength(1205); expect(events.map(event => event.seq)).toEqual(Array.from({ length: 1205 }, (_, index) => index));
    expect(f.pages.length).toBeGreaterThan(30); expect(f.pages.every(page => page.throughSeq === baseline.asOfSeq && page.sessionId === owner)).toBe(true);
    expect(f.pages.slice(1).every((page, index) => page.beforeSeq! < (f.pages[index]!.beforeSeq ?? baseline.asOfSeq + 1))).toBe(true);
    expect((await readNativeEvents(f.host, owner, baseline.asOfSeq, 1199)).map(event => event.seq)).toEqual([1200, 1201, 1202, 1203, 1204]);
  });

  it('supports the empty -1 cut and rejects missing sessions, malformed pages, page gaps and hard budgets', async () => {
    const f = fixture(); expect(await captureNativeCut(f.host, owner)).toEqual({ sessionId: owner, asOfSeq: -1 });
    expect(await readNativeEvents(f.host, owner)).toEqual([]); expect(f.pages).toHaveLength(0);
    await expect(captureNativeCut(f.host, 'missing')).rejects.toMatchObject({ code: 'NATIVE_SESSION_NOT_FOUND' });
    for (let index = 0; index < 4; index++) human(f.log, `user-${index}`);
    await expect(readNativeEvents(f.host, owner, 3, -1, { pageMessages: 1, maxPages: 1 })).rejects.toMatchObject({ code: 'NATIVE_PAGE_BUDGET' });
    await expect(readNativeEvents(f.host, owner, 3, -1, { maxEvents: 2 })).rejects.toMatchObject({ code: 'NATIVE_EVENT_BUDGET' });
    f.hooks.transformPage = () => ({ records: [], hasMore: true });
    await expect(readNativeEvents(f.host, owner, 3)).rejects.toMatchObject({ code: 'NATIVE_INVALID_PAGE' });
    f.hooks.transformPage = () => ({ records: [{ type: 'event', event: f.log[2] }], hasMore: true });
    await expect(readNativeEvents(f.host, owner, 3)).rejects.toMatchObject({ code: 'NATIVE_PAGE_GAP' });
    await expect(readNativeEvents(f.host, owner, 2, 3)).rejects.toMatchObject({ code: 'NATIVE_INVALID_RANGE' });
  });

  it('selects the accepted rpcId after the baseline rather than old idle, compaction or other turns/sessions', async () => {
    const f = fixture(); turn(f.log, 1, requestId, '旧回合');
    const baseline = await captureNativeCut(f.host, owner);
    append(f.log, 'compaction/start', { id: 'synthetic-compaction' });
    const checkpoint = createUserMessage({ source: { kind: 'user' }, content: [text('旧摘要')] });
    append(f.log, 'user/message', { ...checkpoint,
      source: { kind: 'compact-checkpoint', compactionId: 'synthetic-compaction', rpcId: requestId } }, 'append');
    append(f.log, 'compaction/end', { id: 'synthetic-compaction' });
    turn(f.log, 2, 'other-request', '别的回合');
    const foreign: SessionWireEvent[] = []; turn(foreign, 1, requestId, '别的课堂'); f.logs.set('foreign', foreign);
    let polls = 0;
    f.hooks.projection = () => { if (++polls === 3) turn(f.log, 3, requestId, '当前教师答复'); };
    const result = await waitForNativeTurn(f.host, owner, baseline, { requestId, pollMs: 1, timeoutMs: 1000, pageMessages: 1 });
    expect(polls).toBe(3); expect(result).toMatchObject({ requestId, turn: 3, status: 'completed', reason: { kind: 'completed' }, assistantText: '当前教师答复' });
    expect(result.userSeq).toBeGreaterThan(baseline.asOfSeq); expect(result.events[0]?.type).toBe('turn/start'); expect(result.events.at(-1)?.type).toBe('turn/end');
    expect(f.pages.every(page => page.sessionId === owner)).toBe(true);
  });

  it('returns the exact terminal even if another queued turn has already made the session running again', async () => {
    const f = fixture(), baseline = await captureNativeCut(f.host, owner);
    turn(f.log, 1, requestId, '目标回合完成'); start(f.log, 2); human(f.log, 'next-request'); f.hooks.running = true;
    const result = await waitForNativeTurn(f.host, owner, baseline, { requestId, timeoutMs: 1000 });
    expect(result.turn).toBe(1); expect(result.status).toBe('completed'); expect(result.assistantText).toBe('目标回合完成');
  });

  it.each(['error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'forked', 'future-terminal'])('returns %s as an explicit failed terminal', async kind => {
    const f = fixture(), baseline = await captureNativeCut(f.host, owner);
    start(f.log, 1); human(f.log, requestId); model(f.log, 1, 1, '部分内容'); finish(f.log, 1, { kind, syntheticDetail: 'retained reason' });
    const result = await waitForNativeTurn(f.host, owner, baseline, { requestId, timeoutMs: 1000 });
    expect(result.status).toBe('failed'); expect(result.reason).toEqual({ kind, syntheticDetail: 'retained reason' }); expect(result.assistantText).toBe('部分内容');
  });

  it('does not promote a committed interrupted assistant prefix to success even with a completed terminal', async () => {
    const f = fixture(), baseline = await captureNativeCut(f.host, owner);
    start(f.log, 1); human(f.log, requestId); model(f.log, 1, 1, '中断前缀', true); finish(f.log, 1);
    const result = await waitForNativeTurn(f.host, owner, baseline, { requestId, timeoutMs: 1000 });
    expect(result.reason.kind).toBe('completed'); expect(result.status).toBe('failed'); expect(result.assistantText).toBe('中断前缀');
  });

  it('pairs only causal same-turn/step tool identities and retains failed and unknown results explicitly', async () => {
    const f = fixture(), baseline = await captureNativeCut(f.host, owner);
    start(f.log, 1); human(f.log, requestId); model(f.log, 1, 1, '检查工具');
    toolCall(f.log, 1, 1, 'reused', 'ordinary_read'); const first = toolResult(f.log, 1, 1, 'reused', '第1步原文');
    const unknown = toolResult(f.log, 1, 2, 'reused', '未来调用之前的结果');
    const future = toolCall(f.log, 1, 2, 'reused', 'history_read'); const second = toolResult(f.log, 1, 2, 'reused', '实际失败', true);
    const wrongStep = toolResult(f.log, 1, 3, 'reused', '第3步未匹配结果'); finish(f.log, 1);
    const result = await waitForNativeTurn(f.host, owner, baseline, { requestId, timeoutMs: 1000 });
    expect(result.toolOutcomes).toHaveLength(2);
    expect(result.toolOutcomes[0]).toMatchObject({ name: 'ordinary_read', step: 1, resultSeq: first.seq, failed: false, text: '第1步原文' });
    expect(result.toolOutcomes[1]).toMatchObject({ name: 'history_read', step: 2, callSeq: future.seq, resultSeq: second.seq, failed: true, text: '实际失败' });
    expect(result.unpairedToolResults.map(value => value.resultSeq)).toEqual([unknown.seq, wrongStep.seq]);
    expect(result.toolOutcomes.every(value => value.callSeq < value.resultSeq)).toBe(true);
  });

  it('recovers the real pre-baseline turn start for a steered request while excluding earlier assistant/tool credit', async () => {
    const f = fixture(); start(f.log, 8); human(f.log, 'previous-request'); model(f.log, 8, 1, '旧说明');
    toolCall(f.log, 8, 1, 'old-call', 'ordinary_read'); toolResult(f.log, 8, 1, 'old-call', '旧工具');
    const baseline = await captureNativeCut(f.host, owner);
    append(f.log, 'step/start', { turn: 8, step: 2 }); const target = human(f.log, requestId);
    model(f.log, 8, 2, '新的说明'); toolCall(f.log, 8, 2, 'new-call', 'history_read'); toolResult(f.log, 8, 2, 'new-call', '新工具'); finish(f.log, 8);
    const result = await waitForNativeTurn(f.host, owner, baseline, { requestId, pageMessages: 1, timeoutMs: 1000 });
    expect(result).toMatchObject({ turn: 8, startSeq: 0, userSeq: target.seq, assistantText: '新的说明' });
    expect(result.toolOutcomes.map(value => value.callId)).toEqual(['new-call']);
  });

  it('times out on old idle and a completed turn that never consumed the submitted request', async () => {
    const f = fixture(); turn(f.log, 1, 'old'); const baseline = await captureNativeCut(f.host, owner);
    turn(f.log, 2, 'not-the-target');
    await expect(waitForNativeTurn(f.host, owner, baseline, { requestId, timeoutMs: 20, pollMs: 1 })).rejects.toMatchObject({ code: 'NATIVE_TURN_TIMEOUT' });
  });

  it('aborts promptly even while an RPC is pending and rejects disappearance, rewind and wrong-session baselines', async () => {
    const f = fixture(), baseline = await captureNativeCut(f.host, owner), controller = new AbortController();
    const stalled: NativeTurnHost = { ...f.host, rpc: async () => new Promise(() => {}) };
    const waiting = waitForNativeTurn(stalled, owner, baseline, { requestId, signal: controller.signal, timeoutMs: 1000 });
    const reason = new Error('synthetic observer cancelled'); controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    f.hooks.listed = false;
    await expect(waitForNativeTurn(f.host, owner, baseline, { requestId })).rejects.toMatchObject({ code: 'NATIVE_SESSION_NOT_FOUND' });
    f.hooks.listed = true; human(f.log, 'old'); const newer = await captureNativeCut(f.host, owner); f.log.pop();
    await expect(waitForNativeTurn(f.host, owner, newer, { requestId })).rejects.toMatchObject({ code: 'NATIVE_LOG_REWOUND' });
    await expect(waitForNativeTurn(f.host, owner, { sessionId: 'foreign', asOfSeq: -1 }, { requestId })).rejects.toMatchObject({ code: 'NATIVE_INVALID_BASELINE' });
  });

  it('rejects orphaned user identities and malformed terminal ownership rather than fabricating a turn', async () => {
    const f = fixture(), baseline = await captureNativeCut(f.host, owner); human(f.log, requestId);
    await expect(waitForNativeTurn(f.host, owner, baseline, { requestId })).rejects.toMatchObject({ code: 'NATIVE_TURN_PROTOCOL' });
    f.log.length = 0; start(f.log, 1); human(f.log, requestId); model(f.log, 1, 1); finish(f.log, 9);
    await expect(waitForNativeTurn(f.host, owner, baseline, { requestId })).rejects.toMatchObject({ code: 'NATIVE_TURN_PROTOCOL' });
  });
});
