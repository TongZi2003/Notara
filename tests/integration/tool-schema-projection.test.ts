/**
 * P7 tool-schema projection over the real assembled request.
 *
 * The provider rejected `propose_card` with
 * `schema must be a JSON Schema of 'type: "object"', got 'type: null'` because a
 * discriminated union of object branches registers as a bare `{oneOf:[…]}`.
 * Registration stays native-compliant; the provider-facing copy assembled by
 * `system-prompt/assemble` carries the implied object root.
 *
 * Under the facade surface the same risk moved one level down: every facade is
 * itself a bare `{oneOf:[…]}` union of `{method, input}` branches, so the root
 * repair must still apply, and each wrapped tool's own parameter schema —
 * including inner unions like propose_card's — sits under `input` unchanged.
 *
 * The tool list under test is the exact one from the real `request/header`
 * durable event of an isolated formal Host: whatever the loaded host build put
 * there, this test never re-projects or edits it. It also sweeps the whole
 * parameter tree of every tool for the same class of incompatibility
 * (`type` beside `oneOf`, untyped object unions) at any depth.
 *
 * NOTE: `scripts/dev-isolated.ts` boots the host plugin from
 * `packages/host/lib/types/index.js`. This lane therefore proves the *built*
 * host snapshot, not `packages/host/src`. Rebuild the host before reading its
 * result as evidence for a source change.
 */
import { afterEach, expect, test } from 'vitest';
import { join } from 'node:path';
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue, SessionPage } from '@deepseek-ai/dsh-api-session-controller';
import type { CourseView } from '@studyforge/contracts/courses';
import { TOOL_FACADES } from '@studyforge/contracts/tool-facades';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }

interface AssembleTool { name: string; description: string; parameters: Record<string, unknown>; }

/** The constant classroom wire: every facade plus the builtin capability set. */
const facadeNames = Object.keys(TOOL_FACADES);
const wrappedNames: ReadonlySet<string> = new Set(Object.values(TOOL_FACADES).flatMap(methods => Object.values(methods)));

/** Every schema node reachable through the structural keywords the subset keeps. */
function schemaNodes(root: unknown, path = ''): { path: string; node: Record<string, unknown> }[] {
  const found: { path: string; node: Record<string, unknown> }[] = [];
  const walk = (node: unknown, at: string): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    found.push({ path: at, node: record });
    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      if (Array.isArray(record[key])) (record[key] as unknown[]).forEach((branch, index) => walk(branch, `${at}.${key}[${index}]`));
    }
    if (record.items) walk(record.items, `${at}.items`);
    if (record.properties) for (const [name, child] of Object.entries(record.properties as Record<string, unknown>)) walk(child, `${at}.properties.${name}`);
  };
  walk(root, path);
  return found;
}

