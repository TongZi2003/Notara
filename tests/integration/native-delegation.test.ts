/**
 * P7.4 controllable native delegation spec.
 *
 * This runs the released DSH launcher with the StudyForge Host and the
 * scripted classroom model (`startIsolated({ testModel: true })`), so the
 * delegation path under test is the one a lesson really takes: a native
 * learning Session, the Host's registered role tools, and the real
 * `ctx.subagents` spawn provider.
 *
 * It needs one wiring piece from the main Agent, because it is not in this
 * file's write scope: the Host root must call
 * `registerDelegationTools(ctx, { assistantsDir })` next to `installTeaching`.
 * The resource copy already exists — `scripts/build.ts` puts `resources/teaching`
 * at `packages/host/lib/teaching-resources`, which is where `TeachingCatalog`
 * reads from, so `fileURLToPath(new URL('../teaching-resources/assistants',
 * import.meta.url))` is the matching directory. Until that call lands this
 * spec fails on purpose: no `delegate_*` tool exists, so no child is started.
 *
 * What this file owns that the harness test cannot: the real process, the real
 * preset composition and the real model-request log. What it cannot own: the
 * child's tool surface, which is not part of the logged request — that single
 * claim stays in `assistant-boundaries.test.ts`, where the full request is
 * captured. A structured problem answer is impossible here as well: the
 * scripted model answers the child's task text, and that text is the product's
 * own framing, so it can never be scripted; card registration end to end is
 * asserted against the real stores in the harness test instead.
 */
import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

interface LoggedBlock { readonly type: string; readonly text?: string; readonly content?: readonly LoggedBlock[]; }
interface LoggedMessage { readonly role: string; readonly content: readonly LoggedBlock[]; }
interface LoggedRequest { readonly sessionId?: string; readonly messages: readonly LoggedMessage[]; readonly toolNames?: readonly string[]; }
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

test('a real lesson delegates to native helpers that never receive its conversation', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  }));

  const assistant = { name: 'delegate_assistant', arguments: {
    materials: [{ title: '三角恒等变换', text: '平方关系：sin^2+cos^2=1' }],
    standard: '化简时优先用平方关系',
    question: '这个做法成立吗',
  } };
  const peer = { name: 'delegate_peer', arguments: {
    materials: [{ title: '三角恒等变换', text: '平方关系：sin^2+cos^2=1' }],
    explanation: '两边同除 cos 就得到 tan',
  } };
  value(await client.rpc('session/prompt', {
    request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([{ name: 'load_tools', arguments: { names: ['delegate_assistant', 'delegate_peer'] } }, assistant, peer]) }] },
  }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);

  // Two real native children of this lesson, one per role.
  const list = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
  const children = list.items.filter(item => item.parentSessionId === sessionId && item.origin === 'subagent');
  expect(children, '为 0 说明 Host 还没接线 registerDelegationTools(ctx, { assistantsDir })：本课没有任何 delegate_* 工具可用').toHaveLength(2);

  // The real outbound requests prove the boundary: the children got their own
  // persona and their own task, and nothing of the lesson they were sent from.
  const log = await modelLog();
  for (const [persona, marker] of [['# 助教', '化简时优先用平方关系'], ['# 同伴', '两边同除 cos 就得到 tan']] as const) {
    // Native list order is recency, not dispatch order. Match the child's own
    // role and still require a real child identity of this parent.
    const request = log.find(entry => children.some(child => entry.sessionId === String(child.sessionId)) && systemOf(entry).includes(persona));
    expect(request, JSON.stringify(log.map(entry => entry.sessionId))).toBeDefined();
    expect(systemOf(request!)).toContain('你是独立上下文里的');
    expect(textOf(request!)).toContain(marker);
    expect(textOf(request!)).not.toContain('delegate_assistant');
    expect(textOf(request!)).not.toContain('[tools]');
    expect(request!.toolNames).not.toContain('load_tools');
    expect(systemOf(request!)).not.toContain('按需取得工具');
  }
  // Two children left the lesson's own session alone.
  expect(log.filter(entry => entry.sessionId === sessionId).length).toBeGreaterThan(0);
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {})).filter(card => card.content.presentation === 'problem')).toEqual([]);
}, 60_000);

