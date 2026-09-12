import { afterEach, expect, test } from 'vitest';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { FrozenSource } from '@studyforge/contracts/source-context';
import type { EvidenceCatalogue } from '@studyforge/domain/evidence';
import type { LessonResourcesProjection } from '@studyforge/domain/lesson-resources';
import type { LearningSearchResult } from '@studyforge/contracts/learning-search';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }

test('native accepted source context retains v1 across version updates and restart; source text is not the student answer', async () => {
  runtime = await startIsolated({ testModel: true });
  let client = await connectRuntime(runtime);
  const material = { title: '原题', fileName: '原题.md', mediaType: 'text/markdown' };
  const imported = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: crypto.randomUUID(), material, base64: Buffer.from('原题\n递增区间\n').toString('base64') } }));
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const source = { materialId: imported.materialId, versionId: imported.currentVersion.versionId, locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 4 } } };
  const frozen = value(await client.rpc<FrozenSource>('studyforgeSources/freeze', { input: { sessionId, context: { selection: { text: '被渲染转换的文字', sources: [source] } } } }));
  expect(frozen.fragment.context.selection?.text).toBe('递增区间');
  expect(frozen.images).toEqual([]);
  value(await client.rpc('studyforgeMaterials/createVersion', { input: { operationId: crypto.randomUUID(), expectedVersion: imported.revision, material: { ...material, materialId: imported.materialId }, base64: Buffer.from('第二版完全不同').toString('base64') } }));
  const text = '我的判断是它递增。' + frozen.modelText;
  const request = { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } };
  value(await client.rpc('session/prompt', request));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);
  const evidence = value(await client.rpc<EvidenceCatalogue>('studyforgeCourses/evidence', { input: { sessionId } }));
  expect(evidence.entries).toHaveLength(1);
  expect(evidence.entries[0]).toMatchObject({ quote: '我的判断是它递增。', source: 'classroom_evidence', objects: [{ ref: 'material:' + imported.materialId, version: imported.currentVersion.digest }] });
  const resources = value(await client.rpc<LessonResourcesProjection>('studyforgeMaterials/lessonResources', { input: { sessionId } }));
  expect(resources.resources).toHaveLength(1);
  expect(resources.resources[0]?.source).toEqual(source);
  expect(resources.resources[0]?.origins).toEqual([{ from: 'message', messageId: evidence.entries[0]!.messageId }]);
  const search = value(await client.rpc<LearningSearchResult>('studyforgeMaterials/search', { input: { query: '第二版' } }));
  expect(search.hits).toHaveLength(1);
  expect(search.hits[0]?.source?.versionId).not.toBe(imported.currentVersion.versionId);
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc<EvidenceCatalogue>('studyforgeCourses/evidence', { input: { sessionId } }))).toEqual(evidence);
  expect(value(await client.rpc<LessonResourcesProjection>('studyforgeMaterials/lessonResources', { input: { sessionId } }))).toEqual(resources);
  expect(value(await client.rpc('session/prompt', request))).toMatchObject({ accepted: true });
  expect(value(await client.rpc<EvidenceCatalogue>('studyforgeCourses/evidence', { input: { sessionId } }))).toEqual(evidence);
}, 30_000);
