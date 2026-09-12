/**
 * The shared material map's own model: what a node is, which of them a map
 * shows, and where each one sits.
 *
 * Kept apart from the React component so the projection and its geometry stay
 * pure and directly testable — the drawing is `mindmap.tsx`, the rules are here.
 */

/** One drawn node. `parent` and `children` are the same relation, read both ways. */
export interface MindNode {
  readonly key: string;
  readonly title: string;
  readonly kind: string;
  readonly hint: string;
  readonly parent?: string | undefined;
  readonly children: readonly string[];
  /** True when this node really has children the map has not read yet (a book not opened). */
  readonly expandable?: boolean | undefined;
}

/** The nodes the map really shows: every root, then the children of expanded nodes. */
export function visibleMindNodes(nodes: readonly MindNode[], expanded: readonly string[]): MindNode[] {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const open = new Set(expanded);
  const visible: MindNode[] = [];
  const walk = (key: string): void => {
    const node = byKey.get(key);
    if (node === undefined) return;
    visible.push(node);
    if (!open.has(key)) return;
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) if (node.parent === undefined || !byKey.has(node.parent)) walk(node.key);
  return visible;
}

/** Where every node of one projection sits: its depth row, and its span over the leaves. */
export interface MindLayout {
  readonly depth: ReadonlyMap<string, number>;
  /** The node's centre as a fraction of the whole forest, so expanding never moves a sibling. */
  readonly centre: ReadonlyMap<string, number>;
  readonly rows: number;
  readonly leaves: number;
}

/**
 * Lay a forest out: every node's row and span over the leaves it has *here*.
 *
 * Callers hand in the nodes they are really showing (see `visibleMindNodes`),
 * so a collapsed branch takes one leaf's worth of width instead of reserving
 * every hidden descendant. Expanding therefore re-spreads its siblings — a
 * drawing decision the map makes, not a fact about the tree.
 */
export function layoutMind(nodes: readonly MindNode[]): MindLayout {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const kids = (key: string): readonly string[] => (byKey.get(key)?.children ?? []).filter(child => byKey.has(child));
  const counted = new Map<string, number>();
  const leaves = (key: string): number => {
    const remembered = counted.get(key);
    if (remembered !== undefined) return remembered;
    const children = kids(key);
    const count = children.length === 0 ? 1 : children.reduce((sum, child) => sum + leaves(child), 0);
    counted.set(key, count);
    return count;
  };
  const depth = new Map<string, number>(), centre = new Map<string, number>();
  const roots = nodes.filter(node => node.parent === undefined || !byKey.has(node.parent));
  const total = roots.reduce((sum, node) => sum + leaves(node.key), 0);
  let rows = 0;
  const place = (key: string, start: number, level: number): void => {
    const span = leaves(key);
    depth.set(key, level);
    centre.set(key, total === 0 ? 0 : (start + span / 2) / total);
    rows = Math.max(rows, level + 1);
    let next = start;
    for (const child of kids(key)) { place(child, next, level + 1); next += leaves(child); }
  };
  let cursor = 0;
  for (const node of roots) { place(node.key, cursor, 0); cursor += leaves(node.key); }
  return { depth, centre, rows, leaves: total };
}
