import { compileExpression } from './math-expression.js';
import { figureBounds, figureView } from './board-figure.js';
import { flowBlanks, layoutFlow, renderFlowSvg } from './board-flow.js';
import { loadLazyModule } from './lazy-assets.js';

/**
 * Board figures and flow diagrams on the page. JSXGraph is fetched from the
 * Host lazy route the first time a figure is shown; every formula runs through
 * the board's own expression compiler, and every label is plain SVG text —
 * nothing a figure line says is parsed as HTML or script.
 */
export const loadFigureEngine = () => loadLazyModule('jsxgraph.mjs', module => {
  const JXG = module.default ?? module.JXG;
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
const cleanSvg = svg => svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '').replace(/\son[a-z]+="[^"]*"/gi, '');

export function createBoardVisuals(React) {
  const h = React.createElement, { useEffect, useMemo, useRef, useState } = React;

  /** The JSXGraph board of one figure. Params are read live through `scope`. */
  function FigureCanvas({ spec, specKey, values, answer, disabled, snapshotKey, onDrags }) {
    const host = useRef(null), engine = useRef(null), board = useRef(null), marker = useRef(null), scope = useRef({});
    const latest = useRef({ answer, disabled, onDrags });
    latest.current = { answer, disabled, onDrags };
    Object.assign(scope.current, values);
    const [status, setStatus] = useState('loading');
    useEffect(() => {
      let alive = true;
      // An answered figure is redrawn read-only under the same key; each canvas removes only its own reader.
      const snapshot = () => { const svg = host.current?.querySelector('svg'); return svg ? cleanSvg(svg.outerHTML) : ''; };
      loadFigureEngine().then(JXG => {
        if (!alive || !host.current) return;
        engine.current = JXG;
        host.current.id ||= 'nb-figure-' + Math.random().toString(36).slice(2);
        const bounds = figureView(spec), frame = figureBounds(spec);
        const created = JXG.JSXGraph.initBoard(host.current.id, { boundingbox: [bounds.xmin, bounds.ymax, bounds.xmax, bounds.ymin], axis: spec.axes, keepAspectRatio: !spec.axes, showNavigation: false, showCopyright: false, showFullscreen: false, showScreenshot: false, pan: { enabled: false }, zoom: { enabled: false, wheel: false }, resize: { enabled: true, throttle: 100 } });
        board.current = created;
        const S = scope.current, names = spec.params.map(param => param.name);
        const compiled = (source, variables) => compileExpression(source, [...variables, ...names]).evaluate;
        const elements = new Map(), drags = new Map();
        const pointStyle = drag => ({ size: drag ? 4 : 3, fillColor: drag ? COLOR.accent : COLOR.point, strokeColor: drag ? COLOR.accent : COLOR.point, label: { offset: [6, 6], fontSize: 13 } });
        for (const item of spec.objects) {
          if (item.kind === 'function') { const f = compiled(item.expr, ['x']); elements.set(item.name, created.create('functiongraph', [x => { S.x = x; return f(S); }], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'curve') { const l = compiled(item.lhs, ['x', 'y']), r = compiled(item.rhs, ['x', 'y']); elements.set(item.name, created.create('implicitcurve', [(x, y) => { S.x = x; S.y = y; return l(S) - r(S); }], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'parametric') { const X = compiled(item.x, ['t']), Y = compiled(item.y, ['t']); elements.set(item.name, created.create('curve', [t => { S.t = t; return X(S); }, t => { S.t = t; return Y(S); }, item.t[0], item.t[1]], { strokeColor: COLOR.line, strokeWidth: 2 })); }
          else if (item.kind === 'point') {
            const X = compiled(item.x, []), Y = compiled(item.y, []);
            const point = created.create('point', item.drag ? [X(S), Y(S)] : [() => X(S), () => Y(S)], { name: item.name, fixed: !item.drag, ...pointStyle(item.drag) });
            if (item.drag) { drags.set(item.name, point); point.on('drag', () => { if (!latest.current.disabled) latest.current.onDrags?.(item.name, { x: point.X(), y: point.Y() }); }); }
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
    useEffect(() => { board.current?.fullUpdate?.(); }, [JSON.stringify(values)]);
    return h('div', { className: 'nb-figure', 'data-status': status },
      h('div', { ref: host, className: 'nb-figure-board', role: 'img', 'aria-label': spec.ask?.prompt ?? '图' }),
      status === 'loading' && h('div', { className: 'nb-figure-note' }, '正在准备作图…'),
      status === 'failed' && h('div', { className: 'nb-figure-note', role: 'status' }, '作图工具暂时没有加载出来，请刷新页面再试。'));
  }

  function Params({ spec, values, onChange, disabled, only }) {
    const params = only ? spec.params.filter(param => param.name === only) : spec.params;
    if (!params.length) return null;
    return h('div', { className: 'nb-figure-params' }, params.map(param => h('label', { key: param.name },
      h('span', null, param.name), h('input', { type: 'range', min: param.min, max: param.max, step: param.step, value: values[param.name], disabled, 'aria-label': `参数 ${param.name}`, onChange: event => onChange(param.name, Number(event.target.value)) }),
      h('b', null, number(values[param.name])))));
  }
  const initialValues = spec => Object.fromEntries(spec.params.map(param => [param.name, param.value]));

  /** A figure to explore (no ask): sliders and draggable points, then 带入对话. */
  function FigureView({ component, snapshotKey, onDiscuss, prefix }) {
    const { spec } = component;
    const [values, setValues] = useState(() => initialValues(spec));
    const drags = useRef({});
    useEffect(() => { setValues(initialValues(spec)); drags.current = {}; }, [component.fingerprint]);
    const bring = () => {
      const parts = [...spec.params.map(param => `${param.name} = ${number(values[param.name])}`), ...Object.entries(drags.current).map(([name, point]) => `${name} = (${number(point.x)}, ${number(point.y)})`)];
      onDiscuss?.(`${prefix}图${parts.length ? '：' + parts.join('；') : ''}`);
    };
    return h('section', { className: 'nb-figure-view', 'aria-label': '图' },
      h(FigureCanvas, { spec, specKey: component.fingerprint, values, snapshotKey, onDrags: (name, point) => { drags.current[name] = point; } }),
      h(Params, { spec, values, onChange: (name, value) => setValues(previous => ({ ...previous, [name]: value })) }),
      (spec.params.length > 0 || spec.objects.some(item => item.drag)) && h('div', { className: 'nb-q-actions' }, h('button', { type: 'button', onClick: bring }, '带入对话')));
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
