import { Service } from '@deepseek-ai/cordis';
import { createHash,randomUUID } from 'node:crypto';
import { isAbsolute,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentVaultIO,createEditorVaultIO,vaultScopes,sourceRef } from './agent-io.js';
import { serializeFrontmatter } from './frontmatter.js';
import { safeRelativePath } from './vault.js';
import { lessonLog,parseLessonSummaries,upsertLessonSummary,parseRoute,renderRoute } from './lesson-data.js';
import { TEACHING_PRESET,teachingManifest,teachingResource,teachingResourcePath,currentTeachingBody } from './teaching-catalog.js';
import { readTeachingSettings,updateTeachingSettings,validateTeachingPatch,bindTeachingLesson,appendTeachingEvent,teachingCutoff,LESSON_EVENT,SUMMARY_EVENT } from './teaching-state.js';
import { installAgentTools } from './agent-tools.js';
import { teacherPersona } from './persona.js';
import { assembleTeachingContext } from './teaching-context.js';
import { installSolver } from './solver-runtime.js';
import { createReviewRuntime } from './review-runtime.js';
import { createRouteInVault, safeTitlePath as titlePath } from './file-operations.js';
import { createBoardRuntime,readBoardDocument,boardPath } from './board-runtime.js';

const fail=code=>{throw new Error(code);};
const summaryTitle=session=>session.snapshotEvents().filter(e=>e.type==='session/title').at(-1)?.data?.title??'课堂小结';
const summaryRecords=session=>session.snapshotEvents().filter(event=>event.type===SUMMARY_EVENT&&event.seq>=(session.inheritedEventCount??0));
function pendingInputs(session) {
  const queues={'next-step':[],'next-turn':[]};
  for(const event of session.snapshotEvents()) if(event.type==='agent/inbox/spliced'){
    const d=event.data;if(queues[d.target]) queues[d.target].splice(d.start,d.removedCount??0,...d.inserted);
  }
  return queues['next-step'].length+queues['next-turn'].length;
}
function stableSessionId(workspace,route,node) {
  const h=createHash('sha256').update(`${workspace}\0${route}\0${node}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

/** 两种收课请求共用一份小结要求，避免正文各写一版后漂移。 */
const SUMMARY_BODY='保留实际进度、探索经历、得到的帮助和下次从哪里继续（小结正文包含 `## 下次从这里继续`）。保留有证据的理解演变：早先不完备或错误的理解、促成变化的问题或提示、后来实际表现及未解决处；引用相关卡片，不只留下最终正确答案，不补编缺失过程。同时简要反思本次教学判断和引导是否与学生实际表现一致；有依据的改进并入本小结，未验证的保留为下次观察点，无新发现不强凑。';
/** 「总结本课」是学生可见的收课请求：只说明保存小结并保留会话，不写工具名或参数。 */
const SUMMARY_REQUEST=`请总结这次课堂，保存本课小结，保留原会话在列表里以便继续。${SUMMARY_BODY}`;
/** 原生会话菜单的归档入口：明确要求收起会话；小结先落盘，归档失败仍可原地重试。 */
const ARCHIVE_SUMMARY_REQUEST=`请总结并归档这次课堂：保存小结后把会话从列表收起。${SUMMARY_BODY}`;

export class NotaraTeaching extends Service {
  constructor(ctx,{root=process.cwd()}={},internals={}) {
    super(ctx,'notaraTeaching');this.root=resolve(root);this.internals=internals;this.prepared=new WeakMap();this.requests=new Map();this.routeLocks=new Map();this.summaryLocks=new Map();this.operations=new Map();
    this.nativeArchive=internals.archive??(ctx.get('workspaceRegistry')?.archiveSession.bind(ctx.workspaceRegistry));
    this.review=createReviewRuntime(this);
    this.lessonBoard=createBoardRuntime(this);
  }
  isTeaching(agent) {return agent?.session?.header?.agentPreset===TEACHING_PRESET;}
  async board(input) {return this.lessonBoard.read(input);}
  async mutateBoard(input) {return this.lessonBoard.mutate(input);}
  async classroom(input) {return this.solver.read(input);}
  async solverTask(input) {return this.solver.task(input);}
  async configureSolver(input) {return this.solver.configure(input);}
  async cancelSolver(input) {return this.solver.cancel(input);}
  async calendar(input) {return this.review.calendar(input);}
  async reviewQueue(input) {return this.review.queue(input);}
  async reviewDetail(input) {return this.review.detail(input);}
  async recordReview(input) {return this.review.record(input);}
  async undoReview(input) {return this.review.undo(input);}
  async dailyNote(input) {return this.review.dailyNote(input);}
  async scheduleLesson(input) {return this.review.schedule(input);}
  async agentFor(id) {
    if(typeof id!=='string'||!id) fail('teaching_session_required');
    const result=this.internals.resolveAgent?await this.internals.resolveAgent(id):await this.ctx.sessionController.resolveAgent(id);
    if(result?.error) fail('teaching_session_unavailable');
    const agent=result.agent??result;
    if(!this.isTeaching(agent)) fail('teaching_session_required');
    return agent;
  }
  async flush(session) {if(this.internals.flush) await this.internals.flush(session);else await this.ctx.sessions.flush(session);}
  editor() {return createEditorVaultIO(this.ctx,this.root);}
  async editorFor(input={}) {
    const root=input.sessionId?(await this.ctx.sessionController.inspect(input.sessionId)).meta.cwd:this.root;
    const workspace=this.ctx.get('workspaceRegistry')?.list().find(row=>resolve(row.path)===resolve(root??''));
    if(!workspace) fail('vault_scope_unavailable');
    return createEditorVaultIO(this.ctx,workspace.path);
  }
  async settings({sessionId}) {return readTeachingSettings((await this.agentFor(sessionId)).session);}
  async updateSettings({sessionId,expectedRevision,patch}) {
    const agent=await this.agentFor(sessionId),result=updateTeachingSettings(agent.session,patch,expectedRevision);
    await this.flush(agent.session);return result;
  }
  scriptSnapshot(document) {
    return {title:document.title,path:document.path,revision:document.revision,ref:document.ref};
  }
  async bindScript(exec,path,expectedRevision) {
    const settings=readTeachingSettings(exec.agent.session);
    let script=null,workspace=null;
    if(path!==null){
      if(typeof path!=='string'||!path.trim())fail('vault_path_invalid');
      workspace=vaultScopes(this.ctx,exec)[0];
      if(isAbsolute(path)){
        workspace=vaultScopes(this.ctx,exec,'all').find(row=>{
          const rel=relative(resolve(row.path,'vault'),path);
          return rel&&!rel.startsWith('..')&&!isAbsolute(rel);
        });
        if(!workspace)fail('vault_scope_unavailable');
        path=relative(resolve(workspace.path,'vault'),path);
      }else if(path.startsWith('vault/'))path=path.slice(6);
      script=await createAgentVaultIO(this.ctx,exec,{scope:workspace.id}).read(safeRelativePath(path));
      if(script.type!=='lesson')fail('lesson_script_required');
    }
    if(expectedRevision!==undefined&&readTeachingSettings(exec.agent.session).revision!==expectedRevision)fail('teaching_settings_conflict');
    return bindTeachingLesson(exec.agent.session,{...settings,scriptPath:script?.path??null,scriptRevision:script?.revision??null,scriptWorkspaceId:workspace?.id??null,scriptSnapshot:script?this.scriptSnapshot(script):null});
  }
  async lessonLog(args={}) {
    const io=await this.editorFor(args),scan=await io.scan(),result=lessonLog(scan.documents,args);
    return {...result,hits:result.hits.map(hit=>({...hit,ref:sourceRef(io.workspace.id,hit.path,hit.revision,{anchor:hit.anchor})}))};
  }
  async saveSummary(exec,args) {
    const key=exec.agent.session.id,previous=this.summaryLocks.get(key)??Promise.resolve();
    const work=previous.catch(()=>{}).then(()=>this.writeSummary(exec,args));
    this.summaryLocks.set(key,work);
    try{return await work;}finally{this.requests.delete(key);if(this.summaryLocks.get(key)===work)this.summaryLocks.delete(key);}
  }
  prepareTool(exec) {
    if(exec.name!=='save_lesson_summary'||!this.isTeaching(exec.agent)||!exec.callId)return;
    const key=`${exec.agent.session.id}:${exec.callId}`;
    if(!this.operations.has(key))this.operations.set(key,{cutoff:teachingCutoff(exec.agent.session),settings:readTeachingSettings(exec.agent.session)});
  }
  async archiveSaved(session,result) {
    await this.solver?.cancelAll(session);
    if(teachingCutoff(session).cutoff!==result.cutoff||pendingInputs(session)) return {...result,archived:false,archivePending:true,reason:'课堂有新的输入，小结已保存，本次尚未归档。'};
    try {
      if(!this.nativeArchive) fail('lesson_archive_unavailable');
      await this.nativeArchive(session.id);return {...result,archived:true};
    }catch{return {...result,archived:false,archivePending:true,reason:'小结已保存，归档未完成，可以重试。'};}
  }
  async writeSummary(exec,args) {
    if(typeof args.body!=='string'||!args.body.trim()) fail('lesson_summary_body_required');
    const session=exec.agent.session,operation=this.operations.get(`${session.id}:${exec.callId}`),settings=operation?.settings??readTeachingSettings(session),cutoff=operation?.cutoff??this.prepared.get(exec.agent)?.cutoff??teachingCutoff(session);
    if(operation&&settings.revision!==readTeachingSettings(session).revision)fail('teaching_settings_conflict');
    const records=summaryRecords(session),prior=records.at(-1)?.data,operationId=exec.callId;
    const currentWorkspace=vaultScopes(this.ctx,exec)[0];
    // Once saved, this class owns one summary block at one file location.
    // Changing the lesson background never retargets it to a namesake in another set.
    const scope=prior?.workspaceId??settings.scriptWorkspaceId??currentWorkspace.id;
    let path=prior?.path??settings.scriptPath??`lesson_log/${titlePath(summaryTitle(session))}-${createHash('sha256').update(session.id).digest('hex').slice(0,12)}.md`;
    const scriptTarget=prior?.script??Boolean(settings.scriptPath);
    const boundWrite={workspaceId:scope,path};
    const io=createAgentVaultIO(this.ctx,exec,{writeApproved:true,scope,boundWrite});
    let document=null;
    try {document=await io.read(path);}catch(error){
      if(error.message!=='vault_file_not_found')throw error;
      const matches=(await io.scan()).documents.filter(doc=>{try{return parseLessonSummaries(doc).some(row=>row.sessionId===session.id&&row.learningSetRef===currentWorkspace.id);}catch{return false;}});
      if(matches.length>1)fail('lesson_summary_duplicate_block');
      if(matches.length){document=matches[0];path=document.path;boundWrite.path=path;}
      else if(scriptTarget)throw error;
    }
    if(scriptTarget&&document.type!=='lesson') fail('lesson_script_required');
    const existing=document?parseLessonSummaries(document).find(row=>row.sessionId===session.id):null;
    const replay=operationId&&records.some(event=>event.data.operationId===operationId);
    const stale=prior&&Number(prior.cutoff)>Number(cutoff.cutoff);
    if(replay||stale){
      if(!existing) fail('lesson_summary_index_failed');
      const result={path,anchor:existing.anchor,title:existing.title,revision:document.revision,ref:sourceRef(io.workspace.id,path,document.revision,{anchor:existing.anchor}),saved:true,archived:false,cutoff:existing.cutoff,replayed:true};
      return args.archive?this.archiveSaved(session,result):result;
    }
    const original=document?.content??serializeFrontmatter({type:'lesson-summary',title:summaryTitle(session)});
    const summary={sessionId:session.id,learningSetRef:currentWorkspace.id,subjects:settings.subjects,...cutoff,savedAt:new Date().toISOString(),routePath:settings.routePath,nodeId:settings.nodeId,title:summaryTitle(session),body:args.body};
    const content=upsertLessonSummary(original,summary);
    const saved=content===original?document:await io.save(path,content,document?.revision??null);
    const hit=parseLessonSummaries(saved).find(row=>row.sessionId===session.id);
    if(!hit) fail('lesson_summary_index_failed');
    const result={path,anchor:hit.anchor,title:hit.title,revision:saved.revision,ref:sourceRef(io.workspace.id,path,saved.revision,{anchor:hit.anchor}),saved:true,archived:false,cutoff:cutoff.cutoff};
    appendTeachingEvent(session,SUMMARY_EVENT,{path,workspaceId:io.workspace.id,script:scriptTarget,anchor:hit.anchor,revision:saved.revision,cutoff:cutoff.cutoff,...(operationId?{operationId}:{})});await this.flush(session);
    return args.archive?this.archiveSaved(session,result):result;
  }
  async routes(args={},exec) {
    const io=exec?createAgentVaultIO(this.ctx,exec):await this.editorFor(args),scan=await io.scan(),routes=[],nodes=[],edges=[];
    const summaries=scan.documents.flatMap(doc=>{try{return parseLessonSummaries(doc);}catch{return [];}});
    for(const document of scan.documents.filter(doc=>doc.type==='route')){
      const route=parseRoute(document);routes.push({path:document.path,title:route.title,revision:document.revision,ref:document.ref,overview:route.overview??''});
      for(const node of route.nodes){
        const summary=summaries.find(hit=>hit.sessionId===node.sessionId);
        nodes.push({...node,routePath:document.path,routeRevision:document.revision,parent:node.parent??null,scriptPath:node.scriptPath||null,sessionId:node.sessionId||null,summary:summary?{path:summary.path,anchor:summary.anchor,title:summary.title,continuation:summary.continuation}:null});
      }
      edges.push(...route.edges.map(edge=>({...edge,routePath:document.path})));
    }
    return {routes,nodes,edges};
  }
  async routeContext(exec,settings) {
    if(!settings.routePath||!settings.nodeId)return null;
    try{
      const document=await createAgentVaultIO(this.ctx,exec).read(settings.routePath),route=parseRoute(document);
      const node=route.nodes.find(item=>item.id===settings.nodeId);
      if(!node)return {path:document.path,error:'lesson_route_node_missing'};
      const brief=node.brief??'',withinBudget=Array.from(brief).length<=6000;
      return {path:document.path,title:route.title,revision:document.revision,ref:document.ref,
        node:{id:node.id,title:node.title,stage:node.stage??'',pathway:node.pathway??'main',
          prerequisites:(node.prerequisites??[]).map(id=>({id,title:route.nodes.find(item=>item.id===id)?.title??id}))},
        ...(withinBudget?{brief}:{readWith:'用原生 Bash 中的 rg/grep 定位该 node id 的路线正文块，再用 sed 按行读取；未读部分不推测。'}),
        briefRead:withinBudget,briefAvailable:!!brief,
        instruction:'这是当前课程规划，不是掌握记录；仅注入当前节点。按实际表现决定继续或补练，有小结不等于通过检查。'};
    }catch(error){
      if(exec.signal?.aborted)throw error;
      return {path:settings.routePath,error:/^[a-z][a-z0-9_]*$/.test(error.message??'')?error.message:'lesson_route_unavailable'};
    }
  }
  async createRoute(args) {
    return createRouteInVault(await this.editorFor(args),args);
  }
  async openRouteLesson({path,nodeId,expectedRevision,sessionId:callerSessionId,repeat=false},exec) {
    const io=exec?createAgentVaultIO(this.ctx,exec,{writeApproved:true}):await this.editorFor({sessionId:callerSessionId}),key=`${io.workspace.id}:${path}:${nodeId}`;
    const previous=this.routeLocks.get(key)??Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{
      const doc=await io.read(path,expectedRevision),route=parseRoute(doc);let node=route.nodes.find(item=>item.id===nodeId);
      if(!node) fail('lesson_route_node_missing');
      if(repeat){node={...node,id:randomUUID(),sessionId:undefined,parent:node.id};route.nodes.push(node);}
      const sessionId=node.sessionId||stableSessionId(io.workspace.id,path,nodeId);
      const created=await this.ctx.sessionController.create({sessionId:repeat?stableSessionId(io.workspace.id,path,node.id):sessionId,workspaceId:io.workspace.id,agentPreset:TEACHING_PRESET});
      const agent=await this.agentFor(created.sessionId);
      if(!agent.session.snapshotEvents().some(event=>event.type===LESSON_EVENT)){
        let continuation=null;
        const predecessor=route.nodes.find(item=>item.id===node.parent);
        if(predecessor?.sessionId){
          const hit=(await io.scan()).documents.flatMap(doc=>{try{return parseLessonSummaries(doc);}catch{return [];}}).find(item=>item.sessionId===predecessor.sessionId);
          if(hit) continuation={ref:sourceRef(io.workspace.id,hit.path,hit.revision,{anchor:hit.anchor}),text:hit.continuation,title:hit.title};
        }
        const script=node.scriptPath?await io.read(node.scriptPath):null;
        if(script&&script.type!=='lesson') fail('lesson_script_required');
        const materials=[];
        for(const path of node.materials??[]){const source=path.toLowerCase().endsWith('.md')?await io.read(path):await io.readAsset(path);materials.push({path:source.path,title:source.title,revision:source.revision,ref:source.ref});}
        bindTeachingLesson(agent.session,{scriptPath:node.scriptPath||null,scriptRevision:script?.revision??null,scriptWorkspaceId:script?io.workspace.id:null,scriptSnapshot:script?this.scriptSnapshot(script):null,routePath:path,nodeId:node.id,continuation,materials});
        const subjects=script?.frontmatter?.subjects??doc.frontmatter?.subjects;
        if(Array.isArray(subjects)&&subjects.length) updateTeachingSettings(agent.session,{subjects},readTeachingSettings(agent.session).revision);
        await this.ctx.sessionController.rename({sessionId:created.sessionId,title:node.title});await this.flush(agent.session);
      }
      if(!node.sessionId){node.sessionId=created.sessionId;await io.save(path,renderRoute({title:route.title,nodes:route.nodes},doc.content),doc.revision);}
      return {sessionId:created.sessionId};
    });
    this.routeLocks.set(key,work);try{return await work;}finally{if(this.routeLocks.get(key)===work)this.routeLocks.delete(key);}
  }
  /** 原生会话菜单的归档入口：只有它替学生明确要求收起会话。 */
  async archiveFromNativeEntry(sessionId) {
    return await this.requestSummary({sessionId,archive:true});
  }
  async requestSummary({sessionId,archive=false}) {
    const agent=await this.agentFor(sessionId);
    if(this.requests.has(sessionId)) return {queued:true};
    // A saved summary is reused while the class has not moved on. Only the
    // explicit native archive request hides the session; the lesson-level
    // summary keeps the class open, so a repeat only reports what is saved.
    const prior=summaryRecords(agent.session).at(-1)?.data;
    if(prior&&prior.cutoff===teachingCutoff(agent.session).cutoff&&!pendingInputs(agent.session)) {
      const io=createAgentVaultIO(this.ctx,{agent,signal:new AbortController().signal},{scope:prior.workspaceId??'current'});
      let doc=null,hit=null;
      try{doc=await io.read(prior.path);hit=parseLessonSummaries(doc).find(row=>row.sessionId===sessionId);}catch{}
      if(hit){
        const saved={...prior,revision:doc.revision,saved:true,archived:false,replayed:true};
        if(!archive) return saved;
        // A failed archive retries only the already verified save.
        const result=await this.archiveSaved(agent.session,saved);
        if(!result.archived) fail('lesson_archive_failed');
        return result;
      }
    }
    const requestId=randomUUID();this.requests.set(sessionId,requestId);
    try{await this.ctx.sessionController.prompt({sessionId,requestId,mode:'queue',content:[{type:'text',text:archive?ARCHIVE_SUMMARY_REQUEST:SUMMARY_REQUEST}]},new AbortController().signal);}
    catch(error){this.requests.delete(sessionId);throw error;}
    return {queued:true};
  }
  async executeTool(name,args,exec) {
    if(name==='write_lesson_board')return this.lessonBoard.write(exec,args);
    if(name==='save_lesson_summary')return this.saveSummary(exec,args);
    if(name==='open_learning_lesson'){
      const path=safeRelativePath(args.path?.startsWith('vault/')?args.path.slice(6):args.path);
      const doc=await createAgentVaultIO(this.ctx,exec).read(path);
      return this.openRouteLesson({path,nodeId:args.nodeId,expectedRevision:doc.revision,repeat:args.repeat??false},exec);
    }
    if(name==='set_teaching_settings'){
      const {scriptPath,...patch}=args,current=readTeachingSettings(exec.agent.session);
      validateTeachingPatch(patch);
      // Settings and script share one revision; stale model requests never overwrite a newer UI change.
      const expected=this.prepared.get(exec.agent)?.revision??current.revision;
      if(expected!==current.revision) fail('teaching_settings_conflict');
      if(scriptPath!==undefined) await this.bindScript(exec,scriptPath,expected);
      updateTeachingSettings(exec.agent.session,patch,expected);
      await this.flush(exec.agent.session);return readTeachingSettings(exec.agent.session);
    }
    fail('teaching_tool_unknown');
  }
}

export function installTeachingRuntime(ctx,config={}) {
  const service=new NotaraTeaching(ctx,config);
  installAgentTools(ctx,service);
  ctx.inject(['shellEnv'],scope=>scope.effect(()=>scope.shellEnv.register({
    name:'notara-vault-cli',
    variables:{
      DSH_NOTARA_NODE:{description:'Node executable for the bundled Notara helper.'},
      DSH_NOTARA_CLI:{description:'Bundled helper entry; invoke help for progressive command disclosure.'},
      DSH_NOTARA_WORKSPACE:{description:'Current registered classroom workspace root.'},
      DSH_NOTARA_WORKSPACE_ID:{description:'Current registered workspace identity, provided by Host.'},
      DSH_NOTARA_CALL_ID:{description:'Current native shell call identity, provided by Host.'},
      DSH_NOTARA_LESSON:{description:'Bound lesson location and revision, provided by Host; do not construct or override.'},
      DSH_NOTARA_TEACHING:{description:'Installed teaching resource directory; optional examples can be read here, never treated as learner records.'},
    },
    resolve(exec){
      if(!service.isTeaching(exec.agent)||exec.agent.session.header.origin==='subagent')return {};
      const workspace=vaultScopes(ctx,exec)[0];
      const settings=readTeachingSettings(exec.agent.session);
      const bound=settings.scriptPath?vaultScopes(ctx,exec,'all').find(item=>item.id===(settings.scriptWorkspaceId??workspace.id)):null;
      const lesson=bound?JSON.stringify({workspacePath:bound.path,workspaceId:bound.id,path:settings.scriptPath,revision:settings.scriptRevision}):'';
      return {DSH_NOTARA_NODE:process.execPath,DSH_NOTARA_CLI:fileURLToPath(new URL('./vault-cli.js',import.meta.url)),DSH_NOTARA_WORKSPACE:workspace.path,DSH_NOTARA_WORKSPACE_ID:workspace.id,DSH_NOTARA_CALL_ID:exec.callId??'',DSH_NOTARA_LESSON:lesson,DSH_NOTARA_TEACHING:teachingResourcePath('.')};
    },
  })));

  service.solver=installSolver(ctx,service);
  ctx.effect(()=>ctx.systemPrompt.section({name:'notara:teaching',order:20000,text:({agent})=>{
    if(!service.isTeaching(agent)) return '';
    // The fixed solver owns its own prompt and receives only supplied material.
    if(agent.session.header.origin==='subagent') return '';
    const settings=readTeachingSettings(agent.session);
    return teacherPersona(settings,teachingResource('persona.md'))+'\n\n'+teachingResource('base.md')+'\n\n'+currentTeachingBody(settings.teachingRef);
  }}));
  ctx.on('system-prompt/assemble',async(assembly,context,next)=>{
    const result=await next(),agent=context.agent;
    if(!service.isTeaching(agent)||agent.session.header.origin==='subagent') return result;
    const settings=readTeachingSettings(agent.session);
    service.prepared.set(agent,{revision:settings.revision,cutoff:teachingCutoff(agent.session)});
    let memory;
    try{
      const exec={agent,signal:context.signal},io=createAgentVaultIO(ctx,exec),readers=[{scope:io.workspace,read:io.read}];
      // Explicitly bound cross-set scripts retain their scope. Never substitute
      // a same-named file from the current learning set.
      if(settings.scriptWorkspaceId&&settings.scriptWorkspaceId!==io.workspace.id){
        try{const bound=createAgentVaultIO(ctx,exec,{scope:settings.scriptWorkspaceId});readers.push({scope:bound.workspace,read:bound.read});}
        catch(error){if(error.message!=='vault_scope_unavailable')throw error;}
      }
      memory=await assembleTeachingContext({readers,settings:{...settings,learningGoal:null,temporaryInstructions:''}});
      const board=await readBoardDocument(io,agent.session.id);
      service.prepared.get(agent).boardRevision=board.revision;
      // Semantic titles let the teacher target a region without inventing IDs or coordinates.
      memory.text+='\n\n当前板书区域：'+JSON.stringify(board.board.blocks.map(({title,kind})=>({title,kind})))+'。同名写入会替换该区域全文；只写已向学生公开的内容。需核对已有正文时读取 '+resolve(io.workspace.path,'vault',boardPath(agent.session.id))+'。';
    }
    catch(error){if(!['vault_scope_unavailable','vault_session_required'].includes(error.message))throw error;memory={text:'当前课堂尚未连接学习集，可以继续讨论题目；资料和学习记录需要先通过原生工作区入口接入，不能推测已有记录。'};}
    // Bindings and navigation are separate from the L0 memory budget. No script
    // body (including legacy snapshots) is injected before a stage is read.
    const bound=settings.scriptPath?ctx.get('workspaceRegistry')?.list().find(item=>item.id===settings.scriptWorkspaceId):null;
    const readPath=bound?resolve(bound.path,'vault',settings.scriptPath):settings.scriptWorkspaceId?null:settings.scriptPath;
    const course=await service.routeContext({agent,signal:context.signal},settings);
    const background={learningGoal:settings.learningGoal,temporaryInstructions:settings.temporaryInstructions,subjects:settings.subjects,course,script:settings.scriptPath?{...memory.script,path:settings.scriptPath,readPath,workspaceId:settings.scriptWorkspaceId,boundRevision:settings.scriptRevision,bodyRead:false}:null,previousLesson:settings.continuation,materials:settings.materials};
    return {...result,contexts:[...result.contexts,{name:'notara:learning-context',text:memory.text},{name:'notara:lesson-background',text:JSON.stringify(background)}]};
  });
  ctx.on('session/event',(session,event)=>{if(event.type==='turn/end'){service.requests.delete(session.id);for(const key of service.operations.keys())if(key.startsWith(session.id+':'))service.operations.delete(key);}});
  const registry=ctx.get('workspaceRegistry');
  if(registry&&service.nativeArchive){
    const original=registry.archiveSession;
    const wrapped=async sessionId=>{const snapshot=await ctx.sessionController.inspect(sessionId);if(snapshot.meta.agentPreset===TEACHING_PRESET){await service.archiveFromNativeEntry(sessionId);return;}return original.call(registry,sessionId);};
    registry.archiveSession=wrapped;
    ctx.effect(()=>()=>{if(registry.archiveSession===wrapped)registry.archiveSession=original;});
  }
  return service;
}
