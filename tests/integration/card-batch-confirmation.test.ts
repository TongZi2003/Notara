import { afterEach, expect, test } from 'vitest';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { ProposalView, ProposalSelection } from '@studyforge/contracts/proposals';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { BookStructure } from '@studyforge/contracts/book-exploration';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
const value = <T>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
const selection = (view: ProposalView, ids = view.items.map(item => item.id)): ProposalSelection => ({ revision: view.version,
  items: view.items.filter(item => ids.includes(item.id)).map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })) });

test('one native batch survives restart, saves only the displayed selection once, and delivers one combined receipt', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const idle = async () => expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running).toBe(false);
  const propose = async (args: unknown) => {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tool]' + JSON.stringify({ name: 'propose_card', arguments: args }) }] } })); await idle();
  };
  const proposals = async () => value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }));
  const cards = async () => value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}));
  await propose({ kind: 'cards', title: '空批次', cards: [] });
  await propose({ kind: 'cards', title: '有坏来源', cards: [{ title: '有效草稿' }, { title: '坏来源', sources: [{ materialId: 'missing', versionId: 'missing', locator: { kind: 'pdf', page: 1 } }] }] });
  expect(await proposals()).toEqual([]); expect(await cards()).toEqual([]);
  await propose({ kind: 'cards', title: '三道原题', cards: ['加法', '减法', '乘法'].map(title => ({ title, front: title })) });
  await propose({ kind: 'card', title: '另一件事', front: '独立提案' });
  const batch = (await proposals()).find(row => row.title === '三道原题')!;
  expect(batch.items).toHaveLength(3); expect(batch.items.every(item => item.status === 'pending')).toBe(true);
  expect(await cards()).toEqual([]);
  await runtime.restart(); client = await connectRuntime(runtime);
  expect((await proposals()).find(row => row.ref === batch.ref)).toEqual(batch);
  const item = batch.items[0]!, effect = item.draft.effect;
  if (effect.kind !== 'card-create') throw new Error('expected card');
  const edited = value(await client.rpc<ProposalView>('studyforgeProposals/edit', { input: { operationId: 'batch-edit', target: batch.ref,
    expectedVersion: batch.version, edit: { itemId: item.id, effect: { ...effect, content: { ...effect.content, title: '修订后的加法' } } } } }));
  expect((await client.rpc('studyforgeProposals/confirm', { input: { operationId: 'stale-batch', target: batch.ref, selection: selection(batch) } })).ok).toBe(false);
  expect(await cards()).toEqual([]);
  const request = { operationId: 'save-two', target: batch.ref, selection: selection(edited, ['item-1', 'item-3']) };
  const saved = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: request }));
  expect(saved.items.map(item => item.status)).toEqual(['applied', 'pending', 'applied']);
  expect(saved.items.filter(item => item.receipt).every(item => item.receipt?.deliveredAt)).toBe(true);
  await idle();
  expect((await cards()).map(card => card.content.title).sort()).toEqual(['乘法', '修订后的加法']);
  expect((await cards()).every(card => !card.review && card.history.length === 0)).toBe(true);
  value(await client.rpc('studyforgeProposals/confirm', { input: request }));
  expect(await cards()).toHaveLength(2);
  expect((await proposals()).find(row => row.title === '另一件事')?.items[0]?.status).toBe('pending');
  const requests = (await readFile(join(runtime.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const receiptIds = new Set<string>();
  for (const request of requests) for (const message of request.messages ?? []) if (message.source?.kind === 'plugin' && message.source?.plugin === 'studyforge'
    && message.content?.some((block: { text?: string }) => block.text?.includes('【单据·结果】'))) receiptIds.add(message.id);
  expect(receiptIds.size).toBe(1);
  value(await client.rpc('studyforgeProposals/reject', { input: { operationId: 'skip-two', target: batch.ref, selection: selection(saved, ['item-2']) } }));
  await runtime.restart(); client = await connectRuntime(runtime);
  expect((await proposals()).find(row => row.ref === batch.ref)?.items.map(item => item.status)).toEqual(['applied', 'rejected', 'applied']);
  expect(await cards()).toHaveLength(2);
}, 60_000);

test('a node breakdown binds every card in the single batch to its frozen chapter and source', async () => {
  runtime = await startIsolated({ testModel: true }); const client = await connectRuntime(runtime);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'batch-book',
    material: { title: '算术原题', fileName: '算术.md', mediaType: 'text/markdown' }, base64: Buffer.from('计算2+3\n计算7-4\n').toString('base64') } }));
  const material = { materialId: book.materialId, versionId: book.currentVersion.versionId };
  const sources = [1, 2].map(line => ({ ...material, locator: { kind: 'text' as const, start: { line, column: 0 }, end: { line, column: 5 } } }));
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'batch-chapter', materialId: book.materialId, expectedVersion: 0,
    change: { nodes: [{ path: '算术', sources }] } } }));
  const tree = value(await client.rpc<BookStructure>('studyforgeOrganization/book', { input: { material } }));
  await writeFile(join(runtime.root, 'book-task-replies.json'), JSON.stringify([{ action: 'cards', nodePath: '算术', calls: [
    ...sources.map(source => ({ name: 'read_material', arguments: { source } })),
    { name: 'propose_card', arguments: { kind: 'cards', title: '算术 · 两道原题', cards: sources.map((source, i) => ({ title: i ? '减法' : '加法', sources: [source] })) } },
  ] }]));
  const { sessionId } = value(await client.rpc<{ sessionId: string }>('studyforgeOrganization/breakdown', { input: { operationId: 'batch-task',
    intent: { action: 'cards', material, nodePath: '算术', skeletonRevision: tree.skeletonRevision, sources } } }));
  const proposals = () => client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }).then(value);
  await expect.poll(async () => (await proposals()).length).toBe(1);
  const batch = (await proposals())[0]!;
  expect(batch.items).toHaveLength(2);
  for (const [i, item] of batch.items.entries()) expect(item.draft.effect).toMatchObject({ kind: 'card-create', content: { chapter: '算术', sources: [sources[i]] } });
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))).toEqual([]);
  const saved = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: { operationId: 'batch-task-confirm', target: batch.ref, selection: selection(batch) } }));
  expect(saved.items.every(item => item.status === 'applied')).toBe(true);
  const cards = value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}));
  expect(cards).toHaveLength(2); expect(cards.every(card => card.content.chapter === '算术' && !card.review)).toBe(true);
}, 45_000);
