import { createSpatialProjector, spatialConeRings, spatialPointMap, spatialRing, spatialTicks } from './board-spatial.js';
import { compileExpression } from './math-expression.js';
import { figureBounds, figureView } from './board-figure.js';
import { flowBlanks, layoutFlow, renderFlowSvg } from './board-flow.js';
import { loadLazyModule } from './lazy-assets.js';
import {navigationPreferenceFor,wheelCamera,bindWheelBoundary} from './board/board-navigation.js';

/**
 * Board figures and flow diagrams on the page. JSXGraph is fetched from the
 * Host lazy route the first time a figure is shown; every formula runs through
 * the board's own expression compiler, and every label is plain SVG text —
 * nothing a figure line says is parsed as HTML or script.
 */
export const loadFigureEngine = () => loadLazyModule('jsxgraph.mjs', module => {
  const JXG = module.default ?? module.JXG;
  // JessieCode compilation uses eval even for internal axis identities. The
  // interpreter keeps JSXGraph on the existing strict script-src self policy.
  JXG.Options.jc.compile=false;
  for (const key of ['text', 'label']) if (JXG.Options[key]) Object.assign(JXG.Options[key], { display: 'internal', parse: false, useMathJax: false, useKatex: false });
  return JXG;
});

const COLOR = { line: '#4d7aa6', point: '#335b80', accent: '#c0663c', soft: '#8aa7c0', fill: '#cfe0ee' };
const number = value => Number(value.toFixed(2)).toString();
/** Live SVG snapshots of mounted figures, read by the export. */
export const figureSnapshots = new Map();
export function snapshotFigures() {
  return Object.fromEntries([...figureSnapshots].map(([key, read]) => [key, read()]).filter(([, svg]) => svg));
}
const cleanSvg = svg => svg.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '').replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s+(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript|data):[\s\S]*?\1/gi, '').replace(/url\(\s*(["']?)\s*(?:javascript|data):[^)]*\)/gi, 'none');

export function createBoardVisuals(React) {
  const h = React.createElement, { useEffect, useMemo, useRef, useState } = React;

  /** The JSXGraph board of one figure. Params are read live through `scope`. */
  function FigureCanvas({ spec, specKey, values, answer, disabled, snapshotKey, onDrags, onDragEnd,navigationActive=false }) {
    const host = useRef(null), engine = useRef(null), board = useRef(null), marker = useRef(null), scope = useRef({});
    const latest = useRef({ answer, disabled, onDrags, onDragEnd,navigationActive });
    latest.current = { answer, disabled, onDrags, onDragEnd,navigationActive };
    Object.assign(scope.current, values);
    const [status, setStatus] = useState('loading');
    useEffect(() => {
      let alive = true;
      setStatus('loading');
      // An answered figure is redrawn read-only under the same key; each canvas removes only its own reader.
      const snapshot = () => { const svg = host.current?.querySelector('svg'); return svg ? cleanSvg(svg.outerHTML) : ''; };
      loadFigureEngine().then(JXG => {
        if (!alive || !host.current) return;
        engine.current = JXG;
        host.current.id ||= 'nb-figure-' + Math.random().toString(36).slice(2);
        const bounds = figureView(spec), frame = figureBounds(spec);
        const created = JXG.JSXGraph.initBoard(host.current.id, { boundingbox: [bounds.xmin, bounds.ymax, bounds.xmax, bounds.ymin], axis: spec.axes, keepAspectRatio: !spec.axes, showNavigation: false, showCopyright: false, showFullscreen: false, showScreenshot: false, pan: { enabled: latest.current.navigationActive,needShift:false }, zoom: { enabled: false, wheel: false }, resize: { enabled: true, throttle: 100 } });
        board.current = created;
        const S = scope.current, names = spec.params.map(param => param.name);
        const compiled = (source, variables) => compileExpression(source, [...variables, ...names]).evaluate;
        const elements = new Map(), drags = new Map(),pendingDrags=new Map();
        const pointStyle = drag => ({ size: drag ? 4 : 3, fillColor: drag ? COLOR.accent : COLOR.point, strokeColor: drag ? COLOR.accent : COLOR.point, label: { offset: [6, 6], fontSize: 13 } });
        for (const item of spec.objects) {
          if (item.kind === 'function') { const f = compiled(item.expr, ['x']); elements.set(item.name, created.create('functiongraph', [x => { S.x = x; return f(S); }], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'curve') { const l = compiled(item.lhs, ['x', 'y']), r = compiled(item.rhs, ['x', 'y']); elements.set(item.name, created.create('implicitcurve', [(x, y) => { S.x = x; S.y = y; return l(S) - r(S); }], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'parametric') { const X = compiled(item.x, ['t']), Y = compiled(item.y, ['t']); elements.set(item.name, created.create('curve', [t => { S.t = t; return X(S); }, t => { S.t = t; return Y(S); }, item.t[0], item.t[1]], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'point') {
            const X = compiled(item.x, []), Y = compiled(item.y, []);
            const point = created.create('point', item.drag ? [X(S), Y(S)] : [() => X(S), () => Y(S)], { name: item.name, fixed: !item.drag, ...pointStyle(item.drag) });
            if (item.drag) { drags.set(item.name, point); point.on('drag', () => { if (!latest.current.disabled){const position={x:point.X(),y:point.Y()};pendingDrags.set(item.name,position);latest.current.onDrags?.(item.name,position);} }); }
            elements.set(item.name, point);
          }
          else if (item.kind === 'segment' || item.kind === 'line') elements.set(item.name, created.create(item.kind, item.points.map(name => elements.get(name)), { strokeColor: COLOR.soft, strokeWidth: 1.6 }));
          else if (item.kind === 'circle') { const center = elements.get(item.center), R = item.radius ? compiled(item.radius, []) : null; elements.set(item.name, created.create('circle', item.through ? [center, elements.get(item.through)] : [center, () => R(S)], { strokeColor: COLOR.soft, strokeWidth: 1.6 })); }
          else if (item.kind === 'midpoint') elements.set(item.name, created.create('midpoint', item.points.map(name => elements.get(name)), { name: item.name, ...pointStyle(false) }));
          else if (item.kind === 'intersection') elements.set(item.name, created.create('intersection', [elements.get(item.of[0]), elements.get(item.of[1]), item.index - 1], { name: item.name, ...pointStyle(false) }));
          else if (item.kind === 'polygon') elements.set(item.name, created.create('polygon', item.points.map(name => elements.get(name)), { fillColor: COLOR.fill, fillOpacity: .35, borders: { strokeColor: COLOR.soft } }));
          else if (item.kind === 'angle') elements.set(item.name, created.create('angle', item.points.map(name => elements.get(name)), { radius: .5, name: '', fillColor: '#f0d9b5', strokeColor: COLOR.accent }));
          else if (item.kind === 'arrow') { const from = elements.get(item.from), DX = compiled(item.dx, []), DY = compiled(item.dy, []); elements.set(item.name, created.create('arrow', [from, [() => from.X() + DX(S), () => from.Y() + DY(S)]], { strokeColor: COLOR.accent, strokeWidth: 2, name: item.label, withLabel: true })); }
          else if (item.kind === 'text') { const X = compiled(item.x, []), Y = compiled(item.y, []); created.create('text', [() => X(S), () => Y(S), item.content], { fontSize: 14, color: '#3b4652' }); }
        }
        // 在图上作答: a click places the answer marker; a dragged point reports where it went.
        const place = point => {
          if (marker.current) marker.current.moveTo([point.x, point.y]);
          else marker.current = created.create('point', [point.x, point.y], { name: '？', fixed: true, size: 5, fillColor: COLOR.accent, strokeColor: '#fff', label: { offset: [8, 8] } });
        };
        const current = latest.current.answer;
        if (current?.mode === 'point' && current.point) place(current.point);
        if (current?.mode === 'drag' && current.point) drags.get(spec.ask.target)?.moveTo([current.point.x, current.point.y]);
        created.on('down', event => {
          const now = latest.current;
          if (now.disabled || now.answer?.mode !== 'point') return;
          // getMousePosition applies the canvas zoom (a CSS transform); getUsrCoordsOfMouse would not.
          const screen = created.getMousePosition(event), usr = new JXG.Coords(JXG.COORDS_BY_SCREEN, screen, created).usrCoords, x = usr[1], y = usr[2];
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          // A click in the axis margin counts as the nearest point of the declared frame.
          const point = { x: Math.min(frame.xmax, Math.max(frame.xmin, x)), y: Math.min(frame.ymax, Math.max(frame.ymin, y)) };
          place(point); now.answer.onPoint(point);
        });
        created.on('up',()=>{for(const [name,position]of pendingDrags)latest.current.onDragEnd?.(name,position);pendingDrags.clear();});
        if (snapshotKey) figureSnapshots.set(snapshotKey, snapshot);
        setStatus('ready');
      }, () => { if (alive) setStatus('failed'); });
      return () => {
        alive = false; marker.current = null;
        if (snapshotKey && figureSnapshots.get(snapshotKey) === snapshot) figureSnapshots.delete(snapshotKey);
        if (board.current && engine.current) { try { engine.current.JSXGraph.freeBoard(board.current); } catch { /* already gone */ } }
        board.current = null;
      };
    }, [specKey]);
    // Navigation changes event ownership, never the figure instance. Local
    // zoom, dragged points and the conversation projection remain aligned.
    useEffect(()=>{
      const created=board.current,element=host.current;
      if(!created||status!=='ready')return;
      created.setAttribute({pan:{...created.attr.pan,enabled:navigationActive,needshift:false}});
      if(!navigationActive)return;
      const wheel=event=>{
        event.preventDefault();event.stopPropagation();
        const rect=element.getBoundingClientRect(),[left,top,right,bottom]=created.getBoundingBox();
        const next=wheelCamera({x:0,y:0,z:1},event,navigationPreferenceFor(element),{x:event.clientX-rect.left,y:event.clientY-rect.top},rect.height);
        const width=(right-left)/next.z,height=(top-bottom)/next.z,x=left-next.x/rect.width*width,y=top+next.y/rect.height*height;
        created.setBoundingBox([x,y,x+width,y-height],!spec.axes);
      };
      element.addEventListener('wheel',wheel,{passive:false,capture:true});
      return()=>element.removeEventListener('wheel',wheel,true);
    },[navigationActive,status,specKey]);
    useEffect(() => { board.current?.fullUpdate?.(); }, [JSON.stringify(values)]);
    return h('div', { className: 'nb-figure', 'data-status': status },
      h('div', { ref: host, className: 'nb-figure-board', role: 'img', 'aria-label': spec.ask?.prompt ?? '图' }),
      status === 'loading' && h('div', { className: 'nb-figure-note' }, '正在准备作图…'),
      status === 'failed' && h('div', { className: 'nb-figure-note', role: 'status' }, '作图工具暂时没有加载出来，请刷新页面再试。'));
  }

  function Params({ spec, values, onChange, onCommit, disabled, only }) {
    const params = only ? spec.params.filter(param => param.name === only) : spec.params;
    if (!params.length) return null;
    return h('div', { className: 'nb-figure-params' }, params.map(param => h('label', { key: param.name },
      h('span', null, param.name), h('input', { type: 'range', min: param.min, max: param.max, step: param.step, value: values[param.name], disabled, 'aria-label': `参数 ${param.name}`, onChange: event => onChange(param.name, Number(event.target.value)),onPointerUp:event=>onCommit?.(param.name,Number(event.currentTarget.value)),onKeyUp:event=>onCommit?.(param.name,Number(event.currentTarget.value)) }),
      h('b', null, number(values[param.name])))));
  }
  const initialValues = spec => Object.fromEntries(spec.params.map(param => [param.name, param.value]));

  /** A lightweight SVG projection for space-coordinate figures. It keeps the
   * declarative figure contract while avoiding a second WebGL/persistence path. */
  function SpaceFigureCanvas({ spec, values, snapshotKey }) {
    const host = useRef(null), gesture = useRef(null);
    const [camera, setCamera] = useState({ yaw: -.72, pitch: .52, zoom: 1 });
    const sceneResult = useMemo(() => {
      try { return { scene: spatialPointMap(spec, values, compileExpression), error: false }; }
      catch { return { scene: null, error: true }; }
    }, [spec, JSON.stringify(values)]);
    const scene = sceneResult.scene;
    useEffect(() => { if (!snapshotKey) return undefined; const snapshot = () => { const svg = host.current; return svg?.tagName?.toLowerCase() === 'svg' ? cleanSvg(svg.outerHTML) : ''; }; figureSnapshots.set(snapshotKey,snapshot); return () => { if (figureSnapshots.get(snapshotKey)===snapshot) figureSnapshots.delete(snapshotKey); }; }, [snapshotKey]);
    useEffect(() => {
      const svg = host.current;
      if (!svg) return undefined;
      const wheel = event => {
        event.preventDefault(); event.stopPropagation();
        setCamera(previous => ({ ...previous, zoom: Math.max(.35,Math.min(3,previous.zoom * (event.deltaY>0?.92:1.08))) }));
      };
      // React delegates wheel as passive; the local listener must consume the
      // scroll so zooming the figure does not also move the surrounding board.
      svg.addEventListener('wheel',wheel,{passive:false});
      return () => svg.removeEventListener('wheel',wheel);
    }, [sceneResult.error]);
    if (sceneResult.error) return h('div', { className: 'nb-space-error', role: 'alert' }, '空间表达式无效，请检查参数范围或坐标表达式。');
    const box = figureBounds(spec), project = createSpatialProjector(box, camera);
    const coord = point => project(point).slice(0, 2).map(value => value.toFixed(1)).join(',');
    const edge = (a, b, key, className = 'nb-space-edge') => a && b && h('line', { key, x1: project(a)[0], y1: project(a)[1], x2: project(b)[0], y2: project(b)[1], className, stroke: className === 'nb-space-grid' ? '#e8edf2' : className === 'nb-space-axis' ? '#7992a8' : className === 'nb-space-vector' ? '#c0663c' : '#91a7bb', strokeWidth: className === 'nb-space-axis' ? 1.8 : className === 'nb-space-vector' ? 2.2 : 1.4, vectorEffect: 'non-scaling-stroke' });
    const polygon = (points, key, className = 'nb-space-face') => points.length >= 3 && points.every(point => point && point.every(Number.isFinite)) && h('polygon', { key, points: points.map(coord).join(' '), className, fill: '#b8d2e5', fillOpacity: .18, stroke: '#7797b1', strokeWidth: 1.2, vectorEffect: 'non-scaling-stroke' });
    const label = (text, point, key) => { if (!point || !point.every(Number.isFinite)) return null; const [x, y] = project(point); return h('text', { key, x: x + 7, y: y - 7, className: 'nb-space-label', fill: '#50677d', fontSize: 13, fontFamily: '-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, strokeLinejoin: 'round' }, text); };
    const add = (a, b) => a.map((value, index) => value + b[index]);
    const multiply = (a, scalar) => a.map(value => value * scalar);
    const subtract = (a, b) => a.map((value, index) => value - b[index]);
    const objectNodes = scene.objects.map((item, index) => {
      const key = `${item.kind}-${item.name ?? index}`;
      if (item.kind === 'point') { const point = scene.points.get(item.name); if (!point) return null; const [x, y] = project(point); return h(React.Fragment, { key }, h('circle', { cx: x, cy: y, r: 4, className: 'nb-space-point', fill: '#c0663c', stroke: '#fff', strokeWidth: 1.5 }), label(item.name, point, `${key}-label`)); }
      if (item.kind === 'text') return label(item.content, [scene.evaluate(item.x), scene.evaluate(item.y), scene.evaluate(item.z)], key);
      if (item.kind === 'vector' || item.kind === 'arrow') { const from = scene.points.get(item.from), to = from && add(from, [scene.evaluate(item.dx), scene.evaluate(item.dy), scene.evaluate(item.dz)]); return from && to ? h(React.Fragment, { key }, edge(from, to, `${key}-edge`, 'nb-space-vector'), label(item.label, to, `${key}-label`)) : null; }
      if (item.kind === 'segment' || item.kind === 'line') { const [a, b] = item.points.map(name => scene.points.get(name)); if (!a || !b) return null; const vector = subtract(b, a), from = item.kind === 'line' ? subtract(a, multiply(vector, 1.5)) : a, to = item.kind === 'line' ? add(b, multiply(vector, 1.5)) : b; return edge(from, to, key); }
      if (item.kind === 'plane' || item.kind === 'polygon') return polygon(item.points.map(name => scene.points.get(name)), key);
      if (item.kind === 'cuboid') { const points = item.points.map(name => scene.points.get(name)); const faces = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]], edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]; return h(React.Fragment, { key }, faces.map((face,n) => polygon(face.map(i => points[i]), `${key}-face-${n}`)), edges.map(([a,b],n) => edge(points[a],points[b],`${key}-edge-${n}`)), label(item.name, points[6], `${key}-label`)); }
      if (item.kind === 'tetrahedron') { const points = item.points.map(name => scene.points.get(name)), edges = []; for (let a=0;a<points.length;a++) for (let b=a+1;b<points.length;b++) edges.push(edge(points[a],points[b],`${key}-${a}-${b}`)); return h(React.Fragment, { key }, edges, label(item.name,points[3],`${key}-label`)); }
      if (item.kind === 'prism') { const base = item.points.map(name => scene.points.get(name)), delta = [scene.evaluate(item.dx),scene.evaluate(item.dy),scene.evaluate(item.dz)], top = base.map(point => add(point,delta)); return h(React.Fragment, { key }, polygon(base,`${key}-base`),polygon(top,`${key}-top`),base.map((point,n)=>edge(point,top[n],`${key}-vertical-${n}`)),base.map((point,n)=>edge(point,base[(n+1)%base.length],`${key}-base-${n}`)),top.map((point,n)=>edge(point,top[(n+1)%top.length],`${key}-top-${n}`)),label(item.name,top[0],`${key}-label`)); }
      if (item.kind === 'pyramid') { const base = item.points.map(name => scene.points.get(name)), apex = scene.points.get(item.apex); return h(React.Fragment, { key }, polygon(base,`${key}-base`),base.map((point,n)=>edge(point,apex,`${key}-side-${n}`)),base.map((point,n)=>edge(point,base[(n+1)%base.length],`${key}-base-${n}`)),label(item.name,apex,`${key}-label`)); }
      if (['sphere','cylinder','cone','frustum'].includes(item.kind)) { const center = scene.points.get(item.center), radius = scene.evaluate(item.radius); if (!center || radius < 0) return null; if (item.kind === 'sphere') { const [x,y] = project(center), r = Math.abs(radius * .62 * Math.min(760,520) / Math.max(box.xmax-box.xmin,box.ymax-box.ymin,box.zmax-box.zmin,1) * camera.zoom); return h(React.Fragment,{key},h('ellipse',{cx:x,cy:y,rx:r,ry:r*.58,className:'nb-space-surface',fill:'#a6c6dd',fillOpacity:.13,stroke:'#7193ae',strokeWidth:1.3}),h('ellipse',{cx:x,cy:y,rx:r*.58,ry:r,className:'nb-space-surface nb-space-dashed',fill:'none',stroke:'#7193ae',strokeWidth:1.3,strokeDasharray:'4 4'}),label(item.name,center,`${key}-label`)); }
        const axis = [scene.evaluate(item.dx),scene.evaluate(item.dy),scene.evaluate(item.dz)], height = scene.evaluate(item.height), topRadius = item.kind === 'frustum' ? scene.evaluate(item.top) : item.kind === 'cone' ? 0 : radius;
        if (height < 0 || topRadius < 0) return null;
        const { bottom, top } = item.kind === 'cone'
          ? (() => { const rings = spatialConeRings(center, axis, radius, height); return { bottom: rings.base, top: rings.apex }; })()
          : { bottom: spatialRing(center,axis,radius,0), top: spatialRing(center,axis,topRadius,height) };
        return h('g',{key,'data-spatial-object':`${item.kind}-${item.name}`},polygon(bottom,`${key}-bottom`),item.kind === 'cone' ? null : polygon(top,`${key}-top`),bottom.map((point,n)=>edge(point,top[n],`${key}-side-${n}`)),label(item.name,item.kind === 'cone' ? center : top[0],`${key}-label`)); }
      return null;
    });
    const grid = [];
    for (const x of spatialTicks(box.xmin, box.xmax)) grid.push(edge([x,box.ymin,0],[x,box.ymax,0],`grid-x-${x}`,'nb-space-grid'));
    for (const y of spatialTicks(box.ymin, box.ymax)) grid.push(edge([box.xmin,y,0],[box.xmax,y,0],`grid-y-${y}`,'nb-space-grid'));
    grid.push(edge([box.xmin,0,0],[box.xmax,0,0],'axis-x','nb-space-axis'),edge([0,box.ymin,0],[0,box.ymax,0],'axis-y','nb-space-axis'),edge([0,0,box.zmin],[0,0,box.zmax],'axis-z','nb-space-axis'));
    const endGesture = event => { if (gesture.current?.pointerId === event.pointerId) gesture.current = null; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
    const pointerDown = event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture?.(event.pointerId); gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: camera.yaw, pitch: camera.pitch }; };
    const pointerMove = event => { const start = gesture.current; if (!start || start.pointerId !== event.pointerId) return; setCamera(previous => ({ ...previous, yaw: start.yaw + (event.clientX-start.x)*.01, pitch: Math.max(-1.35,Math.min(1.35,start.pitch+(event.clientY-start.y)*.01)) })); };
    return h('div',{className:'nb-space-figure'},h('svg',{ref:host,className:'nb-space-svg',viewBox:'0 0 760 520',style:{display:'block',width:'100%',height:'auto'},role:'img','aria-label':'空间直角坐标系',onPointerDown:pointerDown,onPointerMove:pointerMove,onPointerUp:endGesture,onPointerCancel:endGesture,onLostPointerCapture:endGesture},grid,objectNodes),h('div',{className:'nb-space-controls'},h('button',{type:'button',onClick:()=>{gesture.current=null;setCamera({yaw:-.72,pitch:.52,zoom:1});}},'重置视角'),h('span',null,'拖动旋转 · 滚轮缩放')));
  }

  function SpaceFigureView({ component, snapshotKey, onDiscuss, prefix, onValueChange,navigationActive,navigationProps,navigationControl }) {
    const { spec } = component, [values, setValues] = useState(() => initialValues(spec));
    useEffect(() => setValues(initialValues(spec)), [component.fingerprint]);
    const bring = () => onDiscuss?.(`${prefix}空间图${spec.params.length ? '：' + spec.params.map(param => `${param.name} = ${number(values[param.name])}`).join('；') : ''}`);
    return h('section', { className: 'nb-figure-view', 'aria-label': '空间直角坐标系',...navigationProps },navigationControl, h(SpaceFigureCanvas, { spec, values, snapshotKey,navigationActive }), h(Params, { spec, values,onCommit:onValueChange, onChange: (name, value) => setValues(previous => ({ ...previous, [name]: value })) }), spec.params.length > 0&&onDiscuss && h('div', { className: 'nb-q-actions' }, h('button', { type: 'button', onClick: bring }, '带入对话')));
  }

  /** A figure to explore (no ask): sliders and draggable points, then 带入对话. */
  function FigureView({ component, snapshotKey, onDiscuss, prefix, onValueChange, onPointChange,navigationActive=false }) {
    const { spec } = component;
    const [values, setValues] = useState(() => initialValues(spec));
    const drags = useRef({});
    const [localNavigation,setLocalNavigation]=useState(false),navigationHost=useRef(),active=navigationActive||localNavigation;
    useEffect(()=>{if(active)return bindWheelBoundary(navigationHost.current);},[active]);
    const navigationProps={ref:navigationHost,'data-board-editing':active?'true':undefined,tabIndex:active?0:undefined,onPointerDown:event=>{if(active)event.stopPropagation();},onKeyDown:event=>{if(active&&event.key==='Escape'&&!event.defaultPrevented&&!navigationActive){event.preventDefault();event.stopPropagation();setLocalNavigation(false);}}};
    const navigationControl=!navigationActive&&h('button',{className:'nb-figure-navigation',type:'button','aria-pressed':localNavigation,onClick:()=>{setLocalNavigation(value=>!value);navigationHost.current?.focus({preventScroll:true});}},localNavigation?'结束操作':'操作图形');
    useEffect(() => { setValues(initialValues(spec)); drags.current = {}; }, [component.fingerprint]);
    if (spec.space) return h(SpaceFigureView, { component, snapshotKey, onDiscuss, prefix, onValueChange,navigationActive:active,navigationProps,navigationControl });
    const bring = () => {
      const parts = [...spec.params.map(param => `${param.name} = ${number(values[param.name])}`), ...Object.entries(drags.current).map(([name, point]) => `${name} = (${number(point.x)}, ${number(point.y)})`)];
      onDiscuss?.(`${prefix}图${parts.length ? '：' + parts.join('；') : ''}`);
    };
    return h('section', { className: 'nb-figure-view', 'aria-label': '图',...navigationProps },navigationControl,
      h(FigureCanvas, { spec, specKey: component.fingerprint, values, snapshotKey,navigationActive:active, onDragEnd:onPointChange,onDrags: (name, point) => { drags.current[name] = point; } }),
      h(Params, { spec, values,onCommit:onValueChange, onChange: (name, value) => setValues(previous => ({ ...previous, [name]: value })) }),
      onDiscuss&&(spec.params.length > 0 || spec.objects.some(item => item.drag)) && h('div', { className: 'nb-q-actions' }, h('button', { type: 'button', onClick: bring }, '带入对话')));
  }

  const figureInput = {
    initial(component) {
      const { spec } = component, values = initialValues(spec);
      if (spec.ask?.kind === 'drag') { const target = spec.objects.find(item => item.name === spec.ask.target); const x = Number(compileExpression(target.x, []).evaluate({})), y = Number(compileExpression(target.y, []).evaluate({})); return { values, point: { x, y }, exit: null, note: '' }; }
      return { values, point: null, exit: null, note: '' };
    },
    fromAnswer(component, value, draft) {
      const note = typeof value?.note === 'string' ? value.note : '';
      return value?.point ? { ...draft, point: value.point, note } : Number.isFinite(value?.value) ? { ...draft, values: { ...draft.values, [component.spec.ask.target]: value.value }, note } : draft;
    },
    answer(component, draft) {
      const { ask } = component.spec, note = (draft.note ?? '').trim(), saw = note ? { note } : {};
      if (ask.kind === 'param') return { value: { value: draft.values[ask.target], ...saw } };
      return draft.point ? { value: { point: draft.point, ...saw } } : { missing: '先在图上点出一个位置。' };
    },
    Input({ component, draft, update, disabled, slotKey }) {
      const { spec } = component, ask = spec.ask;
      const setValue = (name, value) => update(previous => ({ ...previous, values: { ...previous.values, [name]: value }, exit: null }));
      return h(React.Fragment, null,
        h('p', { className: 'nb-q-stem' }, ask.prompt),
        h(FigureCanvas, { spec, specKey: component.fingerprint + (disabled ? ':read' : ''), values: draft.values, disabled, snapshotKey: slotKey,
          answer: ask.kind === 'param' ? null : { mode: ask.kind, point: draft.point, onPoint: point => update(previous => ({ ...previous, point, exit: null })) },
          onDrags: (name, point) => { if (ask.kind === 'drag' && name === ask.target) update(previous => ({ ...previous, point, exit: null })); } }),
        h(Params, { spec, values: draft.values, onChange: setValue, disabled }),
        ask.kind !== 'param' && h('p', { className: 'nb-q-wait' }, draft.point ? `${ask.kind === 'drag' ? ask.target : '你点的位置'}：(${number(draft.point.x)}, ${number(draft.point.y)})` : '在图上点一下。'),
        // One sentence of what the student saw goes with the answer; the handed-in summary shows it afterwards.
        !disabled && h('textarea', { className: 'nb-q-note', 'aria-label': '看到了什么', rows: 2, maxLength: 2000, placeholder: '说一句你看到了什么（可选）', value: draft.note ?? '', onChange: event => update(previous => ({ ...previous, note: event.target.value })) }));
    },
  };

  /** A flow diagram: static SVG, with inputs laid over the `[?]` gaps when answering. */
  function FlowDiagram({ spec, fills, onFill, disabled, flowId }) {
    const layout = useMemo(() => layoutFlow(spec), [JSON.stringify(spec)]);
    const svg = useMemo(() => renderFlowSvg(layout, { id: flowId }), [layout, flowId]);
    const blanks = onFill ? layout.nodes.filter(node => node.blank) : [];
    const percent = (value, total) => `${(value / total) * 100}%`;
    return h('div', { className: 'nb-flow-host', style: { maxWidth: layout.width, aspectRatio: `${layout.width} / ${layout.height}` } },
      h('div', { className: 'nb-flow-svg', dangerouslySetInnerHTML: { __html: svg } }),
      blanks.map(node => h('input', { key: node.id, className: 'nb-flow-blank', disabled, value: fills?.[node.id] ?? '', placeholder: '？', 'aria-label': `补上节点 ${node.id}`, style: { left: percent(node.x + 4, layout.width), top: percent(node.y + 4, layout.height), width: percent(node.w - 8, layout.width), height: percent(node.h - 8, layout.height) }, onChange: event => onFill(node.id, event.target.value) })));
  }
  function FlowView({ component, flowId }) {
    return h('section', { className: 'nb-flow-view', 'aria-label': '关系图' }, h(FlowDiagram, { spec: component.spec, flowId }));
  }
  const flowInput = {
    initial(component) { return { fills: Object.fromEntries(flowBlanks(component.spec).map(id => [id, ''])), exit: null, note: '' }; },
    fromAnswer(component, value, draft) { return value?.fills ? { ...draft, fills: { ...draft.fills, ...value.fills } } : draft; },
    answer(component, draft) { return Object.values(draft.fills).some(value => value.trim()) ? { value: { fills: Object.fromEntries(Object.entries(draft.fills).map(([id, value]) => [id, value.trim()])) } } : { missing: '至少补上一处。' }; },
    Input({ component, draft, update, disabled, slotKey }) {
      return h(FlowDiagram, { spec: component.spec, fills: draft.fills, disabled, flowId: `flow-${String(slotKey).replace(/[^A-Za-z0-9-]/g, '-')}${disabled ? '-read' : ''}`, onFill: (id, value) => update(previous => ({ ...previous, fills: { ...previous.fills, [id]: value }, exit: null })) });
    },
  };
  return { FigureView, FlowView, inputs: { figure: figureInput, flow: flowInput } };
}
