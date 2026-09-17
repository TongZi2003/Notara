import { afterEach, expect, test } from 'vitest';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); });
const value = <T>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('task skills use the native provider and slash invocation injects the same instructions', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const choices = value(await client.rpc<{ id: string; title: string }[]>('studyforgeTeaching/tasks', {}));
  expect(choices.map(item => item.title)).toEqual(['按语义查找','作文批改','整理成讲义','互动演示','蒸馏学习方法']);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '/studyforge-semantic-search 查找与当前问题有关的资料。' }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);
  const requests = await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8');
  expect(requests).toContain('skill-invocation'); expect(requests).toContain('按语义查找');
}, 40_000);
