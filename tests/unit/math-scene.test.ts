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
test('2D and 3D constructions share parameters and validate typed dependencies', () => {
  const input = {kind:'math',title:'平面与空间',parameters:[{name:'a',value:2,min:1,max:5}],objects:[
    {kind:'point',name:'A',x:0,y:0},{kind:'point',name:'B',x:4,y:0},
    {kind:'midpoint',name:'M',from:'A',to:'B'},
    {kind:'point3d',name:'P',x:0,y:0,z:0},{kind:'point3d',name:'Q',x:4,y:0,z:0},
    {kind:'point3d',name:'R',x:0,y:3,z:0},{kind:'plane3d',name:'plane',points:['P','Q','R']},
    {kind:'sphere3d',name:'sphere',center:'P',radius:'a'},
    {kind:'function3d',name:'surface',expression:'a*sin(x)*cos(y)',xRange:[-3,3],yRange:[-3,3]},
  ]};
  expect(MathSceneSchema.safeParse(input).success).toBe(true);
  expect(MathSceneSchema.safeParse({...input,objects:[...input.objects,{kind:'line3d',name:'bad',from:'A',to:'Q'}]}).success).toBe(false);
});
test('derived-point cycles and dangling dependencies are rejected before publication', () => {
  const seed={kind:'math',title:'循环',objects:[{kind:'point',name:'A',x:0,y:0},{kind:'midpoint',name:'M',from:'A',to:'N'},{kind:'midpoint',name:'N',from:'A',to:'M'}]};
  const parsed=MathSceneSchema.safeParse(seed);
  expect(parsed.success).toBe(false);
  if(!parsed.success)expect(parsed.error.issues.some(i=>i.message.includes('循环'))).toBe(true);
});
test('legacy parameter names remain readable when adding 3D capabilities',()=>{
  expect(MathSceneSchema.safeParse({kind:'math',title:'旧参数',parameters:[{name:'u',value:1,min:0,max:2},{name:'z',value:1,min:0,max:2}],objects:[{kind:'function',name:'f',expression:'u*x+z'}]}).success).toBe(true);
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
