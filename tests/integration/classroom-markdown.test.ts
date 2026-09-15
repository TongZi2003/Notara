import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); });
const value = <T>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

async function waitIdle(client: Awaited<ReturnType<typeof connectRuntime>>, sessionId: string): Promise<void> {
  await expect.poll(async () => value(await client.rpc<{ items: { sessionId: string; running?: boolean }[] }>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 30_000 }).toBe(false);
}

test('classroom Markdown tools create one material, append versions and preserve a stale writer', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const lesson = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {}));
  const prompt = (text: string) => client.rpc('session/prompt', { request: { sessionId: lesson.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } });
  const toolPrompt = (calls: unknown[]) => prompt('[tools]' + JSON.stringify(calls));
  const source = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'classroom-source', material: { title: '课堂依据', fileName: '课堂依据.md', mediaType: 'text/markdown' }, base64: Buffer.from('变化率的定义。').toString('base64') } }));

  value(await toolPrompt([{ name: 'create_markdown_material', arguments: { title: '课堂讲义', content: '# 第一章\n\n先看定义。', references: [{ materialId: source.materialId, versionId: source.currentVersion.versionId }] } }]));
  await waitIdle(client, lesson.sessionId);
  let materials = value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {}));
  let material = materials.find(item => item.title === '课堂讲义');
  expect(material).toBeDefined();
  expect(material!.versions).toHaveLength(1);
  expect(material!.currentVersion.sources).toEqual([{ materialId: source.materialId, versionId: source.currentVersion.versionId }]);

  value(await toolPrompt([{ name: 'update_markdown_material', arguments: {
    materialId: material!.materialId, versionId: material!.currentVersion.versionId, expectedVersion: material!.revision, content: '# 第一章\n\n先看定义。\n\n## 第二章\n\n再做一题。',
  } }]));
  await waitIdle(client, lesson.sessionId);
  materials = value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {}));
  material = materials.find(item => item.materialId === material!.materialId);
  expect(material!.versions).toHaveLength(2);

  const stale = await toolPrompt([{ name: 'update_markdown_material', arguments: {
    materialId: material!.materialId, versionId: material!.versions[0]!.versionId, expectedVersion: 1, content: '覆盖较新的学生编辑',
  } }]);
  await waitIdle(client, lesson.sessionId);
  expect(stale.ok).toBe(true);
  const current = value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {})).find(item => item.materialId === material!.materialId)!;
  expect(current.versions).toHaveLength(2);
  const requests = await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8');
  expect(requests).toContain('create_markdown_material');
  expect(requests).toContain('update_markdown_material');
});
