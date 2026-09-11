import { afterEach, expect, test } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionCreateValue, SessionListValue, SessionRenameValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { CourseViewSchema, type CourseView } from '../../packages/contracts/src/courses.ts';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import type { EvidenceCatalogue } from '../../packages/domain/src/evidence/evidence-query.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test('native identity adoption and metadata failure/retry preserve one classroom through a Host restart', async () => {
  runtime = await startIsolated({ testModel: true });
  let client = await connectRuntime(runtime);
  // A planned opening persists its native UUID on the plan in P6. This is the
  // real native explicit-id adoption seam, not a second Session factory.
  const sessionId = SessionId(crypto.randomUUID());
  const create = { request: { sessionId, cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } };
  const created = await Promise.all([client.rpc<SessionCreateValue>('session/create', create), client.rpc<SessionCreateValue>('session/create', create)]);
  expect(created.map(result => value(result).sessionId)).toEqual([sessionId, sessionId]);
  const empty = CourseViewSchema.parse(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })));
  expect(empty).toMatchObject({ version: 0, data: { lessonMaterials: { materials: [] }, archived: false, closure: null, learningSetRef: null } });
  const bad = await client.rpc<CourseView>('studyforgeCourses/update', { input: { sessionId, operationId: 'attempt', expectedVersion: 0, patch: { lessonMaterials: { materials: [], initialIndex: 0 } } } });
  expect(bad.ok).toBe(false);
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })).version).toBe(0);
  const update = { input: { sessionId, operationId: 'archive', expectedVersion: 0, patch: { archived: true } } };
  const archived = value(await client.rpc<CourseView>('studyforgeCourses/update', update));
  const replay = value(await client.rpc<CourseView>('studyforgeCourses/update', update));
  expect(replay).toEqual(archived);
  expect(value(await client.rpc<SessionRenameValue>('session/rename', { request: { sessionId, title: '我指定的课名' } })).title).toBe('我指定的课名');
  const list = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
  expect(list.items.filter(row => row.sessionId === sessionId)).toHaveLength(1);
  await runtime.restart();
  client = await connectRuntime(runtime);
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }))).toEqual(archived);
  expect(value(await client.rpc<SessionCreateValue>('session/create', create)).sessionId).toBe(sessionId);
  const after = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
  expect(after.items.filter(row => row.sessionId === sessionId)).toHaveLength(1);
  expect(after.items.find(row => row.sessionId === sessionId)?.projections?.values).toMatchObject({ title: '我指定的课名' });
  expect(await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).toBe('');
}, 30_000);

test('metadata patch cannot close a classroom, forge title or attach another workspace', async () => {
  runtime = await startIsolated();
  const client = await connectRuntime(runtime);
  const own = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  for (const patch of [{ closure: { closedAt: '2026-09-12T00:00:00Z', handoffRef: 'handoff:fake' } }, { title: '第二名称' }, { sessionId: 'another' }]) {
    expect((await client.rpc('studyforgeCourses/update', { input: { sessionId: own.sessionId, operationId: crypto.randomUUID(), expectedVersion: 0, patch } })).ok).toBe(false);
  }
  const foreign = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: runtime.root, agentPreset: 'studyforge-learning' } }));
  expect((await client.rpc('studyforgeCourses/read', { input: { sessionId: foreign.sessionId } })).ok).toBe(false);
  const first = { sessionId: own.sessionId, expectedVersion: 0, patch: { archived: true } };
  const race = await Promise.all(['one', 'two'].map(operationId => client.rpc('studyforgeCourses/update', { input: { ...first, operationId } })));
  expect(race.filter(result => result.ok)).toHaveLength(1);
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId: own.sessionId } })).data.closure).toBeNull();
});

test('native prompt idempotency and accepted evidence survive restart without a second input ledger', async () => {
  runtime = await startIsolated({ testModel: true });
  let client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const prompt = { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '我先把定义域写出来' }] } };
  value(await client.rpc<SessionRenameValue>('session/rename', { request: { sessionId, title: '自己指定的课堂' } }));
  expect(value(await client.rpc('session/prompt', prompt))).toMatchObject({ accepted: true });
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running).toBe(false);
  expect(value(await client.rpc('session/prompt', prompt))).toMatchObject({ accepted: true });
  const before = value(await client.rpc<EvidenceCatalogue>('studyforgeCourses/evidence', { input: { sessionId } }));
  expect(before.entries).toHaveLength(1);
  expect(before.entries[0]).toMatchObject({ alias: 'E1', quote: '我先把定义域写出来', source: 'student_statement' });
  expect(before.skipped.assistant).toBe(1);
  expect(value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.projections?.values.title).toBe('自己指定的课堂');
  const requests = await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8');
  expect(requests).toContain('studyforge-test');
  expect(requests).toContain('study-model-a');
  const state = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  expect(state).toMatchObject({ version: 0, data: { closure: null } });
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc<EvidenceCatalogue>('studyforgeCourses/evidence', { input: { sessionId } }))).toEqual(before);
  expect(await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8')).toBe(requests);
}, 30_000);

test.each(['during', 'after', 'native-after'] as const)('an explicit native title %s generation remains durable after completion and restart', async timing => {
  runtime = await startIsolated({ testModel: true, hostEnabled: timing !== 'native-after', clientEnabled: false });
  let client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: timing === 'native-after' ? 'standard' : 'studyforge-learning' } }));
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[slow] 生成过程改名。'.repeat(10) }] } }));
  await expect.poll(async () => (await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).length).toBeGreaterThan(0);
  if (timing !== 'during') await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running, { timeout: 10_000 }).toBe(false);
  value(await client.rpc('session/rename', { request: { sessionId, title: '过程中指定的课名' } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running, { timeout: 10_000 }).toBe(false);
  expect(value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.projections?.values.title).toBe('过程中指定的课名');
  const directory = join(runtime.root, 'home/sessions');
  const cold = new Context();
  await cold.plugin(JsonlPersistence, { root: directory });
  try {
    const reader = await cold.sessionPersistence.open(sessionId, 'read');
    try {
      const titles = (await reader.read()).events.filter(event => event.type === 'session/title');
      expect(titles.at(-1)?.data).toMatchObject({ title: '过程中指定的课名', source: { kind: 'user' } });
    }
    finally { await reader.close(); }
  } finally { await cold.fiber.dispose(); }
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.projections?.values.title).toBe('过程中指定的课名');
}, 30_000);
