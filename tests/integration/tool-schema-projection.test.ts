/**
 * P7 tool-schema projection over the real assembled request.
 *
 * The provider rejected `propose_card` with
 * `schema must be a JSON Schema of 'type: "object"', got 'type: null'` because a
 * discriminated union of object branches registers as a bare `{oneOf:[…]}`.
 * Registration stays native-compliant; the provider-facing copy assembled by
 * `system-prompt/assemble` carries the implied object root.
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
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';

let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); runtime = undefined; });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }

interface AssembleTool { name: string; description: string; parameters: Record<string, unknown>; }

/** Tools this repository registers; the names fixed by the StudyForge host. */
const studyforgeNames = ['list_materials', 'list_plans', 'list_sets', 'note_memory', 'note_method', 'preview_region',
  'propose_card', 'propose_handoff', 'propose_lesson_settings', 'propose_plan', 'propose_review', 'propose_route',
  'propose_set', 'propose_skeleton', 'query_evidence', 'read_card', 'read_handoff', 'read_lesson', 'read_material',
  'read_memory', 'read_method', 'read_plan', 'read_route', 'read_set', 'read_skeleton', 'record_review',
  'register_cards', 'revise_memory', 'revise_method', 'search_learning', 'search_memory', 'update_card'];
/** Tools the released DSH runtime installs alongside them. */
const builtinNames = ['delegate_assistant', 'delegate_peer', 'delegate_problem', 'delegate_search', 'edit', 'glob',
  'grep', 'interrupt_agent', 'read', 'read_image', 'send_message', 'skill', 'subagent', 'web_fetch', 'web_search', 'write'];
/** The subset a provider flatly refuses without an object root. */
const requiredTools = ['propose_card', 'propose_handoff', 'propose_plan', 'propose_route', 'propose_set'];

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
  value(await client.rpc('session/prompt', {
    request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '用一句话说明今天要做什么。' }] },
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
  const assembled = headers
    .map(header => (header.event.data as { header?: { tools?: AssembleTool[] } }).header?.tools)
    .filter((tools): tools is AssembleTool[] => Array.isArray(tools))
    .at(-1);
  expect(assembled, runtime.log()).toBeDefined();

  // The assembled surface is exactly the two known groups: every StudyForge
  // tool, every released built-in, no duplicate, no silent third party.
  const names = assembled!.map(tool => tool.name);
  expect(new Set(names).size, 'tool names must stay unique').toBe(names.length);
  expect([...names].sort()).toEqual([...studyforgeNames, ...builtinNames].sort());
  expect(assembled!.length).toBe(48);
  expect(names).toEqual(expect.arrayContaining(requiredTools));

  const unionRoots: string[] = [];
  const plainRoots: string[] = [];
  const nestedUntypedObjectUnions: string[] = [];
  const unprojectedUnionViolations: string[] = [];
  const misplacedTypeOneOf: string[] = [];
  for (const tool of assembled!) {
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
  // The exact affected set on the real surface: the study-forge object unions.
  expect([...unionRoots].sort()).toEqual([...requiredTools].sort());

  // The exact regression: the repaired union root is an object union, not a
  // scalar or an unconstrained schema.
  const card = assembled!.find(tool => tool.name === 'propose_card')!;
  expect(card.parameters).toMatchObject({ type: 'object' });
  expect((card.parameters.oneOf as { type?: unknown }[]).map(branch => branch.type)).toEqual(['object', 'object']);

  console.log(JSON.stringify({
    assembledTools: assembled!.length,
    studyforgeTools: names.filter(name => studyforgeNames.includes(name)).length,
    builtinTools: names.filter(name => builtinNames.includes(name)).length,
    projectedObjectUnionRoots: [...unionRoots].sort(),
    plainObjectRoots: plainRoots.length,
    names: [...names].sort(),
    // Report-only: nested untyped all-object unions already exist in the
    // registered definitions, outside this root-level projection.
    nestedUntypedObjectUnionPaths: nestedUntypedObjectUnions.sort(),
  }));
}, 60_000);
