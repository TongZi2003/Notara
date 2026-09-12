/**
 * P6.2 route × native existing lessons over the real Host HTTP Remote.
 *
 * `mixed-route.test.ts` owns the domain rules; this file proves the wiring the
 * course page really calls: `routeLessons` lists the acting workspace's ordinary
 * native lessons (never a subagent, never a foreign workspace) and writes
 * nothing, and `bindNativeLesson` puts one existing lesson onto the same route
 * row exactly once, taking the title and creation time from the native session
 * rather than from the caller.
 */
import { afterEach, expect, test } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { RouteNativeLesson, RouteView } from '@studyforge/contracts/routes';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
type Client = Awaited<ReturnType<typeof connectRuntime>>;
function value<T>(result: RemoteResult<T>): T {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const call = <T>(client: Client, method: string, payload: unknown) => client.rpc<T>(method, payload);
const lessonOf = (lessons: readonly RouteNativeLesson[], sessionId: string) => lessons.find(lesson => lesson.sessionId === sessionId);

test('routeLessons reads the workspace lessons without writing; bindNativeLesson binds one exactly once', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const created = value(await client.rpc<{ sessionId: string }>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  }));
  const sessionId = created.sessionId;
  value(await client.rpc('session/rename', { request: { sessionId, title: '九月的一节数学课' } }));

  // Browsing writes nothing and still sees the native lesson with its own title.
  const before = value(await call<RouteNativeLesson[]>(client, 'studyforgeOrganization/routeLessons', {}));
  const listed = lessonOf(before, sessionId);
  expect(listed).toBeDefined();
  expect(listed!.title).toBe('九月的一节数学课');
  expect(listed!.materials).toEqual({ materials: [] });
  expect(listed!.archived).toBe(false);
  expect(listed!.nodeId).toMatch(/^l_/);
  expect(Date.parse(listed!.createdAt)).toBeGreaterThan(0);
  expect(value(await call<RouteView>(client, 'studyforgeOrganization/route', {}))).toMatchObject({ version: 0, nodes: [] });

  // The explicit student action binds it: the title and time are the native ones.
  const bound = value(await call<RouteView>(client, 'studyforgeOrganization/bindNativeLesson', {
    input: { operationId: 'bind-1', nativeSessionId: sessionId },
  }));
  expect(bound.nodes).toHaveLength(1);
  expect(bound.nodes[0]).toMatchObject({ id: listed!.nodeId, title: '九月的一节数学课', materials: { materials: [] } });
  expect(bound.nodes[0]!.session).toMatchObject({ sessionId, openedAt: listed!.createdAt });

  // Two tabs binding the same lesson at the same time land on one node, and a
  // third call with a new operation answers that node instead of a duplicate.
  const [tabA, tabB] = await Promise.all([
    call<RouteView>(client, 'studyforgeOrganization/bindNativeLesson', { input: { operationId: 'bind-2', nativeSessionId: sessionId } }),
    call<RouteView>(client, 'studyforgeOrganization/bindNativeLesson', { input: { operationId: 'bind-3', nativeSessionId: sessionId } }),
  ]);
  for (const tab of [tabA, tabB]) {
    expect(value(tab).nodes.filter(node => node.session?.sessionId === sessionId)).toHaveLength(1);
  }

  await runtime.restart();
  const restarted = await connectRuntime(runtime);
  const after = value(await call<RouteView>(restarted, 'studyforgeOrganization/route', {}));
  expect(after.nodes.filter(node => node.session?.sessionId === sessionId)).toHaveLength(1);
  const listedAfter = lessonOf(value(await call<RouteNativeLesson[]>(restarted, 'studyforgeOrganization/routeLessons', {})), sessionId);
  expect(listedAfter!.nodeId).toBe(listed!.nodeId);
}, 90_000);

