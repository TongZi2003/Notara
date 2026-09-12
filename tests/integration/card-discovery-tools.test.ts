import { afterEach, expect, test } from 'vitest';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue, SessionPage } from '@deepseek-ai/dsh-api-session-controller';
import { CardContentSchema, CardPatchSchema, CardListResultSchema, CardBatchReadResultSchema, type CardView } from '@studyforge/contracts/cards';
import { ProposalViewSchema, type ProposalView } from '@studyforge/contracts/proposals';
import type { PlanView } from '@studyforge/contracts/plans';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }

test('native discovery is read-only and batch reads bind each card version, preserving real conflicts', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const create = async (title: string) => value(await client.rpc<CardView>('studyforgeLearning/createCard', {
    input: { operationId: title, content: CardContentSchema.parse({ title, front: '先检查条件', tags: ['函数'] }) },
  }));
  const a = await create('甲卡'), b = await create('乙卡');
  const sessionId = value(await client.rpc<SessionCreateValue>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  })).sessionId;
  const read = async (target: string) => value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target } }));
  async function call(name: string, args: unknown) {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue',
      content: [{ type: 'text', text: '[tool]' + JSON.stringify({ name, arguments: args }) }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running).toBe(false);
    const end = await client.rpc<SessionPage>('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: 1_000_000, maxMessages: 1 } });
    const cursor = end.ok ? -1 : Number(/past cursor (-?\d+)/.exec(end.error.message)?.[1] ?? -1);
    const page = value(await client.rpc<SessionPage>('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: cursor, maxMessages: 300 } }));
    const record = page.records.filter(record => record.type === 'event' && record.event.type === 'tool/result').at(-1);
    if (!record || record.type !== 'event') throw new Error('native tool result missing: ' + name);
    const result = (record.event.data as { message: { content: { isError?: boolean; content: { type: string; text?: string }[] }[] } }).message.content[0]!;
    return { failed: result.isError === true, text: result.content.flatMap(block => block.text ? [block.text] : []).join('\n') };
  }

  const first = CardListResultSchema.parse(JSON.parse((await call('list_cards', { state: 'unlearned', tags: ['函数'], limit: 1 })).text));
  expect(first.nextOffset).toBe(1);
  const second = CardListResultSchema.parse(JSON.parse((await call('list_cards', { state: 'unlearned', tags: ['函数'], limit: 1, offset: 1 })).text));
  expect(new Set([...first.cards, ...second.cards].map(card => card.ref))).toEqual(new Set([a.ref, b.ref]));
  expect((await call('update_card', { target: a.ref, patch: { notes: '只看到名单不能改' } })).failed).toBe(true);
  expect(await read(a.ref)).toEqual(a);

  const batch = await call('read_cards', { targets: [b.ref, a.ref] });
  expect(batch.failed).toBe(false);
  expect(CardBatchReadResultSchema.parse(JSON.parse(batch.text)).cards.map(card => card.ref)).toEqual([b.ref, a.ref]);
  expect((await call('update_card', { target: b.ref, patch: { notes: '批读后修改乙' } })).failed).toBe(false);
  expect((await read(b.ref)).content.notes).toBe('批读后修改乙');

  value(await client.rpc('studyforgeLearning/editCard', { input: { operationId: 'student-race', target: a.ref, expectedVersion: 1,
    patch: CardPatchSchema.parse({ front: '学生刚补的条件' }) } }));
  expect((await call('update_card', { target: a.ref, patch: { notes: '过期批读不能覆盖' } })).failed).toBe(true);
  expect((await read(a.ref)).version).toBe(2);
  expect((await call('read_cards', { targets: [a.ref, 'card:missing'] })).failed).toBe(true);
  expect((await call('update_card', { target: a.ref, patch: { notes: '失败批读也不能更新基线' } })).failed).toBe(true);
  await call('read_cards', { targets: [a.ref] });
  expect((await call('update_card', { target: a.ref, patch: { notes: '重新读后保留学生修改' } })).failed).toBe(false);
  const after = await read(a.ref);
  expect(after.content.front).toBe('学生刚补的条件');
  expect(after.review).toBeUndefined(); expect(after.history).toEqual([]);
  expect(CardListResultSchema.parse(JSON.parse((await call('list_cards', { state: 'due' })).text)).cards).toEqual([]);
  expect((await call('search_learning', { include: ['memory'] })).failed).toBe(true);
  expect(JSON.parse((await call('search_memory', { kinds: ['preference'] })).text)).toMatchObject({ hits: [] });
  // The minimal campaign is valid on the actual native tool, remains pending,
  // and receives its defaults only from the shared contract before confirmation.
  const pending = await call('propose_plan', { action: 'create', content: {
    kind: 'campaign', title: '每天复习两张', dailyCount: 2, start: first.date, end: first.date,
  } });
  expect(pending.failed).toBe(false);
  const proposal = ProposalViewSchema.parse(JSON.parse(pending.text));
  expect(value(await client.rpc<PlanView[]>('studyforgeOrganization/plans', { input: {} }))).toEqual([]);
  const confirmed = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: { operationId: 'confirm-minimal-plan', target: proposal.ref,
    selection: { revision: proposal.version, items: proposal.items.map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })) } } }));
  expect(confirmed.items[0]?.status).toBe('applied');
  expect(value(await client.rpc<PlanView[]>('studyforgeOrganization/plans', { input: {} }))[0]?.content)
    .toMatchObject({ title: '每天复习两张', dailyCount: 2, learningSetRef: null, tags: [], cards: [], schedule: [] });
  await runtime.restart();
  const reconnected = await connectRuntime(runtime);
  expect(value(await reconnected.rpc<CardView>('studyforgeLearning/card', { input: { target: a.ref } }))).toEqual(after);
}, 90_000);
