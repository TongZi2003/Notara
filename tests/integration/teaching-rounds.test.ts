/**
 * Multi-role teaching rounds against the real launcher: `startIsolated({ testModel: true })`
 * runs the released Host, so every stage takes the path a lesson really takes —
 * the `round_*` tools inside a native learning Session, real `ctx.subagents`
 * children, the persisted `teachinground` collection, and the student-facing
 * `studyforgeRounds` remote.
 *
 * The scripted model makes the chain deterministic: a `[structured-problem]`
 * target makes the problem child return a structured draft the Host registers
 * as one ordinary card; peer and assistant children echo their task text, so
 * the request log — not the record — proves what each role could see. The
 * privacy assertions read the actual outbound requests: the peer's request
 * must never contain the standard, the assistant's must.
 */
import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CardView } from '@studyforge/contracts/cards';
import type { TeachingRoundView } from '@studyforge/contracts/teaching-rounds';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { TeachingRounds } from '../../packages/host/src/teaching/rounds.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

interface LoggedBlock { readonly type: string; readonly text?: string; readonly content?: readonly LoggedBlock[]; }
interface LoggedRequest { readonly sessionId?: string; readonly messages: readonly LoggedMessage[]; }
interface LoggedMessage { readonly role: string; readonly content: readonly LoggedBlock[]; }
function textOf(request: LoggedRequest): string {
  const text = (block: LoggedBlock): string => block.text ?? block.content?.map(text).join('\n') ?? '';
  return request.messages.flatMap(message => message.content).map(text).join('\n');
}
function systemOf(request: LoggedRequest): string {
  return request.messages.filter(message => message.role === 'system').map(message => message.content.map(block => block.text ?? '').join('')).join('');
}
async function modelLog(): Promise<LoggedRequest[]> {
  const raw = await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8');
  return raw.split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line) as LoggedRequest);
}

const MATERIAL = { title: '三角恒等变换', text: '平方关系：sin^2+cos^2=1' };
const STANDARD = '化简时优先用平方关系，再按二倍角展开';
async function prompt(client: Awaited<ReturnType<typeof connectRuntime>>, sessionId: string, calls: { name: string; arguments: unknown }[]): Promise<void> {
  value(await client.rpc('session/prompt', {
    request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify(calls) }] },
  }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
}

test('a round runs problem→answer→peer→assistant with the standard visible only to the assistant', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  }));

  await prompt(client, sessionId, [{ name: 'round_open', arguments: {
    topic: '[structured-problem] 平方关系的直接应用', materials: [MATERIAL], standard: STANDARD,
  } }]);

  // The round persisted through the same record the student remote reads:
  // stage opened for the student's own answer, the question landed as one
  // ordinary unlearned card, and the view carries neither the standard nor
  // any child identity.
  const rounds = value(await client.rpc<TeachingRoundView[]>('studyforgeRounds/list', { input: { sessionId } }));
  expect(rounds).toHaveLength(1);
  const round = rounds[0]!;
  expect(round).toMatchObject({ stage: 'answering', questionTitle: '独立命题样题', topic: '[structured-problem] 平方关系的直接应用' });
  expect(round.cardRef).toBeDefined(); expect(round.questionFront).toBeTruthy();
  const serialised = JSON.stringify(round);
  expect(serialised).not.toContain(STANDARD); expect(serialised).not.toContain('childId');
  const cards = value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}));
  expect(cards.filter(card => card.content.presentation === 'problem')).toHaveLength(1);
  expect(cards[0]?.review).toBeUndefined();

  // The student's own answer goes in verbatim through the student remote;
  // the peer then runs against materials plus that answer — the outbound
  // request proves the standard never reached it.
  const answered = value(await client.rpc<TeachingRoundView>('studyforgeRounds/answer', {
    input: { sessionId, ref: round.ref, text: '两边同除 cos 就能得到 tan，所以原式成立' },
  }));
  expect(answered.stage).toBe('awaiting_correction');
  expect(answered.answer).toBe('两边同除 cos 就能得到 tan，所以原式成立');
  const children = value(await client.rpc<SessionListValue>('session/list', { _request: {} }))
    .items.filter(item => item.parentSessionId === sessionId && item.origin === 'subagent');
  expect(children).toHaveLength(2);
  const log = await modelLog();
  const peer = log.find(entry => children.some(child => entry.sessionId === String(child.sessionId)) && systemOf(entry).includes('# 同伴'));
  expect(peer, JSON.stringify(log.map(entry => entry.sessionId))).toBeDefined();
  expect(textOf(peer!)).toContain('两边同除 cos 就能得到 tan');
  expect(textOf(peer!)).toContain(MATERIAL.text);
  expect(textOf(peer!)).not.toContain(STANDARD);

  // The correction stage is the only one that receives the standard.
  const corrected = value(await client.rpc<TeachingRoundView>('studyforgeRounds/correct', { input: { sessionId, ref: round.ref } }));
  expect(corrected.stage).toBe('completed');
  expect(corrected.actors.map(actor => actor.state)).toEqual(['completed', 'completed', 'completed']);
  // The problem helper's product is the registered card itself; peer and
  // assistant speak in their own words, stored verbatim.
  expect(corrected.actors.filter(actor => actor.role !== 'problem').every(actor => actor.text.length > 0)).toBe(true);
  const allChildren = value(await client.rpc<SessionListValue>('session/list', { _request: {} }))
    .items.filter(item => item.parentSessionId === sessionId && item.origin === 'subagent');
  expect(allChildren).toHaveLength(3);
  const finalLog = await modelLog();
  const assistant = finalLog.find(entry => allChildren.some(child => entry.sessionId === String(child.sessionId)) && systemOf(entry).includes('# 助教'));
  expect(assistant).toBeDefined();
  expect(textOf(assistant!)).toContain(STANDARD);
  expect(textOf(assistant!)).toContain('两边同除 cos 就能得到 tan');

  // No second card. The completed view still carries no `standard` field and
  // no child identity; the assistant's own correction words are the student's
  // to read — they only exist after the student's answer was locked in.
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {})).filter(card => card.content.presentation === 'problem')).toHaveLength(1);
  const finalView = value(await client.rpc<TeachingRoundView>('studyforgeRounds/read', { input: { sessionId, ref: round.ref } }));
  expect('standard' in finalView).toBe(false);
  expect(JSON.stringify(finalView)).not.toContain('childId');
}, 120_000);

