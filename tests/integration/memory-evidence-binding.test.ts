/**
 * Memory basis binding (P7.1 evidence locality): a note/revise that omits
 * `evidenceRefs` makes the Host bind the most recent accepted student
 * utterance — the record still stores the resolved quote and message id.
 * Explicit aliases still reach earlier turns, and a receipt-opened turn with
 * no new student message binds the same most-recent utterance rather than
 * inventing a basis.
 */
import { afterEach, expect, test } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MemoryView } from '../../packages/contracts/src/memory.ts';
import type { ProposalView } from '../../packages/contracts/src/proposals.ts';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
const value = <T>(result: RemoteResult<T>): T => { expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
const memories = async (client: Awaited<ReturnType<typeof connectRuntime>>): Promise<MemoryView[]> =>
  value(await client.rpc<MemoryView[]>('studyforgeMemory/list', {}));

test('omitted evidenceRefs binds the student message that opened the turn', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  // The real student line itself carries the scripted teacher calls, so the
  // note executes inside the turn that line opened.
  await writeFile(join(runtime.root, 'teacher-replies.json'), JSON.stringify({
    '我更喜欢先猜再验证。': [
      { name: 'load_tools', arguments: { names: ['note_memory'] } },
      { name: 'note_memory', arguments: { kind: 'habit', title: '先猜再验证', body: '学生自述习惯先猜答案再验证。' } },
    ],
  }));
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const send = async (body: string): Promise<void> => {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: body }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  };
  await send('我更喜欢先猜再验证。');
  const [saved] = await memories(client);
  expect(saved?.content.title).toBe('先猜再验证');
  expect(saved?.basis.current).toHaveLength(1);
  expect(saved?.basis.current[0]?.quote).toBe('我更喜欢先猜再验证。');
}, 90_000);

test('explicit aliases still cite an earlier turn, not the current window', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const send = async (body: string): Promise<void> => {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: body }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  };
  await send('我习惯先猜答案再去验证。');
  // The [tools] directive itself opens this turn (E2); the explicit E1 still
  // resolves to the earlier real student line.
  await send('[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['note_memory'] } },
    { name: 'note_memory', arguments: { kind: 'habit', title: '先猜再验证的做题习惯', body: '学生自述习惯先猜答案再验证。', evidenceRefs: ['E1'] } },
  ]));
  const [saved] = await memories(client);
  expect(saved?.basis.current[0]?.quote).toBe('我习惯先猜答案再去验证。');
}, 90_000);

test('a receipt-opened turn still binds the most recent student utterance', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  // Turn 1 ends after the card proposal; the confirmation receipt then opens a
  // new turn whose note_memory omits refs — it binds the latest student line.
  await writeFile(join(runtime.root, 'teacher-replies.json'), JSON.stringify({
    '造一张卡。': [
      { name: 'load_tools', arguments: { names: ['propose_card', 'note_memory'] } },
      { name: 'propose_card', arguments: { kind: 'card', title: '端点代入验证' } },
      null,
      { name: 'note_memory', arguments: { kind: 'habit', title: '确认节奏的观察', body: '学生确认提案后再观察。' } },
      null,
    ],
  }));
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const send = async (body: string): Promise<void> => {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: body }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  };
  await send('造一张卡。');
  const proposal = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } })).findLast(row => row.items[0]?.status === 'pending')!;
  const item = proposal.items[0]!;
  const confirmed = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: { operationId: 'card-confirm', target: proposal.ref,
    selection: { revision: proposal.version, items: [{ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline }] } } }));
  expect(confirmed.items[0]?.status).toBe('applied');
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  const [saved] = await memories(client);
  expect(saved?.content.title).toBe('确认节奏的观察');
  expect(saved?.basis.current[0]?.quote).toBe('造一张卡。');
}, 90_000);
