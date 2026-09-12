import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { MaterialResource, MaterialBytes } from '@studyforge/contracts/material-api';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }

test('authenticated material import/read needs no Session, and native file addresses retain the exact version', async () => {
  runtime = await startIsolated({ testModel: true });
  let client = await connectRuntime(runtime);
  const input = { operationId: crypto.randomUUID(), material: { title: '函数讲义', fileName: '函数.md', mediaType: 'text/markdown' }, base64: Buffer.from('# 函数\n\n不可变原文😀\n').toString('base64') };
  const imported = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input }));
  const source = { materialId: imported.materialId, versionId: imported.currentVersion.versionId };
  const bytes = value(await client.rpc<MaterialBytes>('studyforgeMaterials/bytes', { input: source }));
  expect(bytes.base64).toBe(input.base64);
  expect(value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items).toHaveLength(0);
  expect(value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input }))).toEqual(imported);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const resource = value(await client.rpc<MaterialResource>('studyforgeMaterials/resolveForSession', { input: { sessionId, source } }));
  const address = parseFileAddress(resource.address)!;
  expect(address).toMatchObject({ scope: 'session', sessionId });
  expect((await client.rpc('workspaceFiles/readAll', { workspaceFileScopeId: sessionId, path: address.path })).ok).toBe(true);
  const other = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: runtime.root, agentPreset: 'studyforge-learning' } }));
  expect((await client.rpc('studyforgeMaterials/resolveForSession', { input: { sessionId: other.sessionId, source } })).ok).toBe(false);
  value(await client.rpc('studyforgeMaterials/createVersion', { input: { operationId: crypto.randomUUID(), expectedVersion: imported.revision, material: { ...input.material, materialId: imported.materialId }, base64: Buffer.from('明确的新版本').toString('base64') } }));
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc<MaterialBytes>('studyforgeMaterials/bytes', { input: source })).base64).toBe(input.base64);
  expect(await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).toBe('');
}, 30_000);

test('read_material sends the real crop as a native image attachment into the next model request', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const pixels = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#2040e0' } }).png().toBuffer();
  const imported = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: crypto.randomUUID(), material: { title: '题图', fileName: '题图.png', mediaType: 'image/png' }, base64: pixels.toString('base64') } }));
  const source = { materialId: imported.materialId, versionId: imported.currentVersion.versionId, locator: { kind: 'image', rect: [0, 0, 0.5, 1] } };
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const text = '[tool]' + JSON.stringify({ name: 'read_material', arguments: { source } });
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);
  const requests = (await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const resumed = requests.find(request => request.purpose !== 'session-title' && request.messages.some((message: { content: { type: string }[] }) => message.content.some(block => block.type === 'tool-result')));
  expect(resumed, runtime.log()).toBeDefined();
  const tool = resumed.messages.flatMap((message: { content: unknown[] }) => message.content).findLast((block: { type: string }) => block.type === 'tool-result');
  expect(JSON.stringify(tool), runtime.log()).not.toContain('isError":true');
  const image = tool.content.find((block: { type: string }) => block.type === 'image');
  expect(image).toMatchObject({ type: 'image', attachment: { mediaType: 'image/png', width: 50, height: 80 } });
  const returned = JSON.parse(tool.content.find((block: { type: string }) => block.type === 'text').text);
  expect(returned.source).toEqual(source);
  expect(image.attachment.attachmentId).toBeTypeOf('string');
}, 30_000);
