import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
const module=await import('./agent-tools.js').catch(()=>({}));

test('teaching tools register native validated schemas and require approval when policy is unknown',async()=>{
  assert.equal(typeof module.installAgentTools,'function');
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  const calls=[];
  const service={isTeaching:()=>true,executeTool:async(name,args)=>{calls.push({name,args});return {saved:true};}};
  module.installAgentTools(ctx,service);
  const names=ctx.tools.schemas().map(x=>x.name);
  assert.deepEqual(names.sort(),['open_learning_lesson','save_lesson_summary','set_teaching_settings','vault_command','vault_read','vault_save','vault_search','write_lesson_board']);
  const result=await ctx.tools.execute({name:'save_lesson_summary',callId:'write-denied-without-approval',arguments:{body:'已完成的真实课堂进度。'},signal:new AbortController().signal});
  assert.equal(result.isError,true);
  assert.equal(calls.length,0);
});

test('write_lesson_board takes sections and sizes; figures are body components, not an interaction argument', async () => {
  const contract = module.VAULT_TOOL_CONTRACTS.find(item => item.name === 'write_lesson_board');
  assert.ok(contract);
  assert.equal(contract.parameters.properties.interactive, undefined);
  assert.equal(contract.parameters.additionalProperties, false);
  assert.deepEqual(contract.parameters.properties.size.enum, ['narrow', 'wide', 'full']);
  assert.equal(contract.parameters.properties.section.maxLength, 80);
  for (const type of ['choice', 'blank', 'order', 'figure', 'flow']) assert.match(contract.description, new RegExp('```' + type));
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

test('the retired tools take their native prompt guidance with them for the teacher only',async()=>{
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  const retired=['read','write','edit','glob','grep'];
  for(const name of [...retired,'bash']){
    ctx.tools.register({name,description:'Native seam',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},execute:async()=>({})});
    // The shape the native packages use: "Use the grep tool — not shell grep or rg".
    ctx.systemPrompt.section({name:`tool:${name}`,order:100,text:({scope})=>ctx.tools.get(name,scope)===undefined?'':`Use the ${name} tool.`});
  }
  module.installAgentTools(ctx,{isTeaching:agent=>agent?.session?.header?.agentPreset==='notara-teacher',executeTool:async()=>({})});
  const sectionsFor=async header=>(await ctx.systemPrompt.assemble({agent:{session:{header}}})).sections.map(section=>section.name).filter(name=>name.startsWith('tool:'));
  assert.deepEqual(await sectionsFor({origin:'user',agentPreset:'notara-teacher'}),['tool:bash']);
  assert.deepEqual((await sectionsFor({origin:'user',agentPreset:'default'})).sort(),[...retired,'bash'].map(name=>`tool:${name}`).sort());
  // A read-only worker keeps its native read/glob/grep guidance.
  assert.ok((await sectionsFor({origin:'subagent',agentPreset:'notara-teacher'})).includes('tool:grep'));
});

for(const mode of ['workspace-write','danger-full-access'])test(`${mode} permits classroom writes while preserving native asks, denials and worker limits`,async()=>{
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  const get=ctx.get.bind(ctx);
  ctx.get=(name,...args)=>name==='sandboxPolicy'?{resolve:()=>({mode})}:get(name,...args);
  let called=0;
  module.installAgentTools(ctx,{isTeaching:()=>true,executeTool:async()=>{called++;return {saved:true};}});
  const exec={name:'save_lesson_summary',callId:'classroom-write',arguments:{body:'保留课堂事实'},agent:{session:{header:{origin:'user'}}},signal:new AbortController().signal};
  const writes=[
    ['write_lesson_board',{title:'第一步',body:'先自己试一试。'}],
    ['write_lesson_board',{title:'第一步',body:'再看一个例子。'}],
    ['save_lesson_summary',{body:'保留课堂事实'}],
    ['open_learning_lesson',{path:'路线/学习.md',nodeId:'lesson-1'}],
  ];
  for(const [name,args] of writes) {
    const allowed=await ctx.tools.execute({...exec,name,arguments:args,callId:`write-${called}`});
    assert.notEqual(allowed.isError,true,name);
  }
  assert.equal(called,4);
  const child=await ctx.tools.execute({...exec,callId:'full-access-child',agent:{session:{header:{origin:'subagent'}}}});
  assert.equal(child.isError,true);
  assert.equal(called,4);
  const unask=ctx.on('tools/pre-execute',()=>({kind:'ask',reason:'native confirmation'}));
  const asked=await ctx.tools.execute({...exec,callId:'native-ask'});
  assert.equal(asked.isError,true,'a native ask cannot execute without approval');
  assert.equal(called,4);
  unask();
  ctx.on('tools/pre-execute',()=>({kind:'deny',reason:'native boundary'}));
  const denied=await ctx.tools.execute({...exec,callId:'native-denial'});
  assert.equal(denied.isError,true);
  assert.equal(called,4);
});

test('read-only classroom writes still require approval before executing',async()=>{
  const ctx=new Context();
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  const get=ctx.get.bind(ctx);
  ctx.get=(name,...args)=>name==='sandboxPolicy'?{resolve:()=>({mode:'read-only'})}:get(name,...args);
  let called=0;
  module.installAgentTools(ctx,{isTeaching:()=>true,executeTool:async()=>{called++;return {};}});
  for(const [name,args] of [
    ['write_lesson_board',{title:'第一步',body:'先自己试一试。'}],
    ['save_lesson_summary',{body:'保留课堂事实'}],
    ['open_learning_lesson',{path:'路线/学习.md',nodeId:'lesson-1'}],
  ]) {
    const result=await ctx.tools.execute({name,arguments:args,callId:`readonly-${name}`,agent:{session:{header:{origin:'user'}}},signal:new AbortController().signal});
    assert.equal(result.isError,true,name);
  }
  assert.equal(called,0);
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

test('the teacher may use native read/write/edit on code files only; search stays in Bash', async () => {
  const ctx = new Context();
  new SystemPrompt(ctx, { includeHarnessIdentity: true, includeRuntimeContext: true });
  new ToolRuntime(ctx, { mode: 'native' });
  let called = 0;
  for (const name of ['read', 'write', 'edit', 'glob', 'grep']) ctx.tools.register({ name, description: 'Native seam', parameters: { type: 'object', properties: {}, additionalProperties: true }, output: { schema: { type: 'object' }, render: () => [] }, execute: async () => { called++; return {}; } });
  module.installAgentTools(ctx, { isTeaching: agent => agent?.session?.header?.agentPreset === 'notara-teacher', executeTool: async () => ({}) });
  const teacher = { session: { header: { origin: 'user', agentPreset: 'notara-teacher', cwd: '/synthetic/notara-workspace' } } };
  const run = (name, args) => ctx.tools.execute({ name, callId: `${name}-${JSON.stringify(args)}`, arguments: args, agent: teacher, signal: new AbortController().signal });
  for (const [name, args] of [['read', { file_path: '代码/hog.py' }], ['write', { file_path: '代码/lab01.scm', content: '(define x 1)' }], ['edit', { file_path: 'os/proc.c', old_string: 'a', new_string: 'b' }]]) {
    assert.notEqual((await run(name, args)).isError, true, `${name} ${args.file_path}`);
  }
  assert.equal(called, 3);
  const refusals = [];
  for (const [name, args] of [['read', { file_path: '知识/向量.md' }], ['write', { file_path: '卡片/x.md', content: '#' }], ['edit', { file_path: 'notes', old_string: 'a', new_string: 'b' }], ['glob', { pattern: '**/*.py' }], ['grep', { pattern: 'def' }]]) {
    const result = await run(name, args);
    assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
    refusals.push(JSON.stringify(result));
  }
  assert.equal(called, 3, 'nothing refused reached the native tool');
  assert.ok(refusals.every(text => text.includes('vault_read') && text.includes('代码文件')));
  // A code file outside the Vault would be listed to the student as this turn's work.
  for (const [name, args] of [['write', { file_path: '../scratch.json', content: '{}' }], ['write', { file_path: '/tmp/notara-reviews.json', content: '{}' }], ['edit', { file_path: '../lab.py', old_string: 'a', new_string: 'b' }]]) {
    const result = await run(name, args);
    assert.equal(result.isError, true, `${name} ${args.file_path}`);
    assert.match(JSON.stringify(result), /vault_command/);
  }
  assert.equal(called, 3, 'nothing outside the Vault reached the native tool');
  // The code tools are offered to the teacher; the search tools stay hidden.
  const tools = (await ctx.systemPrompt.assemble({ agent: teacher })).tools.map(tool => tool.name);
  assert.ok(['read', 'write', 'edit'].every(name => tools.includes(name)));
  assert.ok(!tools.includes('glob') && !tools.includes('grep'));
});
