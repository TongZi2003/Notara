/**
 * The one canvas the Vault benches draw on: a force layout of "point + straight
 * line + label" nodes with pin, pan, zoom, hover-neighbour highlighting and a
 * resizable detail pane next to it. The knowledge graph and the route bench both
 * reuse it, so their interaction and visual language cannot drift apart.
 *
 * The board only knows keys: `nodes` are `{ key, title, role }` and `edges` are
 * `{ source, target, kind }`. Every projection stays outside this module, which
 * is why the same board can render files/relations or lessons/课序 without the
 * caller having to fake one as the other.
 */
export const CANVAS_CSS = `
.nv-views{container-type:inline-size;min-width:0}.nv-views button:disabled{opacity:.45;cursor:default}
.nv-views button:focus-visible,.nv-views [tabindex]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.nv-view-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.nv-graph-layout{display:flex;flex:1;min-height:0;overflow:hidden}
.nv-graph-board{position:relative;flex:1;min-width:0;min-height:360px;overflow:hidden;background-color:var(--dsw-alias-bg-layer-2);background-image:radial-gradient(var(--dsw-alias-border-l2) .7px,transparent .7px);background-size:20px 20px}
.nv-graph-svg{width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.nv-graph-node{cursor:pointer;position:absolute;border:0;padding:0;background:transparent;color:var(--dsw-alias-label-primary);font:12px var(--dsw-font-family,system-ui);display:flex;align-items:center;flex-direction:column;touch-action:none}
.nv-graph-node span{white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;text-shadow:0 0 4px var(--dsw-alias-bg-layer-2)}
.nv-graph-pane{width:var(--nv-pane-width,360px);min-width:0;overflow:auto;background:var(--dsw-alias-bg-layer-1);padding:18px;box-sizing:border-box}
.nv-graph-pane h2{font-size:19px;overflow-wrap:anywhere;margin:12px 0}
.nv-graph-pane p{line-height:1.6;overflow-wrap:anywhere}
.nv-resize{width:6px;flex:none;cursor:col-resize;background:var(--dsw-alias-border-l1);touch-action:none}
.nv-resize:hover{background:var(--dsw-alias-state-business-primary)}
.nv-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--dsw-alias-label-secondary);padding:10px 18px;border-top:1px solid var(--dsw-alias-border-l1)}
.nv-legend span{display:inline-flex;align-items:center;gap:5px}
@container (max-width:650px){.nv-graph-layout[data-detail=true]{flex-direction:column}.nv-graph-layout[data-detail=true] .nv-graph-board{min-height:160px}.nv-graph-pane{width:100%;max-height:45%;flex:none;border-top:1px solid var(--dsw-alias-border-l1)}.nv-resize{display:none}}
`;

// Pairwise repulsion is useful for a small graph, but its cost grows with the
// square of the node count. Large Vaults use stable seeded positions below and
// keep dragging, zooming and selection available without a long main-thread
// simulation.
export const GRAPH_FORCE_LIMIT = 180;
export const graphLayoutMode = nodeCount => nodeCount > GRAPH_FORCE_LIMIT ? 'static' : 'force';
export const seededGraphPoint = (index, total, width, height) => {
  const angle = index * 2.399963229728653;
  const radius = Math.max(70, Math.min(width, height) * .42) * Math.sqrt((index + 1) / Math.max(1, total));
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0, fixed: false };
};

/** Node roles differ per bench, so each bench brings its own legend labels. */
export const KNOWLEDGE_ROLES = { root: '原书（根）', intermediate: '中间卡片', leaf: '叶子卡片', isolated: '孤立点', plan: '路线/剧本资料', insight: '锦囊' };
export const LESSON_ROLES = { logged: '已有课堂小结', opened: '已开课', lesson: '计划课程' };

const EDGE_STYLE = {
  split: { stroke: 'var(--dsw-alias-state-business-primary)', dash: undefined, arrow: false },
  reference: { stroke: 'var(--dsw-alias-label-secondary)', dash: '3 5', arrow: false },
  // 课序 keeps the theme colour but carries a head, so a route reads as a
  // direction instead of another undirected relation.
  sequence: { stroke: 'var(--dsw-alias-state-business-primary)', dash: undefined, arrow: true },
};

const MARKS = {
  root: { radius: 8, filled: true, halo: true },
  intermediate: { radius: 6, filled: true, ring: true },
  leaf: { radius: 6 },
  isolated: { radius: 6, dashed: true, muted: true },
  plan: { radius: 7, filled: true },
  logged: { radius: 7, filled: true, halo: true },
  opened: { radius: 7, filled: true },
  lesson: { radius: 6, dashed: true, muted: true },
  insight: { radius: 8, filled: true, ring: true },
};

