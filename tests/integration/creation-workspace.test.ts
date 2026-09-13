import { afterEach, expect, test } from 'vitest';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { ArtifactView } from '@studyforge/contracts/creation';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); });
const value = <T>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('creator owns one native session and file; retries, stale student saves and native file writes preserve ownership', async () => {
  runtime = await startIsolated({ testModel: true }); const client = await connectRuntime(runtime);
  const input = { operationId: 'new-subject', title: '物理教法', kind: 'subject', subjects: ['物理'], references: [], content: '# 物理教法\n先观察现象，再用模型解释。' };
  let view = value(await client.rpc<ArtifactView>('studyforgeCreation/create', { input }));
  expect(value(await client.rpc<ArtifactView>('studyforgeCreation/create', { input })).ref).toBe(view.ref);
  expect((await client.rpc('studyforgeCreation/create', { input: { ...input, content: '另一个作品' } })).ok).toBe(false);
  const file = view.files.find(file => file.path === 'content.md')!;
  view = value(await client.rpc<ArtifactView>('studyforgeCreation/save', { input: { ref: view.ref, path: file.path, expectedDigest: file.digest, content: file.body + '\n让学生自己画受力图。' } }));
  expect((await client.rpc('studyforgeCreation/save', { input: { ref: view.ref, path: file.path, expectedDigest: file.digest, content: '覆盖新内容' } })).ok).toBe(false);
  expect((await client.rpc('studyforgeCreation/save', { input: { ref: view.ref, path: '../outside.md', expectedDigest: file.digest, content: 'x' } })).ok).toBe(false);
  const sessionId = view.sessionId;
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '一起完善这份教法' }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);
  const requests = await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8');
  expect(requests).toContain('你是创作者'); expect(requests).toContain('本次作品目录');
  expect(value(await client.rpc<ArtifactView>('studyforgeCreation/read', { input: { ref: view.ref } })).files.find(file => file.path === 'content.md')!.body).toContain('自己画受力图');
  expect((await client.rpc('studyforgeCourses/read', { input: { sessionId } })).ok).toBe(false);
  const path = 'packs/work-' + view.ref.slice('creation:'.length) + '/content.md';
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'read', arguments: { file_path: path } }, { name: 'write', arguments: { file_path: path, content: '# 物理教法\n原生工具和用户共同编辑。' } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<ArtifactView>('studyforgeCreation/read', { input: { ref: view.ref } })).files.find(file => file.path === 'content.md')!.body).toContain('原生工具和用户共同编辑');
  expect((await client.rpc('studyforgeCreation/save', { input: { ref: view.ref, path: 'content.md', expectedDigest: view.files.find(file => file.path === 'content.md')!.digest, content: '覆盖原生修改' } })).ok).toBe(false);
  view = value(await client.rpc<ArtifactView>('studyforgeCreation/read', { input: { ref: view.ref } }));
  await runtime.restart();
  const reconnected = await connectRuntime(runtime);
  expect(value(await reconnected.rpc<ArtifactView>('studyforgeCreation/read', { input: { ref: view.ref } })).digest).toBe(view.digest);
}, 45_000);
