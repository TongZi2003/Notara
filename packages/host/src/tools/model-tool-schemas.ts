/**
 * Provider-facing projection of the assembled tool list.
 *
 * DSH's enforced subset forbids `type` beside `oneOf` on one node, so a
 * discriminated union of object branches registers as a bare `{oneOf:[…]}`:
 * native-compliant, and what the tool registry, its guard and its SDK renderer
 * all read. Real providers instead validate the *root* of a function's
 * parameters and require `type: "object"`; a bare union root fails with
 * `got 'type: null'`. Every branch of such a union already requires an object,
 * so declaring that root an object admits exactly the same instances without
 * touching a single branch, constraint or field.
 *
 * This runs only on the assembled copy the model receives. The registered
 * definitions keep their oneOf root, so nothing downstream of registration
 * changes meaning; a tool whose root is not an all-object union is returned
 * unchanged (same reference), and the array order/length/names are preserved.
 */
import type { ToolSchema } from '@deepseek-ai/dsh-llm';

/** True when the root is an object-only union with no declared root type. */
export function needsObjectRoot(parameters: Record<string, unknown>): boolean {
  if (parameters.type !== undefined) return false;
  const branches = parameters.oneOf;
  if (!Array.isArray(branches) || branches.length === 0) return false;
  return branches.every(branch => branch !== null && typeof branch === 'object' && !Array.isArray(branch)
    && (branch as { type?: unknown }).type === 'object');
}

/** One tool's provider-facing copy, or the same tool when it needs no change. */
export function providerToolSchema(tool: ToolSchema): ToolSchema {
  if (!needsObjectRoot(tool.parameters)) return tool;
  return { ...tool, parameters: { type: 'object', ...tool.parameters } };
}

/** The whole assembled list, in order, with only the implied root type added. */
export function providerToolSchemas(tools: readonly ToolSchema[]): ToolSchema[] {
  return tools.map(providerToolSchema);
}
