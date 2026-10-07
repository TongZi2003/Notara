import assert from 'node:assert/strict';
import test from 'node:test';
import { compileExpression, constantValue } from './math-expression.js';
import { answerFigure, figureAnswerText, figureBounds, figureView, parseFigure } from './board-figure.js';
import { createSpatialProjector, spatialConeRings, spatialPointMap, spatialRing, spatialTicks } from './board-spatial.js';
import { answerFlow, flowAnswerText, layoutFlow, parseFlow, renderFlowSvg } from './board-flow.js';

const special = () => undefined;

test('math expressions: precedence, implicit multiplication, functions, and only allowed names', () => {
  const at = (source, scope = {}, names = Object.keys(scope)) => compileExpression(source, names).evaluate(scope);
  assert.equal(at('1 + 2*3^2'), 19);
  assert.equal(at('-x^2', { x: 3 }), -9);
  assert.equal(at('2^3^2'), 512);
  assert.equal(at('2x + 1', { x: 4 }), 9);
  assert.equal(at('(x+1)(x-1)', { x: 3 }), 8);
  assert.ok(Math.abs(at('2cos(t)', { t: 0 }) - 2) < 1e-12);
  assert.ok(Math.abs(at('sin pi') - 0) < 1e-12);
  assert.equal(at('sqrt(abs(-16))'), 4);
  assert.equal(at('a*(x-h)^2', { a: 2, x: 3, h: 1 }), 8);
  assert.equal(constantValue('2pi'), 2 * Math.PI);
  for (const bad of ['constructor', 'x.y', 'alert(1)', '__proto__', '1 +', '(1', 'x ? 1 : 2', '"a"', '[1]']) assert.throws(() => compileExpression(bad, ['x']), /MathExpressionError|公式|不认识|不是这里|括号/, bad);
  assert.throws(() => compileExpression('y + 1', ['x']), /“y”不是这里能用的变量/);
});

test('common Greek letters are names on their own; π is pi; lookalikes are refused', () => {
  const at = (source, scope = {}) => compileExpression(source, Object.keys(scope)).evaluate(scope);
  assert.equal(at('σ^2', { σ: 3 }), 9);
  // A Greek letter does not run into its neighbours: σx and 2πx are products.
  assert.equal(at('σx', { σ: 2, x: 5 }), 10);
  assert.equal(at('2πx', { x: 1 }), 2 * Math.PI);
  assert.equal(at('θ1 + θ_2', { θ1: 1, θ_2: 2 }), 3);
  assert.equal(at("Δ'", { "Δ'": 4 }), 4);
  assert.equal(constantValue('π/2'), Math.PI / 2);
  assert.throws(() => compileExpression('σ + 1', ['x']), /“σ”不是这里能用的变量/);
  // Omicron and a Greek capital alpha look like o and A: not letters here.
  assert.throws(() => compileExpression('ο', ['x']), /不认识的符号“ο”/);
  assert.throws(() => compileExpression('Α', ['x']), /不认识的符号“Α”/);

  const spec = parseFigure('axes x -6..6 y -0.05..0.9\nparam σ = 1 in 0.5..4\nparam μ = 0 in -2..2\nfunction f(x) = exp(-(x-μ)^2/(2σ^2))/(σ sqrt(2π))\npoint Ω = (μ, 0)\nask param σ "σ 变大时曲线怎么变？"');
  assert.deepEqual(spec.params.map(item => item.name), ['σ', 'μ']);
  assert.deepEqual(spec.ask, { kind: 'param', target: 'σ', prompt: 'σ 变大时曲线怎么变？' });
  const f = compileExpression(spec.objects[0].expr, ['x', 'σ', 'μ']);
  assert.ok(Math.abs(f.evaluate({ x: 0, σ: 1, μ: 0 }) - 1 / Math.sqrt(2 * Math.PI)) < 1e-12);
  assert.equal(figureAnswerText(spec, { value: 2.5, note: '变矮变胖' }), '我把 σ 调到了 2.5。我看到：变矮变胖');
  assert.throws(() => parseFigure('param π = 1 in 0..2'), /关键字/);
  // Two Greek letters are two names, not one: the line does not parse.
  assert.throws(() => parseFigure('param σσ = 1 in 0..2'), /写成 param/);
});

