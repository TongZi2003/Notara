import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { CourseView } from '@studyforge/contracts/courses';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import type { ProposalView } from '@studyforge/contracts/proposals';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
const value = <T>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
type Request = { sessionId: string; purpose: string; messages: { role: string; source: { kind: string; plugin?: string }; content: { type: string; text?: string }[] }[]; toolNames: string[] };
const transcript = (row: Request) => row.messages.flatMap(message => message.content.flatMap(block => block.text ? [block.text] : [])).join('\n');
async function requests(): Promise<Request[]> { return (await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Request).filter(row => row.purpose !== 'session-title'); }

test('teacher lesson settings are a proposal over the exact observed current lesson, then the student confirms', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'read_lesson', arguments: {} }, { name: 'propose_lesson_settings', arguments: { teachingRef: 'brainstorm', temporaryInstructions: '先比较两种方法。' } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 30_000 }).toBe(false);
  const proposal = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }))[0]!;
  expect(proposal.items[0]?.draft.effect.kind).toBe('lesson-edit');
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })).data.teachingRef).toBeUndefined();
  const confirmed = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: { operationId: 'lesson-choice', target: proposal.ref,
    selection: { revision: proposal.version, items: proposal.items.map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })) } } }));
  expect(confirmed.items[0]?.status).toBe('applied');
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })).data).toMatchObject({ sessionId, teachingRef: 'brainstorm', temporaryInstructions: '先比较两种方法。', closure: null });
}, 45_000);

test('five configured teaching choices change the actual next native request and survive restart', async () => {
  runtime = await startIsolated({ testModel: true });
  let client = await connectRuntime(runtime);
  const choices = value(await client.rpc<TeachingChoice[]>('studyforgeTeaching/choices', {}));
  expect(choices.map(choice => choice.title)).toEqual(['资料整理','诊断分析','苏格拉底授课','头脑风暴拓展','搜索']);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  async function send(text: string): Promise<Request> {
    const count = await requests().then(rows => rows.length).catch(() => 0);
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } }));
    await expect.poll(async () => (await requests()).length).toBeGreaterThan(count);
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);
    return (await requests()).at(-1)!;
  }
  const first = await send('从当前问题开始');
  expect(transcript(first)).toContain('# 苏格拉底授课');
  expect(first.toolNames).toContain('read_memory');
  let course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  course = value(await client.rpc<CourseView>('studyforgeCourses/update', { input: { sessionId, operationId: crypto.randomUUID(), expectedVersion: course.version, patch: { teachingRef: 'search', temporaryInstructions: '本轮优先核对官方来源。' } } }));
  const changed = await send('现在按这个要求继续');
  expect(changed.sessionId).toBe(sessionId);
  expect(transcript(changed)).toContain('# 搜索');
  expect(transcript(changed)).toContain('本轮优先核对官方来源。');
  expect(changed.toolNames).toContain('web_search');
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }))).toEqual(course);
  const resumed = await send('重开后继续');
  expect(transcript(resumed)).toContain('本轮优先核对官方来源。');
}, 45_000);

test('receipt-only native followup has no tools and a later student turn regains them', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tool]' + JSON.stringify({ name: 'propose_card', arguments: { kind: 'card', title: '题卡', presentation: 'problem', front: '题面', sections: [], notes: '', sources: [], tags: [], links: [] } }) }] } }));
  await expect.poll(async () => value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } })).length).toBe(1);
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running).toBe(false);
  const proposal = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }))[0]!;
  const item = proposal.items[0]!;
  value(await client.rpc('studyforgeProposals/confirm', { input: { operationId: crypto.randomUUID(), target: proposal.ref, selection: { revision: proposal.version, items: [{ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline }] } } }));
  await expect.poll(async () => (await requests()).filter(row => row.messages.findLast(message => message.role === 'user')?.source.kind === 'plugin').length).toBeGreaterThan(0);
  const receipt = (await requests()).findLast(row => row.messages.findLast(message => message.role === 'user')?.source.kind === 'plugin')!;
  expect(receipt.toolNames).toEqual([]);
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '现在继续学这张卡' }] } }));
  await expect.poll(async () => transcript((await requests()).at(-1)!)).toContain('现在继续学这张卡');
  expect((await requests()).at(-1)!.toolNames).toContain('read_card');
}, 45_000);
