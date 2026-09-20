/** Browser-local arrangement only. Never writes lesson facts or native drafts. */
export const VIEWS = ['chat', 'thoughts', 'materials', 'vault'] as const;
export type WorkspaceView = typeof VIEWS[number] | `plugin-${string}`;
const isView = (value: unknown): value is WorkspaceView => typeof value === 'string' && ((VIEWS as readonly string[]).includes(value) || /^plugin-[a-f0-9]{24}-[a-z][a-z0-9-]{0,47}$/.test(value));
/** Keep unavailable views in saved layout, prune only the current render. */
export function availableTree(tree: SplitTree | null, available: readonly WorkspaceView[]): SplitTree | null {
  if (tree === null || typeof tree === 'string') return tree !== null && available.includes(tree) ? tree : null;
  const a = availableTree(tree.a, available), b = availableTree(tree.b, available);
  return a === null ? b : b === null ? a : { ...tree, a, b };
}
export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type SplitTree = WorkspaceView | { axis: 'x' | 'y'; ratio: number; a: SplitTree; b: SplitTree };
export interface WorkspaceLayout { tree: SplitTree | null; active: WorkspaceView; visited: WorkspaceView[] }
export interface Rect { x: number; y: number; width: number; height: number }
export function leaves(tree: SplitTree | null): WorkspaceView[] { return tree === null ? [] : typeof tree === 'string' ? [tree] : [...leaves(tree.a), ...leaves(tree.b)]; }
export function removeView(tree: SplitTree | null, view: WorkspaceView): SplitTree | null {
  if (tree === null || tree === view) return null;
  if (typeof tree === 'string') return tree;
  const a = removeView(tree.a, view), b = removeView(tree.b, view);
  return a === null ? b : b === null ? a : { ...tree, a, b };
}
export function dockView(tree: SplitTree | null, view: WorkspaceView, target: WorkspaceView, edge: Edge): SplitTree {
  if (view === target && leaves(tree).includes(view)) return tree!;
  const rest = removeView(tree, view);
  if (!rest) return view;
  const before = edge === 'left' || edge === 'top';
  const insert = (node: SplitTree): SplitTree => typeof node !== 'string' ? { ...node, a: insert(node.a), b: insert(node.b) }
    : node !== target ? node : { axis: edge === 'left' || edge === 'right' ? 'x' : 'y', ratio: .5, a: before ? view : node, b: before ? node : view };
  return leaves(rest).includes(target) ? insert(rest) : { axis: 'x', ratio: .55, a: rest, b: view };
}
export function resizeTree(tree: SplitTree, path: string, ratio: number): SplitTree {
  if (typeof tree === 'string') return tree;
  if (!path) return { ...tree, ratio: Math.min(.8, Math.max(.2, ratio)) };
  return path[0] === 'a' ? { ...tree, a: resizeTree(tree.a, path.slice(1), ratio) } : { ...tree, b: resizeTree(tree.b, path.slice(1), ratio) };
}
/** A narrow desktop can stack its secondary pair without overwriting the
 * student's saved wide-screen arrangement. Keep readable leaf widths. */
