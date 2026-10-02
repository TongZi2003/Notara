import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { isAbsolute,join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { Session } from '@deepseek-ai/dsh-session';
import { bindTeachingLesson } from './teaching-state.js';
import { parseLessonSummaries } from './lesson-data.js';
import { parseMarkdownDocument } from './vault.js';
const module=await import('./teaching-runtime.js').catch(()=>({}));

async function setup(t) {
  assert.equal(typeof module.NotaraTeaching,'function');
  const root=await mkdtemp(join(tmpdir(),'notara-teaching-runtime-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'vault'),{recursive:true});
  const ctx=new Context();new LocalFileSystem(ctx,{cwd:root,diffBasisMaxBytes:10*1024*1024});
  ctx.reflect.provide('workspaceRegistry',{list:()=>[{id:'runtime-workspace',path:root,title:'测试学习集'}],archiveSession:async()=>{}});
  const session=Session.create('runtime-session',[],{version: 4,id:'runtime-session',createdAt:Date.now(),isSeeded:false,cwd:root,agentPreset:'notara-teacher'});
  const agent={session};
  const service=new module.NotaraTeaching(ctx,{root},{resolveAgent:async()=>agent,flush:async()=>{},archive:async()=>{}});
  return {root,ctx,session,agent,service,exec:{agent,signal:new AbortController().signal,callId:'runtime-test'}};
}

/** Install the real runtime over fakes for the Host seams it registers into. */
async function installRuntime(t,{layout='legacy'}={}) {
  assert.equal(typeof module.installTeachingRuntime,'function');
  const root=await mkdtemp(join(tmpdir(),'notara-teaching-install-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  // 旧布局：vault/ 里有资料，工作区根另有 README.md。
  // 直接根：用户选中的目录自己有资料，旁边只剩旧版本误建的空 vault/。
  await mkdir(join(root,'知识'),{recursive:true});
  await mkdir(join(root,'vault','_templates'),{recursive:true});
  await writeFile(join(root,'README.md'),'# 说明\n');
  if(layout==='legacy')await writeFile(join(root,'vault','卡片.md'),'---\ntype: card\ntitle: 旧卡\n---\n\n内容。\n');
  else await writeFile(join(root,'知识','自有资料.md'),'# 自有资料\n');
  const ctx=new Context();new LocalFileSystem(ctx,{cwd:root,diffBasisMaxBytes:10*1024*1024});
  ctx.reflect.provide('workspaceRegistry',{list:()=>[{id:'install-workspace',path:root,title:'安装'}],archiveSession:async()=>{}});
  ctx.reflect.provide('sessionController',{inspect:async()=>({meta:{cwd:root}})});
  const sections=[],shellEnvs=[],handlers=[];
  ctx.reflect.provide('systemPrompt',{section:config=>{sections.push(config);return()=>{};}});
  ctx.reflect.provide('shellEnv',{register:config=>{shellEnvs.push(config);return()=>{};}});
  ctx.reflect.provide('tools',{register:()=>()=>{},guard:()=>()=>{}});
  const register=ctx.on.bind(ctx);
  ctx.on=(name,handler)=>{handlers.push({name,handler});return register(name,handler);};
  module.installTeachingRuntime(ctx,{root});
  const session=Session.create('install-session',[],{version: 4,id:'install-session',createdAt:Date.now(),isSeeded:false,cwd:root,agentPreset:'notara-teacher'});
  return {root,ctx,agent:{session},sections,shellEnvs,handlers};
}

async function assembledContext(runtime) {
  const next=async()=>({contexts:[],tools:[],sections:[]});
  for(const {name,handler} of runtime.handlers.filter(item=>item.name==='system-prompt/assemble')){
    const result=await handler({}, {agent:runtime.agent,signal:new AbortController().signal}, next);
    const context=result.contexts.find(item=>item.name==='notara:lesson-background');
    if(context)return {result,background:JSON.parse(context.text)};
  }
  throw new Error('notara_lesson_background_missing');
}

test('教学环境变量、提示构造与每轮上下文共用同一资料根',async t=>{
  const runtime=await installRuntime(t);
  const shell=runtime.shellEnvs.find(item=>item.name==='notara-vault-cli');
  const env=shell.resolve({agent:runtime.agent,callId:'install-call'});
  assert.equal(env.DSH_NOTARA_WORKSPACE,runtime.root.replaceAll('\\','/'));
  assert.equal(env.DSH_NOTARA_VAULT_ROOT,join(runtime.root,'vault').replaceAll('\\','/'));
  assert.equal(env.DSH_NOTARA_VAULT_PREFIX,'vault/');

  const {background}=await assembledContext(runtime);
  assert.deepEqual(background.materialsRoot,{env:'DSH_NOTARA_VAULT_ROOT',path:join(runtime.root,'vault'),legacyPrefix:'vault/'});

  // 提示构造只带规则正文：没有工作区时同样不抛异常、不泄露绝对路径。
  const unregistered=await installRuntime(t);
  unregistered.ctx.workspaceRegistry.list=()=>[];
  const section=unregistered.sections.find(item=>item.name==='notara:teaching');
  const text=section.text({agent:unregistered.agent});
  assert.ok(text.includes('教学共同规则'));
  assert.ok(text.includes('$DSH_NOTARA_VAULT_ROOT'));
  assert.ok(!text.includes(unregistered.root));
});

test('老师的 shell 带上随包 ripgrep：不依赖用户自己装 rg',async t=>{
  const runtime=await installRuntime(t);
  const shell=runtime.shellEnvs.find(item=>item.name==='notara-vault-cli');
  assert.ok(shell.variables.DSH_NOTARA_RG,'the variable is declared for the model');
  const env=shell.resolve({agent:runtime.agent,callId:'install-call'});
  assert.ok(isAbsolute(env.DSH_NOTARA_RG),env.DSH_NOTARA_RG);
  const {execFileSync}=await import('node:child_process');
  assert.match(execFileSync(env.DSH_NOTARA_RG,['--version'],{encoding:'utf8'}),/^ripgrep \d+/);
});

test('直接选中的资料目录：环境变量前缀为空，上下文仍指向自己',async t=>{
  const runtime=await installRuntime(t,{layout:'direct'});
  const env=runtime.shellEnvs.find(item=>item.name==='notara-vault-cli').resolve({agent:runtime.agent,callId:'install-call'});
  assert.equal(env.DSH_NOTARA_VAULT_ROOT,runtime.root.replaceAll('\\','/'));
  assert.equal(env.DSH_NOTARA_VAULT_PREFIX,'');
  const {background}=await assembledContext(runtime);
  assert.deepEqual(background.materialsRoot,{env:'DSH_NOTARA_VAULT_ROOT',path:runtime.root,legacyPrefix:''});
});

test('retired document tools have no hidden compatibility dispatcher',async t=>{
  const {service,exec}=await setup(t);
  for(const name of ['vault_list','vault_read','vault_search','vault_save','learning_find','learning_read','lesson_log_find','create_learning_route','review_queue','record_review','learning_calendar','schedule_learning_lesson'])await assert.rejects(service.executeTool(name,{},exec),/teaching_tool_unknown/);
});

test('archived lesson summary appends to its script without creating a second document',async t=>{
  const {root,service,session,exec}=await setup(t);
  await mkdir(join(root,'vault/备课'),{recursive:true});
  const path='备课/第一课.md',original='---\ntype: lesson\n---\n# 第一课\n\n原有教案不可丢。\n';
  await writeFile(join(root,'vault',path),original);
  bindTeachingLesson(session,{scriptPath:path});
  const summary=await service.executeTool('save_lesson_summary',{body:'完成条件辨析。\n\n## 下次从这里继续\n继续第二题。'},exec);
  assert.equal(summary.path,path);
  const saved=await readFile(join(root,'vault',path),'utf8');
  assert.ok(saved.startsWith(original));
  assert.equal(parseLessonSummaries(parseMarkdownDocument(path,saved)).length,1);
  const retry=await service.executeTool('save_lesson_summary',{body:'完成条件辨析。\n\n## 下次从这里继续\n继续第二题。'},exec);
  assert.equal(retry.path,path);
  const log=await service.lessonLog({});
  assert.equal(log.total,1);
  assert.match(log.hits[0].continuation,/继续第二题/);
});

test('free lesson summary creates an independent material and is indexed once',async t=>{
  const {service,exec}=await setup(t);
  const value=await service.executeTool('save_lesson_summary',{body:'讨论了一个反例。'},exec);
  assert.ok(value.path.startsWith('lesson_log/'));
  assert.equal((await service.lessonLog({})).total,1);
  const read=await service.editor().read(value.path);
  assert.match(parseLessonSummaries(read)[0].body,/讨论了一个反例/);
});

function student(session,text) {
  session.append('user/message',{id:crypto.randomUUID(),role:'user',source:{kind:'user'},content:[{type:'text',text}]},{surfaceOp:'append'});
}

test('old save retries never overwrite a newer summary, and archive retry only archives',async t=>{
  const {root,service,session,exec}=await setup(t);
  student(session,'完成第二题');
  const first=await service.saveSummary({...exec,callId:'op-first'},{body:'只做到第二题。'});
  student(session,'完成第七题');
  const second=await service.saveSummary({...exec,callId:'op-second'},{body:'现在做到第七题。'});
  const replay=await service.saveSummary({...exec,callId:'op-first'},{body:'只做到第二题。'});
  assert.equal(replay.revision,second.revision);
  assert.equal(first.path,second.path);
  assert.match(await readFile(join(root,'vault',first.path),'utf8'),/现在做到第七题/);
  let archived=0;
  service.nativeArchive=async()=>{if(++archived===1)throw new Error('transient');};
  // 重复的「总结本课」只回已保存的小结：课还开着，会话没有进归档集合。
  const repeat=await service.requestSummary({sessionId:session.id});
  assert.equal(repeat.saved,true);
  assert.equal(repeat.archived,false);
  assert.equal(archived,0);
  // 老师明确请求保存并归档时，归档失败保留小结并允许重试。
  assert.equal((await service.archiveSaved(session,repeat)).archivePending,true);
  assert.equal((await service.archiveSaved(session,repeat)).archived,true);
  assert.equal(archived,2);
  assert.equal((await service.lessonLog({})).total,1);
});

test('the lesson summary request queues one real class turn and hides nothing',async t=>{
  const {ctx,service,session}=await setup(t);
  const prompts=[];ctx.reflect.provide('sessionController',{prompt:async input=>{prompts.push(input);}});
  let archived=false;service.nativeArchive=async()=>{archived=true;};
  assert.equal((await service.requestSummary({sessionId:session.id})).queued,true);
  assert.equal(prompts.length,1);
  assert.equal(prompts[0].sessionId,session.id);
  assert.equal(archived,false);
  // 同一课堂在途时不再排第二个总结回合。
  assert.equal((await service.requestSummary({sessionId:session.id})).queued,true);
  assert.equal(prompts.length,1);
});

test('new student input during preparation keeps the class open and permits a retry',async t=>{
  const {service,session,exec}=await setup(t);
  student(session,'开始研究');
  const {teachingCutoff}=await import('./teaching-state.js');
  service.prepared.set(exec.agent,{revision:0,cutoff:teachingCutoff(session)});
  student(session,'先别结束，我还有问题');
  service.requests.set(session.id,'queued');
  let archived=false;service.nativeArchive=async()=>{archived=true;};
  const result=await service.saveSummary(exec,{body:'开始研究。',archive:true});
  assert.equal(result.archivePending,true);
  assert.equal(archived,false);
  assert.equal(service.requests.has(session.id),false);
});

test('the teacher asking to archive in its own turn waits for the turn to end, and retries while the session is busy',async t=>{
  const {service,session,exec}=await setup(t);
  student(session,'今天到这里');
  const calls=[];service.nativeArchive=async id=>{calls.push(id);if(calls.length===1)throw new Error('WorkspaceActiveSessionError');};
  const result=await service.saveSummary(exec,{body:'今天讲完了条件概率。',archive:true});
  assert.equal(result.archived,false);
  assert.equal(result.archiveScheduled,true);
  assert.deepEqual(calls,[]);
  assert.equal(service.archiveAfterTurn.has(session.id),true);
  // What the turn/end hook does once the teacher's turn is over.
  const cutoff=service.archiveAfterTurn.get(session.id);service.archiveAfterTurn.delete(session.id);service.archiveWhenIdle(session,cutoff);
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.deepEqual(calls,[session.id,session.id]);
});

test('a deferred archive leaves the lesson open when the student writes again before it lands',async t=>{
  const {service,session,exec}=await setup(t);
  student(session,'今天到这里');
  const calls=[];service.nativeArchive=async id=>{calls.push(id);throw new Error('WorkspaceActiveSessionError');};
  const result=await service.saveSummary(exec,{body:'今天讲完了条件概率。',archive:true});
  assert.equal(result.archiveScheduled,true);
  const cutoff=service.archiveAfterTurn.get(session.id);service.archiveAfterTurn.delete(session.id);service.archiveWhenIdle(session,cutoff);
  // The first attempt meets a busy session; before the retry the student keeps talking.
  await new Promise(resolve=>setTimeout(resolve,50));
  student(session,'等等，我还想再问一道题');
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.deepEqual(calls,[session.id]);
});

test('clearing a cross-set script binding keeps the existing summary at its original source',async t=>{
  const {root,ctx,service,exec}=await setup(t),other=join(root,'other');
  await mkdir(join(other,'vault/备课'),{recursive:true});
  await mkdir(join(root,'vault/备课'),{recursive:true});
  ctx.workspaceRegistry.list=()=>[{id:'runtime-workspace',path:root,title:'本集'},{id:'other-set',path:other,title:'其他集'}];
  const path='备课/第一课.md';
  await writeFile(join(other,'vault',path),'---\ntype: lesson\n---\n# 原剧本\n');
  await writeFile(join(root,'vault',path),'# 本集同名资料，不能追加\n');
  await service.executeTool('set_teaching_settings',{scriptPath:join(other,'vault',path)},exec);
  await service.saveSummary({...exec,callId:'first'},{body:'初次进度。'});
  await service.executeTool('set_teaching_settings',{scriptPath:null},exec);
  const updated=await service.saveSummary({...exec,callId:'second'},{body:'后续进度。'});
  assert.equal(updated.path,path);
  assert.equal(await readFile(join(root,'vault',path),'utf8'),'# 本集同名资料，不能追加\n');
  const summaries=parseLessonSummaries(parseMarkdownDocument(path,await readFile(join(other,'vault',path),'utf8')));
  assert.equal(summaries.length,1);
  assert.equal(summaries[0].body,'后续进度。');
  assert.equal(summaries[0].learningSetRef,'runtime-workspace');
});

test('a missing independent summary re-enters the actual summary request instead of an archive dead end',async t=>{
  const {root,ctx,service,session,exec}=await setup(t);
  const summary=await service.saveSummary({...exec,callId:'first'},{body:'先前小结。'});
  await rm(join(root,'vault',summary.path));
  let prompts=0;ctx.reflect.provide('sessionController',{prompt:async()=>{prompts++;}});
  assert.equal((await service.requestSummary({sessionId:session.id})).queued,true);
  assert.equal(prompts,1);
  const recovered=await service.saveSummary({...exec,callId:'regenerate'},{body:'重新总结当前课堂。'});
  assert.equal(recovered.path,summary.path);
  assert.equal((await service.lessonLog({})).total,1);
});

test('每轮的本课背景都带上学习集梗概：没有时提示创建，启用后补上默认科目与学科技能',async t=>{
  const runtime=await installRuntime(t);
  let {background}=await assembledContext(runtime);
  assert.equal(background.learningSet.status,'missing');
  assert.match(background.learningSet.hint,/技能页/);
  await mkdir(join(runtime.root,'vault','技能'),{recursive:true});
  await writeFile(join(runtime.root,'vault','技能','learning-set.md'),'---\ntype: skill\nid: learning-set\ntitle: 学习集梗概\ndescription: 本学习集的梗概。\nstatus: active\nsubjects: [数学]\ncoverage: 高中解析几何\nlevel: 高二\ngoal: 期末 120 分\ndeadline: 2027-01\n---\n# 学习集梗概\n\n以课本为主。\n');
  ({background}=await assembledContext(runtime));
  assert.equal(background.learningSet.status,'active');
  assert.equal(background.learningSet.goal,'期末 120 分');
  assert.deepEqual(background.learningSet.subjectSkills,['notara-subject-math']);
  assert.deepEqual(background.subjects,['数学'],'the lesson falls back to the overview subjects');
  assert.equal(background.subjectsSource,'learning-set');
});

test('a lesson opened on a route node from inside the lesson is written to the route first, and a half-bound lesson is repaired', async t => {
  const {root,ctx,session,service,exec}=await setup(t);
  const {createEditorVaultIO}=await import('./agent-io.js');
  const {createRouteInVault}=await import('./file-operations.js');
  const {parseRoute}=await import('./lesson-data.js');
  const {readTeachingSettings}=await import('./teaching-state.js');
  const io=createEditorVaultIO(ctx,root);
  const {path}=await createRouteInVault(io,{title:'路线',lessons:[{title:'第一课'},{title:'第二课'}]});
  const nodes=async()=>parseRoute(await io.read(path)).nodes;
  const [first,second]=await nodes();
  // Someone else writes the same route (the plan page scheduling lesson 2)
  // while this lesson binds: the lesson must still end up on the node.
  const bind=service.bindRouteNode.bind(service);let once=true;
  service.bindRouteNode=async(...args)=>{await bind(...args);if(once){once=false;const doc=await io.read(path);await io.save(path,doc.content.replace('第二课','第二课 '),doc.revision);}};
  const opened=await service.openRouteLessonHere({path,nodeId:first.id,expectedRevision:(await io.read(path)).revision},exec);
  assert.equal(opened.bound,true);
  assert.equal((await nodes()).find(node=>node.id===first.id).sessionId,session.id);
  assert.equal(readTeachingSettings(session).nodeId,first.id);
  service.bindRouteNode=bind;

  // A lesson an earlier version bound without writing the route gets its node back.
  const {bindTeachingLesson}=await import('./teaching-state.js');
  const other=(await import('@deepseek-ai/dsh-session')).Session.create('half-bound',[],{version: 4,id:'half-bound',createdAt:Date.now(),isSeeded:false,cwd:root,agentPreset:'notara-teacher'});
  bindTeachingLesson(other,{scriptPath:null,scriptRevision:null,scriptWorkspaceId:null,scriptSnapshot:null,routePath:path,nodeId:second.id,continuation:null,materials:[]});
  const half={agent:{session:other},signal:new AbortController().signal,callId:'half'};
  const repaired=await service.openRouteLessonHere({path,nodeId:second.id,expectedRevision:(await io.read(path)).revision},half);
  assert.equal(repaired.already,true);
  assert.equal((await nodes()).find(node=>node.id===second.id).sessionId,'half-bound');
});

test('a summary saved into the bound script does not make the lesson rebind it; a real script edit still does', async t => {
  const {root,ctx,session,service,exec}=await setup(t);
  const {runCommand}=await import('./vault-cli.js');
  const {readTeachingSettings}=await import('./teaching-state.js');
  const vault=join(root,'vault');
  await mkdir(join(vault,'备课'),{recursive:true});
  await writeFile(join(vault,'备课','一.md'),'---\ntype: lesson\ntitle: 一\n---\n# 一\n\n## 阶段一：引入\n\n先想想。\n\n## 阶段二：练习\n\n做题。\n');
  await service.executeTool('set_teaching_settings',{scriptPath:'备课/一.md'},exec);
  const fs=ctx.fs;
  const env=()=>({DSH_NOTARA_WORKSPACE:root,DSH_NOTARA_WORKSPACE_ID:'runtime-workspace',DSH_SESSION_ID:session.id,DSH_NOTARA_CALL_ID:`c${Math.random()}`,
    DSH_NOTARA_LESSON:module.lessonPinText({path:root,id:'runtime-workspace'},readTeachingSettings(session))});
  const cli=async(command,args)=>{try{return await runCommand(command,args,{fs,root,env:env()});}catch(error){return {error:error.code??error.message};}};
  const outline=await cli('lesson-outline',{path:'备课/一.md'});
  const key=outline.sections[0].key;
  await service.executeTool('save_lesson_summary',{body:'学了引入。\n\n## 下次从这里继续\n\n练习。'},{...exec,callId:'summary'});
  const after=await cli('lesson-outline',{path:'备课/一.md'});
  assert.equal(after.stale,false);
  const section=await cli('lesson-section',{path:'备课/一.md',section:key,expectedRevision:after.revision});
  assert.equal(section.error,undefined,JSON.stringify(section));
  // Changing the script itself is still a change the lesson must see.
  const text=await readFile(join(vault,'备课','一.md'),'utf8');
  await writeFile(join(vault,'备课','一.md'),text.replace('先想想。','先画一张图。'));
  const edited=await cli('lesson-outline',{path:'备课/一.md'});
  assert.equal(edited.stale,true);
  assert.equal((await cli('lesson-section',{path:'备课/一.md',section:key,expectedRevision:edited.revision})).error,'lesson_script_rebind_required');
});

test('one route the planner cannot read is reported by itself while every other route still lists', async t => {
  const {root,ctx,service}=await setup(t);
  const {createEditorVaultIO}=await import('./agent-io.js');
  const {createRouteInVault}=await import('./file-operations.js');
  const io=createEditorVaultIO(ctx,root);
  const broken=await createRouteInVault(io,{title:'路线甲',lessons:[{title:'一',brief:'第一课规划'},{title:'二'}]});
  await createRouteInVault(io,{title:'路线乙',lessons:[{title:'三'}]});
  // The student hand-edits route 甲 and deletes one of its block markers.
  const current=await io.read(broken.path);
  const lines=current.content.split('\n');
  lines.splice(lines.findIndex(line=>/notara:route[^\n]*end|\/notara:route/.test(line)),1);
  await io.save(broken.path,lines.join('\n'),current.revision);
  const listed=await service.routes({});
  assert.deepEqual(listed.nodes.map(node=>node.title),['三']);
  const bad=listed.routes.find(route=>route.path===broken.path);
  assert.ok(bad?.error,JSON.stringify(listed.routes));
  assert.equal(listed.routes.find(route=>route.title==='路线乙')?.error,undefined);
});
