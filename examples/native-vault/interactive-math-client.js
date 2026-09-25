import { validateMathScene, mathSceneSummary } from './interactive-data.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberText = value => Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');

export function normalizeMathScene(scene) {
  return validateMathScene(scene);
}

export function sceneEquation(scene) {
  return mathSceneSummary(scene);
}

function scale(scene, box) {
  const [left, right, top, bottom] = scene.viewport;
  const pad = { left: 38, right: 18, top: 18, bottom: 30 };
  const width = Math.max(1, box.width - pad.left - pad.right), height = Math.max(1, box.height - pad.top - pad.bottom);
  return {
    left, right, top, bottom, pad, width, height,
    x: value => pad.left + (value - left) / (right - left) * width,
    y: value => pad.top + (top - value) / (top - bottom) * height,
  };
}

export function parabolaPath(scene, box) {
  const { a, h, k } = scene.parameters, map = scale(scene, box);
  let path = '';
  const step = (map.right - map.left) / 120;
  for (let x = map.left; x <= map.right + step / 2; x += step) {
    const y = a * (x - h) ** 2 + k;
    const point = `${map.x(x).toFixed(2)} ${map.y(y).toFixed(2)}`;
    path += `${path ? 'L' : 'M'}${point}`;
  }
  return path;
}

export function scenePointFromPointer(scene, box, point) {
  const map = scale(scene, box);
  const h = clamp(map.left + ((point.x - map.pad.left) / map.width) * (map.right - map.left), map.left, map.right);
  const k = clamp(map.top - ((point.y - map.pad.top) / map.height) * (map.top - map.bottom), map.bottom, map.top);
  return { h: Number(h.toFixed(2)), k: Number(k.toFixed(2)) };
}

function graph(React, scene, expanded, onVertexChange) {
  const h = React.createElement, box = expanded ? { width: 720, height: 390 } : { width: 420, height: 240 }, map = scale(scene, box);
  const grid = [];
  for (let x = Math.ceil(map.left); x <= map.right; x++) grid.push(h('line', { key: `x${x}`, x1: map.x(x), y1: map.pad.top, x2: map.x(x), y2: map.pad.top + map.height, className: 'nb-interactive-grid' }));
  for (let y = Math.ceil(map.bottom); y <= map.top; y++) grid.push(h('line', { key: `y${y}`, x1: map.pad.left, y1: map.y(y), x2: map.pad.left + map.width, y2: map.y(y), className: 'nb-interactive-grid' }));
  const axisX = map.x(0), axisY = map.y(0), { a, h: vertexX, k: vertexY } = scene.parameters;
  const focusY = vertexY + 1 / (4 * a);
  return h('svg', { className: `nb-interactive-graph${expanded ? ' is-expanded' : ''}`, viewBox: `0 0 ${box.width} ${box.height}`, role: 'img', 'aria-label': sceneEquation(scene), onPointerDown: onVertexChange ? event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = scenePointFromPointer(scene, { width: rect.width, height: rect.height }, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    const distance = Math.hypot(map.x(vertexX) - (event.clientX - rect.left), map.y(vertexY) - (event.clientY - rect.top));
    if (distance < 24) { event.currentTarget.setPointerCapture?.(event.pointerId); onVertexChange({ type: 'start', point }); }
  } : undefined, onPointerMove: onVertexChange ? event => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onVertexChange({ type: 'move', point: scenePointFromPointer(scene, { width: rect.width, height: rect.height }, { x: event.clientX - rect.left, y: event.clientY - rect.top }) });
  } : undefined, onPointerUp: onVertexChange ? event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); onVertexChange({ type: 'end' }); } : undefined },
  h('g', null, grid),
  h('line', { x1: map.pad.left, y1: axisY, x2: map.pad.left + map.width, y2: axisY, className: 'nb-interactive-axis' }),
  h('line', { x1: axisX, y1: map.pad.top, x2: axisX, y2: map.pad.top + map.height, className: 'nb-interactive-axis' }),
  h('line', { x1: map.pad.left, y1: map.y(focusY), x2: map.pad.left + map.width, y2: map.y(focusY), className: 'nb-interactive-directrix' }),
  h('path', { d: parabolaPath(scene, box), className: 'nb-interactive-curve' }),
  h('circle', { cx: map.x(vertexX), cy: map.y(vertexY), r: expanded ? 8 : 6, className: 'nb-interactive-vertex' }),
  h('circle', { cx: map.x(vertexX), cy: map.y(focusY), r: expanded ? 6 : 4, className: 'nb-interactive-focus' }),
  h('text', { x: map.pad.left + 7, y: map.pad.top + 15, className: 'nb-interactive-label' }, 'y'),
  h('text', { x: map.pad.left + map.width - 15, y: axisY - 8, className: 'nb-interactive-label' }, 'x'),
  h('text', { x: map.x(vertexX) + 8, y: map.y(vertexY) - 10, className: 'nb-interactive-label' }, '顶点'));
}

