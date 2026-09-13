/**
 * One node-and-edge map, shared by the book's own structure area and the
 * classroom's 本课资料 pane.
 *
 * Both callers hand in a pure projection of what the Host really read — a
 * book's saved sections and its real cards, or a lesson's own material
 * projection — and this component only draws it. Expansion and selection stay
 * with the caller, so coming back from a card or an original restores exactly
 * what was open.
 *
 * The map is a real graph, not an indented list: a node sits on its depth row,
 * an edge is drawn to each of its own children, and the layer is wide enough
 * for every leaf, so a narrow rail scrolls instead of stacking nodes on top of
 * each other.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { layoutMind, visibleMindNodes, type MindLayout, type MindNode } from './mindmap-model.ts';
import './mindmap.css';

// The model, its visibility rule and its geometry are pure and live in
// `mindmap-model.ts`; this module draws them and re-exports the same names.
export type { MindLayout, MindNode };
export { layoutMind, visibleMindNodes };

/** One node action, offered only on the nodes it really applies to. */
export interface MindAction {
  readonly label: string | ((node: MindNode) => string);
  readonly when: (node: MindNode) => boolean;
  readonly run: (node: MindNode) => void;
}

export interface MindmapProps {
  /** The container's own test id; the nodes are found by `[data-kind]` inside it. */
  readonly testId: string;
  readonly label: string;
  readonly nodes: readonly MindNode[];
  readonly mode: 'map' | 'list';
  readonly expanded: readonly string[];
  readonly selected: string | undefined;
  readonly onPick: (node: MindNode) => void;
  readonly onExpand: (node: MindNode, open: boolean) => void;
  readonly action?: MindAction | undefined;
  readonly actions?: readonly MindAction[] | undefined;
  readonly relations?: readonly { readonly from: string; readonly to: string; readonly label: string }[] | undefined;
  readonly busy?: boolean | undefined;
  /** What the map says when the projection really has no node at all. */
  readonly empty?: string | undefined;
  /** This caller's own name for one node wrapper; `mindmap-node` when it has none. */
  readonly nodeTestId?: string | undefined;
  /** And for the button that picks the node. */
  readonly labelTestId?: string | undefined;
}

