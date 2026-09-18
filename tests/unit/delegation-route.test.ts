import { expect, test } from 'vitest';
import { toolSchema } from '../../packages/host/src/tools/tool-schema.ts';
import {
  AssistantDelegationInputSchema,
  PeerDelegationInputSchema,
  ProblemDelegationInputSchema,
  SearchDelegationInputSchema,
} from '../../packages/host/src/teaching/native-delegation.ts';

const ROUTE = { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' };

test('every delegation input accepts an optional model route', () => {
  expect(SearchDelegationInputSchema.parse({ task: '查', route: ROUTE }).route).toEqual(ROUTE);
  expect(SearchDelegationInputSchema.parse({ task: '查' }).route).toBeUndefined();
  expect(AssistantDelegationInputSchema.parse({ materials: [{ title: 'm', text: 't' }], standard: 's', route: ROUTE }).route?.model).toBe('deepseek-reasoner');
  expect(PeerDelegationInputSchema.parse({ materials: [{ title: 'm', text: 't' }], explanation: 'e', route: ROUTE }).route?.provider).toBe('deepseek');
  expect(ProblemDelegationInputSchema.parse({ target: 't', route: ROUTE }).route?.model).toBe('deepseek-reasoner');
  expect(() => ProblemDelegationInputSchema.parse({ target: 't', route: { provider: 'x' } })).toThrow();
  expect(() => PeerDelegationInputSchema.parse({ materials: [{ title: 'm', text: 't' }], explanation: 'e', route: { ...ROUTE, extra: 1 } })).toThrow();
});

test('the route field projects into the provider-facing tool schema', () => {
  for (const schema of [SearchDelegationInputSchema, AssistantDelegationInputSchema, PeerDelegationInputSchema, ProblemDelegationInputSchema]) {
    const rendered = JSON.stringify(toolSchema(schema));
    expect(rendered).toContain('"route"');
    expect(rendered).toContain('reasoningEffort');
  }
});