test('the real native search child can read its fixed material through the product access boundary', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'child-book', material: { title: '检索原文', fileName: '检索.txt', mediaType: 'text/plain' }, base64: Buffer.from('真正读取的材料正文').toString('base64') } }));
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const child = { name: 'read_material', arguments: { source: { materialId: book.materialId, versionId: book.currentVersion.versionId } } };
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['delegate_search'] } },
    { name: 'delegate_search', arguments: { task: '[child-tool]' + JSON.stringify(child) } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  const children = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.filter(item => item.parentSessionId === sessionId);
  expect(children).toHaveLength(1);
  const requests = (await modelLog()).filter(entry => entry.sessionId === children[0]!.sessionId);
  for (const request of requests) expect(request.toolNames).not.toContain('subagent');
  // The adapter log is the real prepared request; use its actual text blocks,
  // without assuming a provider-specific role for a rendered tool result.
  expect(requests.map(textOf).join('\n'), JSON.stringify(requests)).toContain('真正读取的材料正文');
}, 60_000);

test('structured output from a native problem child is registered once as the same ordinary unlearned card', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const request = { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tool]' + JSON.stringify({ name: 'delegate_problem', arguments: { target: '[structured-problem] 加法', count: 1 } }) }] } };
  value(await client.rpc('session/prompt', request));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  const cards = value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}));
  expect(cards).toHaveLength(1); expect(cards[0]?.content.title).toBe('独立命题样题');
  expect(cards[0]?.history).toEqual([]); expect(cards[0]?.review).toBeUndefined();
  value(await client.rpc('session/prompt', request));
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {})).map(card => card.ref)).toEqual(cards.map(card => card.ref));
}, 60_000);

test('a prose-only problem child is refused by the Host and registers no card', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  }));
  value(await client.rpc('session/prompt', {
    request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tool]' + JSON.stringify({ name: 'delegate_problem', arguments: { target: '平方关系的直接应用', count: 1 } }) }] },
  }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);

  // The scripted child only writes prose, so the structured product never
  // arrives: the lesson model cannot turn that into a card by itself.
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {})).filter(card => card.content.presentation === 'problem')).toEqual([]);
  const log = await modelLog();
  expect(log.some(entry => entry.sessionId !== sessionId), '子会话请求为 0：delegate_problem 还没接进 Host，命题帮手从未被派出').toBe(true);
}, 60_000);

test('a progressively loaded background search can be followed up and stopped, while its child cannot load teacher tools', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const send = async (calls: { name: string; arguments: unknown }[]) => {
    const before = await modelLog().then(rows => rows.filter(row => row.sessionId === sessionId).length).catch(() => 0);
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify(calls) }] } }));
    await expect.poll(async () => (await modelLog()).filter(row => row.sessionId === sessionId).length, { timeout: 30_000 }).toBeGreaterThan(before);
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running, { timeout: 30_000 }).toBe(false);
  };
  await send([
    { name: 'load_tools', arguments: { names: ['delegate_search'] } },
    { name: 'delegate_search', arguments: { task: '检索任务测试：这次只确认收到任务，不访问外网。', background: true } },
  ]);
  // A continuable child's address comes from the accepted native delegation;
  // the ordinary lesson list need not list resident background agents.
  const prepared = (await modelLog()).filter(row => row.sessionId === sessionId).at(-1)!;
  const results = prepared.messages.flatMap(message => message.content).filter(block => block.type === 'tool-result');
  const accepted = results.flatMap(block => block.content ?? []).flatMap(block => {
    try { return block.text ? [JSON.parse(block.text) as { background?: boolean; childId?: string }] : []; } catch { return []; }
  }).find(result => result.background === true && typeof result.childId === 'string');
  expect(accepted, JSON.stringify(results)).toBeDefined();
  const childId = accepted!.childId!;
  await expect.poll(async () => (await modelLog()).filter(row => row.sessionId === childId).length).toBeGreaterThan(0);
  const first = (await modelLog()).find(row => row.sessionId === childId)!;
  expect(first.toolNames).toEqual(expect.arrayContaining(['web_search', 'read_material', 'send_message']));
  expect(first.toolNames).not.toContain('load_tools');
  await send([{ name: 'send_message', arguments: { agent_id: childId,
    message: '[child-tool]' + JSON.stringify({ name: 'load_tools', arguments: { names: ['note_memory'] } }) } }]);
  await expect.poll(async () => (await modelLog()).filter(row => row.sessionId === childId).map(textOf).join('\n'), { timeout: 30_000 })
    .toMatch(/UNKNOWN_TOOL|unknown tool|只有主课堂|not found|not visible|not callable/i);
  for (const row of (await modelLog()).filter(row => row.sessionId === childId)) expect(row.toolNames).not.toContain('note_memory');
  await send([{ name: 'interrupt_agent', arguments: { agent_id: childId } }]);
  const parent = (await modelLog()).filter(row => row.sessionId === sessionId).at(-1)!;
  expect(parent.toolNames).toEqual(expect.arrayContaining(['delegate_search', 'send_message', 'interrupt_agent']));
  expect(textOf(parent)).toContain('interrupt requested for agent');
}, 60_000);
