import type { ReactNode } from 'react';

/** Nest only real parent links among the visible rows, preserving sibling order.
 * The caller keeps the row's buttons, state, identity and write callbacks. */
export function linearTreeRows<T>(items: readonly T[], keyOf: (item: T) => string,
  parentOf: (item: T) => string | null | undefined, render: (item: T, children: ReactNode) => ReactNode): ReactNode[] {
  const keys = new Set(items.map(keyOf));
  const groups = new Map<string | undefined, T[]>();
  for (const item of items) {
    const parent = parentOf(item), key = parent && keys.has(parent) ? parent : undefined;
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group);
  }
  const walk = (item: T): ReactNode => {
    const children = groups.get(keyOf(item)) ?? [];
    return render(item, children.length ? <ul className="sf-linear-tree" data-testid="linear-tree-children">{children.map(walk)}</ul> : null);
  };
  return (groups.get(undefined) ?? []).map(walk);
}
