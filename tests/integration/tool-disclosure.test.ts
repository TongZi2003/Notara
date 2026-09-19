import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
const value = <T>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
type Request = { sessionId: string; purpose: string; toolNames: string[]; toolSchemaBytes: number; messages: { role: string; content: ContentBlock[] }[] };
async function requests(): Promise<Request[]> {
  return (await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Request).filter(row => row.purpose !== 'session-title');
}
const system = (row: Request) => row.messages.filter(m => m.role === 'system').flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : [])).join('\n');
const calls = (rows: { name: string; arguments: unknown }[]) => '[tools]' + JSON.stringify(rows);
const lastResult = (row: Request, name?: string) => {
  const blocks = row.messages.flatMap(m => m.content);
  if (!name) return blocks.filter(b => b.type === 'tool-result').at(-1);
  const call = blocks.findLast(b => b.type === 'tool-call' && b.name === name);
  if (call?.type !== 'tool-call') throw new Error(`missing ${name} call`);
  return blocks.find(b => b.type === 'tool-result' && b.toolCallId === call.id);
};
async function fixture() {
  runtime = await startIsolated({ testModel: true });
  let client = await connectRuntime(runtime);
  const create = async () => value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime!.root, 'classroom'), agentPreset: 'studyforge-learning' } })).sessionId;
  const send = async (sessionId: string, text: string) => {
    const before = await requests().then(rows => rows.length).catch(() => 0);
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } }));
    await expect.poll(async () => (await requests()).length, { timeout: 30_000 }).toBeGreaterThan(before);
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 30_000 }).toBe(false);
    return (await requests()).filter(row => row.sessionId === sessionId).at(-1)!;
  };
  return { create, send, restart: async () => { await runtime!.restart(); client = await connectRuntime(runtime!); } };
}

const FACADES = ['find', 'open', 'note', 'update', 'record', 'propose', 'create', 'board', 'classroom', 'stage', 'delegate'];

test('the classroom wire is constant: facades dispatch, direct names still work, and load_tools is a receipt', async () => {
  const f = await fixture(), lesson = await f.create();
  const initial = await f.send(lesson, '先讨论今天的问题');
  for (const name of [...FACADES, 'read', 'web_search', 'subagent', 'send_message', 'interrupt_agent']) expect(initial.toolNames).toContain(name);
  for (const name of ['load_tools', 'read_route', 'propose_route', 'register_cards', 'write', 'run_code']) expect(initial.toolNames).not.toContain(name);
  // The static method reference lists inner names so direct calls remain discoverable.
  expect(system(initial)).toContain('read_route');
  expect(system(initial)).toContain('propose_route');
  const loaded = await f.send(lesson, calls([
    { name: 'load_tools', arguments: { names: ['read_route', 'propose_route'] } },
    { name: 'open', arguments: { method: 'route', input: {} } },
  ]));
  expect(loaded.toolNames).toEqual(initial.toolNames);
  expect(lastResult(loaded, 'load_tools')).toMatchObject({ isError: false });
  expect(lastResult(loaded, 'open')).toMatchObject({ isError: false });
  // The registry stays authoritative: calling a wrapped tool by its exact name still executes.
  const direct = await f.send(lesson, calls([{ name: 'read_route', arguments: {} }]));
  expect(direct.toolNames).toEqual(initial.toolNames);
  expect(lastResult(direct, 'read_route')).toMatchObject({ isError: false });
  await f.restart();
  expect((await f.send(lesson, '继续刚才的安排')).toolNames).toEqual(initial.toolNames);
  expect((await f.send(await f.create(), '这是一节新课')).toolNames).toEqual(initial.toolNames);
  console.log(JSON.stringify({ tools: initial.toolNames.length, schemaBytes: initial.toolSchemaBytes, dispatch: 'PASS', direct: 'PASS', restart: 'PASS', isolation: 'PASS' }));
}, 90_000);

test('malformed or empty facade arguments fail with transport attribution, not a field error', async () => {
  const f = await fixture(), lesson = await f.create();
  const malformed = await f.send(lesson, calls([{ name: 'find', arguments: { __malformed_arguments: '{"method":"materials","input":{"q":"数学' } }]));
  const malformedResult = lastResult(malformed, 'find');
  expect(malformedResult).toMatchObject({ isError: true });
  const malformedText = JSON.stringify(malformedResult?.content);
  expect(malformedText).toContain('未能通过解析');
  expect(malformedText).toContain('切换模型');
  const empty = await f.send(lesson, calls([{ name: 'find', arguments: {} }]));
  const emptyResult = lastResult(empty, 'find');
  expect(emptyResult).toMatchObject({ isError: true });
  expect(JSON.stringify(emptyResult?.content)).toContain('参数在送达前丢失');
}, 90_000);

test('unknown facade methods and disallowed load_tools names fail without touching the wire', async () => {
  const f = await fixture(), lesson = await f.create();
  const initial = await f.send(lesson, '先看看有什么');
  const unknown = await f.send(lesson, calls([{ name: 'propose', arguments: { method: 'nonsense', input: {} } }]));
  expect(unknown.toolNames).toEqual(initial.toolNames);
  expect(lastResult(unknown, 'propose')).toMatchObject({ isError: true });
  // The register_cards gate resolves through the facade: a normal lesson cannot batch-register.
  const gated = await f.send(lesson, calls([{ name: 'record', arguments: { method: 'cards', input: { cards: [] } } }]));
  expect(lastResult(gated, 'record')).toMatchObject({ isError: true });
  const missing = await f.send(lesson, calls([{ name: 'load_tools', arguments: { names: ['read_plan', 'not_a_tool'] } }]));
  expect(missing.toolNames).toEqual(initial.toolNames);
  expect(lastResult(missing, 'load_tools')).toMatchObject({ isError: true });
  const denied = await f.send(lesson, calls([{ name: 'load_tools', arguments: { names: ['write', 'register_cards'] } }]));
  expect(denied.toolNames).toEqual(initial.toolNames);
  expect(lastResult(denied, 'load_tools')).toMatchObject({ isError: true });
  const ok = await f.send(lesson, calls([{ name: 'load_tools', arguments: { names: ['read_plan', 'delegate_search'] } }]));
  expect(ok.toolNames).toEqual(initial.toolNames);
  expect(lastResult(ok, 'load_tools')).toMatchObject({ isError: false });
}, 90_000);
