/**
 * P6.2 the course route against the real record store (plan §P6.2, CONTRACTS.md §5).
 *
 * The route is one real RecordStore row and the native side is a scripted port,
 * because what this task owns is exactly the seam: a planned node may carry
 * ordered mixed materials or none, a declaration inherits from the nearest
 * ancestor, an edge may not close a cycle, only references the workspace really
 * holds are stored, and opening a planned node asks the Host once per stable
 * opening key — freezing the exact input first so a restart adopts the same
 * lesson and an unrelated edit never drops the binding.
 *
 * The native session lifecycle stays with the Host; the domain only records the
 * binding the Host really produced.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouteRecordSchema, RouteViewSchema } from '../../packages/contracts/src/routes.ts';
import type { RouteNativeLesson } from '../../packages/contracts/src/routes.ts';
import type { HostContext } from '../../packages/contracts/src/execution.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { ROUTE_KIND, RouteService, lessonNodeId, type NativeLessonSource, type NativeOpen, type RouteValidators } from '../../packages/domain/src/organization/route-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { toolSchema } from '../../packages/host/src/tools/tool-schema.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
/** The native header's own creation time, deliberately not this row's clock. */
const NATIVE_OPENED_AT = '2026-09-11T22:00:00Z';
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const HOST: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
/** The node id a session-derived binding uses for the test workspace, per the domain's own rule. */
const lessonNodeIdOf = (sessionId: string): string => lessonNodeId(HOST.workspaceId, sessionId);
const student = (operationId: string, expectedVersion?: number) =>
  ({ ...HOST, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Opening { readonly openingKey: string; readonly title: string; readonly materials: unknown; readonly decl: unknown; }

async function open(root?: string) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-route-'));
  if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const routeStore = await owner.collection(ROUTE_KIND, RouteRecordSchema);
  // The Host side: the same opening key must always answer the same native lesson.
  const openings: Opening[] = [];
  let onOpen: ((ctx: HostContext) => Promise<void>) | undefined;
  const native: NativeOpen = {
    open: async (openCtx, request) => {
      openings.push({ ...request });
      if (onOpen) await onOpen(openCtx);
      return { sessionId: `sess-${request.openingKey.slice(-8)}`, openedAt: NATIVE_OPENED_AT };
    },
  };
  // The Host side: only existence of a real material/teaching configuration.
  const knownMaterials = new Set<string>();
  const knownRefs = new Set<string>();
  const refuse = (code: string) => Object.assign(new Error(code), { code });
  const validators: RouteValidators = {
    materials: (_ctx, materials) => {
      for (const material of materials.materials) {
        if (material.kind === 'source' && !knownMaterials.has(material.source.materialId)) return Promise.reject(refuse('material_missing'));
        if (material.kind === 'card' && !knownRefs.has(material.cardRef)) return Promise.reject(refuse('card_missing'));
      }
      return Promise.resolve();
    },
    teachingRef: (_ctx, ref) => knownRefs.has(`teach:${ref}`) ? Promise.resolve() : Promise.reject(refuse('teaching_ref_missing')),
  };
  // The read-only native-lesson side: only the ids this fake store really holds
  // are lessons of this workspace; the domain never asks it to create one.
  const lessonStore = new Map<string, Omit<RouteNativeLesson, 'sessionId' | 'nodeId'>>();
  let lessonsReads = 0;
  const withId = (sessionId: string, found: Omit<RouteNativeLesson, 'sessionId' | 'nodeId'>): RouteNativeLesson =>
    ({ sessionId, ...found, nodeId: lessonNodeIdOf(sessionId) });
  // A real failure (corrupt or unreadable native facts) is not "no lesson": the
  // stub raises it so the service must surface it, never default to an empty row.
  const failOn = 'sess-corrupt';
  const lessons: NativeLessonSource = {
    read: async (_ctx, sessionId) => {
      if (sessionId === failOn) throw Object.assign(new Error('record_corrupt'), { code: 'record_corrupt' });
      lessonsReads += 1;
      const found = lessonStore.get(sessionId);
      return found === undefined ? { foreign: true } : { foreign: false, lesson: withId(sessionId, found) };
    },
    list: async () => {
      if (lessonStore.has(failOn)) throw Object.assign(new Error('record_corrupt'), { code: 'record_corrupt' });
      return [...lessonStore.entries()].map(([sessionId, found]) => withId(sessionId, found));
    },
  };
  const routes = new RouteService(routeStore, native, clock, validators, lessons);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { dir, owner, routeStore, openings, routes, native, validators, lessons, knownMaterials, knownRefs, lessonStore,
    lessonReads: () => lessonsReads, setOnOpen: (fn?: (ctx: HostContext) => Promise<void>) => { onOpen = fn; } };
}

test('a planned node may carry ordered mixed materials, or none at all', async () => {
  const workspace = await open();
  const { routes, routeStore, knownMaterials, knownRefs } = workspace;
  knownMaterials.add('mat_a');
  knownRefs.add('card:b');
  // An axis nobody wrote reads as empty without creating a row.
  expect(routes.read(HOST)).toMatchObject({ version: 0, nodes: [] });
  expect(routeStore.list(HOST)).toEqual([]);
  const plain = await routes.add(student('plan-plain'), { title: '先定方向' });
  expect(plain.nodes).toHaveLength(1);
  expect(plain.nodes[0]!.materials).toEqual({ materials: [] });

  const mixed = await routes.add(student('plan-mixed', plain.version), {
    title: '源A + 卡B', parent: plain.nodes[0]!.id,
    materials: {
      materials: [
        { kind: 'source', source: { materialId: 'mat_a', versionId: 'ver_a', locator: { kind: 'pdf', page: 3 } } },
        { kind: 'card', cardRef: 'card:b' },
      ],
      initialIndex: 1,
    },
  });
  const node = mixed.nodes[1]!;
  // The material kind is the real reference kind, in the order the plan froze.
  expect(node.materials.materials.map(material => material.kind)).toEqual(['source', 'card']);
  expect(node.materials.initialIndex).toBe(1);
  expect(node.parent).toBe(plain.nodes[0]!.id);
  // Empty materials cannot name a default.
  await expect(routes.add(student('plan-bad', mixed.version), { title: '空却指默认', materials: { materials: [], initialIndex: 0 } })).rejects.toThrow();
});

test('two first route nodes racing to create the empty axis both survive', async () => {
  const workspace = await open();
  const { routeStore, native, validators, lessons, routes } = workspace;
  let waiting = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const racingStore = {
    workspaceId: routeStore.workspaceId,
    read: routeStore.read.bind(routeStore),
    updateCurrent: routeStore.updateCurrent.bind(routeStore),
    create: async (ctx: Parameters<typeof routeStore.create>[0], id: string, input: unknown) => {
      waiting++;
      if (waiting === 2) release();
      await gate;
      return routeStore.create(ctx, id, input);
    },
  };
  const first = new RouteService(racingStore, native, clock, validators, lessons);
  const second = new RouteService(racingStore, native, clock, validators, lessons);
  // The two services have separate read-before-create windows; the store gate
  // forces both to observe the empty axis before either create is published.
  const [a, b] = await Promise.all([
    first.add(student('parallel-a'), { title: '并发甲' }),
    second.add(student('parallel-b'), { title: '并发乙' }),
  ]);
  expect([...a.nodes, ...b.nodes].map(node => node.title)).toEqual(expect.arrayContaining(['并发甲', '并发乙']));
  expect(routes.read(HOST).nodes).toHaveLength(2);
});

test('a route never stores a reference the workspace does not really hold', async () => {
  const workspace = await open();
  const { routes, knownMaterials, knownRefs } = workspace;
  knownRefs.add('teach:socratic');
  knownRefs.add('card:b');
  // An unknown original, an unknown card and an unknown teaching configuration
  // all reach the Host validator and none of them is stored.
  await expect(routes.add(student('bad-material'), {
    title: '野材料', materials: { materials: [{ kind: 'source', source: { materialId: 'mat_ghost', versionId: 'ver_ghost' } }] },
  })).rejects.toMatchObject({ code: 'material_missing' });
  await expect(routes.add(student('bad-card'), {
    title: '野卡', materials: { materials: [{ kind: 'card', cardRef: 'card:ghost' }] },
  })).rejects.toMatchObject({ code: 'card_missing' });
  await expect(routes.add(student('bad-ref'), { title: '野配置', decl: { teachingRef: 'not-a-config' } }))
    .rejects.toMatchObject({ code: 'teaching_ref_missing' });
  expect(routes.read(HOST).nodes).toEqual([]);

  // A real reference is accepted, and replaying the same accepted operation
  // plans the same node, not a second one.
  const good = await routes.add(student('good'), {
    title: '真材料', materials: { materials: [{ kind: 'card', cardRef: 'card:b' }] }, decl: { teachingRef: 'socratic' },
  });
  expect(good.nodes).toHaveLength(1);
  const replay = await routes.add(student('good'), {
    title: '真材料', materials: { materials: [{ kind: 'card', cardRef: 'card:b' }] }, decl: { teachingRef: 'socratic' },
  });
  expect(replay.nodes).toHaveLength(1);
  expect(replay.nodes[0]!.id).toBe(good.nodes[0]!.id);
  expect(good.nodes[0]!.materials.materials).toHaveLength(1);
});

test('a declaration inherits from the nearest ancestor, and an edit freezes what it does not touch', async () => {
  const workspace = await open();
  const { routes, knownRefs } = workspace;
  knownRefs.add('teach:socratic');
  const root = await routes.add(student('plan-root'), { title: '根', decl: { teachingRef: 'socratic', stance: '先看定义' } });
  const rootId = root.nodes[0]!.id;
  const child = await routes.add(student('plan-child', root.version), { title: '子', parent: rootId, decl: { stance: '先算一遍' } });
  const childId = child.nodes[1]!.id;
  const grand = await routes.add(student('plan-grand', child.version), { title: '孙', parent: childId });
  const grandId = grand.nodes[2]!.id;

  expect(routes.effectiveDecl(grand, grandId)).toEqual({ teachingRef: 'socratic', stance: '先算一遍' });
  expect(routes.effectiveDecl(grand, childId)).toEqual({ teachingRef: 'socratic', stance: '先算一遍' });
  expect(routes.effectiveDecl(grand, rootId)).toEqual({ teachingRef: 'socratic', stance: '先看定义' });

  // A content edit keeps the fields it does not mention.
  const edited = await routes.edit(student('edit-root', grand.version), rootId, { date: '2026-09-20' });
  expect(edited.nodes[0]!.decl).toEqual({ teachingRef: 'socratic', stance: '先看定义' });
  expect(edited.nodes[0]!.materials).toEqual({ materials: [] });
  expect(edited.nodes[0]!.date).toBe('2026-09-20');
  // `null` is the explicit clear form.
  const cleared = await routes.edit(student('clear-root', edited.version), rootId, { date: null, decl: null });
  expect(cleared.nodes[0]).not.toHaveProperty('date');
  expect(cleared.nodes[0]).not.toHaveProperty('decl');
  expect(routes.effectiveDecl(cleared, grandId)).toEqual({ stance: '先算一遍' });
});

test('an edge refuses an unknown parent and a cycle, and detaching is legal', async () => {
  const { routes } = await open();
  const root = await routes.add(student('plan-root'), { title: '根' });
  const rootId = root.nodes[0]!.id;
  const child = await routes.add(student('plan-child', root.version), { title: '子', parent: rootId });
  const childId = child.nodes[1]!.id;
  const grand = await routes.add(student('plan-grand', child.version), { title: '孙', parent: childId });
  const grandId = grand.nodes[2]!.id;

  await expect(routes.mount(student('bad-parent', grand.version), childId, 'p_ghost'))
    .rejects.toMatchObject({ code: 'route_parent_missing', problems: ['p_ghost'] });
  await expect(routes.mount(student('self-parent', grand.version), childId, childId))
    .rejects.toMatchObject({ code: 'route_cycle' });
  await expect(routes.mount(student('cycle', grand.version), rootId, grandId))
    .rejects.toMatchObject({ code: 'route_cycle' });
  const detached = await routes.mount(student('detach', grand.version), childId, null);
  expect(detached.nodes.find(node => node.id === childId)).not.toHaveProperty('parent');
  expect(detached.nodes.find(node => node.id === grandId)?.parent).toBe(childId);
});

test('replaying one plan operation answers the version it wrote and never fakes a changed input', async () => {
  const { routes } = await open();
  const first = await routes.add(student('plan-a'), { title: '第一节' });
  expect(first.version).toBe(1);
  expect(first.nodes.map(node => node.title)).toEqual(['第一节']);
  // A later node moves the tree on; the retry still answers the revision the
  // first operation really wrote, never the tree as it looks now.
  const second = await routes.add(student('plan-b', first.version), { title: '第二节' });
  expect(second.nodes.map(node => node.title)).toEqual(['第一节', '第二节']);
  const replay = await routes.add(student('plan-a'), { title: '第一节' });
  expect(replay.version).toBe(first.version);
  expect(replay.nodes.map(node => node.title)).toEqual(['第一节']);
  expect(routes.read(HOST).nodes.map(node => node.title)).toEqual(['第一节', '第二节']);

  // The same operation with different content is not a silent success: the
  // record store's operation fingerprint refuses it.
  await expect(routes.add(student('plan-a'), { title: '改过的标题' }))
    .rejects.toMatchObject({ code: 'operation_conflict' });
  await expect(routes.add(student('plan-a'), { title: '第一节', parent: second.nodes[1]!.id }))
    .rejects.toMatchObject({ code: 'operation_conflict' });
  expect(routes.read(HOST).nodes.map(node => node.title)).toEqual(['第一节', '第二节']);
});

test('edits are controlled per node, not by the whole-tree revision', async () => {
  const { routes } = await open();
  const root = await routes.add(student('plan-root'), { title: '根' });
  const idA = (await routes.add(student('plan-a', root.version), { title: '甲', parent: root.nodes[0]!.id })).nodes[1]!.id;
  const idB = (await routes.add(student('plan-b', routes.read(HOST).version), { title: '乙', parent: root.nodes[0]!.id })).nodes[2]!.id;

  // One read version, two different nodes: both edits land, and neither blocks
  // the other the way a whole-tree compare-and-swap would.
  const read = routes.read(HOST).version;
  await routes.edit(student('edit-a', read), idA, { title: '甲改' });
  const afterB = await routes.edit(student('edit-b', read), idB, { title: '乙改' });
  expect(afterB.nodes.find(node => node.id === idA)?.title).toBe('甲改');
  expect(afterB.nodes.find(node => node.id === idB)?.title).toBe('乙改');

  // The same node from the same old baseline is refused: 甲 really changed.
  const refused = await routes.edit(student('edit-a-again', read), idA, { title: '再改' })
    .then(() => undefined, (error: unknown) => error as { readonly code?: string; readonly message?: string });
  expect(refused).toMatchObject({ code: 'route_node_conflict', problems: [idA] });
  // The Remote carrier folds a thrown domain error into one generic failure, so
  // the code has to travel inside the message for the student's screen to branch
  // on it instead of showing the catch-all line.
  expect(refused?.message).toContain('route_node_conflict');
  expect(routes.read(HOST).nodes.find(node => node.id === idA)?.title).toBe('甲改');
});

test('two simultaneous moves that would close a cycle cannot both persist', async () => {
  const { routes } = await open();
  const root = await routes.add(student('plan-root'), { title: '根' });
  const idA = (await routes.add(student('plan-a', root.version), { title: '甲', parent: root.nodes[0]!.id })).nodes[1]!.id;
  const idB = (await routes.add(student('plan-b', routes.read(HOST).version), { title: '乙', parent: root.nodes[0]!.id })).nodes[2]!.id;
  const read = routes.read(HOST).version;

  const results = await Promise.allSettled([
    routes.mount(student('mount-a', read), idA, idB),
    routes.mount(student('mount-b', read), idB, idA),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const refused = results.find(result => result.status === 'rejected');
  expect(refused).toBeDefined();
  expect((refused as PromiseRejectedResult).reason).toMatchObject({ code: 'route_cycle' });
  // Whatever landed, the persisted tree has no cycle.
  const view = routes.read(HOST);
  const parentOf = (id: string) => view.nodes.find(node => node.id === id)?.parent;
  expect(parentOf(idA) === idB && parentOf(idB) === idA).toBe(false);
});

test('the student\'s own layout is a narrow merge that a node edit never loses', async () => {
  const { routes } = await open();
  const root = await routes.add(student('plan-root'), { title: '根' });
  const idA = root.nodes[0]!.id;
  const idB = (await routes.add(student('plan-a', routes.read(HOST).version), { title: '甲', parent: idA })).nodes[1]!.id;
  expect(routes.read(HOST).layout).toEqual([]);

  // Placing one node writes only that node's coordinate.
  const placed = await routes.place(student('place-a'), [{ nodeId: idB, position: { x: 240, y: 96 } }]);
  expect(placed.layout).toEqual([{ nodeId: idB, x: 240, y: 96 }]);
  // Reading the layout is ordered by the route's own node order, never by write order.
  const both = await routes.place(student('place-root'), [{ nodeId: idA, position: { x: 12, y: 8 } }]);
  expect(both.layout).toEqual([{ nodeId: idA, x: 12, y: 8 }, { nodeId: idB, x: 240, y: 96 }]);
  // A model tool can read this route: the layout carries no dynamic-key object.
  expect(() => toolSchema(RouteViewSchema)).not.toThrow();
  expect(() => toolSchema(RouteRecordSchema)).not.toThrow();

  // A content edit and an edge move keep every placement the student really made.
  await routes.edit(student('edit-a', routes.read(HOST).version), idB, { title: '甲改' });
  const afterMount = await routes.mount(student('mount-a', routes.read(HOST).version), idB, null);
  expect(afterMount.layout).toEqual([{ nodeId: idA, x: 12, y: 8 }, { nodeId: idB, x: 240, y: 96 }]);
  expect(afterMount.nodes.find(node => node.id === idB)?.title).toBe('甲改');

  // Clearing one node removes only that entry: it goes back to the stored order.
  const cleared = await routes.place(student('clear-a'), [{ nodeId: idA, position: null }]);
  expect(cleared.layout).toEqual([{ nodeId: idB, x: 240, y: 96 }]);

  // A node this route does not hold is refused instead of inventing a position.
  await expect(routes.place(student('place-ghost'), [{ nodeId: 'ghost', position: { x: 1, y: 1 } }]))
    .rejects.toMatchObject({ code: 'route_node_missing' });
  // Replaying the accepted operation answers the layout it really wrote.
  const replay = await routes.place(student('place-a'), [{ nodeId: idB, position: { x: 240, y: 96 } }]);
  expect(replay.layout).toEqual([{ nodeId: idB, x: 240, y: 96 }]);
  await expect(routes.place(student('place-a'), [{ nodeId: idB, position: { x: 999, y: 999 } }]))
    .rejects.toMatchObject({ code: 'operation_conflict' });
  expect(routes.read(HOST).layout).toEqual([{ nodeId: idB, x: 240, y: 96 }]);
});

test('opening a planned node asks the Host once and keeps the lesson it got', async () => {
  const { routes, openings, knownRefs } = await open();
  knownRefs.add('teach:diagnose');
  const planned = await routes.add(student('plan'), { title: '第一节', decl: { teachingRef: 'diagnose' } });
  const id = planned.nodes[0]!.id;
  const first = await routes.openPlanned(student('open'), id);
  expect(first.created).toBe(true);
  expect(openings).toHaveLength(1);
  expect(openings[0]!.openingKey).toBe(routes.openingKeyOf(id));
  expect(openings[0]!.decl).toEqual({ teachingRef: 'diagnose' });
  // The binding keeps the native lesson's real time, not the retry row's clock.
  expect(first.node.session).toMatchObject({ sessionId: first.sessionId, openingKey: routes.openingKeyOf(id), openedAt: NATIVE_OPENED_AT });
  expect(first.node).not.toHaveProperty('opening');

  // Double click / second tab / restart: the lesson that exists is the answer,
  // and the Host is not asked again.
  const again = await routes.openPlanned(student('open-again'), id);
  expect(again.created).toBe(false);
  expect(again.sessionId).toBe(first.sessionId);
  expect(openings).toHaveLength(1);

  // Renaming the lesson never changes which native lesson it opened.
  const renamed = await routes.edit(student('rename', routes.read(HOST).version), id, { title: '第一节（改名）' });
  expect(renamed.nodes[0]!.session?.sessionId).toBe(first.sessionId);
  expect(routes.openingKeyOf(id)).toBe(openings[0]!.openingKey);
  await expect(routes.openPlanned(student('open-missing'), 'p_ghost'))
    .rejects.toMatchObject({ code: 'route_node_missing' });
});

test('an unresolved opening locks its own content edit but not a sibling, and the binding still lands', async () => {
  const workspace = await open();
  const { routes, setOnOpen } = workspace;
  const root = await routes.add(student('plan-root'), { title: '根' });
  const idA = (await routes.add(student('plan-a', root.version), { title: '甲', parent: root.nodes[0]!.id })).nodes[1]!.id;
  const idC = (await routes.add(student('plan-c', routes.read(HOST).version), { title: '丙', parent: root.nodes[0]!.id })).nodes[2]!.id;

  // While 甲 is mid-open, 甲's own content is locked but a sibling still edits.
  setOnOpen(async () => {
    await expect(routes.edit(student('lock', routes.read(HOST).version), idA, { title: '不该落' }))
      .rejects.toMatchObject({ code: 'route_opening_pending' });
    await routes.edit(student('sibling', routes.read(HOST).version), idC, { title: '丙改名' });
  });
  const opened = await routes.openPlanned(student('open-a'), idA);
  setOnOpen(undefined);
  const view = routes.read(HOST);
  // The sibling edit landed and the binding was not lost to it.
  expect(view.nodes.find(node => node.id === idC)?.title).toBe('丙改名');
  expect(view.nodes.find(node => node.id === idA)?.title).toBe('甲');
  expect(view.nodes.find(node => node.id === idA)?.session?.sessionId).toBe(opened.sessionId);
});

test('two nodes open concurrently, each keeping its own lesson', async () => {
  const { routes } = await open();
  const root = await routes.add(student('plan-root'), { title: '根' });
  const idA = (await routes.add(student('plan-a', root.version), { title: '甲', parent: root.nodes[0]!.id })).nodes[1]!.id;
  const idB = (await routes.add(student('plan-b', routes.read(HOST).version), { title: '乙', parent: root.nodes[0]!.id })).nodes[2]!.id;

  const [openedA, openedB] = await Promise.all([
    routes.openPlanned(student('open-a'), idA),
    routes.openPlanned(student('open-b'), idB),
  ]);
  expect(openedA.sessionId).not.toBe(openedB.sessionId);
  const view = routes.read(HOST);
  expect(view.nodes.find(node => node.id === idA)?.session?.sessionId).toBe(openedA.sessionId);
  expect(view.nodes.find(node => node.id === idB)?.session?.sessionId).toBe(openedB.sessionId);
});

test('a crash after the native lesson is created reuses the frozen opening', async () => {
  const workspace = await open();
  const { routes, openings, setOnOpen, knownRefs } = workspace;
  knownRefs.add('teach:diagnose');
  const planned = await routes.add(student('plan'), { title: '第一节', decl: { teachingRef: 'diagnose' } });
  const id = planned.nodes[0]!.id;

  // The Host really created the native lesson, then the process died before the
  // binding landed: the frozen opening stays and no session is bound yet.
  setOnOpen(() => Promise.reject(Object.assign(new Error('crash'), { code: 'host_died' })));
  await expect(routes.openPlanned(student('open-1'), id)).rejects.toMatchObject({ code: 'host_died' });
  const pending = routes.read(HOST).nodes[0]!;
  expect(pending.session).toBeUndefined();
  expect(pending.opening?.key).toBe(routes.openingKeyOf(id));
  expect(pending.opening?.title).toBe('第一节');
  expect(pending.opening?.decl).toEqual({ teachingRef: 'diagnose' });

  // The retry adopts the same native id and binds it; the frozen input is what
  // the lesson was really started from, and the key never changed.
  setOnOpen(undefined);
  const retried = await routes.openPlanned(student('open-2'), id);
  expect(retried.created).toBe(true);
  expect(openings.map(opening => opening.openingKey)).toEqual([routes.openingKeyOf(id), routes.openingKeyOf(id)]);
  expect(retried.node.session).toMatchObject({ sessionId: retried.sessionId, openingKey: routes.openingKeyOf(id) });
  expect(retried.node).not.toHaveProperty('opening');
});

test('the route survives a restart and stays inside its workspace', async () => {
  const first = await open();
  await first.routes.add(student('plan-a'), { title: '第一节' });
  await first.routes.add(student('plan-b', first.routes.read(HOST).version), { title: '第二节' });
  await first.owner.close();
  const reopened = await open(first.dir);
  expect(reopened.routes.read(HOST).nodes.map(node => node.title)).toEqual(['第一节', '第二节']);
  expect(() => reopened.routes.read({ ...HOST, workspaceId: 'student-b' })).toThrow(/workspace/);
});

test('an existing native lesson binds onto the same axis from its own header, once', async () => {
  const { routes, lessonStore, lessonReads } = await open();
  lessonStore.set('sess-existing', {
    title: '上周那一节', createdAt: NATIVE_OPENED_AT, materials: { materials: [] }, archived: false,
  });
  const stored = lessonNodeIdOf('sess-existing');

  // The explicit student action binds the lesson it read; the title and time are
  // the native ones, never a client value or this row's clock.
  const bound = await routes.bindNativeLesson(student('bind-existing'), 'sess-existing');
  expect(bound.nodes).toHaveLength(1);
  expect(bound.nodes[0]).toMatchObject({ id: stored, title: '上周那一节', materials: { materials: [] } });
  expect(bound.nodes[0]!.session).toMatchObject({ sessionId: 'sess-existing', openedAt: NATIVE_OPENED_AT });
  expect(lessonReads()).toBe(1);

  // A different operation for the same lesson is the same one node, and it does
  // not even need to read the lesson again: it sees the binding and answers.
  const replay = await routes.bindNativeLesson(student('bind-other-tab'), 'sess-existing');
  expect(replay.nodes).toHaveLength(1);
  expect(replay.nodes[0]!.id).toBe(stored);
  expect(lessonReads()).toBe(1);

  // A retry of the very accepted operation answers the same node too.
  const retry = await routes.bindNativeLesson(student('bind-existing'), 'sess-existing');
  expect(retry.nodes).toHaveLength(1);
  expect(retry.nodes[0]!.id).toBe(stored);
});

test('binding never invents a lesson and never duplicates a planned binding', async () => {
  const { routes, lessonStore, knownMaterials } = await open();
  knownMaterials.add('mat_a');
  // A workspace with no such native lesson: nothing is stored and nothing is
  // created — the read-only lesson port has no way to start a session.
  await expect(routes.bindNativeLesson(student('bind-ghost'), 'sess-ghost'))
    .rejects.toMatchObject({ code: 'route_native_session_foreign', problems: ['sess-ghost'] });
  expect(routes.read(HOST).nodes).toEqual([]);

  // A planned node really opened one lesson; binding that same native session
  // adopts the planned node instead of adding a second leaf for one lesson.
  lessonStore.set('sess-planned', { title: '排好的一节', createdAt: NATIVE_OPENED_AT, materials: { materials: [] }, archived: false });
  expect(lessonNodeIdOf('sess-planned')).toMatch(/^l_/);
  const planned = await routes.add(student('plan-planned'), {
    title: '排好的一节', materials: { materials: [{ kind: 'source', source: { materialId: 'mat_a', versionId: 'ver_a' } }] },
  });
  const plannedId = planned.nodes[0]!.id;
  const opened = await routes.openPlanned(student('open-planned'), plannedId);
  expect(opened.created).toBe(true);
  const adopted = await routes.bindNativeLesson(student('bind-planned'), opened.sessionId);
  expect(adopted.nodes).toHaveLength(1);
  expect(adopted.nodes[0]!.id).toBe(plannedId);
  expect(adopted.nodes[0]!.session?.sessionId).toBe(opened.sessionId);
});

test('binding is stable under two simultaneous operations for one lesson', async () => {
  const { routes, lessonStore } = await open();
  lessonStore.set('sess-race', { title: '同一节', createdAt: NATIVE_OPENED_AT, materials: { materials: [] }, archived: false });
  const [one, two] = await Promise.all([
    routes.bindNativeLesson(student('race-one'), 'sess-race'),
    routes.bindNativeLesson(student('race-two'), 'sess-race'),
  ]);
  const stored = lessonNodeIdOf('sess-race');
  for (const view of [one, two]) {
    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0]!.id).toBe(stored);
    expect(view.nodes[0]!.session?.sessionId).toBe('sess-race');
  }
});

test('an unreadable native lesson fact fails the read instead of defaulting to an empty lesson', async () => {
  const { routes, lessonStore } = await open();
  lessonStore.set('sess-corrupt', {
    title: '坏了的一节', createdAt: NATIVE_OPENED_AT, materials: { materials: [] }, archived: false,
  });
  // The graph read fails loudly rather than showing an apparently complete lesson
  // with empty materials, and binding it fails too instead of storing that shape.
  await expect(routes.lessons(HOST)).rejects.toMatchObject({ code: 'record_corrupt' });
  await expect(routes.bindNativeLesson(student('bind-corrupt'), 'sess-corrupt')).rejects.toMatchObject({ code: 'record_corrupt' });
  expect(routes.read(HOST).nodes).toEqual([]);
});

test('a first bind inherits the native lineage, and never re-parents an already bound node', async () => {
  const { routes, lessonStore } = await open();
  lessonStore.set('sess-parent', { title: '父课', createdAt: NATIVE_OPENED_AT, materials: { materials: [] }, archived: false });
  lessonStore.set('sess-child', {
    title: '子课', createdAt: NATIVE_OPENED_AT, materials: { materials: [] }, archived: false, parentSession: 'sess-parent',
  });
  lessonStore.set('sess-orphan', {
    title: '父课还没上', createdAt: NATIVE_OPENED_AT, materials: { materials: [] }, archived: false, parentSession: 'sess-parent',
  });

  // Child first: its parent has no route node yet, so it stays at the root.
  const childFirst = await routes.bindNativeLesson(student('bind-child-first'), 'sess-child');
  const childNode = childFirst.nodes.find(node => node.session?.sessionId === 'sess-child')!;
  expect(childNode).not.toHaveProperty('parent');

  // Parent later, then the orphan child: the native lineage becomes the edge in
  // the same bind, so the child is not left disconnected.
  const withParent = await routes.bindNativeLesson(student('bind-parent'), 'sess-parent');
  const parentNodeId = withParent.nodes.find(node => node.session?.sessionId === 'sess-parent')!.id;
  const orphan = await routes.bindNativeLesson(student('bind-orphan'), 'sess-orphan');
  expect(orphan.nodes.find(node => node.session?.sessionId === 'sess-orphan')!.parent).toBe(parentNodeId);

  // The child's own first bind used its own row state: re-binding it does not
  // invent the parent now, and an explicit root mount stays the student's.
  const rerun = await routes.bindNativeLesson(student('bind-child-again'), 'sess-child');
  expect(rerun.nodes.find(node => node.session?.sessionId === 'sess-child')).not.toHaveProperty('parent');
  const mounted = await routes.mount(student('mount-child-root', rerun.version), childNode.id, null);
  expect(mounted.nodes.find(node => node.session?.sessionId === 'sess-child')).not.toHaveProperty('parent');
  const after = await routes.bindNativeLesson(student('bind-child-third'), 'sess-child');
  expect(after.nodes.find(node => node.session?.sessionId === 'sess-child')).not.toHaveProperty('parent');
});
