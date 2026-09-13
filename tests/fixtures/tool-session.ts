import { expect } from 'vitest';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue, SessionPage } from '@deepseek-ai/dsh-api-session-controller';
import type { ProposalView, ProposalSelection } from '@studyforge/contracts/proposals';
import type { IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from './http-runtime.ts';

export function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }
export function selection(view: ProposalView): ProposalSelection {
  return { revision: view.version, items: view.items.map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })) };
}
export async function toolSession(runtime: IsolatedRuntime, existing?: string) {
  const client = await connectRuntime(runtime);
  const sessionId = existing ?? value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } })).sessionId;
  const idle = async () => { await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false); };
  async function events() {
    const end = await client.rpc<SessionPage>('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: 1_000_000, maxMessages: 1 } });
    const cursor = end.ok ? -1 : Number(/past cursor (-?\d+)/.exec(end.error.message)?.[1] ?? -1);
    return value(await client.rpc<SessionPage>('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: cursor, maxMessages: 1000 } })).records;
  }
  async function call(name: string, args: unknown) {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tool]' + JSON.stringify({ name, arguments: args }) }] } }));
    await idle();
    const record = (await events()).filter(record => record.type === 'event' && record.event.type === 'tool/result').at(-1);
    if (!record || record.type !== 'event') throw new Error('Tool result missing: ' + name);
    const result = (record.event.data as { message: { content: { isError?: boolean; content: { text?: string }[] }[] } }).message.content[0]!;
    return { failed: result.isError === true, text: result.content.flatMap(block => block.text ? [block.text] : []).join('\n') };
  }
  async function confirm(title: string) {
    const rows = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }));
    const proposal = rows.find(row => row.title === title && row.items.some(item => item.status === 'pending'));
    if (!proposal) throw new Error('Pending proposal missing: ' + title);
    const request = { operationId: crypto.randomUUID(), target: proposal.ref, selection: selection(proposal) };
    const saved = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: request }));
    await idle();
    expect(saved.items.every(item => item.status === 'applied')).toBe(true);
    return saved;
  }
  return { client, sessionId, call, confirm, idle, events };
}
