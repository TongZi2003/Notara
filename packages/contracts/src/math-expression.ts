// Parse mathematics as data. Neither the Host nor the iframe executes formula
// text as JavaScript. JSXGraph receives ordinary numeric callbacks.
const functions: Record<string, (...values: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, pow: Math.pow,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
};
export const mathReservedNames = new Set(['x', 'y', 't', 'pi', 'e', 'PI', ...Object.keys(functions)]);
type Node = { type: string; value?: number; name?: string; operator?: string; argument?: Node; left?: Node; right?: Node; callee?: Node; arguments?: Node[] };
function parseMath(text: string): Node {
  const tokens: string[] = [], pattern = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|(\*\*|[+\-*/^(),]))/y;
  let offset = 0;
  text = text.replaceAll('π', 'pi').replaceAll('−', '-').trim();
  while (offset < text.length) { pattern.lastIndex = offset; const match = pattern.exec(text); if (!match) throw new Error('invalid_token'); tokens.push(match[1] ?? match[2] ?? match[3]!); offset = pattern.lastIndex; }
  let at = 0, depth = 0;
  const binary = (operator: string, left: Node, right: Node): Node => ({type:'BinaryExpression',operator,left,right});
  const primary = (): Node => {
    if (++depth > 32) throw new Error('nested_expression');
    const token = tokens[at++]; let node: Node;
    if (token === '(') { node = sum(); if (tokens[at++] !== ')') throw new Error('missing_parenthesis'); }
    else if (token && /^[\d.]/.test(token)) node = { type:'Literal', value:Number(token) };
    else if (token && /^[A-Za-z]/.test(token)) {
      node = {type:'Identifier',name:token};
      if (tokens[at] === '(' && Object.hasOwn(functions,token)) { at++; const args: Node[] = []; if (tokens[at] !== ')') { args.push(sum()); while (tokens[at] === ',') { at++; args.push(sum()); } } if (tokens[at++] !== ')') throw new Error('missing_parenthesis'); node = {type:'CallExpression',callee:node,arguments:args}; }
    } else throw new Error('missing_expression');
    depth--; return node;
  };
  const power = (): Node => { const left = primary(); if (tokens[at] === '^' || tokens[at] === '**') { at++; return binary('^',left,unary()); } return left; };
  const unary = (): Node => { const operator = tokens[at]; if (operator === '+' || operator === '-') { at++; if (++depth > 32) throw new Error('nested_expression'); const node: Node = {type:'UnaryExpression',operator,argument:unary()}; depth--; return node; } return power(); };
  const product = (): Node => { let left = unary(); while (tokens[at] === '*' || tokens[at] === '/' || /^(?:[A-Za-z\d.]|\()/.test(tokens[at]??'')) { const explicit=tokens[at]==='*'||tokens[at]==='/';left = binary(explicit?tokens[at++]!:'*',left,unary()); } return left; };
  const sum = (): Node => { let left = product(); while (tokens[at] === '+' || tokens[at] === '-') left = binary(tokens[at++]!,left,product()); return left; };
  const root = sum(); if (at !== tokens.length) throw new Error('unexpected_token'); return root;
}
export function compileMath(expression: string, variables: readonly string[]): (scope: Readonly<Record<string, number>>) => number {
  if (!expression.trim() || expression.length > 800) throw new Error('公式需要1–800个字符');
  let root: Node;
  try { root = parseMath(expression); } catch { throw new Error('公式语法不完整，请检查括号、运算符，并显式写出乘号'); }
  const allowed = new Set(variables); let count = 0;
  const walk = (node: Node, depth: number): void => {
    if (++count > 200 || depth > 30) throw new Error('公式过于复杂，请拆成几个函数');
    if (node.type === 'Literal') { if (typeof node.value !== 'number' || !Number.isFinite(node.value)) throw new Error('数字超出可表示范围'); return; }
    if (node.type === 'Identifier' && (allowed.has(node.name!) || ['pi', 'PI', 'e'].includes(node.name!))) return;
    if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator!)) { walk(node.argument!, depth + 1); return; }
    if (node.type === 'BinaryExpression' && ['+', '-', '*', '/', '^', '**'].includes(node.operator!)) { walk(node.left!, depth + 1); walk(node.right!, depth + 1); return; }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && Object.hasOwn(functions, node.callee.name!) && node.arguments!.length >= 1 && node.arguments!.length <= 8) {
      const name = node.callee.name!, arity = name === 'pow' ? 2 : ['min', 'max'].includes(name) ? undefined : 1;
      if (arity !== undefined && node.arguments!.length !== arity) throw new Error(name + '的参数数量不正确');
      for (const argument of node.arguments!) walk(argument, depth + 1); return;
    }
    throw new Error(node.type === 'Identifier' ? '未定义的变量：' + node.name : '只支持数学运算、已定义参数和常用数学函数');
  };
  walk(root, 0);
  const run = (node: Node, scope: Readonly<Record<string, number>>): number => {
    if (node.type === 'Literal') return node.value as number;
    if (node.type === 'Identifier') return node.name === 'e' ? Math.E : node.name === 'pi' || node.name === 'PI' ? Math.PI : scope[node.name!] ?? NaN;
    if (node.type === 'UnaryExpression') return (node.operator === '-' ? -1 : 1) * run(node.argument!, scope);
    if (node.type === 'CallExpression') return functions[node.callee!.name!]!(...node.arguments!.map(argument => run(argument, scope)));
    const left = run(node.left!, scope), right = run(node.right!, scope);
    switch (node.operator) { case '+': return left + right; case '-': return left - right; case '*': return left * right; case '/': return left / right; default: return left ** right; }
  };
  return scope => run(root, scope);
}

