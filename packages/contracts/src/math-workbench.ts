import { z } from 'zod';
import { MathSceneBaseSchema, MathSceneSchema, MathObjectSchema, mathRemovalClosure, type MathScene } from './math-scene.ts';

export const MathEditSchema = z.discriminatedUnion('action', [
  z.object({action:z.literal('put-object'),object:MathObjectSchema}).strict().describe('按name新增或替换一个完整对象，其他对象保留'),
  z.object({action:z.literal('remove-object'),name:z.string().min(1)}).strict().describe('移除对象及所有直接或间接依赖它的构造；保留其父对象，如删线不删端点'),
  z.object({action:z.literal('put-parameter'),parameter:MathSceneBaseSchema.shape.parameters.unwrap().element}).strict(),
  z.object({action:z.literal('remove-parameter'),name:z.string().min(1)}).strict(),
  z.object({action:z.literal('set-view'),view:MathSceneBaseSchema.shape.view.unwrap().optional(),viewport:MathSceneBaseSchema.shape.viewport.unwrap().optional(),space:z.object({bounds:MathSceneBaseSchema.shape.space.unwrap().shape.bounds.unwrap().optional(),azimuth:MathSceneBaseSchema.shape.space.unwrap().shape.azimuth.unwrap().optional(),elevation:MathSceneBaseSchema.shape.space.unwrap().shape.elevation.unwrap().optional()}).strict().optional()}).strict(),
  z.object({action:z.literal('set-observation'),text:z.string().max(8000)}).strict(),
]);
export const MathEditsSchema=z.array(MathEditSchema).min(1).max(80);
export type MathEdit=z.infer<typeof MathEditSchema>;
export function applyMathEdits<T extends MathScene>(input:T, edits:MathEdit[]):T {
  const doc=structuredClone(input);
  const removed=new Set<string>();
  for(const edit of MathEditsSchema.parse(edits)){
    if(edit.action==='put-object'){const i=doc.objects.findIndex(o=>o.name===edit.object.name);if(i<0)doc.objects.push(edit.object);else doc.objects[i]=edit.object;removed.delete(edit.object.name);}
    else if(edit.action==='remove-object'){
      if(!doc.objects.some(o=>o.name===edit.name)){if(removed.has(edit.name))continue;throw new Error('object_missing: '+edit.name);}
      const closure=mathRemovalClosure(doc.objects,[edit.name]);
      doc.objects=doc.objects.filter(o=>!closure.has(o.name));for(const name of closure)removed.add(name);
    }
    else if(edit.action==='put-parameter'){const i=doc.parameters.findIndex(p=>p.name===edit.parameter.name);if(i<0)doc.parameters.push(edit.parameter);else doc.parameters[i]=edit.parameter;}
    else if(edit.action==='remove-parameter'){if(!doc.parameters.some(p=>p.name===edit.name))throw new Error('parameter_missing: '+edit.name);doc.parameters=doc.parameters.filter(p=>p.name!==edit.name);}
    else if(edit.action==='set-view'){if(edit.view===undefined&&edit.viewport===undefined&&edit.space===undefined)throw new Error('empty_view_edit');if(edit.view!==undefined)doc.view=edit.view;if(edit.viewport!==undefined)doc.viewport=edit.viewport;if(edit.space?.bounds!==undefined)doc.space.bounds=edit.space.bounds;if(edit.space?.azimuth!==undefined)doc.space.azimuth=edit.space.azimuth;if(edit.space?.elevation!==undefined)doc.space.elevation=edit.space.elevation;}
    else doc.observation=edit.text;
  }
  const parsed=MathSceneSchema.parse(Object.fromEntries(Object.entries(doc).filter(([key])=>key!=='links')));
  return {...doc,...parsed};
}
export const MathProjectionSchema=z.object({
  revision:z.number().int().nonnegative(),
  objects:z.array(z.object({name:z.string().min(1).max(24),state:z.enum(['defined','undefined','unsupported']),coordinates:z.array(z.number().finite()).min(2).max(3).optional(),values:z.partialRecord(z.enum(['length','area','radius','slope','angle','volume']),z.number().finite()).default({})}).strict()).max(60),
}).strict();
export type MathProjection=z.infer<typeof MathProjectionSchema>;
export const MathComputeSchema=z.object({
  operation:z.enum(['simplify','evaluate','numeric','solve','differentiate']),
  expression:z.string().trim().min(1).max(800).describe('数学表达式，如sqrt(4)、a*x^2、x^2-5x+6=0；也支持LaTeX。普通表达式与画布共用函数语法，不支持程序或JavaScript'),
  variable:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/).default('x').describe('求解或求导的变量，默认x'),
}).strict();
export type MathCompute=z.infer<typeof MathComputeSchema>;
export interface MathResult { status:'result'|'unresolved'|'undefined'|'invalid'|'timeout'|'busy'; latex:string; json:string; numeric?:number; engine:string }
