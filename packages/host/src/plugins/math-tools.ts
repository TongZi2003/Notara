import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { MathEditsSchema, MathComputeSchema } from '@studyforge/contracts/math-workbench';
import { MathSceneSchema } from '@studyforge/contracts/math-scene';
import { toolSchema } from '../tools/tool-schema.ts';
import { teacherContext } from '../tools/learning-context.ts';
import { computeMath } from './math-compute.ts';
const target=z.object({id:z.string().min(1).describe('read_math_scene返回的数学工作台id'),expectedVersion:z.number().int().nonnegative().describe('最近读取的场景revision，冲突后重读')}).strict();
export function registerMathTools(host:Context):void {
  const output={schema:{type:'object' as const,properties:{json:{type:'string' as const}},required:['json'],additionalProperties:false as const},render:(_args:unknown,value:{json:string})=>[{type:'text' as const,text:value.json}]};
  const register=(name:string,description:string,schema:z.ZodType,execute:(input:any,context:Awaited<ReturnType<typeof teacherContext>>)=>Promise<unknown>):void=>{
    host.effect(()=>host.tools.register({name,description,parameters:toolSchema(schema),output,async execute(args,execution){
      const context=await teacherContext(host,execution);if(execution.agent?.session.header.origin==='subagent')throw new Error('main_teacher_required');
      return {json:JSON.stringify(await execute(schema.parse(args),context))};
    }}));
  };
  register('read_math_scene','读取数学工作台的场景、真实画布测量与对象构造schema。无id列出数学工作台；有id返回revision/document/projection。只有rendering=current时projection对应当前已同步场景；unavailable表示页面未打开或尚未绘制，不能编造数值。',z.object({id:z.string().optional()}).strict(),async(input,context)=>{
    if(input.id)return {...await host.studyforgeLearningWorkbenches.inspectMath(context,input.id),schema:z.toJSONSchema(MathSceneSchema,{io:'input'}),editSchema:toolSchema(MathEditsSchema)};
    return {workbenches:host.studyforgePluginsManager.workbenches(context.sessionId).filter(row=>host.studyforgePluginsManager.get(row.pluginRef,row.digest).manifest.notara.workbenches.some(c=>c.id===row.contributionId&&c.document?.kind==='math')).map(row=>({id:row.id,title:row.title}))};
  });
  register('edit_math_scene','在同一个数学场景批量增改二维或三维对象、参数和视区。edits按name引用；整批验证依赖后一次保存，未指定内容保留。公式显式乘号，角度弧度。成功表示已保存，绘制与测量须随后read_math_scene确认。',target.extend({edits:MathEditsSchema}),async(input,context)=>host.studyforgeLearningWorkbenches.editMath({...context,expectedVersion:input.expectedVersion},input.id,input.edits));
  register('calculate_math','用Cortex计算当前数学场景中的公式，自动使用已保存参数。支持LaTeX化简、求值、近似、单变量求解和求导。返回MathJSON与LaTeX；unresolved不是无解，数值近似不是证明，不修改场景或笔记。',target.extend(MathComputeSchema.shape),async(input,context)=>{
    const row=await host.studyforgeLearningWorkbenches.read(context,input.id);if(row.document.kind!=='math')throw new Error('math_workbench_required');if(row.revision!==input.expectedVersion)throw new Error('version_conflict');
    return {revision:row.revision,...await computeMath(MathComputeSchema.parse({operation:input.operation,expression:input.expression,variable:input.variable}),Object.fromEntries(row.document.parameters.map(p=>[p.name,p.value])))};
  });
  register('restore_math_scene','恢复数学场景的历史版本，产生一个新revision。targetRevision从read_math_scene的history选；撤销末次修改用previous。会恢复整份场景，仅在用户要求撤销或恢复时使用。必须用当前expectedVersion，不能覆盖未读的新修改。',target.extend({targetRevision:z.number().int().nonnegative()}),async(input,context)=>{
    if(input.targetRevision>=input.expectedVersion)throw new Error('restore_requires_earlier_revision');
    const document=await host.studyforgeLearningWorkbenches.mathRevision(context,input.id,input.targetRevision);
    return host.studyforgeLearningWorkbenches.write({...context,expectedVersion:input.expectedVersion},input.id,document);
  });
}
