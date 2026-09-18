import { afterEach, expect, test } from 'vitest';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { ClassroomTrace } from '@studyforge/contracts/classroom-trace';
import type { CourseView } from '@studyforge/contracts/courses';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
let runtime: IsolatedRuntime | undefined; afterEach(async () => { await runtime?.stop(); });
const value = <T>(r: RemoteResult<T>): T => { if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.value; };
test('thought nodes bind actual messages, edits survive restart, cycles fail and native forks do not duplicate inherited nodes', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {}));
  value(await client.rpc('studyforgeCourses/update', { input: { sessionId, operationId: 'course', expectedVersion: 0, patch: { subjects: ['物理'], teachingRef: 'feynman' } } }));
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '为什么能量守恒？' }] } }));
  await expect.poll(async () => (await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8').catch(() => '')).includes('为什么能量守恒')).toBe(true);
  const read = () => client.rpc<ClassroomTrace>('studyforgeTrace/read', { input: { sessionId } }).then(value);
  await expect.poll(async () => (await read()).nodes.some(n => n.kind === 'answer')).toBe(true);
  let graph = await read(); const original = graph.nodes[0]!;
  graph = value(await client.rpc<ClassroomTrace>('studyforgeTrace/edit', { input: { sessionId, expectedVersion: graph.version, operationId: 'note', node: { title: '先界定系统', body: '边界决定能否使用守恒。', kind: 'idea', sequence: original.sequence, position: { x: 350, y: 180 } } } }));
  const note = graph.nodes.find(n => n.title === '先界定系统')!;
  graph = value(await client.rpc<ClassroomTrace>('studyforgeTrace/edit', { input: { sessionId, expectedVersion: graph.version, operationId: 'edge', edge: { from: original.id, to: note.id, label: '需要先确定' } } }));
  expect((await client.rpc('studyforgeTrace/edit', { input: { sessionId, expectedVersion: graph.version, operationId: 'cycle', edge: { from: note.id, to: original.id, label: '循环' } } })).ok).toBe(false);
  expect((await client.rpc('studyforgeTrace/edit', { input: { sessionId, expectedVersion: 0, operationId: 'stale', node: { id: note.id, title: '覆盖', body: '', kind: 'idea' } } })).ok).toBe(false);
  const child = value(await client.rpc<{ sessionId: string }>('studyforgeTrace/fork', { input: { sessionId, atSeq: original.sequence } }));
  const fork = value(await client.rpc<ClassroomTrace>('studyforgeTrace/read', { input: child }));
  expect(fork.parent).toBe(sessionId); expect(fork.nodes).toHaveLength(0);
  const unrelated = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {}));
  const family = await read();
  expect(family.branches.map(item => item.sessionId).sort()).toEqual([sessionId, child.sessionId].sort());
  expect(family.branches.some(item => item.sessionId === unrelated.sessionId)).toBe(false);
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: child })).data).toMatchObject({ closure: null, subjects: ['物理'], teachingRef: 'feynman' });
  await runtime.restart(); client = await connectRuntime(runtime);
  expect((await read()).nodes.find(n => n.id === note.id)?.position).toEqual({ x: 350, y: 180 });
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '接着研究系统边界。' }] } }));
  await expect.poll(async () => (await read()).nodes.some(n => n.body.includes('接着研究系统边界'))).toBe(true);
  expect((await read()).nodes.some(n => n.id === original.id)).toBe(true);
}, 45_000);

test('explicit stage advancement creates half-open frames and keeps route data separate', async () => {
  runtime = await startIsolated({ testModel: true });
  let client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {}));
  const prompt = (text: string) => client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } });
  const idle = async (): Promise<void> => { await expect.poll(async () => value(await client.rpc<{ items: { sessionId: string; running?: boolean }[] }>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 30_000 }).toBe(false); };
  const read = () => client.rpc<ClassroomTrace>('studyforgeTrace/read', { input: { sessionId } }).then(value);

  value(await prompt('[tools]' + JSON.stringify([{ name: 'advance_conversation_stage', arguments: { title: '界定问题', summary: '先确认研究对象。', nextGoal: '写出第一个判断' } }])));
  await idle();
  let trace = await read();
  expect(trace.frames).toHaveLength(1);
  expect(trace.frames[0]).toMatchObject({ mode: 'root', status: 'active', goal: '写出第一个判断' });
  const firstFrame = trace.frames[0]!;

  value(await prompt('对象是函数的变化率'));
  await idle();
  trace = await read();
  expect(trace.frames.find(frame => frame.id === firstFrame.id)?.nodes.some(node => node.body.includes('函数的变化率'))).toBe(true);

  value(await prompt('[tools]' + JSON.stringify([{ name: 'advance_conversation_stage', arguments: { title: '继续验证', summary: '已经界定了变化率对象。', nextGoal: '检验一个具体例子' } }])));
  await idle();
  trace = await read();
  expect(trace.frames).toHaveLength(2);
  expect(trace.frames[0]).toMatchObject({ status: 'completed', summary: '已经界定了变化率对象。' });
  expect(trace.activeFrameId).toBe(trace.frames[1]!.id);
  expect(trace.frames[0]!.endSequence).toBe(trace.frames[1]!.startSequence);

  value(await prompt('[tools]' + JSON.stringify([{ name: 'advance_conversation_stage', arguments: { title: '换一条思路', summary: '从当前阶段分出一个验证问题。', nextGoal: '比较另一种例子', mode: 'branch' } }])));
  await idle();
  trace = await read();
  expect(trace.frames).toHaveLength(3);
  expect(trace.frames[1]).toMatchObject({ status: 'branched' });
  expect(trace.frames[2]).toMatchObject({ mode: 'branch', status: 'active', parentFrameId: trace.frames[1]!.id });
  expect(trace.branches).toHaveLength(1);
}, 90_000);
