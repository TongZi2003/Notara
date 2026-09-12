import { afterEach, expect, test } from 'vitest';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { SetView } from '@studyforge/contracts/sets';
import type { RouteNode, RouteView } from '@studyforge/contracts/routes';
import type { PlanView, SkeletonPreview } from '@studyforge/contracts/plans';
import type { SkeletonView } from '@studyforge/contracts/skeleton';
import type { BookStructure } from '@studyforge/contracts/book-exploration';
import type { CourseView } from '@studyforge/contracts/courses';
import type { CardView } from '@studyforge/contracts/cards';
import type { ProposalView } from '@studyforge/contracts/proposals';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const call = <T>(client: Awaited<ReturnType<typeof connectRuntime>>, method: string, payload: unknown) =>
  client.rpc<T>(method, payload);

test('one native route proposal can confirm a tree of new nodes without model-written persistent ids', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const session = value(await client.rpc<{ sessionId: string }>('session/create', { request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  value(await client.rpc('session/prompt', { request: { sessionId: session.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tool]' + JSON.stringify({ name: 'propose_route', arguments: { action: 'add', nodes: [
    { title: '树根' }, { title: '第一支', parentIndex: 0 }, { title: '子节', parentIndex: 1 },
  ] } }) }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === session.sessionId)?.running, { timeout: 40_000 }).toBe(false);
  const proposal = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId: session.sessionId } }))[0]!;
  expect(proposal.items).toHaveLength(3);
  const confirmed = value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: { operationId: 'confirm-tree', target: proposal.ref, selection: { revision: proposal.version,
    items: proposal.items.map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })) } } }));
  expect(confirmed.items.map(item => item.status)).toEqual(['applied', 'applied', 'applied']);
  const tree = value(await client.rpc<RouteView>('studyforgeOrganization/route', {}));
  const root = tree.nodes.find(node => node.title === '树根')!, child = tree.nodes.find(node => node.title === '第一支')!, leaf = tree.nodes.find(node => node.title === '子节')!;
  expect(child.parent).toBe(root.id); expect(leaf.parent).toBe(child.id); expect(tree.nodes.every(node => !node.session)).toBe(true);
}, 60_000);

/** One real markdown book with two readable lines, imported through the native Host. */
async function importBook(client: Awaited<ReturnType<typeof connectRuntime>>, operationId: string) {
  const bytes = Buffer.from('定义域\n单调性\n', 'utf8').toString('base64');
  const book = value(await call<MaterialView>(client, 'studyforgeMaterials/import', {
    input: { operationId, material: { title: '函数', fileName: '函数.md', mediaType: 'text/markdown' }, base64: bytes },
  }));
  const versionId = book.currentVersion.versionId;
  const line = (line: number) => ({ materialId: book.materialId, versionId, locator: { kind: 'text' as const, start: { line, column: 0 }, end: { line, column: 3 } }, quote: line === 1 ? '定义域' : '单调性' });
  return { book, versionId, anchor: line(1), other: line(2) };
}

