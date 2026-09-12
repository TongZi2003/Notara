import { afterEach, expect, test } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { ProposalView } from '@studyforge/contracts/proposals';
import type { SkeletonView } from '@studyforge/contracts/skeleton';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }
async function fixture() {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'book', material: { title: '公式', fileName: '公式.md', mediaType: 'text/markdown' }, base64: Buffer.from('公式\n').toString('base64') } }));
  const { sessionId } = value(await client.rpc<{ sessionId: string }>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const node = (path: string) => ({ path, sources: [{ materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } } }] });
  const read = { name: 'read_skeleton', arguments: { materialId: book.materialId } };
  const propose = (path: string) => ({ name: 'propose_skeleton', arguments: { materialId: book.materialId, change: { nodes: [node(path)] } } });
  async function send(calls: unknown[]) {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify(calls) }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running, { timeout: 30_000 }).toBe(false);
  }
  const proposals = async () => value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }));
  const skeleton = async () => value(await client.rpc<SkeletonView>('studyforgeMaterials/skeleton', { input: { materialId: book.materialId } }));
  const decision = (proposal: ProposalView) => ({ operationId: crypto.randomUUID(), target: proposal.ref, selection: { revision: proposal.version, items: proposal.items.map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })) } });
  const confirm = async (proposal: ProposalView) => value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: decision(proposal) }));
  return { client, book, node, read, propose, send, proposals, skeleton, decision, confirm };
}

test('after saving a skeleton, a stale teacher proposal is rejected until it rereads the directory', async () => {
  const f = await fixture();
  await f.send([f.read, f.propose('和差公式')]);
  await f.confirm((await f.proposals())[0]!);
  await f.send([f.propose('和差公式/直接求值')]);
  expect(await f.proposals()).toHaveLength(1);
  const requests = await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8');
  expect(requests).toContain('请先调用 read_skeleton');
  await f.send([f.read, f.propose('和差公式/直接求值')]);
  const child = (await f.proposals()).find(proposal => proposal.items[0]?.baseline === 1)!;
  expect(child).toBeDefined();
  expect((await f.confirm(child)).items[0]?.status).toBe('applied');
  expect((await f.skeleton()).nodes.map(node => node.path)).toEqual(['和差公式', '和差公式/直接求值']);
}, 60_000);

test('a directory created after a proposal is a definite conflict, then explicit recheck and confirmation save once', async () => {
  const f = await fixture();
  await f.send([f.read, f.propose('和差公式/直接求值')]);
  const pending = (await f.proposals())[0]!;
  value(await f.client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'another-save', materialId: f.book.materialId, expectedVersion: 0, change: { nodes: [f.node('和差公式'), f.node('二倍角')] } } }));
  const failed = await f.confirm(pending);
  expect(failed.items[0]?.failure).toMatchObject({ code: 'record_exists', commit: 'none', retryable: false });
  const current = await f.skeleton(), item = failed.items[0]!;
  const refreshed = value(await f.client.rpc<ProposalView>('studyforgeProposals/edit', { input: { operationId: 'recheck', target: failed.ref, expectedVersion: failed.version, edit: { itemId: item.id, effect: item.draft.effect, target: item.target, baseline: current.revision } } }));
  expect(refreshed.items[0]).toMatchObject({ status: 'pending', baseline: 1 });
  expect((await f.skeleton()).revision).toBe(1);
  const input = f.decision(refreshed);
  expect(value(await f.client.rpc<ProposalView>('studyforgeProposals/confirm', { input })).items[0]?.status).toBe('applied');
  const saved = await f.skeleton();
  expect(saved.nodes.map(node => node.path)).toEqual(['和差公式', '二倍角', '和差公式/直接求值']);
  value(await f.client.rpc('studyforgeProposals/confirm', { input }));
  expect(await f.skeleton()).toEqual(saved);
}, 60_000);
