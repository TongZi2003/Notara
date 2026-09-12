import { expect, test } from 'vitest';
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { toolSchema } from '../../packages/host/src/tools/tool-schema.ts';
import { needsObjectRoot, providerToolSchema, providerToolSchemas } from '../../packages/host/src/tools/model-tool-schemas.ts';
import { LearningSearchResultSchema } from '../../packages/contracts/src/learning-search.ts';
import { ProposalViewSchema } from '../../packages/contracts/src/proposals.ts';
import { registerCardTools } from '../../packages/host/src/tools/card-tools.ts';
import { registerHandoffTools } from '../../packages/host/src/tools/handoff-tools.ts';
import { registerKnowledgeTools } from '../../packages/host/src/tools/knowledge-tools.ts';
import { registerMaterialTools } from '../../packages/host/src/tools/material-tools.ts';
import { registerMemoryTools } from '../../packages/host/src/tools/memory-tools.ts';
import { registerOrganizationTools } from '../../packages/host/src/tools/organization-tools.ts';
import { registerProposalTools } from '../../packages/host/src/tools/proposal-tools.ts';
import { registerReviewTools } from '../../packages/host/src/tools/review-tools.ts';
import { registerSearchTools } from '../../packages/host/src/tools/search-tools.ts';

test('native tool schema supports nullable search results without weakening their union', () => {
  expect(() => toolSchema(LearningSearchResultSchema)).not.toThrow();
  expect(toolSchema(z.string().nullable())).toEqual({ oneOf: [{ type: 'string' }, { type: 'null' }] });
  expect(() => toolSchema(ProposalViewSchema)).not.toThrow();
});
test('overlapping unions remain unsupported instead of changing anyOf meaning', () => {
  expect(() => toolSchema(z.union([z.number(), z.number().int()]))).toThrow('tool_schema_overlapping_union');
  expect(() => toolSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]))).toThrow('tool_schema_overlapping_union');
});

type Registered = { name: string; description: string; parameters: Record<string, unknown>; output: { schema: unknown } };

/** Every StudyForge tool, registered by its own registrar against a stub registry. */
function registeredTools(): Registered[] {
  const registered: Registered[] = [];
  const host = {
    effect: (fn: () => void) => { fn(); },
    tools: { register: (tool: Registered) => { registered.push(tool); } },
  } as unknown as Parameters<typeof registerProposalTools>[0];
  const registrars = [registerProposalTools, registerHandoffTools, registerOrganizationTools, registerCardTools,
    registerKnowledgeTools, registerMaterialTools, registerMemoryTools, registerReviewTools, registerSearchTools];
  for (const register of registrars) register(host);
  return registered;
}

/** Every node of a schema tree that can carry keywords, for a structural sweep. */
function schemaNodes(root: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    found.push(record);
    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      if (Array.isArray(record[key])) (record[key] as unknown[]).forEach(walk);
    }
    if (record.items) walk(record.items);
    if (record.properties) Object.values(record.properties as Record<string, unknown>).forEach(walk);
  };
  walk(root);
  return found;
}

test('every StudyForge registrar emits the enforced native subset and no `type` beside `oneOf`', () => {
  const tools = registeredTools();
  // All nine registrars contribute; the card/handoff/organization unions are not
  // the only schemas that could drift away from the native subset.
  expect(tools.length).toBeGreaterThan(30);
  expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
  for (const tool of tools) {
    expect(() => assertSupportedJsonSchema(tool.parameters as never), tool.name).not.toThrow();
    expect(() => assertSupportedJsonSchema(tool.output.schema as never), `${tool.name} output`).not.toThrow();
    // The enforced subset forbids `type` beside `oneOf` at any depth, so a
    // registered schema that acquired one would be rejected at registration.
    for (const node of schemaNodes(tool.parameters)) {
      expect(node.type === undefined || node.oneOf === undefined, tool.name).toBe(true);
    }
  }
  // The real discriminated unions that a provider rejected as `type: null`.
  const card = tools.find(tool => tool.name === 'propose_card')!;
  expect(card.parameters.type).toBeUndefined();
  expect((card.parameters.oneOf as { type?: unknown }[]).map(branch => branch.type)).toEqual(['object', 'object']);
});

test('the provider projection adds only the implied object root and mutates nothing', () => {
  const tools = registeredTools();
  const before = JSON.stringify(tools);
  // Annotated so the assertions still typecheck in the tests project while the
  // host declaration output for this new module has not been rebuilt yet.
  const projected: { name: string; parameters: Record<string, unknown> }[] = providerToolSchemas(tools);

  expect(projected.map(tool => tool.name)).toEqual(tools.map(tool => tool.name));
  const unions = tools.filter(tool => needsObjectRoot(tool.parameters));
  // The names a real turn could not use before the fix.
  expect(unions.map(tool => tool.name)).toEqual(expect.arrayContaining(['propose_card', 'propose_handoff', 'propose_set', 'propose_plan', 'propose_route']));
  for (const tool of projected) {
    const source = tools.find(candidate => candidate.name === tool.name)!;
    // What the provider validates: every function's parameters are an object.
    expect(tool.parameters.type, tool.name).toBe('object');
    if (needsObjectRoot(source.parameters)) {
      // Only the root type is added: every branch and constraint is the same object.
      const { type: added, ...rest } = tool.parameters;
      expect(added).toBe('object');
      expect(rest).toEqual(source.parameters);
      // The added root type is implied by the branches, so it cannot exclude
      // an instance the union accepted, nor accept a non-object one.
      expect((rest.oneOf as { type?: unknown }[]).every(branch => branch.type === 'object')).toBe(true);
    } else {
      expect(tool, tool.name).toBe(source);
    }
  }
  // Registered definitions are untouched, and unchanged tools keep identity.
  expect(JSON.stringify(tools)).toBe(before);
  const unchanged = tools.find(tool => !needsObjectRoot(tool.parameters))!;
  expect(providerToolSchema(unchanged)).toBe(unchanged);
});

test('nested unions and non-object roots are left exactly as registered', () => {
  const nested = toolSchema(z.object({ choice: z.union([z.string(), z.number()]) }).strict());
  const scalar = toolSchema(z.string().nullable());
  expect(needsObjectRoot(nested)).toBe(false);
  expect(needsObjectRoot(scalar)).toBe(false);
  const projected = providerToolSchemas([{ name: 'nested', description: '', parameters: nested }, { name: 'scalar', description: '', parameters: scalar }]);
  expect(projected[0]!.parameters).toEqual(nested);
  expect(projected[1]!.parameters).toEqual(scalar);
  expect(projected[0]!.parameters.type).toBe('object');
  const nestedProperties = nested.properties as Record<string, unknown>;
  const projectedProperties = projected[0]!.parameters.properties as Record<string, unknown>;
  expect(projectedProperties.choice).toEqual(nestedProperties.choice);
});
