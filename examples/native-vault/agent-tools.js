import { teachingChoices } from './teaching-catalog.js';
import { WORKER_TOOLS } from './worker-catalog.js';
const string=description=>({type:'string',description});
const number=description=>({type:'number',description});
const nullable=value=>({oneOf:[value,{type:'null'}]});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});

// Only operations crossing the native classroom lifecycle live here. Ordinary
// authoring uses native filesystem/search/Bash tools and progressively loaded Skills.
export const VAULT_TOOL_CONTRACTS=[
  {name:'save_lesson_summary',description:'保存与真实课堂绑定的正式小结；有剧本则追加原文，否则生成独立小结。Host绑定课堂、学习时间与日志身份。小结本身就是教学归档：写完小结会话照旧留在会话列表里，学生可以继续在这节课里聊。只有用户明确要求把这次会话从会话列表收起（隐藏会话）时才archive=true——收起是会话列表动作，不等于教学归档；普通笔记与题内小结直接使用原生文件工具。',parameters:object({body:string('本课真实进度、探索、支持程度、产物和下次从这里继续；小结必须包含 `## 下次从这里继续`。保留有证据的认知变化：早先不完备或错误的理解、改变的触发、后来实际表现与未解决处，并引用相关卡片。未知过程不补编，不只留下最终正确答案。'),archive:{type:'boolean',description:'用户明确要求把这节课从会话列表收起时为true，否则false；仅写小结不用它。'}},['body']),write:true},
  {name:'open_learning_lesson',description:'按当前版本打开已读路线中的课程节点，重复打开回到同一原生课堂。明确要求再学一次时repeat=true。路线文档本身由原生文件工具或辅助脚本管理。',parameters:object({path:string('已读取的当前Vault相对路线文件路径，不含vault/前缀。'),nodeId:string('路线文件中实际存在的节点id。'),repeat:{type:'boolean'}},['path','nodeId']),write:true},
  {name:'set_teaching_settings',description:'修改当前课堂的教法、目标、临时要求或科目；scriptPath绑定已读备课文件，null解除。课堂身份与绑定由Host管理，不直接编辑会话文件。',parameters:object({teachingRef:nullable({type:'string',enum:teachingChoices.map(item=>item.id)}),learningGoal:nullable(object({title:string('学习目标。'),deadline:string('用户给出的YYYY-MM-DD期限。'),dailyMinutes:number('用户给出的每日分钟数。')},['title'])),temporaryInstructions:string('本课临时要求；空字符串清除。'),subjects:{type:'array',items:string('真实科目。')},scriptPath:nullable(string('已读备课页：当前Vault相对路径，或已授权注册学习集内的绝对文件路径。'))}),settings:true},
];
export const VAULT_WRITE_TOOLS=new Set(VAULT_TOOL_CONTRACTS.filter(tool=>tool.write).map(tool=>tool.name));

export function installAgentTools(ctx,service) {
  for(const contract of VAULT_TOOL_CONTRACTS) {
    const {write,settings,...schema}=contract;
    ctx.effect(()=>ctx.tools.register({...schema,
      output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      isConcurrencySafe:()=>!write&&!settings,
      async execute(args,exec){
        if(!service.isTeaching(exec.agent))throw new Error('teaching_session_required');
        return JSON.parse(JSON.stringify(await service.executeTool(contract.name,args,exec)));
      },
    }));
  }
  ctx.on('tools/pre-execute',async(exec,next)=>{
    service.prepareTool?.(exec);
    const decision=await next();
    if(decision.kind==='deny'||!service.isTeaching(exec.agent))return decision;
    if(exec.agent?.session?.header?.origin==='subagent')return WORKER_TOOLS.read.includes(exec.name)?decision:{kind:'deny',reason:'后台任务只允许配置范围内的读取，正式资料由老师写回。'};
    // Ask for known file/lifecycle writes by default, while native full access
    // remains authoritative. Never replace a native deny/ask with allow.
    // Bash keeps its native sandbox decision; do not guess effects from command text.
    if(VAULT_WRITE_TOOLS.has(exec.name)||['write','edit'].includes(exec.name)) {
      const session=exec.agent?.session;
      const mode=session?ctx.get?.('sandboxPolicy')?.resolve({session})?.mode:undefined;
      if(mode!=='danger-full-access')return decision.kind==='ask'?decision:{kind:'ask',reason:'保存所示学习资料或课堂绑定。'};
    }
    return decision;
  });
  ctx.effect(()=>ctx.tools.guard(exec=>{
    if(VAULT_TOOL_CONTRACTS.some(tool=>tool.name===exec.name)&&!service.isTeaching(exec.agent))return '该能力仅用于当前教学会话。';
    if(service.isTeaching(exec.agent)&&exec.agent?.session?.header?.origin==='subagent'&&!WORKER_TOOLS.read.includes(exec.name))return '后台任务不能修改资料或安排其他助手。';
    return undefined;
  }));
  ctx.on('system-prompt/assemble',async(assembly,context,next)=>{
    const result=await next();
    if(service.isTeaching(context.agent))return result;
    const names=new Set(VAULT_TOOL_CONTRACTS.map(tool=>tool.name));
    return {...result,tools:result.tools.filter(tool=>!names.has(tool.name))};
  });
}
