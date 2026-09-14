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
]);
export type MathObject = z.infer<typeof MathObjectSchema>;
export const MathSceneBaseSchema = z.object({
  kind: z.literal('math'), title: z.string().trim().min(1).max(160),
  viewport: z.tuple([NumberValue, NumberValue, NumberValue, NumberValue]).default([-5, 5, 5, -5]).describe('JSXGraph视区：左、上、右、下'),
  parameters: z.array(z.object({ name: Name, value: NumberValue, min: NumberValue, max: NumberValue, step: z.number().positive().max(1e6).default(0.1) }).strict()).max(12).default([]),
  objects: z.array(MathObjectSchema).max(60).default([]),
  observation: z.string().max(8000).default(''),
}).strict();
export type MathScene = z.infer<typeof MathSceneBaseSchema>;
export function mathSceneProblems(scene: MathScene): string[] {
  const problems: string[] = [], parameters = scene.parameters.map(p => p.name), names = scene.objects.map(o => o.name);
  if (new Set([...parameters, ...names]).size !== parameters.length + names.length) problems.push('参数和图形名称不能重复');
  if (parameters.some(name => mathReservedNames.has(name))) problems.push('参数名不能使用x、y、t或数学函数名');
  if (scene.parameters.some(p => p.min >= p.max || p.value < p.min || p.value > p.max || p.step > p.max - p.min)) problems.push('参数值和步长必须在区间内');
  if (scene.viewport[0] >= scene.viewport[2] || scene.viewport[3] >= scene.viewport[1]) problems.push('视区必须有正的宽度和高度');
  const byName = new Map(scene.objects.map(object => [object.name, object]));
  const point = (name: string): boolean => ['point', 'glider'].includes(byName.get(name)?.kind ?? '');
  const expression = (text: string, axis: string[], name: string): void => { try { compileMath(text, [...parameters, ...axis]); } catch (error) { problems.push(name + '：' + (error as Error).message); } };
  for (const object of scene.objects) {
    if ('range' in object && object.range && object.range[0] >= object.range[1]) problems.push(object.name + '的参数区间需要从小到大');
    if (object.kind === 'function') expression(object.expression, ['x'], object.name);
    if (object.kind === 'implicit') expression(object.expression, ['x', 'y'], object.name);
    if (object.kind === 'parametric') { expression(object.x, ['t'], object.name); expression(object.y, ['t'], object.name); }
    if (object.kind === 'circle') { expression(object.radius, [], object.name); if (!point(object.center)) problems.push(object.name + '的圆心不存在'); }
    if (object.kind === 'glider' && byName.get(object.curve)?.kind !== 'function') problems.push(object.name + '必须依附一个函数图像');
    if ((object.kind === 'line' || object.kind === 'vector') && (!point(object.from) || !point(object.to) || object.from === object.to)) problems.push(object.name + '需要两个不同的点');
    if (object.kind === 'polygon' && (object.points.some(name => !point(name)) || new Set(object.points).size !== object.points.length)) problems.push(object.name + '的顶点不存在或重复');
    if (object.kind === 'tangent' && byName.get(object.point)?.kind !== 'glider') problems.push(object.name + '的切点需要是函数图像上的动点');
  }
  return problems;
}
export const MathSceneSchema = MathSceneBaseSchema.superRefine((scene, ctx) => { for (const message of mathSceneProblems(scene)) ctx.addIssue({ code: 'custom', message }); });
