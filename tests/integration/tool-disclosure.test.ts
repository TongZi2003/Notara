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

test('schemas load on the next actual request, survive restart and stay in their own lesson', async () => {
  const f = await fixture(), lesson = await f.create();
  const initial = await f.send(lesson, '先讨论今天的问题');
  expect(initial.toolNames).toHaveLength(8);
  expect(initial.toolNames).toContain('load_tools');
  expect(initial.toolNames).not.toContain('propose_route');
  expect(system(initial)).toContain('propose_route —');
  const expanded = await f.send(lesson, calls([
    { name: 'load_tools', arguments: { names: ['read_route', 'propose_route'] } },
    { name: 'read_route', arguments: {} },
  ]));
  const history = (await requests()).filter(row => row.sessionId === lesson);
  expect(history[1]!.toolNames).not.toContain('propose_route');
  expect(history[2]!.toolNames).toEqual(expect.arrayContaining(['read_route', 'propose_route']));
  expect(expanded.toolNames).toHaveLength(10);
  expect(system(expanded)).not.toContain('propose_route —');
  const read = expanded.messages.flatMap(m => m.content).findLast(b => b.type === 'tool-call' && b.name === 'read_route');
  expect(read?.type).toBe('tool-call');
  if (read?.type !== 'tool-call') throw new Error('missing route read');
  expect(expanded.messages.flatMap(m => m.content).find(b => b.type === 'tool-result' && b.toolCallId === read.id)).toMatchObject({ isError: false });
  await f.restart();
  expect((await f.send(lesson, '继续刚才的安排')).toolNames).toEqual(expanded.toolNames);
  expect((await f.send(await f.create(), '这是一节新课')).toolNames).toEqual(initial.toolNames);
  console.log(JSON.stringify({ initialTools: initial.toolNames.length, loadedTools: expanded.toolNames.length, initialSchemaBytes: initial.toolSchemaBytes, loadedSchemaBytes: expanded.toolSchemaBytes, restart: 'PASS', isolation: 'PASS' }));
}, 60_000);

test('invalid or disallowed names load nothing; valid retries work and task controls remain visible', async () => {
  const f = await fixture(), lesson = await f.create();
  const failed = await f.send(lesson, calls([{ name: 'load_tools', arguments: { names: ['read_plan', 'not_a_tool'] } }]));
  expect(failed.toolNames).toHaveLength(8);
  expect(failed.messages.flatMap(m => m.content).filter(b => b.type === 'tool-result').at(-1)).toMatchObject({ isError: true });
  const denied = await f.send(lesson, calls([{ name: 'load_tools', arguments: { names: ['write', 'register_cards'] } }]));
  expect(denied.toolNames).toHaveLength(8);
  expect(system(denied)).not.toContain('write —');
  expect(system(denied)).not.toContain('register_cards —');
  const loaded = await f.send(lesson, calls([{ name: 'load_tools', arguments: { names: ['read_plan', 'read_plan', 'delegate_search'] } }]));
  expect(loaded.toolNames).toEqual(expect.arrayContaining(['read_plan', 'delegate_search', 'send_message', 'interrupt_agent']));
  expect(new Set(loaded.toolNames).size).toBe(loaded.toolNames.length);
  const replay = await f.send(lesson, calls([{ name: 'load_tools', arguments: { names: ['read_plan'] } }]));
  expect(replay.toolNames).toEqual(loaded.toolNames);
}, 60_000);
