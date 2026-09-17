/**
 * Classroom role creation goes through a student-confirmed proposal:
 * propose_classmate freezes the role against the worldbook revision, nothing is
 * written before confirmation, and a stale baseline or a duplicate is refused.
 */
import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { PluginCandidate, PluginView, WorldbookView } from '@studyforge/contracts/plugins';
import type { ProposalView } from '@studyforge/contracts/proposals';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

const fixture = JSON.parse(await readFile(resolve('tests/fixtures/classroom-seed.json'), 'utf8'));
let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
const value = <T>(reply: RemoteResult<T>): T => { expect(reply.ok, JSON.stringify(reply)).toBe(true); if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

const naruto = {
  id: 'naruto', name: '鸣人', purpose: '在学生自我怀疑时鼓励他继续动笔',
  instructions: '你是漩涡鸣人。用直白、不认输的语气回应学生的泄气话；只鼓励，不教题、不替学生做题。',
  enabled: true, personality: '热血不服输',
  greeting: '我是鸣人！遇到困难我也不会退缩的！',
  talkativeness: 60,
  relations: [{ target: 'student', label: '同桌', note: '互相打气的同桌。' }],
};

test('propose_classmate freezes the role; confirmation appends it at the frozen baseline', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const candidate = value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare', { input: { kind: 'directory', path: resolve('examples/plugins/worldbook') } }));
  const installed = value(await client.rpc<PluginView>('studyforgePlugins/installPackage', { input: { candidateId: candidate.candidateId, expectedVersion: 0, trustNative: false } }));
  const session = value(await client.rpc<{ sessionId: string }>('studyforgeCreation/openTeacher', {}));
  const id = 'plugin-' + installed.ref.slice(7) + '-worldbook', target = { ...session, id };
  let world = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  world.document.classroom = structuredClone(fixture.classroom);
  world = value(await client.rpc<WorldbookView>('studyforgePlugins/saveWorldbook', { input: { ...target, expectedVersion: world.revision, operationId: 'seed', document: world.document } }));
  value(await client.rpc('studyforgePlugins/useWorldbook', { input: { ...target, expectedVersion: world.useRevision, enabled: true } }));
  const roleCount = world.document.classroom!.roles.length;

  // The teacher proposes after reading the classroom; nothing is written yet.
  value(await client.rpc('session/prompt', { request: { sessionId: session.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['read_classroom', 'propose_classmate'] } },
    { name: 'read_classroom', arguments: { id } },
    { name: 'propose_classmate', arguments: { id, role: naruto } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === session.sessionId)?.running, { timeout: 45_000 }).toBe(false);
  const proposal = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: session }))[0]!;
  expect(proposal.items[0]?.draft.effect.kind).toBe('classmate-role');
  expect(value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target })).document.classroom!.roles).toHaveLength(roleCount);

  // A concurrent student edit bumps the revision; the frozen baseline is refused.
  const moved = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  moved.document.entries = [...moved.document.entries, { title: '学生补充', content: '学生自己加的条目', keywords: [], enabled: true, always: false }];
  value(await client.rpc('studyforgePlugins/saveWorldbook', { input: { ...target, expectedVersion: moved.revision, operationId: 'student-edit', document: moved.document } }));
  const item = proposal.items[0]!;
  const stale = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: { operationId: 'role-stale', target: proposal.ref,
    selection: { revision: proposal.version, items: [{ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline }] } } }));
  expect(stale.items[0]?.status).toBe('failed');
  expect(stale.items[0]?.failure?.code).toContain('version_conflict');

  // Re-propose on the fresh baseline, then confirm: the role lands, entries stay.
  value(await client.rpc('session/prompt', { request: { sessionId: session.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'read_classroom', arguments: { id } },
    { name: 'propose_classmate', arguments: { id, role: naruto } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === session.sessionId)?.running, { timeout: 45_000 }).toBe(false);
  const fresh = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: session })).findLast(row => row.items[0]?.status === 'pending')!;
  const freshItem = fresh.items[0]!;
  const confirmed = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: { operationId: 'role-confirm', target: fresh.ref,
    selection: { revision: fresh.version, items: [{ itemId: freshItem.id, draft: freshItem.draft.revision, digest: freshItem.draft.digest, target: freshItem.target, baseline: freshItem.baseline }] } } }));
  expect(confirmed.items[0]?.status).toBe('applied');
  const after = value(await client.rpc<WorldbookView>('studyforgePlugins/readWorldbook', { input: target }));
  const saved = after.document.classroom!.roles.find(role => role.id === 'naruto');
  expect(saved?.name).toBe('鸣人');
  expect(saved?.relations?.[0]?.target).toBe('student');
  expect(after.document.classroom!.roles).toHaveLength(roleCount + 1);
  expect(after.document.entries.some(entry => entry.title === '学生补充')).toBe(true);

  // A second role with the same id is refused at proposal time, not on write.
  value(await client.rpc('session/prompt', { request: { sessionId: session.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'propose_classmate', arguments: { id, role: { ...naruto, name: '另一个鸣人' } } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === session.sessionId)?.running, { timeout: 45_000 }).toBe(false);
  const proposals = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: session }));
  expect(proposals.filter(row => row.items[0]?.draft.effect.kind === 'classmate-role' && row.items[0]?.status === 'pending')).toHaveLength(0);
}, 90_000);
