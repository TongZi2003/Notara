import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
const module=await import('./agent-tools.js').catch(()=>({}));

test('teaching tools register native validated schemas and require approval for writes',async()=>{
  assert.equal(typeof module.installAgentTools,'function');
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  const calls=[];
  const service={isTeaching:()=>true,executeTool:async(name,args)=>{calls.push({name,args});return {saved:true};}};
  module.installAgentTools(ctx,service);
  const names=ctx.tools.schemas().map(x=>x.name);
  assert.deepEqual(names.sort(),['open_learning_lesson','save_lesson_summary','set_teaching_settings','write_lesson_board']);
  const result=await ctx.tools.execute({name:'save_lesson_summary',callId:'write-denied-without-approval',arguments:{body:'已完成的真实课堂进度。'},signal:new AbortController().signal});
  assert.equal(result.isError,true);
  assert.equal(calls.length,0);
});

test('write_lesson_board exposes only the controlled math interaction contract', async () => {
  const contract = module.VAULT_TOOL_CONTRACTS.find(item => item.name === 'write_lesson_board');
  assert.ok(contract);
  assert.ok(contract.parameters.properties.interactive);
  assert.equal(contract.parameters.properties.interactive.properties.provider.enum[0], 'math');
  assert.deepEqual(contract.parameters.properties.interactive.properties.preset.enum, ['parabola']);
});

test('read-only subagents cannot write teaching facts even through a callable tool',async()=>{
  assert.equal(typeof module.installAgentTools,'function');
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  let called=false;
  module.installAgentTools(ctx,{isTeaching:()=>true,executeTool:async()=>{called=true;return {};}});
  const result=await ctx.tools.execute({name:'save_lesson_summary',callId:'child-write',arguments:{body:'不应写入'},agent:{session:{header:{origin:'subagent'}}},signal:new AbortController().signal});
  assert.equal(result.isError,true);
  assert.equal(called,false);
});

test('teacher text tools are retired while Bash and ordinary agents keep native decisions',async()=>{
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  let called=0;
  const retired=['read','write','edit','glob','grep'];
  for(const name of [...retired,'bash'])ctx.tools.register({name,description:'Native seam',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},execute:async()=>{called++;return {};}});
  module.installAgentTools(ctx,{isTeaching:agent=>agent?.session?.header?.agentPreset==='notara-teacher',executeTool:async()=>({})});
  for(const name of [...retired,'bash']){
    assert.ok(ctx.tools.schemas().some(tool=>tool.name===name));
    const result=await ctx.tools.execute({name,callId:`native-${name}`,arguments:{},agent:{session:{header:{origin:'user',agentPreset:'notara-teacher'}}},signal:new AbortController().signal});
    assert.equal(result.isError===true,name!=='bash');
  }
  assert.equal(called,1);
  for(const name of retired) {
    const result=await ctx.tools.execute({name,callId:`coding-${name}`,arguments:{},agent:{session:{header:{origin:'user',agentPreset:'default'}}},signal:new AbortController().signal});
    assert.notEqual(result.isError,true);
  }
  assert.equal(called,6);
});

test('native full access overrides teaching write approval without weakening native denials',async()=>{
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  const get=ctx.get.bind(ctx);
  ctx.get=(name,...args)=>name==='sandboxPolicy'?{resolve:()=>({mode:'danger-full-access'})}:get(name,...args);
  let called=0;
  module.installAgentTools(ctx,{isTeaching:()=>true,executeTool:async()=>{called++;return {saved:true};}});
  const exec={name:'save_lesson_summary',callId:'full-access',arguments:{body:'保留课堂事实'},agent:{session:{header:{origin:'user'}}},signal:new AbortController().signal};
  const allowed=await ctx.tools.execute(exec);
  assert.notEqual(allowed.isError,true);
  assert.equal(called,1);
  const child=await ctx.tools.execute({...exec,callId:'full-access-child',agent:{session:{header:{origin:'subagent'}}}});
  assert.equal(child.isError,true);
  assert.equal(called,1);
  ctx.on('tools/pre-execute',()=>({kind:'deny',reason:'native boundary'}));
  const denied=await ctx.tools.execute({...exec,callId:'native-denial'});
  assert.equal(denied.isError,true);
  assert.equal(called,1);
});

test('teacher Bash never overrides a native denial, including full access mode',async()=>{
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  const get=ctx.get.bind(ctx);
  ctx.get=(name,...args)=>name==='sandboxPolicy'?{resolve:()=>({mode:'danger-full-access'})}:get(name,...args);
  let invoked=false;
  ctx.tools.register({name:'bash',description:'Native shell',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[]},execute:async()=>{invoked=true;return {};}});
  module.installAgentTools(ctx,{isTeaching:()=>true,executeTool:async()=>({})});
  ctx.on('tools/pre-execute',()=>({kind:'deny',reason:'native policy refused'}));
  const result=await ctx.tools.execute({name:'bash',callId:'native-denied-bash',arguments:{},agent:{session:{header:{origin:'user'}}},signal:new AbortController().signal});
  assert.equal(result.isError,true);
  assert.equal(invoked,false);
});