export function createMathInteractive(React, { scene: input, expanded = false, onChange = () => {}, onExpand = () => {}, onDiscuss = () => {}, onClose = () => {} } = {}) {
  const h = React.createElement, { useEffect, useRef, useState } = React;
  const [scene, setScene] = useState(() => normalizeMathScene(input));
  const [dragging, setDragging] = useState(false);
  const latest = useRef(scene), pending = useRef(null), timer = useRef(null);
  latest.current = scene;
  useEffect(() => { setScene(normalizeMathScene(input)); }, [JSON.stringify(input)]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = next => { const normalized = normalizeMathScene(next); setScene(normalized); latest.current = normalized; pending.current = normalized; clearTimeout(timer.current); timer.current = setTimeout(() => { const value = pending.current; pending.current = null; onChange({ parameters: value.parameters, observation: value.observation }); }, 240); };
  const vertex = event => {
    if (event.type === 'start') { setDragging(true); return; }
    if (event.type === 'end') { setDragging(false); return; }
    if (!dragging) return;
    commit({ ...latest.current, parameters: { ...latest.current.parameters, h: event.point.h, k: event.point.k } });
  };
  const updateA = event => commit({ ...latest.current, parameters: { ...latest.current.parameters, a: Number(event.target.value) } });
  const updateObservation = event => setScene(current => { const next = { ...current, observation: event.target.value }; latest.current = next; return next; });
  const saveObservation = () => { clearTimeout(timer.current); pending.current = null; onChange({ parameters: latest.current.parameters, observation: latest.current.observation }); };
  const content = [
    h('div', { className: 'nb-interactive-head', key: 'head' }, h('div', null, h('strong', null, '抛物线的形状'), h('small', null, sceneEquation(scene))), h('span', { className: 'nb-interactive-chip' }, expanded ? '完整互动' : '互动块')),
    graph(React, scene, expanded, vertex),
    h('div', { className: 'nb-interactive-controls', key: 'controls' }, h('label', null, '开口 a', h('input', { type: 'range', min: '0.1', max: '3', step: '0.1', value: scene.parameters.a, onChange: updateA }), h('b', null, numberText(scene.parameters.a))), h('span', { className: 'nb-interactive-status' }, dragging ? '正在移动顶点' : '拖动顶点或调整参数')),
  ];
  if (expanded) content.push(h('label', { className: 'nb-interactive-observation', key: 'observation' }, '观察记录', h('textarea', { value: scene.observation, onChange: updateObservation, placeholder: '记录你从图像变化中看到的现象…' })));
  content.push(h('div', { className: 'nb-interactive-actions', key: 'actions' }, expanded ? h('button', { onClick: saveObservation }, '保存观察') : null, h('button', { onClick: () => onDiscuss(`${sceneEquation(scene)}。${scene.observation}`) }, '带入对话'), h('button', { onClick: expanded ? onClose : onExpand }, expanded ? '收起' : '展开互动图 ↗')));
  return h('section', { className: `nb-interactive ${expanded ? 'is-expanded' : ''}`, 'data-interactive-provider': 'math', 'data-interactive-preset': scene.preset }, content);
}