test('the organisation surface stores only real references and opens one native lesson per planned node', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const { book, versionId, anchor } = await importBook(client, 'book');

  // A learning set groups the real original it was given, and a replay is one effect.
  const set = value(await call<SetView>(client, 'studyforgeOrganization/createSet', {
    input: { operationId: 'set', set: { name: '高考数学', ladder: [1, 3, 7], materials: [book.materialId] } },
  }));
  expect(set.materials).toEqual([book.materialId]);
  expect(value(await call<SetView[]>(client, 'studyforgeOrganization/sets', { input: {} })).map(row => row.name)).toEqual(['高考数学']);
  const ladder = { operationId: 'ladder', ref: set.ref, expectedVersion: set.version, patch: { ladder: [1, 5, 9] } };
  const updated = value(await call<SetView>(client, 'studyforgeOrganization/updateSet', { input: ladder }));
  expect(updated.ladder).toEqual([1, 5, 9]);
  expect(value(await call<SetView>(client, 'studyforgeOrganization/updateSet', { input: ladder }))).toEqual(updated);
  // A set may not group an original this workspace does not hold.
  expect((await call(client, 'studyforgeOrganization/createSet', { input: { operationId: 'ghost-set', set: { name: '野书集', materials: ['mat_zzzzzzzzzzzzzzzz'] } } })).ok).toBe(false);
  // It may be born holding real cards ("把这批错题放进期末复习"), and a member
  // that is not a real card is refused at creation.
  const member = value(await call<CardView>(client, 'studyforgeLearning/createCard', { input: { operationId: 'member-card', content: { title: '错题', front: '先看分母' } } }));
  const born = value(await call<SetView>(client, 'studyforgeOrganization/createSet', { input: { operationId: 'born-set', set: { name: '期末复习', ladder: [1, 5, 9], members: [member.ref] } } }));
  expect(born.members).toEqual([member.ref]);
  expect(value(await call<SetView[]>(client, 'studyforgeOrganization/cardSets', { input: { target: member.ref } })).map(view => view.ref)).toEqual([born.ref]);
  expect(value(await call<SetView[]>(client, 'studyforgeOrganization/sets', { input: {} })).map(view => view.name)).toContain('期末复习');
  expect((await call(client, 'studyforgeOrganization/createSet', { input: { operationId: 'ghost-member', set: { name: '野成员集', members: ['card:ghost'] } } })).ok).toBe(false);

  // The route reads a book's skeleton so a chapter that really exists is a legal plan target.
  const outline = value(await call<SkeletonView>(client, 'studyforgeOrganization/saveSkeleton', {
    input: { operationId: 'outline', materialId: book.materialId, expectedVersion: 0, change: { nodes: [{ path: '数学/定义域', sources: [anchor] }] } },
  }));
  expect(outline.revision).toBe(1);
  const preview = value(await call<SkeletonPreview>(client, 'studyforgeOrganization/previewSkeleton', {
    input: { materialId: book.materialId, version: outline.revision, change: { nodes: [{ path: '数学/单调性', sources: [anchor] }] } },
  }));
  expect(preview.nodes.map(node => node.path)).toEqual(['数学/定义域', '数学/单调性']);
  const tree = value(await call<BookStructure>(client, 'studyforgeOrganization/book', { input: { material: { materialId: book.materialId, versionId } } }));
  expect(tree.nodes.filter(node => node.kind === 'section').map(node => node.key)).toEqual(['section:数学/定义域']);

  const plan = value(await call<PlanView>(client, 'studyforgeOrganization/createPlan', {
    input: { operationId: 'plan', plan: { kind: 'book', title: '下一节', materialId: book.materialId, entries: [{ date: '2026-09-14', chapter: '数学/定义域', sources: [anchor] }] } },
  }));
  expect(value(await call<PlanView>(client, 'studyforgeOrganization/plan', { input: { ref: plan.ref } }))).toEqual(plan);
  // A chapter no skeleton node carries is refused before anything is stored.
  expect((await call(client, 'studyforgeOrganization/checkPlan', { input: { plan: { kind: 'book', title: '野章节', materialId: book.materialId, entries: [{ date: '2026-09-14', chapter: '数学/不存在', sources: [anchor] }] } } })).ok).toBe(false);

  // One planned node carries the real material; a fake original or teaching
  // reference never reaches the row.
  const planned = value(await call<RouteView>(client, 'studyforgeOrganization/addRouteNode', {
    input: { operationId: 'plan-1', node: { title: '第一节', materials: { materials: [{ kind: 'source', source: { materialId: book.materialId, versionId, locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 3 } } } }] }, decl: { stance: '先看定义域' } } },
  }));
  const nodeId = planned.nodes[0]!.id;
  expect(planned.nodes[0]!.materials.materials).toHaveLength(1);
  for (const [operationId, node] of [
    ['fake-material', { title: '野材料', materials: { materials: [{ kind: 'source', source: { materialId: 'mat_zzzzzzzzzzzzzzzz', versionId: 'ver_zzzzzzzzzzzzzzzz' } }] } }],
    ['fake-card', { title: '野卡', materials: { materials: [{ kind: 'card', cardRef: 'card:ghost' }] } }],
    ['fake-teaching', { title: '野教法', decl: { teachingRef: 'not-a-config' } }],
  ] as const) {
    expect((await call(client, 'studyforgeOrganization/addRouteNode', { input: { operationId, node } })).ok).toBe(false);
  }
  expect(value(await call<RouteView>(client, 'studyforgeOrganization/route', {})).nodes).toHaveLength(1);

  // Open the planned lesson once; the retry answers the same native Session.
  const opened = value(await call<{ sessionId: string; node: RouteNode; created: boolean }>(client, 'studyforgeOrganization/openPlannedLesson', { input: { operationId: 'open-1', nodeId } }));
  expect(opened.created).toBe(true);
  const again = value(await call<{ sessionId: string; node: RouteNode; created: boolean }>(client, 'studyforgeOrganization/openPlannedLesson', { input: { operationId: 'open-2', nodeId } }));
  expect(again).toMatchObject({ sessionId: opened.sessionId, created: false });
  const list = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
  expect(list.items.filter(row => row.sessionId === opened.sessionId)).toHaveLength(1);
  expect(list.items.find(row => row.sessionId === opened.sessionId)?.projections?.values.title).toBe('第一节');
  // The classroom really carries the planned material the student confirmed.
  const course = value(await call<CourseView>(client, 'studyforgeCourses/read', { input: { sessionId: opened.sessionId } }));
  expect(course.data.lessonMaterials.materials).toEqual(planned.nodes[0]!.materials.materials);
  expect(course.data.stance).toBe('先看定义域');
}, 60_000);