test('every assembled tool the model received has an object root and a native-compliant registration', async () => {
  runtime = await startIsolated({ testModel: true });
  const client = await connectRuntime(runtime);
  const sessionId = value(await client.rpc<SessionCreateValue>('session/create', {
    request: { cwd: join(runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  })).sessionId;
  const course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  value(await client.rpc('studyforgeCourses/update', { input: { sessionId, operationId: 'schema-diagnose', expectedVersion: course.version, patch: { teachingRef: 'diagnose' } } }));
  // Exercise both dispatch paths on the constant wire: a facade call and the
  // compatibility loader; neither may change the tool list of later requests.
  value(await client.rpc('session/prompt', {
    request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
      { name: 'load_tools', arguments: { names: ['read_route'] } },
      { name: 'open', arguments: { method: 'route', input: {} } },
    ]) }] },
  }));
  for (let attempt = 0; attempt < 80; attempt++) {
    const running = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)?.running;
    if (running !== true) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  const refusal = await client.rpc<SessionPage>('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: 1_000_000, maxMessages: 1 } });
  const cursor = refusal.ok ? -1 : Number(/past cursor (-?\d+)/.exec(refusal.error.message)?.[1] ?? -1);
  const page = value(await client.rpc<SessionPage>('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: cursor, maxMessages: 300 } }));
  const headers = page.records.filter(record => record.type === 'event' && record.event.type === 'request/header');
  expect(headers.length, runtime.log()).toBeGreaterThan(0);
  const surfaces = headers
    .map(header => (header.event.data as { header?: { tools?: AssembleTool[] } }).header?.tools)
    .filter((tools): tools is AssembleTool[] => Array.isArray(tools));

  // The wire is identical on every request of the lesson — that constant set is
  // the cache contract; no wrapped tool name or load_tools ever appears on it.
  for (const surface of surfaces) expect(surface.map(tool => tool.name)).toEqual(surfaces[0]!.map(tool => tool.name));
  const assembled = surfaces.at(-1)!;
  const names = assembled.map(tool => tool.name);
  expect(new Set(names).size, 'tool names must stay unique').toBe(names.length);
  for (const facade of facadeNames) expect(names).toContain(facade);
  for (const name of names) {
    expect(wrappedNames.has(name), `wrapped tool ${name} leaked onto the wire`).toBe(false);
    expect(name).not.toBe('load_tools');
  }
  // Wrapped parameters keep their contract: the propose facade's card branch
  // embeds propose_card's own three-way union under `input`, verbatim.
  const propose = assembled.find(tool => tool.name === 'propose')!;
  const cardBranch = (propose.parameters.oneOf as Record<string, unknown>[]).find(branch =>
    (branch.properties as Record<string, { const?: string }>).method?.const === 'card')!;
  const cardInput = (cardBranch.properties as Record<string, Record<string, unknown>>).input!;
  expect((cardInput.oneOf as { type?: unknown }[]).map(branch => branch.type)).toEqual(['object', 'object', 'object']);

  const unionRoots: string[] = [];
  const plainRoots: string[] = [];
  const nestedUntypedObjectUnions: string[] = [];
  const unprojectedUnionViolations: string[] = [];
  const misplacedTypeOneOf: string[] = [];
  for (const tool of assembled) {
    const parameters = tool.parameters;
    expect(parameters, tool.name).toBeTypeOf('object');
    // What the provider validates on every function: an object root.
    expect(parameters.type, tool.name).toBe('object');
    const rootIsUnion = Array.isArray(parameters.oneOf);
    if (rootIsUnion) {
      unionRoots.push(tool.name);
      const branches = parameters.oneOf as { type?: unknown }[];
      expect(branches.length, tool.name).toBeGreaterThan(1);
      expect(branches.every(branch => branch.type === 'object'), tool.name).toBe(true);
      // The registered form is this copy without the implied root type: adding
      // `type` beside `oneOf` is exactly what the provider copy does, so the
      // remainder must equal the definition that registration accepted.
      const { type: implied, ...registered } = parameters;
      expect(implied).toBe('object');
      expect(registered.oneOf).toBe(parameters.oneOf);
      expect(() => assertSupportedJsonSchema(registered as never), tool.name).not.toThrow();
    } else {
      plainRoots.push(tool.name);
      // A native root object is passed through untouched and already validates.
      expect(() => assertSupportedJsonSchema(parameters as never), tool.name).not.toThrow();
    }
    // Sweep the whole tree. `type` beside `oneOf` is only legal on the one node
    // the provider copy repaired: the root of a projected union. Anything else
    // — including a nested node of that same tool — is the same defect and is
    // reported with its path rather than excused by the tool's name.
    for (const { path, node } of schemaNodes(parameters)) {
      if (node.type === undefined || node.oneOf === undefined) continue;
      if (node === parameters && rootIsUnion) continue;
      misplacedTypeOneOf.push(`${tool.name}${path}`);
    }
    for (const { path, node } of schemaNodes(parameters)) {
      if (path === '' || node.type !== undefined || !Array.isArray(node.oneOf)) continue;
      if ((node.oneOf as { type?: unknown }[]).every(branch => branch?.type === 'object')) {
        nestedUntypedObjectUnions.push(`${tool.name}${path}`);
      }
    }
    // A root union whose branches are all objects must have been projected; one
    // that was left bare is the original provider failure, wherever it lives.
    for (const { path, node } of schemaNodes(parameters)) {
      if (node.type === undefined && Array.isArray(node.oneOf)
        && (node.oneOf as { type?: unknown }[]).every(branch => branch?.type === 'object') && path === '') {
        unprojectedUnionViolations.push(`${tool.name}${path}`);
      }
    }
  }

  expect(misplacedTypeOneOf, '`type` beside `oneOf` may only appear at a projected root').toEqual([]);
  expect(unprojectedUnionViolations, 'every all-object union root must carry the implied object type').toEqual([]);
  // Every facade is a method union, so every facade root must have been projected.
  expect([...unionRoots].sort()).toEqual([...facadeNames].sort());

  console.log(JSON.stringify({
    tools: assembled.length,
    schemaBytes: Buffer.byteLength(JSON.stringify(assembled)),
    projectedObjectUnionRoots: [...unionRoots].sort(),
    plainObjectRoots: plainRoots.length,
    names: [...names].sort(),
    // Report-only: wrapped union schemas (e.g. propose_card) sit under `input`
    // unchanged; providers only require the function root to be an object.
    nestedUntypedObjectUnionPaths: nestedUntypedObjectUnions.sort(),
  }));
}, 60_000);
