import { compileExpression, constantValue, MathExpressionError, NAME_SOURCE } from './math-expression.js';

/**
 * `figure`: a function plot or a geometric construction, one declaration per
 * line. With `axes` it is a coordinate plane; without, a pure construction.
 * Every formula goes through `math-expression.js` (never eval); every name a
 * line refers to must already be declared, with the right kind. `drag` points
 * and `param` sliders are for exploring; only an `ask` line makes the figure a
 * question. The parser is shared by the Host (write check) and the page.
 */
export class FigureError extends Error {
  constructor(message, line) { super(message); this.name = 'FigureError'; this.line = line; }
}
const NAME = NAME_SOURCE;
const RESERVED = new Set(['x', 'y', 't', 'pi', 'π', 'e', 'axes', 'view', 'param', 'function', 'curve', 'parametric', 'point', 'segment', 'line', 'circle', 'midpoint', 'intersection', 'polygon', 'angle', 'arrow', 'text', 'ask', 'drag', 'center', 'through', 'radius', 'in', 'at', 'step']);
const POINTS = new Set(['point', 'midpoint', 'intersection']);
const PATHS = new Set(['function', 'curve', 'parametric', 'line', 'segment', 'circle']);
const LIMIT = { objects: 40, params: 6, label: 40, text: 80 };
/** The smallest round step (1, 2 or 5 times a power of ten) at least `raw`. */
const niceStep = raw => { const power = 10 ** Math.floor(Math.log10(raw)); return Number(([1, 2, 5, 10].map(n => n * power).find(n => n >= raw - 1e-12)).toPrecision(3)); };
const quoted = raw => { const match = raw.match(/^"([^"]*)"$/); return match ? match[1] : undefined; };
const plainLabel = (value, max, error) => { if (value.length > max || /[<>]/.test(value)) error(`文字最多 ${max} 字，不能含 < 或 >。`); return value; };

