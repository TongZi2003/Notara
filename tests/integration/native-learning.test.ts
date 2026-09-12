import { afterEach, expect, test } from 'vitest';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import { CardContentSchema, CardPatchSchema, type CardView } from '@studyforge/contracts/cards';
import type { OutputProjection } from '@studyforge/domain/outputs';
import type { LearningSearchResult } from '@studyforge/contracts/learning-search';
import type { ReviewResult } from '@studyforge/domain/review';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }

test('student creation, native teacher edits, conflicts, actual learning and restart share the same card', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const card = value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'create', content: CardContentSchema.parse({ title: '同除的条件', front: '先看分母', sections: [{ heading: '复习', body: '作者写的复习段' }] }) } }));
  expect(card.review).toBeUndefined();
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  async function prompt(text: string) {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);
  }
  await prompt('[tool]' + JSON.stringify({ name: 'read_card', arguments: { target: card.ref } }));
  expect(value(await client.rpc<OutputProjection>('studyforgeCourses/outputs', { input: { sessionId } })).entries).toEqual([]);
  const student = value(await client.rpc<CardView>('studyforgeLearning/editCard', { input: { operationId: 'student-edit', target: card.ref, expectedVersion: 1, patch: CardPatchSchema.parse({ front: '学生补了定义域' }) } }));
  expect(student.version).toBe(2);
  await prompt('[tool]' + JSON.stringify({ name: 'update_card', arguments: { target: card.ref, patch: { notes: '过期的修改' } } }));
  expect(value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } })).version).toBe(2);
  await prompt('[tools]' + JSON.stringify([
    { name: 'read_card', arguments: { target: card.ref } },
    { name: 'update_card', arguments: { target: card.ref, patch: { notes: '教师补充检验零点', tags: ['定义域'] } } },
  ]));
  const after = value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } }));
  expect(after.version).toBe(3);
  expect(after.content.front).toBe('学生补了定义域');
  expect(after.content.sections).toEqual(card.content.sections);
  expect(after.content.notes).toBe('教师补充检验零点');
  const outputs = value(await client.rpc<OutputProjection>('studyforgeCourses/outputs', { input: { sessionId } }));
  expect(outputs.entries).toHaveLength(1);
  expect(outputs.entries[0]).toMatchObject({ target: card.ref, revision: 3, status: 'saved' });
  const search = value(await client.rpc<LearningSearchResult>('studyforgeMaterials/search', { input: { query: '学生补了定义域' } }));
  expect(search.hits.find(hit => hit.ref === card.ref)?.revision).toBe(3);
  const reviewInput = { operationId: 'explicit-grade', target: card.ref, mark: '初' };
  const learned = value(await client.rpc<ReviewResult>('studyforgeLearning/review', { input: reviewInput }));
  expect(learned.card.review?.reviewCount).toBe(0);
  expect(learned.card.history).toHaveLength(1);
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } }))).toEqual(learned.card);
  expect(value(await client.rpc<ReviewResult>('studyforgeLearning/review', { input: reviewInput })).mode).toBe('duplicate');
  expect(value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } })).history).toHaveLength(1);
}, 40_000);
