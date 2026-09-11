import { afterEach, expect, test } from 'vitest';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue, ModelCatalog } from '@deepseek-ai/dsh-api-session-controller';
import type { CourseUsage } from '../../packages/contracts/src/courses.ts';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; }
async function classroom() {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  return {
    client, sessionId, runtime,
    usage: async () => value(await client.rpc<CourseUsage>('studyforgeCourses/usage', { input: { sessionId } })),
    send: async (text: string) => value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } })),
    idle: async () => expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running, { timeout: 10_000 }).toBe(false),
  };
}

test('native stream/final replacement and retry totals remain full-session facts; missing buckets stay unavailable', async () => {
  const c = await classroom();
  expect(await c.usage()).toMatchObject({ totals: null, exact: false, completedTurns: 0 });
  await c.send('普通计数'); await c.idle();
  const normal = await c.usage();
  expect(normal).toMatchObject({ totals: { uncachedInputTokens: 8, cacheReadTokens: 2, outputTokens: 5 }, exact: true, completedTurns: 1, measuredTurns: 1, cacheReadReported: true, cacheWriteReported: false });
  expect(normal.context?.pressureTokens).toBe(10);
  await c.send('[retry] 再试一次'); await c.idle();
  expect(await c.usage()).toMatchObject({ totals: { outputTokens: 13, uncachedInputTokens: 24, cacheReadTokens: 6 }, completedTurns: 2, measuredTurns: 2, exact: true });
  // The retry turn contributes 5 + 3 = 8, not streaming 2 + 5 + 2 + 3.
  await c.send('[partial] 未报告总数'); await c.idle();
  const partial = await c.usage();
  expect(partial).toMatchObject({ totals: { outputTokens: 18 }, completedTurns: 3, measuredTurns: 2, exact: false, cacheWriteReported: false });
  await c.runtime.restart();
  const reopened = await connectRuntime(c.runtime);
  expect(value(await reopened.rpc<CourseUsage>('studyforgeCourses/usage', { input: { sessionId: c.sessionId } }))).toEqual(partial);
}, 30_000);

test('native exact model selection applies to the next request; unlisted routes are not rejected by the catalog', async () => {
  const c = await classroom();
  const catalog = value(await c.client.rpc<ModelCatalog>('session/modelCatalog', {}));
  expect(JSON.stringify(catalog)).toContain('study-model-a');
  expect(JSON.stringify(catalog)).toContain('study-model-b');
  const select = (model: string, reasoningEffort?: string, provider = 'studyforge-test') => c.client.rpc('session/selectModel', { request: { sessionId: c.sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) } });
  value(await select('study-model-a', 'high'));
  await c.send('[slow] 保持正在生成的这一次模型选择');
  const calls = async () => (await readFile(join(c.runtime.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { sessionId: string; purpose?: string; model: string; reasoningEffort?: string }).filter(call => call.sessionId === c.sessionId && call.purpose === undefined);
  await expect.poll(async () => (await calls()).length).toBe(1);
  value(await select('study-model-b'));
  await c.idle();
  expect((await calls())[0]).toMatchObject({ model: 'study-model-a', reasoningEffort: 'high' });
  await c.send('现在用第二个模型'); await c.idle();
  expect((await calls()).at(-1)).toMatchObject({ model: 'study-model-b' });
  expect((await calls()).at(-1)).not.toHaveProperty('reasoningEffort');
  value(await select('unlisted-but-routable'));
  await c.send('目录没有也可路由'); await c.idle();
  expect((await calls()).at(-1)?.model).toBe('unlisted-but-routable');
  expect((await select('anything', undefined, 'unregistered-provider')).ok).toBe(false);
}, 30_000);
