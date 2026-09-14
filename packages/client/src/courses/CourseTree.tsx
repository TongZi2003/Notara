import { useState } from 'react';
import type { CourseGraphNode } from './CourseMapCanvas.tsx';
import { dayLabel } from './format.ts';

/** Both views consume exactly the same identity and parent projection. */
export function CourseTree({ nodes, selected, filterKey, onSelect }: {
  nodes: readonly CourseGraphNode[]; selected?: string; filterKey: string; onSelect(key: string): void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [filtered, setFiltered] = useState<{ key: string; closed: ReadonlySet<string> }>({ key: '', closed: new Set() });
  const byId = new Map(nodes.map(node => [node.key, node]));
  const children = new Map<string, CourseGraphNode[]>();
  for (const node of nodes) if (node.parent && byId.has(node.parent)) children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  const seen = new Set<string>();
  const render = (node: CourseGraphNode): React.JSX.Element | null => {
    if (seen.has(node.key)) return null;
    seen.add(node.key);
    const descendants = children.get(node.key) ?? [];
    const open = filterKey ? !(filtered.key === filterKey && filtered.closed.has(node.key)) : expanded.has(node.key);
    const toggle = (): void => {
      if (filterKey) setFiltered(previous => {
        const closed = new Set(previous.key === filterKey ? previous.closed : []);
        if (open) closed.add(node.key); else closed.delete(node.key);
        return { key: filterKey, closed };
      });
      else setExpanded(previous => {
        const next = new Set(previous);
        if (next.has(node.key)) next.delete(node.key); else next.add(node.key);
        return next;
      });
    };
    return <li key={node.key} data-testid="roadmap-node" data-node-id={node.key} data-context={!node.matches}>
      <div className="sf-course-tree-row" data-selected={selected === node.key}>
        {descendants.length ? <button className="sf-tree-toggle" type="button" aria-label={`${open ? '收起' : '展开'}${node.title}`} aria-expanded={open} onClick={toggle}>
          <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button> : <span className="sf-tree-leaf" aria-hidden="true">·</span>}
        <button className="sf-course-tree-open" type="button" aria-label={`查看${node.title}`} aria-current={selected === node.key ? 'true' : undefined} onClick={() => onSelect(node.key)}>
          <span className="sf-course-tree-title" data-testid="roadmap-node-title">{node.title}</span>
          <span className="sf-course-tree-meta"><span data-testid={node.planned ? 'roadmap-node-planned' : 'roadmap-node-opened'}>{node.planned ? '待开课' : node.archived ? '已归档' : node.current ? '当前课堂' : '已开课'}</span>
            {node.date && <time data-testid="roadmap-node-date" dateTime={node.date}>{dayLabel(node.date)}</time>}
            {descendants.length > 0 && <span>{descendants.length} 节子课</span>}
          </span>
        </button>
      </div>
      {descendants.length > 0 && open && <ul>{descendants.map(render)}</ul>}
    </li>;
  };
  return <ul className="sf-course-tree" data-testid="roadmap-nodes" aria-label="课程树">
    {nodes.filter(node => !node.parent || !byId.has(node.parent)).map(render)}
  </ul>;
}