export function parseFigure(source) {
  const rows = String(source ?? '').replace(/\r/g, '').split('\n').map((raw, index) => ({ value: raw.trim(), line: index + 1 })).filter(row => row.value);
  const spec = { axes: false, bounds: null, params: [], objects: [], ask: null };
  const names = new Map();
  let row;
  const error = message => { throw new FigureError(message, row?.line); };
  const paramNames = () => spec.params.map(param => param.name);
  const expr = (text, variables) => {
    try { compileExpression(text, [...variables, ...paramNames()]); return text.trim(); }
    catch (cause) { if (cause instanceof MathExpressionError) error(cause.message); throw cause; }
  };
  const constant = text => {
    try { return constantValue(text); }
    catch (cause) { if (cause instanceof MathExpressionError) error(cause.message); throw cause; }
  };
  const range = text => {
    const parts = text.split('..');
    if (parts.length !== 2) error(`范围要写成“起..止”，例如 -4..4。`);
    const [from, to] = parts.map(part => constant(part));
    if (!(to > from)) error('范围的终点要大于起点。');
    return [from, to];
  };
  const declare = (name, kind) => {
    if (!new RegExp(`^${NAME}$`).test(name)) error(`名字“${name}”要以英文字母开头、只含字母、数字和下划线，或者用一个希腊字母（如 σ、θ、α），后面可以跟数字。`);
    if (RESERVED.has(name)) error(`“${name}”是写法里的关键字，换一个名字。`);
    if (names.has(name)) error(`名字“${name}”已经用过了。`);
    if (spec.objects.length + spec.params.length >= LIMIT.objects) error(`一张图最多 ${LIMIT.objects} 个对象。`);
    names.set(name, kind);
    return name;
  };
  const refer = (name, allowed, what) => {
    const kind = names.get(name);
    if (!kind) error(`“${name}”还没有声明；先写出它，再引用。`);
    if (!allowed.has(kind)) error(`“${name}”是${kind}，这里需要${what}。`);
    return name;
  };
  const pair = text => {
    const match = text.match(/^\((.+),(.+)\)$/);
    if (!match) error('坐标要写成 (x, y)。');
    return [expr(match[1], []), expr(match[2], [])];
  };
  let anonymous = 0, askRow;
  const auto = prefix => { let name; do name = `${prefix}${++anonymous}`; while (names.has(name)); return name; };

  for (row of rows) {
    const text = row.value, [keyword] = text.split(/\s+/, 1);
    let match;
    switch (keyword) {
      case 'axes': case 'view': {
        if (spec.bounds) error('axes 或 view 只能写一行。');
        match = text.match(/^(axes|view)\s+x\s+(\S+)\s+y\s+(\S+)$/);
        if (!match) error(`写成 ${keyword} x -4..4 y -3..3。`);
        const [xmin, xmax] = range(match[2]), [ymin, ymax] = range(match[3]);
        spec.axes = keyword === 'axes'; spec.bounds = { xmin, xmax, ymin, ymax };
        break;
      }
      case 'param': {
        match = text.match(new RegExp(`^param\\s+(${NAME})\\s*=\\s*(\\S+)\\s+in\\s+(\\S+)(?:\\s+step\\s+(\\S+))?$`));
        if (!match) error('写成 param a = 1 in -3..3（可加 step 0.1）。');
        if (spec.params.length >= LIMIT.params) error(`一张图最多 ${LIMIT.params} 个参数。`);
        const [min, max] = range(match[3]), value = constant(match[2]), step = match[4] ? constant(match[4]) : niceStep((max - min) / 200);
        if (value < min || value > max) error('参数的初始值要在范围内。');
        if (!(step > 0)) error('step 要大于 0。');
        spec.params.push({ name: declare(match[1], 'param'), value, min, max, step });
        break;
      }
      case 'function': {
        match = text.match(new RegExp(`^function\\s+(${NAME})\\(x\\)\\s*=\\s*(.+)$`));
        if (!match) error('写成 function f(x) = x^2 - 1。');
        spec.objects.push({ kind: 'function', name: declare(match[1], 'function'), expr: expr(match[2], ['x']) });
        break;
      }
      case 'curve': {
        match = text.match(new RegExp(`^curve\\s+(?:(${NAME})\\s*:\\s*)?(.+?)=(.+)$`));
        if (!match || match[2].includes('=') || match[3].includes('=')) error('写成 curve E: x^2/4 + y^2 = 1（左右两边各一个式子）。');
        spec.objects.push({ kind: 'curve', name: declare(match[1] ?? auto('curve'), 'curve'), lhs: expr(match[2], ['x', 'y']), rhs: expr(match[3], ['x', 'y']) });
        break;
      }
      case 'parametric': {
        match = text.match(new RegExp(`^parametric\\s+(?:(${NAME})\\s*:\\s*)?x\\s*=\\s*(.+?),\\s*y\\s*=\\s*(.+?),\\s*t\\s+in\\s+(\\S+)$`));
        if (!match) error('写成 parametric c: x = 2cos(t), y = sin(t), t in 0..2pi。');
        spec.objects.push({ kind: 'parametric', name: declare(match[1] ?? auto('curve'), 'parametric'), x: expr(match[2], ['t']), y: expr(match[3], ['t']), t: range(match[4]) });
        break;
      }
      case 'point': {
        match = text.match(new RegExp(`^point\\s+(${NAME})\\s*=\\s*(\\(.+\\))(\\s+drag)?$`));
        if (!match) error('写成 point A = (2, 0)，可以拖动的点在后面加 drag。');
        const [x, y] = pair(match[2]), drag = Boolean(match[3]);
        if (drag) { try { constantValue(x); constantValue(y); } catch { error('可以拖动的点，坐标要是确定的数，不能含参数。'); } }
        spec.objects.push({ kind: 'point', name: declare(match[1], 'point'), x, y, drag });
        break;
      }
      case 'segment': case 'line': {
        match = text.match(new RegExp(`^(segment|line)\\s+(?:(${NAME})\\s*=\\s*)?(${NAME})\\s+(${NAME})$`));
        if (!match) error(`写成 ${keyword} A B（也可以起名：${keyword} l = A B）。`);
        const points = [refer(match[3], POINTS, '一个点'), refer(match[4], POINTS, '一个点')];
        spec.objects.push({ kind: keyword, name: declare(match[2] ?? (keyword === 'segment' ? `${points[0]}${points[1]}` : auto('line')), keyword), points });
        break;
      }
      case 'circle': {
        match = text.match(new RegExp(`^circle\\s+(${NAME})\\s*=\\s*center\\s+(${NAME})\\s+(through|radius)\\s+(.+)$`));
        if (!match) error('写成 circle c = center A through B，或 circle c = center A radius 2。');
        const center = refer(match[2], POINTS, '圆心（一个点）');
        const circle = { kind: 'circle', name: match[1], center, ...(match[3] === 'through' ? { through: refer(match[4].trim(), POINTS, '圆上的一个点') } : { radius: expr(match[4], []) }) };
        circle.name = declare(match[1], 'circle');
        spec.objects.push(circle);
        break;
      }
      case 'midpoint': {
        match = text.match(new RegExp(`^midpoint\\s+(${NAME})\\s*=\\s*(${NAME})\\s+(${NAME})$`));
        if (!match) error('写成 midpoint M = A B。');
        spec.objects.push({ kind: 'midpoint', points: [refer(match[2], POINTS, '一个点'), refer(match[3], POINTS, '一个点')], name: declare(match[1], 'midpoint') });
        break;
      }
      case 'intersection': {
        match = text.match(new RegExp(`^intersection\\s+(${NAME})\\s*=\\s*(${NAME})\\s+(${NAME})(?:\\s+([12]))?$`));
        if (!match) error('写成 intersection P = f c，两条线有两个交点时在后面写 1 或 2。');
        spec.objects.push({ kind: 'intersection', of: [refer(match[2], PATHS, '一条线、圆或曲线'), refer(match[3], PATHS, '一条线、圆或曲线')], index: Number(match[4] ?? 1), name: declare(match[1], 'intersection') });
        break;
      }
      case 'polygon': case 'angle': {
        const parts = text.split(/\s+/).slice(1);
        const need = keyword === 'angle' ? 3 : undefined;
        if ((need && parts.length !== need) || (!need && (parts.length < 3 || parts.length > 12))) error(keyword === 'angle' ? '写成 angle A B C（角的顶点是 B）。' : '写成 polygon A B C（3 到 12 个点）。');
        const points = parts.map(name => refer(name, POINTS, '一个点'));
        spec.objects.push({ kind: keyword, name: declare(auto(keyword), keyword), points });
        break;
      }
      case 'arrow': {
        match = text.match(new RegExp(`^arrow\\s+(${NAME})\\s*=\\s*(${NAME})\\s*->\\s*(\\(.+?\\))(?:\\s+("[^"]*"))?$`));
        if (!match) error('写成 arrow F = M -> (0, -1.5) "mg"：从点 M 出发，按 (dx, dy) 画箭头。');
        const from = refer(match[2], POINTS, '起点（一个点）'), [dx, dy] = pair(match[3]);
        spec.objects.push({ kind: 'arrow', name: declare(match[1], 'arrow'), from, dx, dy, label: plainLabel(match[4] ? quoted(match[4]) : match[1], LIMIT.label, error) });
        break;
      }
      case 'text': {
        match = text.match(/^text\s+("[^"]*")\s+at\s+(\(.+\))$/);
        if (!match) error('写成 text "说明" at (1, 2)。');
        const [x, y] = pair(match[2]);
        spec.objects.push({ kind: 'text', name: declare(auto('text'), 'text'), content: plainLabel(quoted(match[1]), LIMIT.text, error), x, y });
        break;
      }
      case 'ask': {
        if (spec.ask) error('一张图只能有一个 ask。');
        match = text.match(new RegExp(`^ask\\s+(point|drag|param)(?:\\s+(${NAME}))?\\s+("[^"]*")$`));
        if (!match) error('写成 ask point "问题"、ask drag A "问题" 或 ask param a "问题"。');
        const [, kind, target, prompt] = match;
        if (kind === 'point' && target) error('ask point 不带名字：学生在图上点一个位置。');
        if (kind === 'drag') { refer(target ?? '', new Set(['point']), '一个可以拖动的点'); if (!spec.objects.find(item => item.name === target)?.drag) error(`“${target}”要写成可以拖动的点（point ${target} = (…) drag）。`); }
        if (kind === 'param') refer(target ?? '', new Set(['param']), '一个参数');
        const question = plainLabel(quoted(prompt), 120, error);
        if (!question) error('ask 要写出问题。');
        spec.ask = { kind, ...(target ? { target } : {}), prompt: question }; askRow = row;
        break;
      }
      default:
        error(`不认识的一行：“${text}”。每行以 axes、param、function、curve、parametric、point、segment、line、circle、midpoint、intersection、polygon、angle、arrow、text 或 ask 开头。`);
    }
  }
  row = undefined;
  if (!spec.objects.length) error('图里还没有要画的对象。');
  if (spec.ask?.kind === 'point' && !spec.bounds) { row = askRow; error('ask point 需要先写 axes 或 view，学生才知道点在哪个范围里。'); }
  return spec;
}

/** Everything the student sees and is asked counts as the question. */
export const figureIdentity = spec => JSON.stringify(['figure', spec.axes, spec.bounds, spec.params, spec.objects, spec.ask]);

const round = value => Number(value.toFixed(2));
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function figureBounds(spec) {
  if (spec.bounds) return spec.bounds;
  const xs = [], ys = [];
  for (const item of spec.objects) {
    if (item.kind !== 'point' && item.kind !== 'text') continue;
    try { xs.push(constantValue(item.x)); ys.push(constantValue(item.y)); } catch { /* a moving point does not set the frame */ }
  }
  if (!xs.length) return { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
  const pad = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * .2, (Math.max(...ys) - Math.min(...ys)) * .2);
  return { xmin: Math.min(...xs) - pad, xmax: Math.max(...xs) + pad, ymin: Math.min(...ys) - pad, ymax: Math.max(...ys) + pad };
}

/**
 * The frame the page draws. Axes cross at the origin and put their numbers on
 * the outer side (left of the y axis, below the x axis), so an axis lying on the
 * left or bottom edge would lose its numbers to the clip: the view adds a margin
 * on that side. Answers still check the declared frame (`figureBounds`).
 */
export function figureView(spec) {
  const box = figureBounds(spec);
  if (!spec.axes) return box;
  const dx = (box.xmax - box.xmin) * .1, dy = (box.ymax - box.ymin) * .1;
  return { xmin: box.xmin <= 0 && -box.xmin < dx ? box.xmin - dx : box.xmin, xmax: box.xmax, ymin: box.ymin <= 0 && -box.ymin < dy ? box.ymin - dy : box.ymin, ymax: box.ymax };
}

/** A figure answer may carry one sentence of what the student saw (as long as other free answers). */
const NOTE_LIMIT = 2000;
function answerNote(value) {
  if (value.note === undefined) return {};
  if (typeof value.note !== 'string' || value.note.length > NOTE_LIMIT) throw new Error('board_answer_invalid');
  const note = value.note.trim();
  return note ? { note } : {};
}
export function answerFigure(spec, value, special) {
  const exit = special(value);
  if (exit) return exit;
  if (!spec.ask) throw new Error('board_component_missing');
  if (spec.ask.kind === 'param') {
    const param = spec.params.find(item => item.name === spec.ask.target);
    if (!value || Object.keys(value).some(key => !['value', 'note'].includes(key)) || !finite(value.value) || value.value < param.min - 1e-9 || value.value > param.max + 1e-9) throw new Error('board_answer_invalid');
    return { value: round(value.value), ...answerNote(value) };
  }
  const bounds = figureBounds(spec), point = value?.point;
  if (!value || Object.keys(value).some(key => !['point', 'note'].includes(key)) || !point || Object.keys(point).some(key => !['x', 'y'].includes(key)) || !finite(point.x) || !finite(point.y)) throw new Error('board_answer_invalid');
  const marginX = (bounds.xmax - bounds.xmin) * .1, marginY = (bounds.ymax - bounds.ymin) * .1;
  if (point.x < bounds.xmin - marginX || point.x > bounds.xmax + marginX || point.y < bounds.ymin - marginY || point.y > bounds.ymax + marginY) throw new Error('board_answer_invalid');
  return { point: { x: round(point.x), y: round(point.y) }, ...answerNote(value) };
}

export function figureAnswerText(spec, answer) {
  const saw = answer.note ? `。我看到：${answer.note}` : '';
  if (answer.point) return (spec.ask?.kind === 'drag' ? `我把 ${spec.ask.target} 拖到了 (${answer.point.x}, ${answer.point.y})` : `我在图上点了 (${answer.point.x}, ${answer.point.y})`) + saw;
  if (finite(answer.value)) return `我把 ${spec.ask?.target} 调到了 ${answer.value}${saw}`;
  return undefined;
}

export const FIGURE_SYNTAX = '```figure\naxes x -4..4 y -3..3\nparam a = 1 in -3..3\nfunction f(x) = a*(x-1)^2 - 2\ncurve E: x^2/4 + y^2 = 1\npoint A = (2, 0) drag\npoint B = (0, 1)\nsegment A B\nmidpoint M = A B\narrow F = M -> (0, -1.5) "mg"\nask point "在图上点出弦 AB 的中点"\n```\n每行一个对象：axes/view（坐标范围，axes 画坐标轴）、param（滑块）、function f(x) = …、curve 名: 左 = 右、parametric 名: x = …, y = …, t in a..b、point 名 = (x, y) [drag]、segment/line A B、circle c = center A through B 或 radius r、midpoint M = A B、intersection P = f c [1|2]、polygon A B C、angle A B C、arrow F = A -> (dx, dy) "标注"、text "说明" at (x, y)。公式用 x^2、2cos(t)、sqrt(x) 这样的写法。要学生在图上作答再加一行 ask point "问题"、ask drag A "问题" 或 ask param a "问题"。';