/** One map of a tree (or a forest): the same nodes and edges in map or list form. */
export function Mindmap(props: MindmapProps): React.JSX.Element {
  const { nodes, mode } = props;
  const visible = useMemo(() => visibleMindNodes(nodes, props.expanded), [nodes, props.expanded]);
  // The drawing is laid out over what is on screen, not over the whole forest: a
  // collapsed book with hundreds of sections must not reserve their width or
  // push its own root off the panel. Expansion is a drawing decision.
  const layout = useMemo(() => layoutMind(visible), [visible]);
  const wrap = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => {
    const element = wrap.current;
    if (element === null) return undefined;
    const measure = (): void => { setAvailable(element.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [mode, visible.length > 0]);
  const signature = visible.map(node => node.key).join('\n');
  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element || mode !== 'map') return;
    const observer = new ResizeObserver(entries => setHeights(previous => {
      const next = new Map(previous);
      let changed = false;
      for (const entry of entries) {
        const node = entry.target as HTMLElement, key = node.dataset.key;
        if (key !== undefined && next.get(key) !== node.offsetHeight) { next.set(key, node.offsetHeight); changed = true; }
      }
      return changed ? next : previous;
    }));
    element.querySelectorAll('.sf-mindmap > [data-key]').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [mode, signature]);

  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element || mode !== 'map') return;
    const key = props.selected ?? visible[0]?.key;
    const node = [...element.querySelectorAll<HTMLElement>('.sf-mindmap > [data-key]')].find(candidate => candidate.dataset.key === key);
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    element.scrollLeft += bounds.left + bounds.width / 2 - element.getBoundingClientRect().left - element.clientWidth / 2;
  }, [mode, signature, props.selected, available]);

  if (visible.length === 0) return <p className="sf-note" role="status">{props.empty ?? '这里还没有可以展开的结构。'}</p>;

  const toggle = (node: MindNode): React.JSX.Element | null => node.children.length === 0 && node.expandable !== true ? null
    : <button type="button" className="sf-mind-toggle" data-testid="mindmap-expand" aria-expanded={props.expanded.includes(node.key)}
      aria-label={(props.expanded.includes(node.key) ? '收起' : '展开') + node.title}
      onClick={() => { props.onExpand(node, !props.expanded.includes(node.key)); }}>
      {props.expanded.includes(node.key) ? '− 收起' : node.children.length > 0 ? `+ 展开 ${String(node.children.length)} 项` : '+ 展开'}
    </button>;
  const action = (node: MindNode): React.JSX.Element => <>{[...(props.action ? [props.action] : []), ...(props.actions ?? [])].filter(item => item.when(node)).map((item, i) =>
    <button key={i} type="button" className="sf-quiet sf-mind-action" disabled={props.busy === true}
      onClick={() => { item.run(node); }}>{typeof item.label === 'string' ? item.label : item.label(node)}</button>)}</>;
  const body = (node: MindNode): React.JSX.Element => <>
    <button type="button" className="sf-mind-label" title={node.title} onClick={() => { props.onPick(node); }} aria-pressed={props.selected === node.key}
      data-testid={props.labelTestId ?? 'mindmap-node'}>
      <span className="sf-mind-title">{node.title}</span>
      <small className="sf-mind-hint">{node.hint}</small>
    </button>
    {toggle(node)}
    {action(node)}
  </>;

  if (mode === 'list') return <ul className="sf-mindmap-list" data-testid={props.testId} aria-label={props.label}>
    {visible.map(node => <li key={node.key} className="sf-mindmap-node" data-kind={node.kind} data-key={node.key} data-selected={props.selected === node.key}
      data-testid={props.nodeTestId ?? 'mindmap-node'}
      style={{ marginInlineStart: (layout.depth.get(node.key) ?? 0) * 16 }}>{body(node)}</li>)}
  </ul>;

  const nodeWidth = 170, gap = 36, padding = 20;
  const width = Math.max(available, layout.leaves * (nodeWidth + gap) - gap + padding * 2);
  // Titles and action rows can wrap. Measure the complete stickers so their
  // connectors never cross a button or overlap the next generation of nodes.
  const rowHeights = Array.from({ length: layout.rows }, () => 90);
  for (const node of visible) {
    const depth = layout.depth.get(node.key) ?? 0;
    rowHeights[depth] = Math.max(rowHeights[depth] ?? 90, heights.get(node.key) ?? 90);
  }
  const tops: number[] = [];
  let height = padding;
  for (const rowHeight of rowHeights) { tops.push(height); height += rowHeight + gap; }
  const spot = (key: string): { left: number; top: number } => ({
    left: padding + (layout.centre.get(key) ?? 0) * (width - padding * 2),
    top: tops[layout.depth.get(key) ?? 0] ?? padding,
  });
  const edges = visible.flatMap(node => node.parent === undefined ? [] : [{ parent: node.parent, key: node.key }]);
  return <div className="sf-mindmap-wrap" ref={wrap}>
    <div className="sf-mindmap" data-testid={props.testId} aria-label={props.label} data-mode="map" style={{ width, height }}>
      <svg className="sf-mindmap-edges" width={width} height={height} aria-hidden="true">
        {(props.relations ?? []).filter(edge => layout.depth.has(edge.from) && layout.depth.has(edge.to)).map(edge => {
          const from = spot(edge.from), to = spot(edge.to);
          return <g key={`${edge.from}:${edge.to}:${edge.label}`} data-testid="mindmap-relation">
            <path className="sf-mind-relation" d={`M${String(from.left + nodeWidth / 2)},${String(from.top + 35)} C${String(from.left + nodeWidth)},${String(from.top - 14)} ${String(to.left - nodeWidth)},${String(to.top - 14)} ${String(to.left - nodeWidth / 2)},${String(to.top + 35)}`} />
            <text x={(from.left + to.left) / 2} y={(from.top + to.top) / 2 + 12} textAnchor="middle">{edge.label}</text>
          </g>;
        })}
        {edges.map(edge => {
          const from = spot(edge.parent), to = spot(edge.key);
          const bottom = from.top + (heights.get(edge.parent) ?? 90);
          const mid = (bottom + to.top) / 2;
          return <path key={edge.key} d={`M${String(from.left)},${String(bottom)} C${String(from.left)},${String(mid)} ${String(to.left)},${String(mid)} ${String(to.left)},${String(to.top)}`} />;
        })}
      </svg>
      {visible.map(node => <div key={node.key} className="sf-mindmap-node" data-kind={node.kind} data-key={node.key} data-selected={props.selected === node.key}
        data-testid={props.nodeTestId ?? 'mindmap-node'}
        style={{ ...spot(node.key), width: nodeWidth }}>{body(node)}</div>)}
    </div>
  </div>;
}
