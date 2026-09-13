import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { BookStructure } from '@studyforge/contracts/book-exploration';
import type { CourseView } from '@studyforge/contracts/courses';
import { decodeSourceFragments } from '@studyforge/contracts/source-context';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(reply: RemoteResult<T>): T {
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}

test('quoted chapter sources start both directory and card tasks, preserving quotes only in the frozen reference', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'quote-book',
    material: { title: '带摘句的原题', fileName: '题目.md', mediaType: 'text/markdown' }, base64: Buffer.from('计算2+3\n计算7-4\n').toString('base64') } }));
  const material = { materialId: book.materialId, versionId: book.currentVersion.versionId };
  const sources = ['计算2+3', '计算7-4'].map((quote, index) => ({ ...material, quote,
    locator: { kind: 'text' as const, start: { line: index + 1, column: 0 }, end: { line: index + 1, column: 5 } } }));
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'quote-skeleton', materialId: book.materialId, expectedVersion: 0,
    change: { nodes: [{ path: '算术', sources }] } } }));
  const structure = value(await client.rpc<BookStructure>('studyforgeOrganization/book', { input: { material } }));
  let sessionId: string | undefined;
  for (const action of ['directory', 'cards'] as const) {
    const opened = value(await client.rpc<{ sessionId: string }>('studyforgeOrganization/breakdown', { input: {
      operationId: 'quote-' + action, ...(sessionId ? { sessionId } : {}),
      intent: { action, material, nodePath: '算术', skeletonRevision: structure.skeletonRevision, sources },
    } }));
    if (sessionId) expect(opened.sessionId).toBe(sessionId);
    sessionId = opened.sessionId;
  }
  const course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  expect(course.data.lessonMaterials.materials).toEqual(sources.map(({ quote: _quote, ...source }) => ({ kind: 'source', source })));
  const fragments = async () => {
    const logs = await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8').catch(() => '');
    return logs.trim().split('\n').filter(Boolean).flatMap(line => {
      const request = JSON.parse(line) as { purpose: string; messages: { role: string; content: { type: string; text?: string }[] }[] };
      return request.purpose === 'session-title' ? [] : request.messages.flatMap(message => message.role !== 'user' ? [] : message.content
        .flatMap(block => block.type === 'text' ? decodeSourceFragments(block.text ?? '').fragments : []));
    });
  };
  await expect.poll(async () => (await fragments()).some(fragment => fragment.bookTask?.action === 'cards'), { timeout: 20_000 }).toBe(true);
  for (const action of ['directory', 'cards']) {
    const fragment = (await fragments()).find(item => item.bookTask?.action === action)!;
    expect(fragment.bookTask?.sources).toEqual(sources);
    expect(fragment.context.selection?.sources).toEqual(sources);
  }
  expect(value(await client.rpc<BookStructure>('studyforgeOrganization/book', { input: { material } })).nodes.find(node => node.kind === 'section')?.sources).toEqual(sources);
}, 45_000);
