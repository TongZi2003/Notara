/**
 * A small, safe math expression language for board figures: numbers, + - * / ^,
 * unary minus, parentheses, implicit multiplication (`2x`, `2cos(t)`, `(x+1)(x-1)`),
 * the common functions and constants, and only the variable names a caller
 * allows. It compiles to a closure over a scope object; nothing is ever passed
 * to eval or Function, and no property of any object is looked up.
 */
export const MATH_FUNCTIONS = Object.freeze({
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
});
export const MATH_CONSTANTS = Object.freeze({ pi: Math.PI, π: Math.PI, e: Math.E });

/**
 * A name is a Latin letter followed by letters, digits and `_`, or one common
 * Greek letter with an optional digit/`_` suffix (σ, θ1, α_0), then an
 * optional prime. A Greek letter never runs into the letters next to it, so
 * `2πx` and `σx` read as products. Letters that look like Latin ones
 * (ο, ι, υ and capitals such as Α, Β) are left out so a name cannot hide
 * behind a lookalike.
 */
export const GREEK_LETTERS = 'αβγδεζηθκλμνξπρστφχψωΓΔΘΛΞΠΣΦΨΩ';
export const NAME_SOURCE = `(?:[A-Za-z][A-Za-z0-9_]*|[${GREEK_LETTERS}][0-9_]*)'?`;
const NAME_START = new RegExp(`^${NAME_SOURCE}`);

export class MathExpressionError extends Error {
  constructor(message) { super(message); this.name = 'MathExpressionError'; }
}
const fail = message => { throw new MathExpressionError(message); };

function tokenize(source) {
  const tokens = [], text = String(source);
  if (text.length > 300) fail('公式太长了（最多 300 个字符）。');
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index), char = text[index];
    if (/\s/.test(char)) { index++; continue; }
    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) { tokens.push({ type: 'number', value: Number(number[0]) }); index += number[0].length; continue; }
    const name = rest.match(NAME_START);
    if (name) { tokens.push({ type: 'name', value: name[0] }); index += name[0].length; continue; }
    if ('+-*/^(),'.includes(char)) { tokens.push({ type: char }); index++; continue; }
    if (char === '·' || char === '×') { tokens.push({ type: '*' }); index++; continue; }
    fail(`公式里有不认识的符号“${char}”。`);
  }
  return tokens;
}

/**
 * @param source the expression text
 * @param variables names the expression may read (e.g. ['x'] or ['x','y','a'])
 * @returns `{ evaluate(scope) → number, names: Set<string> }`
 */
export function compileExpression(source, variables = []) {
  const tokens = tokenize(source), allowed = new Set(variables), used = new Set();
  let position = 0;
  const peek = () => tokens[position], next = () => tokens[position++];
  const expect = type => { if (peek()?.type !== type) fail(type === ')' ? '括号没有配对。' : `这里缺少“${type}”。`); next(); };
  const startsFactor = token => token && (token.type === 'number' || token.type === 'name' || token.type === '(');
  function expression() {
    let left = term();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const op = next().type, right = term(), a = left;
      left = op === '+' ? scope => a(scope) + right(scope) : scope => a(scope) - right(scope);
    }
    return left;
  }
  function term() {
    let left = unary();
    for (;;) {
      const token = peek();
      if (token?.type === '*' || token?.type === '/') {
        next();
        const right = unary(), a = left;
        left = token.type === '*' ? scope => a(scope) * right(scope) : scope => a(scope) / right(scope);
      } else if (startsFactor(token)) {
        // Implicit multiplication: 2x, 2cos(t), (x+1)(x-1), x y.
        const right = power(), a = left;
        left = scope => a(scope) * right(scope);
      } else return left;
    }
  }
  function unary() {
    if (peek()?.type === '-') { next(); const value = unary(); return scope => -value(scope); }
    if (peek()?.type === '+') { next(); return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek()?.type === '^') { next(); const exponent = unary(); return scope => base(scope) ** exponent(scope); }
    return base;
  }
  function primary() {
    const token = next();
    if (!token) fail('公式没有写完。');
    if (token.type === 'number') { const value = token.value; return () => value; }
    if (token.type === '(') { const inner = expression(); expect(')'); return inner; }
    if (token.type === 'name') {
      const name = token.value;
      if (Object.hasOwn(MATH_FUNCTIONS, name)) {
        const fn = MATH_FUNCTIONS[name];
        if (peek()?.type !== '(') {
          // sin x, cos 2t: a function applied to the next factor.
          if (!startsFactor(peek())) fail(`函数 ${name} 后面要写括号，例如 ${name}(x)。`);
          const argument = power();
          return scope => fn(argument(scope));
        }
        next();
        const argument = expression(); expect(')');
        return scope => fn(argument(scope));
      }
      if (Object.hasOwn(MATH_CONSTANTS, name)) { const value = MATH_CONSTANTS[name]; return () => value; }
      if (!allowed.has(name)) fail(`公式里的“${name}”不是这里能用的变量或参数${variables.length ? `（可以用：${[...allowed].join('、')}）` : ''}。`);
      used.add(name);
      return scope => { const value = scope[name]; return typeof value === 'number' ? value : NaN; };
    }
    fail(`公式在“${token.type}”处写错了。`);
  }
  if (!tokens.length) fail('公式是空的。');
  const compiled = expression();
  if (position < tokens.length) fail('公式后面多了内容，或者少了运算符。');
  return { evaluate: scope => compiled(scope ?? {}), names: used };
}

/** A constant expression (bounds, coordinates without variables) as a finite number. */
export function constantValue(source, variables = []) {
  const value = compileExpression(source, variables).evaluate({});
  if (!Number.isFinite(value)) fail(`“${source}”算不出一个确定的数。`);
  return value;
}