test('a prose-only problem helper leaves the round honestly failed and registers no card', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  }));
  await prompt(client, sessionId, [{ name: 'round_open', arguments: {
    topic: '平方关系的直接应用', materials: [MATERIAL], standard: STANDARD,
  } }]);
  const rounds = value(await client.rpc<TeachingRoundView[]>('studyforgeRounds/list', { input: { sessionId } }));
  expect(rounds).toHaveLength(1);
  expect(rounds[0]).toMatchObject({ stage: 'failed' });
  const problem = rounds[0]!.actors.find(actor => actor.role === 'problem')!;
  expect(problem.state).toBe('failed'); expect(problem.detail).toBeUndefined();
  expect(JSON.stringify(rounds)).not.toContain('childId');
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))).toEqual([]);
  // A failed round refuses the student's answer honestly.
  const refused = await client.rpc('studyforgeRounds/answer', { input: { sessionId, ref: rounds[0]!.ref, text: '任意作答' } });
  expect(refused).toMatchObject({ ok: false });
}, 120_000);

test('stopping while the problem child is running interrupts it and closes the round as stopped', async () => {
  const context = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student' as const, purpose: 'learning' as const, operationId: 'open-round' };
  const interrupts: string[] = [];
  let registered!: () => void;
  let rejectRun!: (error: Error) => void;
  const childRegistered = new Promise<void>(resolve => { registered = resolve; });
  const childRun = new Promise<never>((_resolve, reject) => { rejectRun = reject; });
  let row: any = undefined;
  const records: any = {
    async create(_ctx: unknown, _id: string, input: unknown) {
      row = { ref: 'teachinground:test', version: 1, data: input };
      return { ...row, duplicate: false };
    },
    read() { return { ...row, duplicate: false }; },
    async update(_ctx: unknown, ref: string, _input: unknown, transform: (data: unknown) => unknown) {
      row = { ref, version: row.version + 1, data: transform(row.data) };
      return { ...row, duplicate: false };
    },
    list() { return [{ ...row, duplicate: false }]; },
  };
  const delegation: any = {
    async proposeProblems(input: { onChildId?: (childId: string) => Promise<void> }) {
      await input.onChildId?.('child-problem');
      registered();
      await childRun;
      return { role: 'problem', childId: 'child-problem', stopReason: 'completed', surface: [], cards: [] };
    },
  };
  const host: any = {
    sessionController: { resolveAgent: async () => ({ agent: {} }) },
    subagents: { interrupt: async (childId: string) => { interrupts.push(String(childId)); rejectRun(new Error('interrupted')); } },
  };
  const rounds = new TeachingRounds(host, records, delegation);
  const opening = rounds.open(context, { topic: '题目', materials: [MATERIAL], standard: STANDARD }, new AbortController().signal);
  await childRegistered;
  const stopped = await rounds.stop(context, 'teachinground:test');
  await expect(opening).rejects.toThrow();
  expect(interrupts).toEqual(['child-problem']);
  expect(stopped.stage).toBe('stopped');
  expect(stopped.actors.find(actor => actor.role === 'problem')?.state).toBe('stopped');
});

test('stopping an open round marks it stopped without faking completion', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  }));
  await prompt(client, sessionId, [{ name: 'round_open', arguments: {
    topic: '[structured-problem] 平方关系的直接应用', materials: [MATERIAL], standard: STANDARD,
  } }]);
  const [round] = value(await client.rpc<TeachingRoundView[]>('studyforgeRounds/list', { input: { sessionId } }));
  const stopped = value(await client.rpc<TeachingRoundView>('studyforgeRounds/stop', { input: { sessionId, ref: round!.ref } }));
  expect(stopped.stage).toBe('stopped');
  expect(stopped.actors.find(actor => actor.role === 'problem')?.state).toBe('completed');
  expect(stopped.actors.filter(actor => actor.state === 'stopped')).toHaveLength(2);
  // Stopped is terminal: the student can no longer submit into it.
  expect(await client.rpc('studyforgeRounds/answer', { input: { sessionId, ref: round!.ref, text: '迟到的作答' } })).toMatchObject({ ok: false });
}, 120_000);