export type MathExpressionJSON=number|string|[string,...MathExpressionJSON[]];
/** Same ASCII grammar as the graph, compiled as data for the symbolic engine. */
export function mathExpressionJSON(text:string):MathExpressionJSON {
  const sides=text.split('=');if(sides.length>2)throw new Error('只支持一个等号');
  const names:Record<string,string>={sin:'Sin',cos:'Cos',tan:'Tan',asin:'Arcsin',acos:'Arccos',atan:'Arctan',sqrt:'Sqrt',abs:'Abs',exp:'Exp',log:'Ln',ln:'Ln',log10:'Log10',floor:'Floor',ceil:'Ceil',round:'Round',min:'Min',max:'Max',pow:'Power',sinh:'Sinh',cosh:'Cosh',tanh:'Tanh'};
  const part=(value:string):MathExpressionJSON=>{
    const root=parseMath(value),symbols=new Set<string>();
    const collect=(node:Node):void=>{if(node.type==='Identifier')symbols.add(node.name!);if(node.argument)collect(node.argument);if(node.left)collect(node.left);if(node.right)collect(node.right);node.arguments?.forEach(collect);};collect(root);
    compileMath(value,[...symbols]);
    const convert=(node:Node):MathExpressionJSON=>{
      if(node.type==='Literal')return node.value!;
      if(node.type==='Identifier')return node.name==='pi'||node.name==='PI'?'Pi':node.name==='e'?'ExponentialE':node.name!;
      if(node.type==='UnaryExpression')return node.operator==='-'?['Negate',convert(node.argument!)]:convert(node.argument!);
      if(node.type==='CallExpression')return [names[node.callee!.name!]!,...node.arguments!.map(convert)];
      return [({'+':'Add','-':'Subtract','*':'Multiply','/':'Divide','^':'Power','**':'Power'} as Record<string,string>)[node.operator!]!,convert(node.left!),convert(node.right!)];
    };return convert(root);
  };
  return sides.length===2?['Equal',part(sides[0]!),part(sides[1]!)]:part(text);
}
