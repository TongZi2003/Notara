import { expect, test } from 'vitest';
import { z } from 'zod';
import { toolSchema } from '../../packages/host/src/tools/tool-schema.ts';
import { LearningSearchResultSchema } from '../../packages/contracts/src/learning-search.ts';
import { ProposalViewSchema } from '../../packages/contracts/src/proposals.ts';

test('native tool schema supports nullable search results without weakening their union', () => {
  expect(() => toolSchema(LearningSearchResultSchema)).not.toThrow();
  expect(toolSchema(z.string().nullable())).toEqual({ oneOf: [{ type: 'string' }, { type: 'null' }] });
  expect(() => toolSchema(ProposalViewSchema)).not.toThrow();
});
test('overlapping unions remain unsupported instead of changing anyOf meaning', () => {
  expect(() => toolSchema(z.union([z.number(), z.number().int()]))).toThrow('tool_schema_overlapping_union');
  expect(() => toolSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]))).toThrow('tool_schema_overlapping_union');
});