export function createVaultCanvas(React, { STYLE, IconButton }) {
  const h = React.createElement;
  const { useState, useEffect, useRef } = React;

  /** Slots keep their own view state across tab switches and reloads-of-pane. */
  function useRemembered(state, key, fallback) {
    const [value, setValue] = useState(() => state[key] ?? fallback);
    useEffect(() => { state[key] = value; }, [state, key, value]);
    return [value, setValue];
  }

  function NodeMark({ role, selected = false }) {
    const mark = MARKS[role] ?? MARKS.leaf;
    const accent = 'var(--dsw-alias-state-business-primary, #5865c9)', paper = 'var(--dsw-alias-bg-layer-2)', gray = 'var(--dsw-alias-label-secondary)';
    return h(React.Fragment, null,
      (mark.halo || selected) && h('circle', { r: selected ? 18 : 16, fill: accent, opacity: .12 }),
      mark.ring && h('circle', { r: 11, fill: 'none', stroke: accent, strokeWidth: 1.5 }),
      role==='insight'?h('path',{d:'M 0 -9 L 8 0 L 0 9 L -8 0 Z',fill:accent,stroke:accent}):h('circle', { r: mark.radius, fill: mark.filled ? accent : paper, stroke: mark.muted ? gray : accent, strokeWidth: 1.6, strokeDasharray: mark.dashed ? '3 3' : undefined }));
  }

  /**
   * The board itself. `nodes`/`edges` are already projected; the board owns only
   * layout, camera, dragging and hit-testing, and it reports the pressed node
   * object back so the caller keeps its own selection semantics.
   */
  function Board({ nodes, edges, focus, centerVersion, selected, onSelect, onOpen, onContext, state, layoutMode = 'auto', nodeName = '图谱节点', label = '文件关系图谱' }) {
    const host = useRef(null), positions = useRef(state.positions ?? new Map()), drag = useRef(null), moved = useRef(false), lastContext = useRef({ time: 0, key: '' });
    const [size, setSize] = useState({ width: 800, height: 600 }), [pan, setPan] = useRemembered(state, 'pan', { x: 0, y: 0, zoom: 1 });
    const [hover, setHover] = useState(null), [, draw] = useState(0), [restart, setRestart] = useState(0);
    const marker = useRef(`nv-canvas-arrow-${Math.random().toString(36).slice(2, 9)}`);
    useEffect(() => { const element = host.current; const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight })); observer.observe(element); return () => observer.disconnect(); }, []);
    useEffect(() => {
      const element = host.current;
      const wheel = event => {
        event.preventDefault(); const bounds = element.getBoundingClientRect();
        setPan(previous => {
          const zoom = Math.max(.2, Math.min(3, previous.zoom * Math.exp(-event.deltaY * .001)));
          const x = (event.clientX - bounds.left - bounds.width / 2 - previous.x) / previous.zoom;
          const y = (event.clientY - bounds.top - bounds.height / 2 - previous.y) / previous.zoom;
          return { x: previous.x + x * (previous.zoom - zoom), y: previous.y + y * (previous.zoom - zoom), zoom };
        });
      };
      element.addEventListener('wheel', wheel, { passive: false });
      return () => element.removeEventListener('wheel', wheel);
    }, []);
    useEffect(() => {
      if (!nodes.length) return;
      const previous = positions.current;
      for (const [index, node] of nodes.entries()) if (!previous.has(node.key)) previous.set(node.key, seededGraphPoint(index, nodes.length, size.width, size.height));
      state.positions = previous;
      const points = nodes.map(node => previous.get(node.key));
      if ((layoutMode === 'auto' ? graphLayoutMode(points.length) : layoutMode) === 'static') {
        for (const point of points) { point.vx = 0; point.vy = 0; }
        draw(value => value + 1);
        return;
      }
      let frame, iteration = 0;
      const tick = () => {
        const heat = Math.max(.04, 1 - iteration / 240);
        for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
          const a = points[i], b = points[j], dx = a.x - b.x || .1, dy = a.y - b.y || .1, squared = Math.max(100, dx * dx + dy * dy);
          const f = 9000 * heat / (squared * Math.sqrt(squared));
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
        for (const edge of edges) {
          const a = positions.current.get(edge.source), b = positions.current.get(edge.target); if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, f = (length - 140) * .012 * heat;
          a.vx += dx / length * f; a.vy += dy / length * f; b.vx -= dx / length * f; b.vy -= dy / length * f;
        }
        for (const point of points) {
          if (point.fixed) { point.vx = 0; point.vy = 0; continue; }
          point.vx = (point.vx - point.x * .002 * heat) * .78; point.vy = (point.vy - point.y * .002 * heat) * .78;
          point.x += Math.max(-8, Math.min(8, point.vx)); point.y += Math.max(-8, Math.min(8, point.vy));
          point.x = Math.max(-Math.max(50, size.width / 2 - 80), Math.min(Math.max(50, size.width / 2 - 80), point.x));
          point.y = Math.max(-Math.max(50, size.height / 2 - 55), Math.min(Math.max(50, size.height / 2 - 55), point.y));
        }
        draw(value => value + 1); if (++iteration < 240) frame = requestAnimationFrame(tick);
      };
      tick(); return () => cancelAnimationFrame(frame);
    }, [nodes, edges, restart, size.width, size.height]);
    useEffect(() => { setPan({ x: 0, y: 0, zoom: 1 }); }, [focus, centerVersion]);
    const center = (focus && positions.current.get(focus)) || { x: 0, y: 0 };
    const neighbors = new Set(hover ? [hover, ...edges.flatMap(edge => edge.source === hover ? [edge.target] : edge.target === hover ? [edge.source] : [])] : []);
    const worldPoint = event => { const bounds = host.current.getBoundingClientRect(); return { x: (event.clientX - bounds.left - size.width / 2 - pan.x) / pan.zoom + center.x, y: (event.clientY - bounds.top - size.height / 2 - pan.y) / pan.zoom + center.y }; };
    const reportContext = (node, event) => {
      const now = Date.now();
      if (lastContext.current.key === node.key && now - lastContext.current.time < 250) return;
      lastContext.current = { time: now, key: node.key };
      event.preventDefault(); event.stopPropagation(); onContext?.(node, event);
    };
    return h('div', { ref: host, className: 'nv-graph-board', onPointerDown: event => {
        // A context gesture is not a drag. macOS also uses Control + click.
        if (event.button !== 0 || event.ctrlKey) return;
        if (event.target.closest('button:not([data-node])')) return;
        event.preventDefault();
        const key = event.target.closest('[data-node]')?.getAttribute('data-node');
        const capture = key ? event.target.closest('[data-node]') : event.currentTarget;
        if (key) capture.focus({ preventScroll: true });
        drag.current = { key, startX: event.clientX, startY: event.clientY, pan, capture }; moved.current = false; capture.setPointerCapture(event.pointerId);
      }, onPointerMove: event => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.startX, dy = event.clientY - drag.current.startY;
        if (Math.hypot(dx, dy) < 3 && !moved.current) return; moved.current = true;
        if (drag.current.key) { const point = positions.current.get(drag.current.key); Object.assign(point, worldPoint(event), { fixed: true }); draw(value => value + 1); }
        else setPan({ ...pan, x: drag.current.pan.x + dx, y: drag.current.pan.y + dy });
      }, onPointerUp: event => { drag.current?.capture.releasePointerCapture(event.pointerId); drag.current = null; }, onPointerCancel: () => { drag.current = null; } },
      h('svg', { className: 'nv-graph-svg', 'aria-label': label },
        h('defs', null, h('marker', { id: marker.current, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--dsw-alias-state-business-primary)' }))),
        h('g', { transform: `translate(${size.width / 2 + pan.x - center.x * pan.zoom},${size.height / 2 + pan.y - center.y * pan.zoom}) scale(${pan.zoom})` },
          edges.map((edge, index) => {
            const a = positions.current.get(edge.source), b = positions.current.get(edge.target), style = EDGE_STYLE[edge.kind] ?? EDGE_STYLE.reference;
            return a && b && h('line', { key: `${edge.kind}:${edge.source}->${edge.target}:${index}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'data-edge': edge.kind, stroke: style.stroke, strokeWidth: 1.3, strokeDasharray: style.dash, markerEnd: style.arrow ? `url(#${marker.current})` : undefined, opacity: hover && !(edge.source === hover || edge.target === hover) ? .12 : .65 });
          }))),
        nodes.map(node => { const point = positions.current.get(node.key); return point && h('button', { key: node.key, className: 'nv-graph-node', style: { left: size.width / 2 + pan.x + (point.x - center.x) * pan.zoom, top: size.height / 2 + pan.y + (point.y - center.y) * pan.zoom, transform: `translate(-50%, -24px) scale(${pan.zoom})`, transformOrigin: '50% 24px', opacity: hover && !neighbors.has(node.key) ? .22 : 1 }, 'data-node': node.key, 'data-fixed': point.fixed, 'aria-label': `${nodeName} ${node.title}`, 'aria-pressed': selected === node.key,
          onClick: event => { if (event.button === 0 && !event.ctrlKey && !moved.current) onSelect(node); }, onDoubleClick: event => { if (event.button === 0 && !event.ctrlKey) onOpen?.(node); }, onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node); } },
          onPointerDown: event => { if (event.button === 2 || (event.button === 0 && event.ctrlKey)) reportContext(node, event); },
          onPointerEnter: () => setHover(node.key), onPointerLeave: () => setHover(null), onContextMenu: event => reportContext(node, event) },
          h('svg', { width: 48, height: 48, viewBox: '-24 -24 48 48', 'aria-hidden': true }, h(NodeMark, { role: node.role, selected: selected === node.key })), h('span', { title: node.hint ? `${node.title} · ${node.hint}` : node.title }, node.title)); }),
      h('div', { style: { position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6 } },
        h(IconButton, { icon: 'target', label: '居中', onClick: () => { setPan({ x: 0, y: 0, zoom: 1 }); } }),
        h(IconButton, { icon: 'refresh', label: '重新排列', onClick: () => { for (const point of positions.current.values()) point.fixed = false; setRestart(value => value + 1); } }),
        h('span', { style: STYLE.notice }, `${Math.round(pan.zoom * 100)}%`)));
  }

  return { useRemembered, NodeMark, Board };
}
