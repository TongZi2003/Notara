import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { PluginCandidate, PluginView, WorkbenchContent } from '@studyforge/contracts/plugins';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
const value = <T>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
type Request = { sessionId: string; purpose: string; toolNames: string[]; messages: { role: string; source?: { kind?: string; form?: string }; content: ContentBlock[] }[] };
const requests = async (): Promise<Request[]> => (await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Request).filter(row => row.purpose !== 'session-title');
const calls = (rows: { name: string; arguments: unknown }[]) => '[tools]' + JSON.stringify(rows);
const texts = (row: Request) => row.messages.flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
const lastResult = (row: Request, name: string) => {
  const blocks = row.messages.flatMap(m => m.content);
  const call = blocks.findLast(b => b.type === 'tool-call' && b.name === name);
  if (call?.type !== 'tool-call') throw new Error(`missing ${name} call`);
  return blocks.find(b => b.type === 'tool-result' && b.toolCallId === call.id);
};

const point = (x: number, y: number) => ({ kind: 'point', name: 'A', x, y, draggable: true, color: 'accent', visible: true });
const scene = (objects: unknown[], patch: Record<string, unknown> = {}) => ({
  kind: 'math', title: '数学探索', viewport: [-5, 5, 5, -5],
  space: { bounds: [[-5, 5], [-5, 5], [-5, 5]], azimuth: .8, elevation: .35 },
  view: '2d', parameters: [], objects, observation: '', links: [], ...patch,
});

test('board writes record labelled activity, the activity tool reads it, and the teacher prompt sees it', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/math-workbench') } }));
  const plugin = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const lesson = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } })).sessionId;
  const send = async (text: string): Promise<Request> => {
    const before = await requests().then(rows => rows.length).catch(() => 0);
    value(await client.rpc('session/prompt', { request: { sessionId: lesson, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } }));
    await expect.poll(async () => (await requests()).length, { timeout: 30_000 }).toBeGreaterThan(before);
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === lesson)?.running, { timeout: 30_000 }).toBe(false);
    return (await requests()).filter(row => row.sessionId === lesson).at(-1)!;
  };
  const id = 'plugin-' + plugin.ref.slice(7) + '-board';
  const content = value(await client.rpc<WorkbenchContent>('studyforgePlugins/openWorkbench', { input: { sessionId: lesson, id } }));
  const write = (expectedVersion: number, document: unknown, operationId: string, labels?: string[]) => client.rpc('notaraWorkbench/writeDocument', {
    input: { sessionId: lesson, id, digest: content.digest, expectedVersion, operationId, json: JSON.stringify(document), ...(labels ? { op: { labels } } : {}) },
  }).then(reply => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value as { revision: number } });

  // Student writes: a labelled create, a labelled drag, and an unlabelled viewport change.
  const first = await write(0, scene([point(0, 0)]), 'op-create', ['添加点 A']);
  const second = await write(first.revision, scene([point(2, 3)]), 'op-drag', ['移动 A']);
  await write(second.revision, scene([point(2, 3)], { viewport: [-2, 8, 6, -4] }), 'op-pan');

  // The teacher's own write goes through the facade and is attributed separately.
  const teacher = await send(calls([{ name: 'board', arguments: { method: 'update', input: { id, expectedVersion: second.revision + 1, documentJson: JSON.stringify(scene([point(2, 3)], { title: '教师改的标题', viewport: [-2, 8, 6, -4] })) } } }]));
  expect(lastResult(teacher, 'board')).toMatchObject({ isError: false });

  const activity = await send(calls([{ name: 'board', arguments: { method: 'activity', input: { id } } }]));
  const result = lastResult(activity, 'board');
  expect(result).toMatchObject({ isError: false });
  const { events } = JSON.parse((result as { content: { text: string }[] }).content.map(b => b.text).join('')) as { events: { actor: string; kind: string; revision?: number; labels?: string[]; detail?: string }[] };
  expect(events.length).toBe(4);
  expect(events[0]).toMatchObject({ actor: 'student', kind: 'document', revision: 1 });
  const drag = events.find(entry => entry.labels?.includes('移动 A'));
  expect(drag).toMatchObject({ actor: 'student', detail: expect.stringContaining('A 移到') });
  expect(events.some(entry => entry.detail?.includes('调整视区'))).toBe(true);
  expect(events.at(-1)).toMatchObject({ actor: 'teacher' });

  // The listing form reports the board without dumping entries.
  const listing = await send(calls([{ name: 'board', arguments: { method: 'activity', input: {} } }]));
  const listed = JSON.parse(((lastResult(listing, 'board') as { content: { text: string }[] }).content[0]!.text)) as { workbenches: { id: string; events: number }[] };
  expect(listed.workbenches).toContainEqual(expect.objectContaining({ id, events: 4 }));

  // The next request carries the injected snapshot: student steps only.
  const follow = await send('我们继续');
  const snapshot = texts(follow).find(text => text.includes('学生近期在工作台上的操作'));
  expect(snapshot).toBeTruthy();
  expect(snapshot).toContain('移动 A');
  expect(snapshot).not.toContain('教师改的标题');
}, 120_000);