test('figure declarations parse with references checked in order', () => {
  const spec = parseFigure('axes x -4..4 y -3..3\nparam a = 1 in -3..3\nfunction f(x) = a*(x-1)^2 - 2\ncurve E: x^2/4 + y^2 = 1\nparametric c: x = 2cos(t), y = sin(t), t in 0..2pi\npoint A = (2, 0) drag\npoint B = (0, 1)\nsegment A B\nline l = A B\ncircle k = center A through B\ncircle r = center B radius a\nmidpoint M = A B\nintersection P = l E 2\npolygon A B M\nangle A M B\narrow F = M -> (0, -1.5) "mg"\ntext "中点" at (1, 0.8)\nask drag A "把 A 拖到让 AB 的中点在直线 y=x 上"');
  assert.equal(spec.axes, true);
  assert.deepEqual(spec.bounds, { xmin: -4, xmax: 4, ymin: -3, ymax: 3 });
  assert.deepEqual(spec.params, [{ name: 'a', value: 1, min: -3, max: 3, step: 0.05 }]);
  assert.deepEqual(spec.objects.map(item => `${item.kind}:${item.name}`).slice(0, 8), ['function:f', 'curve:E', 'parametric:c', 'point:A', 'point:B', 'segment:AB', 'line:l', 'circle:k']);
  assert.deepEqual(spec.ask, { kind: 'drag', target: 'A', prompt: '把 A 拖到让 AB 的中点在直线 y=x 上' });
  assert.deepEqual(parseFigure('point A = (0, 0)\npoint B = (4, 2)\nsegment A B').axes, false);
  assert.deepEqual(figureBounds(parseFigure('point A = (0, 0)\npoint B = (4, 2)\nsegment A B')), { xmin: -1, xmax: 5, ymin: -1, ymax: 3 });
  // Axes on the left and bottom edges keep their numbers: the drawn frame gets a margin there only.
  assert.deepEqual(figureView(parseFigure('axes x 0..1 y 0..1\nfunction f(x) = x')), { xmin: -0.1, xmax: 1, ymin: -0.1, ymax: 1 });
  assert.deepEqual(figureView(parseFigure('axes x -4..4 y -3..3\nfunction f(x) = x')), { xmin: -4, xmax: 4, ymin: -3, ymax: 3 });
  assert.deepEqual(figureView(parseFigure('view x 0..1 y 0..1\npoint A = (0.5, 0.5)')), { xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
  assert.deepEqual(figureBounds(parseFigure('axes x 0..1 y 0..1\nfunction f(x) = x')), { xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
  const cases = [
    ['point A = (0,0)\nsegment A B', 2, /“B”还没有声明/],
    ['function f(x) = x^2\nsegment f f', 2, /“f”是function，这里需要一个点/],
    ['param a = 5 in -3..3\npoint A = (a, 0)', 1, /初始值要在范围内/],
    ['param a = 1 in -3..3\npoint A = (a, 0) drag', 2, /可以拖动的点，坐标要是确定的数/],
    ['function f(x) = y^2', 1, /“y”不是这里能用的变量/],
    ['circel c = center A through B', 1, /不认识的一行/],
    ['point x = (1, 1)', 1, /关键字/],
    ['point A = (1, 1)\npoint A = (2, 2)', 2, /已经用过了/],
    ['point A = (1, 1)\ntext "<b>x</b>" at (0, 0)', 2, /不能含 < 或 >/],
    ['point A = (1, 1)\nask point "点一下"', 2, /需要先写 axes 或 view/],
    ['axes x 4..-4 y -3..3\npoint A = (1, 1)', 1, /终点要大于起点/],
  ];
  for (const [source, line, pattern] of cases) assert.throws(() => parseFigure(source), error => { assert.equal(error.line, line, source); assert.match(error.message, pattern); return true; });
});

test('spatial figures parse supported solids and reject asks or mixed coordinate dimensions', () => {
  const spec = parseFigure('axes x -4..4 y -3..3 z -2..6\nparam r = 1 in 0.5..2\npoint A = (0, 0, 0)\npoint B = (2, 0, 0)\npoint C = (2, 2, 0)\npoint D = (0, 2, 0)\npoint E = (0, 0, 3)\nmidpoint M = A B\nvector v = A -> (1, 2, 3) "方向"\nplane P = A B C\ncuboid Q = A B C D E B C D\ntetrahedron T = A B C E\nprism R = A B C by (0, 0, 2)\npyramid U = base A B C apex E\nsphere S = center A radius r\ncylinder C1 = center A axis (0, 0, 1) radius 1 height 2\ncone C2 = vertex A axis (0, 0, 1) radius 1 height 2\nfrustum F = center A axis (0, 0, 1) radius 2 top 1 height 3\ntext "空间" at (1, 1, 1)');
  assert.equal(spec.space, true);
  assert.deepEqual(figureBounds(spec), { xmin: -4, xmax: 4, ymin: -3, ymax: 3, zmin: -2, zmax: 6 });
  assert.deepEqual(figureView(spec), figureBounds(spec));
  assert.deepEqual(spec.objects.find(item => item.name === 'A'), { kind: 'point', name: 'A', x: '0', y: '0', z: '0', drag: false });
  assert.throws(() => parseFigure('axes x -4..4 y -3..3 z -2..2\npoint A = (0, 0, 0)\nask point "点一下"'), /空间图暂时只用于展示/);
  assert.throws(() => parseFigure('axes x -4..4 y -3..3 z -2..2\nfunction f(x) = x'), /function 只能用于平面坐标图/);
  assert.throws(() => parseFigure('point A = (1, 2)\naxes x -4..4 y -3..3 z -2..2'), /空间坐标系要写在图形对象之前/);
  assert.throws(() => parseFigure('axes x -4..4 y -3..3 z -2..2\npoint A = (1, 2)'), /空间坐标要写成/);
  assert.throws(() => parseFigure('vector v = A -> (1, 2, 3)'), /vector 只能用于空间直角坐标系/);
});

test('spatial projection stays finite, rings reject a zero axis, and ticks are bounded', () => {
  const project = createSpatialProjector({ xmin: -2, xmax: 2, ymin: -2, ymax: 2, zmin: -2, zmax: 2 }, { yaw: 0, pitch: 0, zoom: 1 });
  assert.deepEqual(project([0, 0, 0]), [380, 260, 0]);
  assert.ok(project([1, 2, 3]).every(Number.isFinite));
  assert.ok(project([NaN, 0, 0]).every(Number.isNaN));
  assert.equal(spatialRing([0, 0, 0], [0, 0, 0], 1).length, 0);
  const ring = spatialRing([1, 2, 3], [0, 0, 2], 2, 1, 12);
  assert.equal(ring.length, 12);
  assert.ok(Math.abs(ring[0][2] - 4) < 1e-12);
  const cone = spatialConeRings([1, 2, 3], [0, 0, 1], 2, 2, 12);
  assert.ok(cone.apex.every(point => point.every((coordinate, index) => coordinate === [1, 2, 3][index])));
  assert.ok(cone.base.every(point => Math.abs(point[2] - 5) < 1e-12 && Math.abs(Math.hypot(point[0] - 1, point[1] - 2) - 2) < 1e-12));
  assert.deepEqual(spatialTicks(0, 1000).length <= 16, true);
  assert.deepEqual(spatialTicks(4, 2), []);
  const extremeTicks = spatialTicks(-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER);
  assert.ok(extremeTicks.length <= 256);
  assert.ok(extremeTicks.every(Number.isFinite));
  assert.ok(spatialTicks(-1_000_000_000, 1_000_000_000, Number.MAX_SAFE_INTEGER).length <= 256);
  const spec = parseFigure('axes x -2..2 y -2..2 z -2..2\nparam a = 1 in 0..2\npoint A = (a, 1, 2)\nmidpoint M = A A');
  const scene = spatialPointMap(spec, { a: 2 }, compileExpression);
  assert.deepEqual(scene.points.get('A'), [2, 1, 2]);
  assert.deepEqual(scene.points.get('M'), [2, 1, 2]);
  const invalidSolid = parseFigure('axes x -2..2 y -2..2 z -2..2\nparam a = 1 in 0..2\npoint A = (0, 0, 0)\nsphere S = center A radius 1/(a-1)');
  assert.throws(() => spatialPointMap(invalidSolid, { a: 1 }, compileExpression), /spatial_expression_invalid/);
});

test('figure answers stay inside the frame and read naturally', () => {
  const point = parseFigure('axes x -4..4 y -3..3\ncurve E: x^2/4 + y^2 = 1\nask point "点出弦的中点"');
  assert.deepEqual(answerFigure(point, { point: { x: 1.0234, y: .4987 } }, special), { point: { x: 1.02, y: 0.5 } });
  assert.throws(() => answerFigure(point, { point: { x: 40, y: 0 } }, special), /board_answer_invalid/);
  assert.equal(figureAnswerText(point, { point: { x: 1.02, y: .5 } }), '我在图上点了 (1.02, 0.5)');
  const param = parseFigure('axes x -4..4 y -3..3\nparam a = 1 in 0.5..3\nfunction f(x) = a x^2\nask param a "调到开口最窄"');
  assert.deepEqual(answerFigure(param, { value: 2.999 }, special), { value: 3 });
  assert.throws(() => answerFigure(param, { value: 4 }, special), /board_answer_invalid/);
  assert.equal(figureAnswerText(param, { value: 3 }), '我把 a 调到了 3');
  // One sentence of what the student saw goes with any figure answer; blank is dropped, too long is refused.
  assert.deepEqual(answerFigure(param, { value: 2, note: '  开口越来越窄 ' }, special), { value: 2, note: '开口越来越窄' });
  assert.deepEqual(answerFigure(point, { point: { x: 1, y: .5 }, note: '   ' }, special), { point: { x: 1, y: 0.5 } });
  assert.throws(() => answerFigure(param, { value: 2, note: '字'.repeat(2001) }, special), /board_answer_invalid/);
  assert.throws(() => answerFigure(param, { value: 2, note: 3 }, special), /board_answer_invalid/);
  assert.equal(figureAnswerText(param, { value: 2, note: '开口越来越窄' }), '我把 a 调到了 2。我看到：开口越来越窄');
  assert.equal(figureAnswerText(point, { point: { x: 1, y: .5 }, note: '正好在中间' }), '我在图上点了 (1, 0.5)。我看到：正好在中间');
});

test('flow parses nodes, shapes, labels, dashes and gaps', () => {
  const spec = parseFlow('direction right\nA[1023 交子官营] --> B[发行过量]\nB -- 准备金不足 --> C[币值下跌]\nC -.-> D((为什么不能停发？))\nB --> E[?]\nC -. 推测 .-> F{是否挤兑}');
  assert.equal(spec.direction, 'right');
  assert.deepEqual(spec.nodes.map(node => [node.id, node.shape, node.blank]), [['A', 'box', false], ['B', 'box', false], ['C', 'box', false], ['D', 'question', false], ['E', 'box', true], ['F', 'decision', false]]);
  assert.deepEqual(spec.edges, [{ from: 'A', to: 'B', dashed: false }, { from: 'B', to: 'C', dashed: false, label: '准备金不足' }, { from: 'C', to: 'D', dashed: true }, { from: 'B', to: 'E', dashed: false }, { from: 'C', to: 'F', dashed: true, label: '推测' }]);
  assert.deepEqual(parseFlow('A[甲] --> B[乙] --> C[丙]').edges.map(edge => edge.from + edge.to), ['AB', 'BC'], 'a chain');
  for (const [source, pattern] of [['A[甲] -->', /连线后面缺少节点/], ['A[甲] ==> B', /应该是连线/], ['A[甲] --> B\nA[乙]', /前后写的内容不一样/], ['[甲]', /应该是节点/]]) assert.throws(() => parseFlow(source), pattern);
});

test('flow layout is deterministic, keeps layers apart and renders escaped SVG', () => {
  const spec = parseFlow('A[起点] --> B[甲]\nA --> C[乙]\nB --> D[终点<script>]\nC --> D\nD -.-> A');
  const one = layoutFlow(spec), two = layoutFlow(spec);
  assert.deepEqual(one, two);
  const box = id => one.nodes.find(node => node.id === id);
  assert.ok(box('B').y > box('A').y + box('A').h, 'layers go downward');
  assert.ok(box('D').y > box('B').y + box('B').h);
  const [b, c] = [box('B'), box('C')];
  assert.ok(b.x + b.w <= c.x || c.x + c.w <= b.x, 'nodes of one layer do not overlap');
  const svg = renderFlowSvg(one, { id: 'test' });
  assert.match(svg, /^<svg class="nb-flow"/);
  assert.doesNotMatch(svg, /<script/);
  assert.match(svg, /终点&lt;script&gt;/);
  assert.equal((svg.match(/<path class="nb-flow-edge/g) ?? []).length, 5);
});

test('flow gaps are answered by id and described by their neighbours', () => {
  const spec = parseFlow('A[发行过量] --> E[?]\nE --> C[挤兑]');
  assert.deepEqual(answerFlow(spec, { fills: { E: ' 币值下跌 ' } }, special), { fills: { E: '币值下跌' } });
  assert.throws(() => answerFlow(spec, { fills: { X: '1' } }, special), /board_answer_invalid/);
  assert.throws(() => answerFlow(spec, { fills: { E: '' } }, special), /board_answer_empty/);
  assert.equal(flowAnswerText(spec, { fills: { E: '币值下跌' } }), '（接在“发行过量”之后）我填：币值下跌');
});

test('figure and flow join the component contract: located errors, answerability and the student message', async () => {
  const { boardAnswerMessage, boardComponents, validateBoardAnswer, validateBoardComponents } = await import('./board-components.js');
  const fence = (type, body) => '```' + type + '\n' + body + '\n```';
  assert.throws(() => validateBoardComponents(fence('figure', 'axes x -4..4 y -3..3\nsegment A B')), error => /^board_component_invalid：第1个组件（figure）第2行：“A”还没有声明/.test(error.message) && /figure 的写法：\n```figure/.test(error.message));
  assert.throws(() => validateBoardComponents(`说明\n\n${fence('flow', 'A[甲] ==> B')}`), /第1个组件（flow）第1行：节点后面应该是连线[\s\S]*flow 的写法/);
  const [explore, asked, diagram, gap] = boardComponents([
    fence('figure', 'axes x -4..4 y -3..3\nparam a = 1 in -3..3\nfunction f(x) = a x^2'),
    fence('figure', 'axes x -4..4 y -3..3\nfunction f(x) = (x-1)^2 - 2\nask point "点出顶点"'),
    fence('flow', 'A[甲] --> B[乙]'),
    fence('flow', 'A[发行过量] --> E[?]'),
  ].join('\n\n'));
  assert.deepEqual([explore.answerable, asked.answerable, diagram.answerable, gap.answerable], [false, true, false, true]);
  assert.throws(() => validateBoardAnswer(explore, { point: { x: 0, y: 0 } }), /board_component_missing/);
  assert.equal(boardAnswerMessage({ sectionTitle: '第2题', blockTitle: '顶点', component: asked, answer: validateBoardAnswer(asked, { point: { x: 1.004, y: -1.996 } }) }), '〔白板｜第2题｜点出顶点〕我在图上点了 (1, -2)');
  assert.equal(boardAnswerMessage({ sectionTitle: '交子', blockTitle: '因果', component: gap, answer: validateBoardAnswer(gap, { fills: { E: '币值下跌' } }) }), '〔白板｜交子｜关系图〕（接在“发行过量”之后）我填：币值下跌');
  assert.equal(boardAnswerMessage({ blockTitle: '顶点', component: asked, answer: validateBoardAnswer(asked, { unsure: true }) }), '〔白板｜点出顶点〕我不确定。');
  assert.throws(() => validateBoardAnswer(asked, { point: { x: 1, y: 1 }, extra: 1 }), /board_answer_invalid/);
});