export function adaptTree(tree: SplitTree | null, width: number): SplitTree | null {
  if (!tree || typeof tree === 'string') return tree;
  let node = tree;
  if (width < 1050 && node.axis === 'x' && leaves(node).length === 3) {
    node = { ...node, ...(typeof node.a !== 'string' ? { a: { ...node.a, axis: 'y' } } : {}), ...(typeof node.b !== 'string' ? { b: { ...node.b, axis: 'y' } } : {}) };
  }
  const minimum = (item: SplitTree): number => typeof item === 'string' ? item === 'chat' ? 320 : 270 : item.axis === 'x' ? minimum(item.a) + minimum(item.b) + 4 : Math.max(minimum(item.a), minimum(item.b));
  if (node.axis === 'x') {
    const room = width - 4, low = Math.min(.5, minimum(node.a) / room), high = Math.max(.5, 1 - minimum(node.b) / room), ratio = Math.max(low, Math.min(high, node.ratio));
    return { ...node, ratio, a: adaptTree(node.a, room * ratio)!, b: adaptTree(node.b, room * (1 - ratio))! };
  }
  return { ...node, a: adaptTree(node.a, width)!, b: adaptTree(node.b, width)! };
}
export function geometry(tree: SplitTree | null, rect: Rect): { panes: Partial<Record<WorkspaceView, Rect>>; dividers: { path: string; axis: 'x' | 'y'; ratio: number; rect: Rect; parent: Rect }[] } {
  const panes: Partial<Record<WorkspaceView, Rect>> = {}, dividers: ReturnType<typeof geometry>['dividers'] = [];
  function visit(node: SplitTree, box: Rect, path: string): void {
    if (typeof node === 'string') { panes[node] = box; return; }
    const horizontal = node.axis === 'x', available = Math.max(0, (horizontal ? box.width : box.height) - 4), first = available * node.ratio;
    const a = { ...box, ...(horizontal ? { width: first } : { height: first }) };
    const divider = { ...box, ...(horizontal ? { x: box.x + first, width: 4 } : { y: box.y + first, height: 4 }) };
    const b = { ...box, ...(horizontal ? { x: box.x + first + 4, width: available - first } : { y: box.y + first + 4, height: available - first }) };
    dividers.push({ path, axis: node.axis, ratio: node.ratio, rect: divider, parent: box }); visit(node.a, a, path + 'a'); visit(node.b, b, path + 'b');
  }
  if (tree) visit(tree, rect, ''); return { panes, dividers };
}
export function readLayout(raw: unknown, fallback: WorkspaceLayout): WorkspaceLayout {
  if (!raw || typeof raw !== 'object') return fallback;
  const input = raw as Record<string, unknown>, seen = new Set<string>();
  function validTree(value: unknown, depth = 0): value is SplitTree {
    if (typeof value === 'string') { if (!isView(value) || seen.has(value) || seen.size >= 24) return false; seen.add(value); return true; }
    if (!value || typeof value !== 'object' || depth > 23) return false;
    const split = value as Record<string, unknown>;
    return (split.axis === 'x' || split.axis === 'y') && typeof split.ratio === 'number' && Number.isFinite(split.ratio) && split.ratio >= .2 && split.ratio <= .8 && validTree(split.a, depth + 1) && validTree(split.b, depth + 1);
  }
  if (input.tree !== null && !validTree(input.tree)) return fallback;
  if (!isView(input.active)) return fallback;
  const tree = input.tree as SplitTree | null, active = input.active as WorkspaceView;
  const visited = Array.isArray(input.visited) ? input.visited.filter((v): v is WorkspaceView => isView(v)) : [];
  return { tree, active, visited: [...new Set<WorkspaceView>(['chat', ...visited, ...leaves(tree)])] };
}
const states = new Map<string, WorkspaceLayout>(), listeners = new Set<() => void>();
const storageKey = (id: string): string => 'studyforge.workspace.v1:' + id;
export function workspaceLayout(id: string, blank = true): WorkspaceLayout {
  const existing = states.get(id); if (existing) return existing;
  const fallback: WorkspaceLayout = { tree: blank ? 'chat' : { axis: 'x', ratio: .54, a: 'chat', b: 'thoughts' }, active: 'chat', visited: blank ? ['chat'] : ['chat', 'thoughts'] };
  let state = fallback;
  try { state = readLayout(JSON.parse(localStorage.getItem(storageKey(id)) ?? 'null'), fallback); } catch { /* private browsing */ }
  states.set(id, state); return state;
}
export function updateWorkspace(id: string, change: (state: WorkspaceLayout) => WorkspaceLayout): void {
  const next = change(workspaceLayout(id)); states.set(id, next);
  try { localStorage.setItem(storageKey(id), JSON.stringify(next)); } catch { /* Still usable without storage. */ }
  for (const listener of listeners) listener();
}
export function revealWorkspaceView(id: string, view: WorkspaceView): void {
  updateWorkspace(id, old => ({ tree: leaves(old.tree).includes(view) ? old.tree : dockView(old.tree, view, leaves(old.tree).at(-1) ?? view, 'right'), active: view, visited: [...new Set([...old.visited, view])] }));
}
export function subscribeWorkspace(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
