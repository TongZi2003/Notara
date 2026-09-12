import { afterEach, expect, test } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { ProposalView, ProposalSelection } from '@studyforge/contracts/proposals';
import type { CardView } from '@studyforge/contracts/cards';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import type { EvidenceCatalogue } from '@studyforge/domain/evidence';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }
function selection(view: ProposalView): ProposalSelection {
  return { revision: view.version, items: view.items.map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })) };
}

test('native proposal survives restart, confirmation saves once and its plugin receipt never becomes student evidence', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const idle = async () => expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);
  const prompt = async (text: string) => {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } })); await idle();
  };
  await prompt('[tool]' + JSON.stringify({ name: 'propose_card', arguments: { kind: 'card', title: '请你检查分母', front: '分母不能为零', presentation: 'flashcard' } }));
  let proposals = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }));
  expect(proposals).toHaveLength(1); const proposal = proposals[0]!;
  expect(proposal.items[0]?.status).toBe('pending');
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))).toEqual([]);
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }))).toEqual(proposals);
  const request = { operationId: 'confirm-one', target: proposal.ref, selection: selection(proposal) };
  const saved = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: request }));
  expect(saved.items[0]?.status).toBe('applied');
  expect(saved.items[0]?.receipt?.deliveredAt).toBeDefined();
  await idle();
  const cards = value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}));
  expect(cards).toHaveLength(1); expect(cards[0]?.content.title).toBe('请你检查分母'); expect(cards[0]?.review).toBeUndefined();
  const before = value(await client.rpc<EvidenceCatalogue>('studyforgeCourses/evidence', { input: { sessionId } }));
  expect(before.entries).toHaveLength(1);
  const requests = z.array(z.object({ sessionId: z.string().optional(), messages: z.array(z.object({ id: z.string(), source: z.object({ kind: z.string(), plugin: z.string().optional() }).passthrough() }).passthrough()) }).passthrough())
    .parse((await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as unknown));
  const last = requests.findLast(request => request.sessionId === sessionId)!;
  // Native prompt/time notices can also be plugin messages. Count our exact
  // receipt provenance, not all system traffic as if StudyForge owned it.
  expect(last.messages.filter(message => message.source.kind === 'plugin' && message.source.plugin === 'studyforge')).toHaveLength(1);
  value(await client.rpc('studyforgeProposals/confirm', { input: request }));
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))).toEqual(cards);
  expect(value(await client.rpc<EvidenceCatalogue>('studyforgeCourses/evidence', { input: { sessionId } }))).toEqual(before);

  await prompt('[tool]' + JSON.stringify({ name: 'note_method', arguments: { title: '先辨分母', body: '同除之前先排除分母为零。' } }));
  const methods = value(await client.rpc<KnowledgeView[]>('studyforgeLearning/knowledge', {}));
  expect(methods).toHaveLength(1); const method = methods[0]!; expect(method.collection).toBeUndefined();
  await prompt('[tools]' + JSON.stringify([{ name: 'read_method', arguments: { target: method.ref } }, { name: 'propose_card', arguments: { kind: 'method', target: method.ref } }]));
  proposals = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }));
  const collect = proposals.find(row => row.items[0]?.draft.effect.kind === 'knowledge-collect')!;
  expect(collect).toBeDefined();
  value(await client.rpc('studyforgeProposals/confirm', { input: { operationId: 'collect-one', target: collect.ref, selection: selection(collect) } }));
  await idle();
  const collected = value(await client.rpc<KnowledgeView[]>('studyforgeLearning/knowledge', {}));
  expect(collected).toHaveLength(1); expect(collected[0]?.ref).toBe(method.ref); expect(collected[0]?.collection).toBeDefined();
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))).toEqual(cards);
}, 50_000);
