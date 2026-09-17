/**
 * Teaching transparency spec: every bundled teaching text is a node in a
 * workspace-visible tree, a workspace override shadows it at every read point
 * (system prompt, task-skill invocation, delegation persona), and an AI edit
 * lands only through a student-confirmed proposal.
 */
import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { TeachingNode, TeachingResource } from '@studyforge/contracts/teaching';
import type { ProposalView } from '@studyforge/contracts/proposals';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
const value = <T>(result: RemoteResult<T>): T => { expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; };
type Request = { sessionId: string; purpose: string; messages: { role: string; content: ContentBlock[] }[]; toolNames: string[] };
const text = (row: Request): string => row.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n');
const system = (row: Request): string => row.messages.filter(message => message.role === 'system').map(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')).join('');
async function requests(): Promise<Request[]> { return (await readFile(join(runtime!.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Request).filter(row => row.purpose !== 'session-title'); }

test('the teaching tree exposes every bundled file; save, conflict and reset stay versioned', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const nodes = value(await client.rpc<TeachingNode[]>('studyforgeTeaching/resources', {}));
  const kinds = nodes.map(node => node.kind);
  expect(kinds.filter(kind => kind === 'base')).toHaveLength(1);
  expect(kinds.filter(kind => kind === 'guided')).toHaveLength(1);
  expect(kinds.filter(kind => kind === 'preset')).toHaveLength(8);
  expect(kinds.filter(kind => kind === 'skill')).toHaveLength(5);
  expect(kinds.filter(kind => kind === 'assistant')).toHaveLength(4);
  for (const node of nodes) { expect(node.origin).toBe('bundled'); expect(node.overridden).toBe(false); expect(node.editable).toBe(true); }

  const base = value(await client.rpc<TeachingResource>('studyforgeTeaching/resource', { input: { nodeId: 'base' } }));
  expect(base.bundledBody).toBe(base.body); expect(base.version).toBeNull();
  const saved = value(await client.rpc<TeachingResource>('studyforgeTeaching/saveResource', { input: { nodeId: 'base', body: '[override-marker] 自定义共同规则', expectedVersion: 0, operationId: 'teach-save-1' } }));
  expect(saved.overridden).toBe(true); expect(saved.version).toBe(1); expect(saved.body).toContain('override-marker');
  // A stale baseline is a conflict, not a silent overwrite.
  const conflict = await client.rpc('studyforgeTeaching/saveResource', { input: { nodeId: 'base', body: '并发改写', expectedVersion: 0, operationId: 'teach-save-2' } });
  expect(conflict.ok).toBe(false);
  // Re-saving after a reset still works: reset is a recorded version, not a delete.
  const reset = value(await client.rpc<TeachingResource>('studyforgeTeaching/resetResource', { input: { nodeId: 'base', expectedVersion: 1, operationId: 'teach-reset-1' } }));
  expect(reset.overridden).toBe(false); expect(reset.body).toBe(reset.bundledBody); expect(reset.version).toBe(2);
  const again = value(await client.rpc<TeachingResource>('studyforgeTeaching/saveResource', { input: { nodeId: 'base', body: '第二次覆盖', expectedVersion: 2, operationId: 'teach-save-3' } }));
  expect(again.overridden).toBe(true); expect(again.version).toBe(3);
  const missing = await client.rpc('studyforgeTeaching/resource', { input: { nodeId: 'assistant/missing' } });
  expect(missing.ok).toBe(false);
}, 30_000);

test('an override reaches the system prompt, the task skill and the delegation persona', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  value(await client.rpc('studyforgeTeaching/saveResource', { input: { nodeId: 'base', body: '[base-marker] 覆盖后的共同规则', expectedVersion: 0, operationId: 'teach-base' } }));
  value(await client.rpc('studyforgeTeaching/saveResource', { input: { nodeId: 'preset/socratic', body: '[preset-marker] 覆盖后的苏格拉底', expectedVersion: 0, operationId: 'teach-preset' } }));
  value(await client.rpc('studyforgeTeaching/saveResource', { input: { nodeId: 'skill/studyforge-semantic-search', body: '[skill-marker] 覆盖后的检索技能', expectedVersion: 0, operationId: 'teach-skill' } }));
  value(await client.rpc('studyforgeTeaching/saveResource', { input: { nodeId: 'assistant/peer', body: '[peer-marker] 覆盖后的同伴人格', expectedVersion: 0, operationId: 'teach-peer' } }));
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  const send = async (body: string): Promise<void> => {
    value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: body }] } }));
    await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  };
  await send('从当前问题开始');
  const log = await requests();
  const last = log.findLast(row => row.sessionId === sessionId)!;
  expect(system(last)).toContain('base-marker'); expect(system(last)).toContain('preset-marker');
  await send('/studyforge-semantic-search 找一下');
  expect(text((await requests()).findLast(row => row.sessionId === sessionId)!)).toContain('skill-marker');
  await send('[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['delegate_peer'] } },
    { name: 'delegate_peer', arguments: { materials: [{ title: '例子', text: '1+1=2' }], explanation: '同伴解释' } },
  ]));
  const children = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.filter(item => item.parentSessionId === sessionId);
  expect(children).toHaveLength(1);
  const child = (await requests()).find(row => row.sessionId === String(children[0]!.sessionId))!;
  expect(system(child)).toContain('peer-marker');
}, 60_000);

test('propose_teaching creates a student-confirmed proposal that writes the override', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['read_teaching', 'propose_teaching'] } },
    { name: 'read_teaching', arguments: { nodeId: 'preset/socratic' } },
    { name: 'propose_teaching', arguments: { nodeId: 'preset/socratic', body: '[ai-marker] 老师起草的新苏格拉底正文' } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  const proposal = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }))[0]!;
  expect(proposal.items[0]?.draft.effect.kind).toBe('teaching-override');
  // Not yet applied: the file the teacher runs under is untouched until confirmed.
  expect(value(await client.rpc<TeachingResource>('studyforgeTeaching/resource', { input: { nodeId: 'preset/socratic' } })).overridden).toBe(false);
  const item = proposal.items[0]!;
  const confirmed = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: { operationId: 'teach-confirm', target: proposal.ref,
    selection: { revision: proposal.version, items: [{ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline }] } } }));
  expect(confirmed.items[0]?.status).toBe('applied');
  const applied = value(await client.rpc<TeachingResource>('studyforgeTeaching/resource', { input: { nodeId: 'preset/socratic' } }));
  expect(applied.overridden).toBe(true); expect(applied.body).toContain('ai-marker'); expect(applied.version).toBe(1);
  // The confirmed body is the one the next turn actually teaches under.
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '继续' }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running, { timeout: 45_000 }).toBe(false);
  expect(system((await requests()).findLast(row => row.sessionId === sessionId)!)).toContain('ai-marker');
}, 60_000);
