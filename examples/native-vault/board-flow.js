/**
 * `flow`: relations and processes (causal chains, concept links, procedures,
 * state changes, timelines) in a small subset of Mermaid flowchart syntax. The
 * layout is our own layered one — deterministic, no dependency — and renders to
 * plain SVG, escaped, for the board and for the exported notes alike. A `[?]`
 * node is a gap the student fills.
 */
export class FlowError extends Error {
  constructor(message, line) { super(message); this.name = 'FlowError'; this.line = line; }
}
const LIMIT = { nodes: 40, edges: 60, text: 60, label: 30 };
const NODE = /^([A-Za-z][A-Za-z0-9_]*)\s*(?:\(\(([^()]*)\)\)|\[([^[\]]*)\]|\{([^{}]*)\})?/;
const EDGE = /^(?:-\.\s*([^.\n>]+?)\s*\.->|--\s*([^-\n>][^>\n]*?)\s*-->|-\.->|-->)/;

export function parseFlow(source) {
  const rows = String(source ?? '').replace(/\r/g, '').split('\n').map((raw, index) => ({ value: raw.trim(), line: index + 1 })).filter(row => row.value);
  const spec = { direction: 'down', nodes: [], edges: [] }, byId = new Map();
  let row, directionSet = false;
  const error = message => { throw new FlowError(message, row?.line); };
  const node = (id, text, shape) => {
    const existing = byId.get(id);
    if (text === undefined) {
      if (existing) return existing;
      text = id;
    }
    const value = text.trim(), blank = value === '?';
    if (!blank && !value) error(`节点 ${id} 的文字是空的。`);
    if (value.length > LIMIT.text) error(`一个节点最多 ${LIMIT.text} 字。`);
    if (existing) {
      if (existing.declared && (existing.text !== value || existing.shape !== shape)) error(`节点 ${id} 前后写的内容不一样；后面引用时只写 ${id}。`);
      if (!existing.declared) Object.assign(existing, { text: value, shape, blank, declared: true });
      return existing;
    }
    if (spec.nodes.length >= LIMIT.nodes) error(`一张图最多 ${LIMIT.nodes} 个节点。`);
    const created = { id, text: value, shape, blank, declared: text !== id || shape !== 'box' };
    spec.nodes.push(created); byId.set(id, created);
    return created;
  };
  for (row of rows) {
    const direction = row.value.match(/^direction\s+(right|down)$/);
    if (direction) { if (directionSet) error('direction 只能写一行。'); directionSet = true; spec.direction = direction[1]; continue; }
    let rest = row.value, previous = null, pendingEdge = null;
    while (rest.length) {
      const matched = rest.match(NODE);
      if (!matched) error(`这里应该是节点，例如 A[文字]、B((问题))、C{判断} 或 D[?]：“${rest}”。`);
      const [whole, id, question, box, decision] = matched;
      const shape = question !== undefined ? 'question' : decision !== undefined ? 'decision' : 'box';
      const current = node(id, question ?? box ?? decision, shape);
      if (pendingEdge) {
        if (spec.edges.length >= LIMIT.edges) error(`一张图最多 ${LIMIT.edges} 条连线。`);
        spec.edges.push({ from: previous.id, to: current.id, ...pendingEdge });
      }
      rest = rest.slice(whole.length).trim();
      if (!rest) break;
      const edge = rest.match(EDGE);
      if (!edge) error(`节点后面应该是连线（--> 实线、-.-> 虚线、-- 说明 --> 带说明）：“${rest}”。`);
      const label = (edge[1] ?? edge[2])?.trim();
      if (label && label.length > LIMIT.label) error(`连线上的说明最多 ${LIMIT.label} 字。`);
      pendingEdge = { dashed: edge[0].startsWith('-.'), ...(label ? { label } : {}) };
      previous = current;
      rest = rest.slice(edge[0].length).trim();
      if (!rest) error('连线后面缺少节点。');
    }
  }
  row = undefined;
  if (!spec.nodes.length) error('图里还没有节点。');
  for (const item of spec.nodes) delete item.declared;
  return spec;
}

export const flowIdentity = spec => JSON.stringify(['flow', spec.direction, spec.nodes, spec.edges]);
export const flowBlanks = spec => spec.nodes.filter(node => node.blank).map(node => node.id);

