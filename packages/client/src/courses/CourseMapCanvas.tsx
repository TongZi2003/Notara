import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { autoMapPositions, fitMap, zoomMap, type MapCamera, type MapPoint } from './map-geometry.ts';
import './course-map.css';

export interface CourseGraphNode {
  readonly key: string;
  readonly title: string;
  readonly parent?: string;
  readonly position?: MapPoint;
  readonly date: string;
  readonly preview: string;
  readonly lineName?: string;
  readonly planned: boolean;
  readonly archived: boolean;
  readonly current: boolean;
  readonly matches: boolean;
}
interface Props {
  readonly nodes: readonly CourseGraphNode[];
  readonly selected?: string;
  readonly busy: boolean;
  readonly toolbar: ReactNode;
  onSelect(key?: string): void;
  onOpen(key: string): void;
  onPlace(key: string, position: MapPoint | null): Promise<void>;
  onTidy(): Promise<void>;
  onCreate(): void;
}
const COLORS = ['#26437c', '#3e7c59', '#c93a2e', '#8a6d2f', '#5a688a', '#7c3e63'];

/** Presentation only. Camera is transient; the caller owns the one layout writer. */
export function CourseMapCanvas({ nodes, selected, busy, toolbar, onSelect, onOpen, onPlace, onTidy, onCreate }: Props): React.JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<MapCamera>({ x: 0, y: 150, z: 0.8 });
  const cameraRef = useRef(camera); cameraRef.current = camera;
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [holding, setHolding] = useState<{ key: string; position: MapPoint }>();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const gesture = useRef<{ key?: string; pointer: number; start: MapPoint; origin: MapPoint; moved: boolean; z: number }>();
  const touched = useRef(false);
  const suppressClick = useRef(false);
  const auto = autoMapPositions(nodes);
  const points = new Map(nodes.map(node => [node.key, holding?.key === node.key ? holding.position : node.position ?? auto.get(node.key)!]));
  const currentPoints = useRef(points); currentPoints.current = points;
  const byId = new Map(nodes.map(node => [node.key, node]));
  const rootOf = (node: CourseGraphNode): string => {
    let root = node, seen = new Set<string>();
    while (root.parent && byId.has(root.parent) && !seen.has(root.key)) { seen.add(root.key); root = byId.get(root.parent)!; }
    return root.key;
  };
  const roots = [...new Set(nodes.map(rootOf))];
  const color = (node: CourseGraphNode): string => COLORS[roots.indexOf(rootOf(node)) % COLORS.length]!;
  const signature = nodes.map(node => node.key).join('\n');
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!touched.current) {
      const focus = nodes.find(node => node.current) ?? nodes[0], point = focus ? currentPoints.current.get(focus.key) : undefined;
      setCamera(size.width < 600 && point ? { z: .9, x: 24 - point.x * .9, y: 160 - point.y * .9 } : fitMap([...currentPoints.current.values()], size.width, size.height));
    }
  }, [signature, size]);
  useLayoutEffect(() => {
    if (!world.current) return;
    const observer = new ResizeObserver(entries => setHeights(previous => {
      const next = { ...previous }; let changed = false;
      for (const entry of entries) {
        const element = entry.target as HTMLElement, key = element.dataset.mapKey!;
        const height = element.offsetHeight;
        if (next[key] !== height) { next[key] = height; changed = true; }
      }
      return changed ? next : previous;
    }));
    world.current.querySelectorAll('[data-map-key]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [signature]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (event: WheelEvent): void => {
      if ((event.target as Element).closest('.sf-map-float')) return;
      event.preventDefault(); touched.current = true;
      const box = el.getBoundingClientRect();
      setCamera(previous => zoomMap(previous, { x: event.clientX - box.left, y: event.clientY - box.top }, event.deltaY < 0 ? 1.12 : 1 / 1.12));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const zoom = (factor: number): void => { touched.current = true; setCamera(previous => zoomMap(previous, { x: size.width / 2, y: size.height / 2 }, factor)); };
  const fit = (): void => { touched.current = true; setCamera(fitMap([...points.values()], size.width, size.height)); };
  const locate = (): void => {
    const key = selected ?? nodes.find(node => node.current)?.key, point = key ? points.get(key) : undefined;
    if (!point) { fit(); return; }
    touched.current = true;
    const z = Math.max(camera.z, 0.9);
    setCamera({ z, x: size.width / 2 - (point.x + 115) * z, y: size.height / 2 - (point.y + 60) * z });
  };
  function down(event: React.PointerEvent<HTMLDivElement>, key?: string): void {
    if (event.button !== 0 || busy || (event.target as HTMLElement).closest('button,input,select,summary,.sf-map-float')) return;
    if (!key && (event.target as HTMLElement).closest('[data-map-key]')) return;
    if (gesture.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { ...(key ? { key } : {}), pointer: event.pointerId, start: { x: event.clientX, y: event.clientY },
      origin: key ? points.get(key)! : cameraRef.current, moved: false, z: cameraRef.current.z };
    suppressClick.current = false;
  }
  function move(event: React.PointerEvent<HTMLDivElement>): void {
    const at = gesture.current;
    if (!at || at.pointer !== event.pointerId) return;
    const dx = event.clientX - at.start.x, dy = event.clientY - at.start.y;
    if (!at.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    at.moved = true; touched.current = true;
    if (at.key) setHolding({ key: at.key, position: { x: Math.max(0, Math.round(at.origin.x + dx / at.z)), y: Math.max(0, Math.round(at.origin.y + dy / at.z)) } });
    else setCamera({ x: at.origin.x + dx, y: at.origin.y + dy, z: at.z });
  }
  function end(event: React.PointerEvent<HTMLDivElement>, cancel = false): void {
    const at = gesture.current;
    if (!at || at.pointer !== event.pointerId) return;
    gesture.current = undefined; suppressClick.current = at.moved;
    if (!cancel && at.moved && at.key) {
      const dx = event.clientX - at.start.x, dy = event.clientY - at.start.y;
      const position = { x: Math.max(0, Math.round(at.origin.x + dx / at.z)), y: Math.max(0, Math.round(at.origin.y + dy / at.z)) };
      void onPlace(at.key, position).finally(() => setHolding(undefined));
    } else { setHolding(undefined); if (!cancel && !at.key && !at.moved) onSelect(); }
  }
  return <div className="sf-map-canvas" data-testid="roadmap-canvas" ref={viewport}
    onPointerDown={event => down(event)} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)}>
    <div className="sf-map-world" ref={world} data-testid="map-world" data-scale={camera.z} data-pan-x={camera.x} data-pan-y={camera.y}
      style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.z})` }}>
      <svg className="sf-map-edges" aria-hidden="true" width="1" height="1">
        {nodes.flatMap(node => {
          const parent = node.parent ? byId.get(node.parent) : undefined;
          if (!parent) return [];
          const a = points.get(parent.key)!, b = points.get(node.key)!, y1 = a.y + (heights[parent.key] ?? 120) / 2, y2 = b.y + (heights[node.key] ?? 120) / 2;
          return <g key={node.key} opacity={node.matches && parent.matches ? 0.85 : 0.12} data-testid="map-edge" data-parent={parent.key} data-child={node.key}>
            <path d={`M ${a.x + 230} ${y1} C ${a.x + 300} ${y1}, ${b.x - 70} ${y2}, ${b.x} ${y2}`}
              stroke={color(node)} strokeWidth={node.planned ? 1.4 : 2.2} strokeDasharray={node.planned ? '5 4' : undefined} fill="none" />
            <circle cx={a.x + 230} cy={y1} r="3.2" fill="var(--paper-hi)" stroke={color(node)} strokeWidth="1.5" />
          </g>;
        })}
      </svg>
      {nodes.map(node => {
        const point = points.get(node.key)!;
        return <div key={node.key} data-map-key={node.key} data-testid="roadmap-canvas-node" data-node-id={node.key}
          data-x={point.x} data-y={point.y} data-matches={node.matches} data-planned={node.planned}
          className={'sf-map-card' + (node.planned ? ' planned' : '') + (node.current ? ' cur' : '') + (node.archived ? ' arch' : '')
            + (!node.matches ? ' faded' : '') + (selected === node.key ? ' selected' : '') + (holding?.key === node.key ? ' dragging' : '')}
          style={{ left: point.x, top: point.y }} role="button" tabIndex={0} aria-label={node.title}
          onPointerDown={event => down(event, node.key)} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)}
          onClick={() => { if (!suppressClick.current) onSelect(node.key); }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(node.key); } }}>
          <div className="sf-map-meta"><i style={{ background: color(node) }} />{node.planned ? '◇ 还没上' : node.archived ? '已归档' : node.current ? '当前课' : '上过的课'}{node.date && ' · ' + node.date.slice(5)}</div>
          <div className="sf-map-title">{node.title}</div>{node.preview && <div className="sf-map-preview">{node.preview}</div>}
          <div className="sf-map-actions"><button type="button" disabled={busy} onClick={event => { event.stopPropagation(); onOpen(node.key); }}>{node.planned ? '开这节' : '打开'}</button>
            <button type="button" onClick={event => { event.stopPropagation(); onSelect(node.key); }}>详情</button>
            {node.position && <button type="button" data-testid="roadmap-node-auto" disabled={busy} onClick={event => { event.stopPropagation(); void onPlace(node.key, null); }}>排回原位</button>}</div>
          {node.lineName && <span className="sf-map-line-name" style={{ color: color(node) }}>— {node.lineName}</span>}
        </div>;
      })}
    </div>
    <div className="sf-map-float sf-map-filter" data-testid="map-filter">{toolbar}</div>
    <div className="sf-map-float sf-map-controls" data-testid="map-controls">
      <button type="button" data-testid="roadmap-create" disabled={busy} onClick={onCreate}>安排新课</button>
      <button type="button" data-testid="map-tidy" disabled={busy || !nodes.length} onClick={() => { void onTidy().then(fit); }}>整理</button>
      <button type="button" data-testid="map-locate" onClick={locate}>定位</button><span className="sf-map-separator" />
      <button type="button" data-testid="map-zoom-out" aria-label="缩小路线图" onClick={() => zoom(1 / 1.2)}>−</button>
      <button type="button" data-testid="map-fit" title="适应全部课程" onClick={fit}>{Math.round(camera.z * 100)}%</button>
      <button type="button" data-testid="map-zoom-in" aria-label="放大路线图" onClick={() => zoom(1.2)}>＋</button>
    </div>
    {!nodes.length && <p className="sf-map-empty" data-testid="roadmap-empty">暂无课程</p>}
    <span className="sf-map-hint">拖动空白移动 · 滚轮缩放 · 拖动卡片摆位</span>
  </div>;
}