test('two planned nodes open concurrently into two lessons and both bindings survive a Host restart', async () => {
  runtime = await startIsolated({ testModel: true });
  let client = await connectRuntime(runtime);
  const { book, versionId } = await importBook(client, 'book');
  const route = value(await call<RouteView>(client, 'studyforgeOrganization/addRouteNode', {
    input: { operationId: 'plan-root', node: { title: '根', materials: { materials: [{ kind: 'source', source: { materialId: book.materialId, versionId } }] } } },
  }));
  const rootId = route.nodes[0]!.id;
  const one = value(await call<RouteView>(client, 'studyforgeOrganization/addRouteNode', { input: { operationId: 'plan-one', node: { title: '第一节', parent: rootId } } }));
  const firstId = one.nodes[1]!.id;
  const two = value(await call<RouteView>(client, 'studyforgeOrganization/addRouteNode', { input: { operationId: 'plan-two', node: { title: '第二节', parent: rootId } } }));
  const secondId = two.nodes[2]!.id;

  // Both opens race through the same route row: each node keeps its own lesson.
  const [first, second] = await Promise.all([
    call<{ sessionId: string; created: boolean }>(client, 'studyforgeOrganization/openPlannedLesson', { input: { operationId: 'open-one', nodeId: firstId } }),
    call<{ sessionId: string; created: boolean }>(client, 'studyforgeOrganization/openPlannedLesson', { input: { operationId: 'open-two', nodeId: secondId } }),
  ]);
  const openedFirst = value(first), openedSecond = value(second);
  expect(openedFirst.created).toBe(true);
  expect(openedSecond.created).toBe(true);
  expect(openedFirst.sessionId).not.toBe(openedSecond.sessionId);

  await runtime.restart(); client = await connectRuntime(runtime);
  const after = value(await call<RouteView>(client, 'studyforgeOrganization/route', {}));
  expect(after.nodes.find(node => node.id === firstId)?.session?.sessionId).toBe(openedFirst.sessionId);
  expect(after.nodes.find(node => node.id === secondId)?.session?.sessionId).toBe(openedSecond.sessionId);
  // Reopening after a restart adopts the same native lesson instead of a second one.
  const reopened = value(await call<{ sessionId: string; created: boolean }>(client, 'studyforgeOrganization/openPlannedLesson', { input: { operationId: 'open-again', nodeId: firstId } }));
  expect(reopened).toMatchObject({ sessionId: openedFirst.sessionId, created: false });
  const list = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
  for (const sessionId of [openedFirst.sessionId, openedSecond.sessionId]) {
    expect(list.items.filter(row => row.sessionId === sessionId)).toHaveLength(1);
  }
}, 60_000);
