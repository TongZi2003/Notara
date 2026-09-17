/**
 * Facade tool surface: a constant set of verbs whose `method` field selects one
 * registered tool. The wire shows only the facades; the registry keeps every
 * wrapped tool callable, so history, guards and display resolve through this
 * one table — hosts, history scanners and client labels must not keep their own.
 */
export const TOOL_FACADES = {
  find: {
    materials: 'list_materials',
    cards: 'list_cards',
    sets: 'list_sets',
    plans: 'list_plans',
    learning: 'search_learning',
    memory: 'search_memory',
    evidence: 'query_evidence',
  },
  open: {
    material: 'read_material',
    region: 'preview_region',
    content: 'read_content',
    card: 'read_card',
    cards: 'read_cards',
    method: 'read_method',
    memory: 'read_memory',
    set: 'read_set',
    plan: 'read_plan',
    route: 'read_route',
    skeleton: 'read_skeleton',
    lesson: 'read_lesson',
    handoff: 'read_handoff',
    markdown: 'read_markdown_material',
    teaching: 'read_teaching',
  },
  note: {
    memory: 'note_memory',
    memory_revise: 'revise_memory',
    method: 'note_method',
    method_revise: 'revise_method',
    goal: 'note_learning_goal',
    thought: 'mark_thought',
  },
  update: {
    card: 'update_card',
    markdown: 'update_markdown_material',
  },
  record: {
    review: 'record_review',
    cards: 'register_cards',
    cite: 'cite_materials',
  },
  propose: {
    card: 'propose_card',
    review: 'propose_review',
    set: 'propose_set',
    plan: 'propose_plan',
    route: 'propose_route',
    skeleton: 'propose_skeleton',
    lesson_settings: 'propose_lesson_settings',
    handoff: 'propose_handoff',
    classmate: 'propose_classmate',
    teaching: 'propose_teaching',
  },
  create: {
    material: 'create_markdown_material',
    import: 'import_uploaded_material',
    artifact: 'draft_artifact',
  },
  board: {
    read: 'read_workbench',
    update: 'update_workbench',
    scene: 'read_math_scene',
    edit_scene: 'edit_math_scene',
    restore_scene: 'restore_math_scene',
    calculate: 'calculate_math',
    activity: 'read_workbench_activity',
  },
  classroom: {
    read: 'read_classroom',
    ask: 'ask_classmate',
    continue: 'continue_classmate',
    context: 'update_classroom_context',
    intimacy: 'adjust_classroom_intimacy',
  },
  stage: {
    read: 'read_thoughtmap',
    advance: 'advance_conversation_stage',
    summarize: 'summarize_stage',
  },
  delegate: {
    search: 'delegate_search',
    assistant: 'delegate_assistant',
    peer: 'delegate_peer',
    problem: 'delegate_problem',
  },
} as const satisfies Record<string, Record<string, string>>;

export type ToolFacadeName = keyof typeof TOOL_FACADES;
export const TOOL_FACADE_NAMES: ReadonlySet<string> = new Set(Object.keys(TOOL_FACADES));

/** Every tool hidden behind a facade, for wire filtering and guard reuse. */
export const FACADED_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(TOOL_FACADES).flatMap(methods => Object.values(methods)),
);

/**
 * Resolve one wire-visible call to the registered tool it dispatches to.
 * Accepts the already-parsed arguments object or the raw `tool/call` JSON
 * string; returns undefined for non-facade calls and for unknown methods.
 */
export function resolveFacadeTool(name: string, args: unknown): string | undefined {
  const methods = (TOOL_FACADES as Record<string, Record<string, string>>)[name];
  if (!methods) return undefined;
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try { parsed = JSON.parse(args); } catch { return undefined; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const method = (parsed as { method?: unknown }).method;
  return typeof method === 'string' ? methods[method] : undefined;
}