// Text measure: a CJK character is about one em, Latin about half.
const FONT = 15, LINE = 22, MAX_LINE = 176;
const charWidth = char => /[⺀-鿿＀-￯]/.test(char) ? FONT : FONT * .56;
function wrap(text, maxWidth = MAX_LINE, measure = charWidth) {
  const lines = [];
  let line = '', width = 0;
  for (const char of text) {
    if (char === '\n') { lines.push(line); line = ''; width = 0; continue; }
    const w = measure(char);
    if (width + w > maxWidth && line) { lines.push(line); line = ''; width = 0; }
    line += char; width += w;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
const lineWidth = line => [...line].reduce((sum, char) => sum + charWidth(char), 0);

// Labels use the actual 12px SVG face, with conservative glyph advances.
const LABEL_FONT = 12, LABEL_LINE = 18, LABEL_WIDTH = 168, LABEL_PAD = 8;
const labelCharWidth = char => /[ -~]/.test(char) && !/[MWmw@]/.test(char) ? LABEL_FONT * .65 : LABEL_FONT;
function sizeFlowLabel(text) {
  if (!text) return null;
  const lines = wrap(text, LABEL_WIDTH, labelCharWidth);
  return { lines, w: Math.ceil(Math.max(...lines.map(line => [...line].reduce((sum, char) => sum + labelCharWidth(char), 0)))) + LABEL_PAD * 2,
    h: lines.length * LABEL_LINE + 10 };
}

/** Layered layout: labels own measured gutters; nodes never obscure their text. */
export function layoutFlow(spec) {
  const index = new Map(spec.nodes.map((node, i) => [node.id, i]));
  const sized = spec.nodes.map(node => {
    const lines = node.blank ? ['?'] : wrap(node.text);
    let w = Math.max(...lines.map(lineWidth)) + 30, h = lines.length * LINE + 18;
    if (node.blank) { w = 120; h = 40; }
    if (node.shape === 'question') { w += 18; h += 6; }
    if (node.shape === 'decision') { w = w * 1.35 + 8; h = h * 1.5; }
    return { ...node, lines, w: Math.round(w), h: Math.round(h) };
  });
  // Break cycles for layering only: an edge back into the DFS stack does not push layers.
  const out = spec.nodes.map(() => []), state = new Array(spec.nodes.length).fill(0), forward = [];
  spec.edges.forEach((edge, e) => out[index.get(edge.from)].push({ to: index.get(edge.to), e }));
  const visit = v => { state[v] = 1; for (const { to, e } of out[v]) { if (state[to] === 1 || to === v) continue; forward[e] = true; if (state[to] === 0) visit(to); } state[v] = 2; };
  for (let v = 0; v < spec.nodes.length; v++) if (state[v] === 0) visit(v);
  const layer = new Array(spec.nodes.length).fill(0);
  for (let pass = 0; pass < spec.nodes.length; pass++) {
    let changed = false;
    spec.edges.forEach((edge, e) => { if (!forward[e]) return; const a = index.get(edge.from), b = index.get(edge.to); if (layer[b] < layer[a] + 1) { layer[b] = layer[a] + 1; changed = true; } });
    if (!changed) break;
  }
  const layers = [];
  sized.forEach((node, i) => { (layers[layer[i]] ??= []).push(i); });
  const position = new Map();
  const place = () => layers.forEach(list => list?.forEach((v, order) => position.set(v, order)));
  place();
  const neighbours = (v, up) => spec.edges.flatMap(edge => up ? (index.get(edge.to) === v ? [index.get(edge.from)] : []) : (index.get(edge.from) === v ? [index.get(edge.to)] : []));
  for (let sweep = 0; sweep < 4; sweep++) {
    const up = sweep % 2 === 0;
    for (const list of up ? layers : [...layers].reverse()) {
      if (!list) continue;
      const score = v => { const near = neighbours(v, up).filter(u => layer[u] !== layer[v]); return near.length ? near.reduce((sum, u) => sum + position.get(u), 0) / near.length : position.get(v); };
      list.sort((a, b) => score(a) - score(b) || a - b);
      list.forEach((v, order) => position.set(v, order));
    }
  }
  const right = spec.direction === 'right', gapCross = 24, pad = 16;
  const along = node => right ? node.w : node.h, across = node => right ? node.h : node.w;
  const bands = layers.map(list => list ? Math.max(...list.map(v => along(sized[v]))) : 0);
  const spans = layers.map(list => list ? list.reduce((sum, v) => sum + across(sized[v]), 0) + gapCross * (list.length - 1) : 0);
  const labels = spec.edges.map(edge => {
    const size = sizeFlowLabel(edge.label), from = layer[index.get(edge.from)], to = layer[index.get(edge.to)];
    return { size, from, to, cut: from < to ? Math.floor((from + to - 1) / 2) : null };
  });
  const gaps = bands.map(() => 64);
  labels.forEach(label => {
    if (label.size && label.cut !== null) gaps[label.cut] = Math.max(gaps[label.cut], (right ? label.size.w : label.size.h) + 32);
  });
  const widest = Math.max(...spans, 0), starts = [];
  let main = pad;
  const boxes = new Map();
  layers.forEach((list, l) => {
    if (!list) return;
    starts[l] = main;
    let cross = pad + (widest - spans[l]) / 2;
    for (const v of list) {
      const node = sized[v], offset = (bands[l] - along(node)) / 2;
      boxes.set(node.id, right ? { x: main + offset, y: cross, w: node.w, h: node.h } : { x: cross, y: main + offset, w: node.w, h: node.h });
      cross += across(node) + gapCross;
    }
    main += bands[l] + gaps[l];
  });
  const width = (right ? main - gaps.at(-1) : widest) + pad * (right ? 1 : 2);
  const height = (right ? widest : main - gaps.at(-1)) + pad * (right ? 2 : 1);
  const centers = new Map();
  const crossCenter = box => right ? box.y + box.h / 2 : box.x + box.w / 2;
  // Labels sharing a gutter get separate cross-axis lanes, even when two
  // branches have exactly the same geometric midpoint.
  for (let cut = 0; cut < gaps.length; cut++) {
    const candidates = labels.flatMap((label, e) => {
      if (!label.size || label.cut !== cut) return [];
      const edge = spec.edges[e], wanted = (crossCenter(boxes.get(edge.from)) + crossCenter(boxes.get(edge.to))) / 2;
      return [{ e, size: label.size, wanted }];
    }).sort((a, b) => a.wanted - b.wanted || a.e - b.e);
    let previousEnd = -Infinity;
    for (const item of candidates) {
      const extent = right ? item.size.h : item.size.w;
      const cross = Math.max(item.wanted, previousEnd + 8 + extent / 2);
      previousEnd = cross + extent / 2;
      const along = starts[cut] + bands[cut] + gaps[cut] / 2;
      centers.set(item.e, right ? [along, cross] : [cross, along]);
    }
  }
  // A normal label can extend beyond the narrowest node band (especially a
  // vertical chain). Return lanes start beyond both, not merely beyond nodes.
  const normalCrossStart = labels.flatMap((label, e) => {
    if (!label.size || label.cut === null) return [];
    const center = centers.get(e);
    return [(right ? center[1] : center[0]) - (right ? label.size.h : label.size.w) / 2];
  });
  let outside = Math.min(pad, ...normalCrossStart, ...[...boxes.values()].map(box => right ? box.y : box.x)) - 24;
  const paths = spec.edges.map((edge, e) => {
    const a = boxes.get(edge.from), b = boxes.get(edge.to), label = labels[e];
    const start = right ? [a.x + a.w, a.y + a.h / 2] : [a.x + a.w / 2, a.y + a.h];
    const end = right ? [b.x, b.y + b.h / 2] : [b.x + b.w / 2, b.y];
    const backward = label.from >= label.to;
    let points, mid;
    if (backward) {
      // Return edges live beyond the outermost nodes. A long return label
      // therefore cannot land on a node or outside the exported viewBox.
      const extent = label.size ? (right ? label.size.h : label.size.w) : 0;
      outside -= extent / 2;
      mid = right ? [(start[0] + end[0]) / 2, outside] : [outside, (start[1] + end[1]) / 2];
      points = right
        ? [start, [start[0] + 36, start[1]], [start[0] + 36, mid[1]], mid, [end[0] - 36, mid[1]], [end[0] - 36, end[1]], end]
        : [start, [start[0], start[1] + 36], [mid[0], start[1] + 36], mid, [mid[0], end[1] - 36], [end[0], end[1] - 36], end];
      outside -= extent / 2 + 24;
    } else if (label.size) {
      mid = centers.get(e);
      const bendA = Math.max(8, (right ? mid[0] - start[0] : mid[1] - start[1]) / 2);
      const bendB = Math.max(8, (right ? end[0] - mid[0] : end[1] - mid[1]) / 2);
      points = right
        ? [start, [start[0] + bendA, start[1]], [mid[0] - bendA, mid[1]], mid, [mid[0] + bendB, mid[1]], [end[0] - bendB, end[1]], end]
        : [start, [start[0], start[1] + bendA], [mid[0], mid[1] - bendA], mid, [mid[0], mid[1] + bendB], [end[0], end[1] - bendB], end];
    } else {
      const bend = Math.max(24, (right ? end[0] - start[0] : end[1] - start[1]) / 2);
      const c1 = right ? [start[0] + bend, start[1]] : [start[0], start[1] + bend];
      const c2 = right ? [end[0] - bend, end[1]] : [end[0], end[1] - bend];
      points = [start, c1, c2, end];
      mid = [0.125 * start[0] + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * end[0], 0.125 * start[1] + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * end[1]];
    }
    return { ...edge, points, mid, ...(label.size ? { labelLines: label.size.lines, labelBox: { x: mid[0] - label.size.w / 2, y: mid[1] - label.size.h / 2, w: label.size.w, h: label.size.h } } : {}) };
  });
  // Include label backgrounds and return curves in the canvas extent, so SVG
  // clipping and the live blank-node overlays share the same positive frame.
  const extents = [...boxes.values(), ...paths.flatMap(edge => edge.labelBox ? [edge.labelBox] : []),
    ...paths.flatMap(edge => edge.points.map(([x, y]) => ({ x, y, w: 0, h: 0 })))];
  const minX = Math.min(pad, ...extents.map(box => box.x)), minY = Math.min(pad, ...extents.map(box => box.y));
  const dx = pad - minX, dy = pad - minY;
  const maxX = Math.max(width - pad, ...extents.map(box => box.x + box.w)), maxY = Math.max(height - pad, ...extents.map(box => box.y + box.h));
  const edges = paths.map(({ points, mid, labelBox, ...edge }) => {
    const at = point => [round(point[0] + dx), round(point[1] + dy)].join(' ');
    const d = `M ${at(points[0])} C ${points.slice(1, 4).map(at).join(', ')}${points.length === 7 ? ` C ${points.slice(4).map(at).join(', ')}` : ''}`;
    return { ...edge, d, labelAt: [round(mid[0] + dx), round(mid[1] + dy)], ...(labelBox ? { labelBox: { ...labelBox, x: round(labelBox.x + dx), y: round(labelBox.y + dy) } } : {}) };
  });
  return { width: Math.ceil(maxX + dx + pad), height: Math.ceil(maxY + dy + pad), direction: spec.direction,
    nodes: sized.map(node => { const box = boxes.get(node.id); return { ...node, ...box, x: round(box.x + dx), y: round(box.y + dy) }; }), edges };

}
const round = value => Math.round(value * 10) / 10;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The shape of one node as SVG, shared by the board and the export. */
export function flowNodeShape(node) {
  if (node.shape === 'decision') return `<polygon points="${round(node.x + node.w / 2)},${round(node.y)} ${round(node.x + node.w)},${round(node.y + node.h / 2)} ${round(node.x + node.w / 2)},${round(node.y + node.h)} ${round(node.x)},${round(node.y + node.h / 2)}"/>`;
  const rx = node.shape === 'question' ? node.h / 2 : 9;
  return `<rect x="${round(node.x)}" y="${round(node.y)}" width="${node.w}" height="${node.h}" rx="${round(rx)}"/>`;
}

/** A complete, static, escaped SVG of the flow (export, reading copies). */
export function renderFlowSvg(layout, { id = 'flow', fills = {} } = {}) {
  const marker = `${id}-arrow`;
  const edges = layout.edges.map(edge => {
    let label = '';
    if (edge.label) {
      const lines = edge.labelLines ?? [edge.label], box = edge.labelBox;
      const top = box ? box.y + LABEL_FONT + 5 : edge.labelAt[1] - 4;
      const background = box ? `<rect class="nb-flow-label-bg" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="3"/>` : '';
      label = background + `<text class="nb-flow-label" x="${edge.labelAt[0]}" y="${top}" text-anchor="middle">${lines.map((line, i) => `<tspan x="${edge.labelAt[0]}" dy="${i ? LABEL_LINE : 0}">${escape(line)}</tspan>`).join('')}</text>`;
    }
    return `<path class="nb-flow-edge${edge.dashed ? ' is-dashed' : ''}" d="${edge.d}" marker-end="url(#${marker})"/>${label}`;
  }).join('');
  const nodes = layout.nodes.map(node => {
    const lines = node.blank ? [fills[node.id] || '？'] : node.lines, top = node.y + node.h / 2 - (lines.length - 1) * LINE / 2 + 5;
    return `<g class="nb-flow-node" data-shape="${node.shape}"${node.blank ? ' data-blank="true"' : ''}>${flowNodeShape(node)}${lines.map((line, i) => `<text x="${round(node.x + node.w / 2)}" y="${round(top + i * LINE)}" text-anchor="middle">${escape(line)}</text>`).join('')}</g>`;
  }).join('');
  return `<svg class="nb-flow" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="关系图"><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges}${nodes}</svg>`;
}

export function answerFlow(spec, value, special) {
  const exit = special(value);
  if (exit) return exit;
  const blanks = flowBlanks(spec), fills = value?.fills;
  if (!blanks.length) throw new Error('board_component_missing');
  if (!value || Object.keys(value).some(key => key !== 'fills') || !fills || typeof fills !== 'object' || Array.isArray(fills) || Object.keys(fills).some(key => !blanks.includes(key))) throw new Error('board_answer_invalid');
  const normalized = Object.fromEntries(blanks.map(id => { const text = fills[id] ?? ''; if (typeof text !== 'string' || text.length > 200) throw new Error('board_answer_invalid'); return [id, text.trim()]; }));
  if (!Object.values(normalized).some(Boolean)) throw new Error('board_answer_empty');
  return { fills: normalized };
}

export function flowAnswerText(spec, answer) {
  if (!answer.fills) return undefined;
  const text = id => spec.nodes.find(node => node.id === id)?.text;
  return flowBlanks(spec).map(id => {
    const before = spec.edges.filter(edge => edge.to === id).map(edge => text(edge.from)).filter(value => value && value !== '?');
    const after = spec.edges.filter(edge => edge.from === id).map(edge => text(edge.to)).filter(value => value && value !== '?');
    const where = before.length ? `接在“${before.join('”“')}”之后` : after.length ? `在“${after.join('”“')}”之前` : '空白处';
    return `（${where}）我填：${answer.fills[id] || '（没填）'}`;
  }).join('；');
}

export const FLOW_SYNTAX = '```flow\ndirection right\nA[1023 交子官营] --> B[发行过量]\nB -- 准备金不足 --> C[币值下跌]\nC -.-> D((为什么不能停发？))\nB --> E[?]\n```\n每行一条或一串连线：A[文字] 是事件或概念，B((文字)) 是待讨论的问题，C{文字} 是判断分支，D[?] 是留给学生补的空；--> 是确定的关系，-.-> 是推测或待验证的关系，-- 说明 --> 在连线上写说明。节点第一次出现时写文字，后面只写它的名字。direction right 从左到右（时间线用它），默认从上到下。';

/** The diagram's look, shared by the board page and the exported notes. */
export const FLOW_CSS = '.nb-flow{display:block;width:100%;height:auto;overflow:visible}.nb-flow-edge{fill:none;stroke:#8ea6ba;stroke-width:1.6}.nb-flow-edge.is-dashed{stroke-dasharray:5 4}.nb-flow marker path{fill:#8ea6ba}.nb-flow-node rect,.nb-flow-node polygon{fill:#fff;stroke:#9cb3c6;stroke-width:1.3}.nb-flow-node[data-shape=question] rect{fill:#fdf6ec;stroke:#d7b17b}.nb-flow-node[data-shape=decision] polygon{fill:#f3f7fa}.nb-flow-node[data-blank] rect{fill:#f7fafc;stroke-dasharray:4 3}.nb-flow text{font:15px "Kaiti SC",STKaiti,"KaiTi",serif;fill:#2d3742}.nb-flow .nb-flow-label-bg{fill:#fff;stroke:none}.nb-flow .nb-flow-label{font:12px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;fill:#687d90;paint-order:stroke;stroke:#fff;stroke-width:4px}';
