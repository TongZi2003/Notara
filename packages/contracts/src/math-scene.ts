import { z } from 'zod';
import { compileMath, mathReservedNames } from './math-expression.ts';
const NumberValue = z.number().finite().min(-1e6).max(1e6);
const Name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/);
const Base = z.object({ name: Name, label: z.string().max(80).optional(), color: z.enum(['accent', 'red', 'green', 'gray']).default('accent'), visible: z.boolean().default(true) });
const Range = z.tuple([NumberValue, NumberValue]);
const Expr = z.string().min(1).max(800);
export const MathObjectSchema = z.discriminatedUnion('kind', [
  Base.extend({ kind: z.literal('function'), expression: Expr, range: Range.optional() }).strict(),
  Base.extend({ kind: z.literal('parametric'), x: Expr, y: Expr, range: Range }).strict(),
  Base.extend({ kind: z.literal('implicit'), expression: Expr }).strict(),
  Base.extend({ kind: z.literal('point'), x: NumberValue, y: NumberValue, draggable: z.boolean().default(true) }).strict(),
  Base.extend({ kind: z.literal('glider'), curve: Name, x: NumberValue }).strict(),
  Base.extend({ kind: z.literal('line'), from: Name, to: Name, segment: z.boolean().default(false) }).strict(),
  Base.extend({ kind: z.literal('vector'), from: Name, to: Name }).strict(),
  Base.extend({ kind: z.literal('circle'), center: Name, radius: Expr }).strict(),
  Base.extend({ kind: z.literal('polygon'), points: z.array(Name).min(3).max(12) }).strict(),
  Base.extend({ kind: z.literal('tangent'), point: Name }).strict(),
  Base.extend({ kind: z.literal('midpoint'), from: Name, to: Name }).strict(),
  Base.extend({ kind: z.literal('intersection'), first: Name, second: Name, branch: z.number().int().min(0).max(1).default(0) }).strict(),
  Base.extend({ kind: z.literal('parallel'), line: Name, point: Name }).strict(),
  Base.extend({ kind: z.literal('perpendicular'), line: Name, point: Name }).strict(),
  Base.extend({ kind: z.literal('circumcircle'), points: z.tuple([Name,Name,Name]) }).strict(),
  Base.extend({ kind: z.literal('angle'), points: z.tuple([Name,Name,Name]) }).strict(),
  Base.extend({ kind: z.literal('conic'), points: z.tuple([Name,Name,Name,Name,Name]) }).strict(),
  Base.extend({ kind: z.literal('point3d'), x: NumberValue, y: NumberValue, z: NumberValue, draggable: z.boolean().default(true) }).strict(),
  Base.extend({ kind: z.literal('midpoint3d'), from: Name, to: Name }).strict(),
  Base.extend({ kind: z.literal('line3d'), from: Name, to: Name, segment: z.boolean().default(false) }).strict(),
  Base.extend({ kind: z.literal('vector3d'), from: Name, to: Name }).strict(),
  Base.extend({ kind: z.literal('plane3d'), points: z.tuple([Name,Name,Name]) }).strict(),
  Base.extend({ kind: z.literal('polygon3d'), points: z.array(Name).min(3).max(12) }).strict(),
  Base.extend({ kind: z.literal('sphere3d'), center: Name, radius: Expr }).strict(),
  Base.extend({ kind: z.literal('function3d'), expression: Expr, xRange: Range, yRange: Range }).strict(),
  Base.extend({ kind: z.literal('parametric3d'), x: Expr, y: Expr, z: Expr, range: Range }).strict(),
  Base.extend({ kind: z.literal('surface3d'), x: Expr, y: Expr, z: Expr, uRange: Range, vRange: Range }).strict(),
]);
export type MathObject = z.infer<typeof MathObjectSchema>;
export const MathSceneBaseSchema = z.object({
  kind: z.literal('math'), title: z.string().trim().min(1).max(160),
  viewport: z.tuple([NumberValue, NumberValue, NumberValue, NumberValue]).default([-5, 5, 5, -5]).describe('JSXGraph视区：左、上、右、下'),
  space: z.object({ bounds: z.tuple([Range,Range,Range]).default([[-5,5],[-5,5],[-5,5]]), azimuth: z.number().finite().min(-7).max(7).default(.8), elevation: z.number().finite().min(-1.57).max(1.57).default(.35) }).strict().prefault({}),
  view: z.enum(['2d','3d']).default('2d'),
  parameters: z.array(z.object({ name: Name, value: NumberValue, min: NumberValue, max: NumberValue, step: z.number().positive().max(1e6).default(0.1) }).strict()).max(12).default([]),
  objects: z.array(MathObjectSchema).max(60).default([]),
  observation: z.string().max(8000).default(''),
}).strict();
export type MathScene = z.infer<typeof MathSceneBaseSchema>;
export const mathDimension = (object: MathObject): 2|3 => object.kind.endsWith('3d') ? 3 : 2;
export function mathDependencies(object: MathObject): string[] {
  if ('from' in object) return [object.from,object.to];
  if ('points' in object) return object.points;
  if ('first' in object) return [object.first,object.second];
  if ('center' in object) return [object.center];
  if ('line' in object) return [object.line,object.point];
  if ('point' in object) return [object.point];
  return 'curve' in object ? [object.curve] : [];
}
/** Only dependents are removed; deleting a line never deletes its end points. */
export function mathRemovalClosure(objects: MathObject[], names: Iterable<string>): Set<string> {
  const removed = new Set(names);
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of objects) {
      if (!removed.has(object.name) && mathDependencies(object).some(name => removed.has(name))) {
        removed.add(object.name);
        changed = true;
      }
    }
  }
  return removed;
}
/** Input ordering is not a construction constraint. Dependencies are. */
export function orderedMathObjects(objects: MathObject[]): MathObject[] {
  const byName = new Map(objects.map(object=>[object.name,object])), active = new Set<string>(), done = new Set<string>(), result: MathObject[]=[];
  const visit=(name:string):void=>{
    if(done.has(name))return;
    if(active.has(name))throw new Error('对象依赖存在循环：'+name);
    const object=byName.get(name);if(!object)throw new Error('引用的对象不存在：'+name);
    active.add(name);for(const dependency of mathDependencies(object))visit(dependency);
    active.delete(name);done.add(name);result.push(object);
  };
  for(const object of objects)visit(object.name);
  return result;
}
export function mathSceneProblems(scene: MathScene): string[] {
  const problems: string[] = [], parameters = scene.parameters.map(p => p.name), names = scene.objects.map(o => o.name);
  if (new Set([...parameters, ...names]).size !== parameters.length + names.length) problems.push('参数和图形名称不能重复');
  if (parameters.some(name => mathReservedNames.has(name))) problems.push('参数名不能使用x、y、t或数学函数名');
  if (scene.parameters.some(p => p.min >= p.max || p.value < p.min || p.value > p.max || p.step > p.max - p.min)) problems.push('参数值和步长必须在区间内');
  if (scene.viewport[0] >= scene.viewport[2] || scene.viewport[3] >= scene.viewport[1]) problems.push('视区必须有正的宽度和高度');
  const byName = new Map(scene.objects.map(object => [object.name, object]));
  const point = (name: string, dimension=2): boolean => (dimension===2?['point','glider','midpoint','intersection']:['point3d','midpoint3d']).includes(byName.get(name)?.kind ?? '');
  const line = (name:string):boolean => ['line','vector','parallel','perpendicular','tangent'].includes(byName.get(name)?.kind??'');
  const curve = (name:string):boolean => line(name)||['circle','circumcircle'].includes(byName.get(name)?.kind??'');
  const expression = (text: string, axis: string[], name: string): void => { try { compileMath(text, [...parameters, ...axis]); } catch (error) { problems.push(name + '：' + (error as Error).message); } };
  for (const object of scene.objects) {
    if ('range' in object && object.range && object.range[0] >= object.range[1]) problems.push(object.name + '的参数区间需要从小到大');
    if (object.kind === 'function') expression(object.expression, ['x'], object.name);
    if (object.kind === 'implicit') expression(object.expression, ['x', 'y'], object.name);
    if (object.kind === 'parametric') { expression(object.x, ['t'], object.name); expression(object.y, ['t'], object.name); }
    if (object.kind === 'circle'||object.kind==='sphere3d') { expression(object.radius, [], object.name); if (!point(object.center,mathDimension(object))) problems.push(object.name + '的中心不存在或维度不匹配'); }
    if (object.kind === 'glider' && byName.get(object.curve)?.kind !== 'function') problems.push(object.name + '必须依附一个函数图像');
    if ('from' in object && (!point(object.from,mathDimension(object)) || !point(object.to,mathDimension(object)) || object.from === object.to)) problems.push(object.name + '需要同维度的两个不同点');
    if ('points' in object && (object.points.some(name => !point(name,mathDimension(object))) || new Set(object.points).size !== object.points.length)) problems.push(object.name + '的顶点不存在、重复或维度不匹配');
    if (object.kind === 'tangent' && byName.get(object.point)?.kind !== 'glider') problems.push(object.name + '的切点需要是函数图像上的动点');
    if ('line' in object && (!line(object.line)||!point(object.point))) problems.push(object.name+'需要平面直线和点');
    if(object.kind==='intersection'&&(!curve(object.first)||!curve(object.second)||object.first===object.second))problems.push(object.name+'需要两条不同的直线或圆');
    if(object.kind==='function3d'){expression(object.expression,['x','y'],object.name);}
    if(object.kind==='parametric3d'||object.kind==='surface3d')for(const text of [object.x,object.y,object.z])expression(text,object.kind==='parametric3d'?['t']:['u','v'],object.name);
    if(object.kind==='surface3d'&&parameters.some(name=>name==='u'||name==='v'))problems.push(object.name+'的局部变量u、v不能与场景参数重名');
    for(const key of ['xRange','yRange','uRange','vRange'] as const)if(key in object){const range=(object as unknown as Record<string,[number,number]>)[key]!;if(range[0]>=range[1])problems.push(object.name+'的区间需要从小到大');}
  }
  if(scene.space.bounds.some(range=>range[0]>=range[1]))problems.push('空间视区需要正的宽度');
  try { orderedMathObjects(scene.objects); } catch(error) { problems.push((error as Error).message); }
  return problems;
}
export const MathSceneSchema = MathSceneBaseSchema.superRefine((scene, ctx) => { for (const message of mathSceneProblems(scene)) ctx.addIssue({ code: 'custom', message }); });
