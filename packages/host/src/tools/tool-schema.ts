import { assertSupportedJsonSchema, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';

const NATIVE = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples']);
const REFINEMENTS = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'multipleOf']);
/**
 * DSH rc.2 enforces a structural JSON Schema subset. Zod remains the complete
 * boundary validator before effects and before rendering each output; omitted
 * refinements are stated in the model-visible description, never silently lost.
 * This adapter rejects unsupported structural forms instead of widening them.
 */
export function toolSchema(schema: z.ZodType): JsonSchemaNode & Record<string, unknown> {
  const raw: unknown = JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: 'input' })));
  const convert = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('tool_schema_object_required');
    const node = value as Record<string, unknown>, out: Record<string, unknown> = {}, refinements: Record<string, unknown> = {};
    if (Array.isArray(node.type)) {
      const types = node.type;
      if (types.length < 2 || types.some(type => typeof type !== 'string') || new Set(types).size !== types.length
        || (types.includes('integer') && types.includes('number'))) throw new Error('tool_schema_overlapping_union');
      return { oneOf: types.map(type => convert({ ...node, type })) };
    }
    for (const [key, part] of Object.entries(node)) {
      if (key === '$schema') continue;
      if (REFINEMENTS.has(key)) { refinements[key] = part; continue; }
      if (key === 'prefixItems') continue;
      // Zod emits nullable and primitive unions as anyOf. They are also oneOf
      // only when their JSON types cannot overlap; never rewrite arbitrary unions.
      if (key === 'anyOf') {
        const converted = (part as unknown[]).map(convert);
        const flatten = (branch: Record<string, unknown>): Record<string, unknown>[] => Array.isArray(branch.oneOf)
          ? (branch.oneOf as Record<string, unknown>[]).flatMap(flatten) : [branch];
        const branches = converted.flatMap(flatten);
        const types = branches.map(branch => branch.type);
        if (types.some(type => typeof type !== 'string') || new Set(types).size !== types.length
          || (types.includes('integer') && types.includes('number'))) throw new Error('tool_schema_overlapping_union');
        out.oneOf = branches;
        continue;
      }
      if (!NATIVE.has(key)) throw new Error(`tool_schema_unsupported:${key}`);
      if (key === 'properties') out.properties = Object.fromEntries(Object.entries(part as Record<string, unknown>).map(([name, child]) => [name, convert(child)]));
      else if (key === 'oneOf') out.oneOf = (part as unknown[]).map(convert);
      else if (key === 'items') { if (!node.prefixItems) out.items = convert(part); }
      else out[key] = part;
    }
    if (node.prefixItems) {
      const tuple = (node.prefixItems as unknown[]).map(convert);
      if (!tuple.length || tuple.some(item => JSON.stringify(item) !== JSON.stringify(tuple[0]))) throw new Error('tool_schema_heterogeneous_tuple');
      out.items = tuple[0];
      refinements.tupleLength = tuple.length;
    }
    if (Object.keys(refinements).length) out.description = [out.description, 'Host constraints: ' + JSON.stringify(refinements)].filter(Boolean).join('\n');
    return out;
  };
  const result = convert(raw);
  assertSupportedJsonSchema(result);
  return result;
}
