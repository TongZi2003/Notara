import { expect, test } from 'vitest';
import { compileMath } from '../../packages/contracts/src/math-expression.ts';
import { MathSceneSchema } from '../../packages/contracts/src/math-scene.ts';
test('math expressions evaluate parameters and powers without JavaScript evaluation', () => {
  expect(compileMath('a*sin(pi*x)+sqrt(4)', ['a','x'])({a:3,x:.5})).toBeCloseTo(5);
  expect(compileMath('2^3^2', [])({})).toBe(512);
  expect(compileMath('-x^2', ['x'])({x:3})).toBe(-9);
  expect(compileMath('(-x)^2', ['x'])({x:3})).toBe(9);
  expect(compileMath('2^-2', [])({})).toBe(.25);
  for (const input of ['window.alert(1)', 'constructor(1)', 'x=3', 'x;y', 'Math.sin(x)', 'unknown+x', '[1,2]', 'true', '"1"', 'sin(1,2)']) expect(() => compileMath(input, ['x'])).toThrow();
});
test('scene validates ranges and real geometry references before publishing', () => {
  const scene = { kind:'math',title:'函数与几何',parameters:[{name:'a',value:1,min:-2,max:2}],objects:[{kind:'function',name:'f',expression:'a*x^2'},{kind:'glider',name:'P',curve:'f',x:1},{kind:'tangent',name:'T',point:'P'}] };
  expect(MathSceneSchema.parse(scene).objects).toHaveLength(3);
  expect(MathSceneSchema.safeParse({...scene,objects:[{kind:'line',name:'L',from:'P',to:'missing'}]}).success).toBe(false);
  expect(MathSceneSchema.safeParse({...scene,parameters:[{name:'x',value:1,min:0,max:2}]}).success).toBe(false);
  expect(MathSceneSchema.safeParse({...scene,objects:[{kind:'function',name:'f',expression:'missing*x'}]}).success).toBe(false);
});
import { mergeMathScene } from '../../packages/contracts/src/math-merge.ts';

test('scene merge preserves disjoint AI/student changes and reports shared-field conflicts', () => {
  const base = MathSceneSchema.parse({ kind: 'math', title: '探索', objects: [{ kind: 'point', name: 'A', x: 1, y: 1 }] });
  const local = structuredClone(base), remote = structuredClone(base);
  local.observation = '保留我的观察'; remote.title = '老师改标题';
  expect(mergeMathScene(base,local,remote)).toMatchObject({ document: { observation: local.observation, title: remote.title }, conflicts: [] });
  remote.observation = '另一个观察';
  expect(mergeMathScene(base,local,remote).conflicts).toContain('observation');
  expect(()=>compileMath('1e999',[])).toThrow('数字超出');
});
