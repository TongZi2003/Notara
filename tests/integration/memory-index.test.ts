/**
 * The learner-memory index is injected into the teacher's system prompt every
 * turn, so the model can see which existing record a new observation belongs to
 * before it decides between note_memory and revise_memory.
 */
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
const value = <T>(result: RemoteResult<T>): T => { expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
type Request = { sessionId: string; purpose: string; messages: { role: string; content: ContentBlock[] }[] };
const system = (row: Request): string => row.messages.filter(message => message.role === 'system').map(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')).join('');
async function requests(): Promise<Request[]> { return (await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Request).filter(row => row.purpose !== 'session-title'); }

test('saved memories appear in the next turn system prompt as a dedup index', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const send = async (body: string): Promise<void> => {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: body }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  };
  // First request: no records yet, so no index line.
  await send('我习惯先猜答案再去验证。');
  expect(system((await requests()).findLast(row => row.sessionId === sessionId)!)).not.toContain('已有学情');
  // The teacher notes one real observation citing the actual student line (E1).
  await send('[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['query_evidence', 'note_memory'] } },
    { name: 'query_evidence', arguments: {} },
    { name: 'note_memory', arguments: { kind: 'habit', title: '先猜再验证的做题习惯', body: '学生自述习惯先猜答案再验证。', evidenceRefs: ['E1'] } },
  ]));
  // The next turn's system prompt carries the index row with the record ref.
  await send('继续。');
  const prompt = system((await requests()).findLast(row => row.sessionId === sessionId)!);
  expect(prompt).toContain('本学生已有学情 1 条');
  expect(prompt).toContain('先猜再验证的做题习惯');
  expect(prompt).toMatch(/memory:m_[a-f0-9]{24}/);
}, 90_000);

test('knowledge index and learning goal appear in the next turn system prompt', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const send = async (body: string): Promise<void> => {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: body }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  };
  // First request: neither block exists yet.
  await send('我想在假期里补完函数。');
  const first = system((await requests()).findLast(row => row.sessionId === sessionId)!);
  expect(first).not.toContain('学习目标：');
  expect(first).not.toContain('本学生已有方法与知识');
  // The teacher records the stated goal and one method note (read_lesson binds
  // the course version that note_learning_goal needs).
  await send('[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['note_method', 'note_learning_goal'] } },
    { name: 'read_lesson', arguments: {} },
    { name: 'note_learning_goal', arguments: { title: '假期补完函数', deadline: '2026-10-01', dailyMinutes: 40 } },
    { name: 'note_method', arguments: { title: '端点代入验证解集方向', body: '把区间端点代回原式检验口诀给出的解集方向。', category: '方法' } },
  ]));
  // The next turn's system prompt carries the goal line and the index row.
  await send('继续。');
  const prompt = system((await requests()).findLast(row => row.sessionId === sessionId)!);
  expect(prompt).toContain('学习目标：假期补完函数（截止2026-10-01，每天40分钟）');
  expect(prompt).toContain('本学生已有方法与知识 1 条');
  expect(prompt).toContain('[方法] 端点代入验证解集方向');
  expect(prompt).toMatch(/knowledge:kn_[a-f0-9]{24}/);
}, 90_000);