test('a nested registered workspace inside the acting workspace is foreign, not adopted', async () => {
  // The course page's own startup Session is working-directory-relative; before
  // any lesson exists the graph must be empty, not a ghost 未命名的一课.
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  expect(value(await call<RouteNativeLesson[]>(client, 'studyforgeOrganization/routeLessons', {}))).toEqual([]);

  // A lesson the student really opened is named through the native controller,
  // which is what makes it a lesson rather than the reusable empty shell.
  const own = value(await client.rpc<{ sessionId: string }>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  })).sessionId;
  value(await client.rpc('session/rename', { request: { sessionId: own, title: '进入教室的第一节' } }));
  const listed = value(await call<RouteNativeLesson[]>(client, 'studyforgeOrganization/routeLessons', {}));
  expect(listed.map(lesson => lesson.sessionId)).toEqual([own]);

  // A second workspace registered *inside* the acting one. Its session's header
  // cwd is a descendant of the acting root, so a prefix check would adopt it;
  // the registry's own rule is exact canonical-path equality, so it is foreign.
  const child = join(runtime.root, 'classroom', 'nested-workspace');
  await mkdir(child, { recursive: true });
  const childWorkspace = value(await client.rpc<{ workspace: { workspaceId: string } }>('workspace/create', { request: { path: child } })).workspace;
  const nested = value(await client.rpc<{ sessionId: string }>('session/create', {
    request: { workspaceId: childWorkspace.workspaceId, agentPreset: 'studyforge-learning' },
  })).sessionId;

  // The child workspace's session is a real lesson of that workspace, not of the
  // acting one: never listed here …
  const after = value(await call<RouteNativeLesson[]>(client, 'studyforgeOrganization/routeLessons', {}));
  expect(after.map(lesson => lesson.sessionId)).toEqual([own]);
  expect(lessonOf(after, nested)).toBeUndefined();
  // … and binding it is refused with nothing written and no node invented.
  const refused = await call(client, 'studyforgeOrganization/bindNativeLesson', {
    input: { operationId: 'bind-nested', nativeSessionId: nested },
  });
  expect(refused.ok).toBe(false);
  expect(value(await call<RouteView>(client, 'studyforgeOrganization/route', {}))).toMatchObject({ version: 0, nodes: [] });
  expect(value(await call<RouteNativeLesson[]>(client, 'studyforgeOrganization/routeLessons', {})).map(lesson => lesson.sessionId)).toEqual([own]);

  // Binding the workspace's own lesson still works, so the refusal is about the
  // nested child and not an accident of the ordering above.
  const bound = value(await call<RouteView>(client, 'studyforgeOrganization/bindNativeLesson', {
    input: { operationId: 'bind-own', nativeSessionId: own },
  }));
  expect(bound.nodes.map(node => node.session?.sessionId)).toEqual([own]);
}, 90_000);

test('a lesson of an unrelated workspace is refused and never becomes a lesson', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const own = value(await client.rpc<{ sessionId: string }>('session/create', {
    request: { cwd: join(runtime.root, 'classroom') },
  })).sessionId;
  value(await client.rpc('session/rename', { request: { sessionId: own, title: '本空间的一节' } }));

  const elsewhere = join(runtime.root, 'other-workspace');
  await mkdir(elsewhere, { recursive: true });
  const other = value(await client.rpc<{ workspace: { workspaceId: string } }>('workspace/create', { request: { path: elsewhere } }));
  const foreign = value(await client.rpc<{ sessionId: string }>('session/create', {
    request: { workspaceId: other.workspace.workspaceId },
  })).sessionId;

  const listed = value(await call<RouteNativeLesson[]>(client, 'studyforgeOrganization/routeLessons', {}));
  expect(lessonOf(listed, own)).toBeDefined();
  expect(lessonOf(listed, foreign)).toBeUndefined();

  const raw = await call(client, 'studyforgeOrganization/bindNativeLesson', {
    input: { operationId: 'bind-foreign', nativeSessionId: foreign },
  });
  expect(raw.ok).toBe(false);
  expect(value(await call<RouteView>(client, 'studyforgeOrganization/route', {}))).toMatchObject({ version: 0, nodes: [] });
  const after = value(await call<RouteNativeLesson[]>(client, 'studyforgeOrganization/routeLessons', {}));
  expect(after).toHaveLength(listed.length);
  expect(lessonOf(after, foreign)).toBeUndefined();
  expect(lessonOf(after, own)).toBeDefined();
}, 90_000);
