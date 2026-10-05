import { pluginEventType } from './plugin-events.js';
import {createBoardReferences} from './board-references.js';
import { Service } from '@deepseek-ai/cordis';
import { createHash,randomUUID } from 'node:crypto';
import { isAbsolute,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentVaultIO,createEditorVaultIO,vaultScopes,sourceRef } from './agent-io.js';
import { serializeFrontmatter } from './frontmatter.js';
import { safeRelativePath, resolveVaultRoot } from './vault.js';
import { lessonLog,parseLessonSummaries,upsertLessonSummary,parseRoute,renderRoute } from './lesson-data.js';
import { scriptBodyRevision } from './script-binding.js';
import { TEACHING_PRESET,teachingManifest,teachingResource,teachingResourcePath,currentTeachingBody } from './teaching-catalog.js';
import { readTeachingSettings,updateTeachingSettings,validateTeachingPatch,bindTeachingLesson,appendTeachingEvent,teachingCutoff,LESSON_EVENT,SUMMARY_EVENT } from './teaching-state.js';
import { installAgentTools } from './agent-tools.js';
import { teacherPersona } from './persona.js';
import { assembleTeachingContext } from './teaching-context.js';
import { installSolver } from './solver-runtime.js';
import { createReviewRuntime } from './review-runtime.js';
import { createRouteInVault, safeTitlePath as titlePath } from './file-operations.js';
import { createBoardRuntime,readBoardDocument,boardPath,boardBodyView } from './board-runtime.js';
import { boardOverview } from './board-data.js';
import { installBoardForks } from './board-fork.js';
import { packagedRipgrep } from './ripgrep-path.js';
import { createPomodoroRuntime } from './pomodoro-runtime.js';
import { createUserSkillRuntime } from './user-skill-runtime.js';
import { activeUserSkills,learningSetOverview } from './user-skills.js';
import { learnerProfileContext } from './profile-context.js';

/** A path as the teacher's shell should see it. Git Bash, node and rg on
 * Windows all accept C:/... , while a backslash path breaks prefix stripping
 * and becomes C:\c\... once bash turns /c/... back into a Windows path. */
export const shellPath=(value,platform=process.platform)=>platform==='win32'?String(value).replace(/\\/g,'/'):value;

/** DSH_NOTARA_LESSON: the bound script the local commands may read, and the
 * revisions the lesson was bound at. */
export function lessonPinText(workspace,settings){
  return JSON.stringify({workspacePath:shellPath(workspace.path),workspaceId:workspace.id,path:settings.scriptPath,revision:settings.scriptRevision,...(settings.scriptBodyRevision?{bodyRevision:settings.scriptBodyRevision}:{})});
}

/** Built-in subject skills and the subject names they cover (the manifest is the one source). */
const BUILTIN_SUBJECT_SKILLS=teachingManifest.skills.filter(item=>Array.isArray(item.subjects)&&!item.prep).map(item=>({name:`notara-${item.id}`,subjects:item.subjects}));

const fail=code=>{throw new Error(code);};
/** One root for the Bash environment and the per-turn context. */
function materialRoot(workspacePath){
  const root=resolveVaultRoot(workspacePath);
  return {path:root,prefix:resolve(root)===resolve(workspacePath)?'':'vault/'};
}
const summaryTitle=session=>session.snapshotEvents().filter(e=>e.type==='session/title').at(-1)?.data?.title??'课堂小结';
const summaryRecords=session=>session.snapshotEvents().filter(event=>pluginEventType(event.type)===SUMMARY_EVENT&&event.seq>=(session.inheritedEventCount??0));
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

export class NotaraTeaching extends Service {
  constructor(ctx,{root=process.cwd()}={},internals={}) {
    super(ctx,'notaraTeaching');this.root=resolve(root);this.internals=internals;this.prepared=new WeakMap();this.requests=new Map();this.routeLocks=new Map();this.summaryLocks=new Map();this.operations=new Map();
    this.nativeArchive=internals.archive??(ctx.get('workspaceRegistry')?.archiveSession.bind(ctx.workspaceRegistry));
    // Session id → the summary cutoff its deferred archive was scheduled against.
    this.archiveAfterTurn=new Map();
    this.review=createReviewRuntime(this);
    this.lessonBoard=createBoardRuntime(this);
    this.boardReferences=createBoardReferences({read:input=>this.lessonBoard.content(input),bind:(references,scope)=>this.lessonBoard.bindSelection(references,scope)});
    this.pomodoroTimer=createPomodoroRuntime(this,internals.pomodoro);
    this.userSkillStore=createUserSkillRuntime(this,internals.userSkills);
    ctx.effect(()=>()=>this.pomodoroTimer.dispose());
  }
  isTeaching(agent) {return agent?.session?.header?.agentPreset===TEACHING_PRESET;}
  async board(input) {return this.lessonBoard.read(input);}
  async commitBoard(input) {return this.lessonBoard.commit(input);}
  async contentBoard(input) {return this.lessonBoard.content(input);}
  async boardReference(input) {return this.boardReferences.issue(input);}
  async pomodoro(input) {return this.pomodoroTimer.status(input);}
  async startPomodoro(input) {return this.pomodoroTimer.start(input);}
  async stopPomodoro(input) {return this.pomodoroTimer.stop(input);}
  async userSkills() {return this.userSkillStore.list();}
  async setUserSkillStatus(input) {return this.userSkillStore.setStatus(input);}
  async resolveUserSkillRevision(input) {return this.userSkillStore.resolveRevision(input);}
  async inheritUserSkill(input) {return this.userSkillStore.inherit(input);}
  async createLearningSetOverview(input) {return this.userSkillStore.createOverview(input);}
  async mutateBoard(input) {return this.lessonBoard.mutate(input);}
  async answerBoard(input) {return this.lessonBoard.answer(input);}
  async resendBoardAnswer(input) {return this.lessonBoard.resendAnswer(input);}
  async mutateBoardInteraction(input) {return this.lessonBoard.mutateInteraction(input);}
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
          const rel=relative(resolveVaultRoot(row.path),path);
          return rel&&!rel.startsWith('..')&&!isAbsolute(rel);
        });
        if(!workspace)fail('vault_scope_unavailable');
        path=relative(resolveVaultRoot(workspace.path),path).replaceAll('\\','/');
      }else if(path.startsWith('vault/'))path=path.slice(6);
      script=await createAgentVaultIO(this.ctx,exec,{scope:workspace.id}).read(safeRelativePath(path));
      if(script.type!=='lesson')fail('lesson_script_required');
    }
    if(expectedRevision!==undefined&&readTeachingSettings(exec.agent.session).revision!==expectedRevision)fail('teaching_settings_conflict');
    return bindTeachingLesson(exec.agent.session,{...settings,scriptPath:script?.path??null,scriptRevision:script?.revision??null,scriptBodyRevision:script?scriptBodyRevision(script.content):null,scriptWorkspaceId:workspace?.id??null,scriptSnapshot:script?this.scriptSnapshot(script):null});
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
  async archiveSaved(session,result,{afterTurn=false}={}) {
    await this.solver?.cancelAll(session);
    if(teachingCutoff(session).cutoff!==result.cutoff||pendingInputs(session)) return {...result,archived:false,archivePending:true,reason:'课堂有新的输入，小结已保存，本次尚未归档。'};
    // DSH 0.2.0 refuses to archive a session while its turn runs. The teacher's
    // own summary call is inside that turn, so the archive waits for turn/end.
    if(afterTurn&&this.nativeArchive){this.archiveAfterTurn.set(session.id,result.cutoff);return {...result,archived:false,archiveScheduled:true,reason:'小结已保存，这一轮结束后收起课堂。'};}
    try {
      if(!this.nativeArchive) fail('lesson_archive_unavailable');
      await this.nativeArchive(session.id);return {...result,archived:true};
    }catch{return {...result,archived:false,archivePending:true,reason:'小结已保存，归档未完成，可以重试。'};}
  }
  /** Archive once the turn that asked for it has let go of the session. Each attempt
   * first holds the same rule as archiveSaved: a student message after the summary,
   * or input still queued, keeps the lesson open instead of archiving it later. */
  archiveWhenIdle(session,cutoff,attempt=0) {
    setTimeout(()=>{
      if(teachingCutoff(session).cutoff!==cutoff||pendingInputs(session))return;
      Promise.resolve(this.nativeArchive(session.id)).catch(()=>{if(attempt<40)this.archiveWhenIdle(session,cutoff,attempt+1);});
    },attempt?250:0);
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
      return args.archive?this.archiveSaved(session,result,{afterTurn:true}):result;
    }
    const original=document?.content??serializeFrontmatter({type:'lesson-summary',title:summaryTitle(session)});
    const summary={sessionId:session.id,learningSetRef:currentWorkspace.id,subjects:settings.subjects,...cutoff,savedAt:new Date().toISOString(),routePath:settings.routePath,nodeId:settings.nodeId,title:summaryTitle(session),body:args.body};
    const content=upsertLessonSummary(original,summary);
    const saved=content===original?document:await io.save(path,content,document?.revision??null);
    const hit=parseLessonSummaries(saved).find(row=>row.sessionId===session.id);
    if(!hit) fail('lesson_summary_index_failed');
    const result={path,anchor:hit.anchor,title:hit.title,revision:saved.revision,ref:sourceRef(io.workspace.id,path,saved.revision,{anchor:hit.anchor}),saved:true,archived:false,cutoff:cutoff.cutoff};
    appendTeachingEvent(session,SUMMARY_EVENT,{path,workspaceId:io.workspace.id,script:scriptTarget,anchor:hit.anchor,revision:saved.revision,cutoff:cutoff.cutoff,...(operationId?{operationId}:{})});await this.flush(session);
    return args.archive?this.archiveSaved(session,result,{afterTurn:true}):result;
  }
  async routes(args={},exec) {
    const io=exec?createAgentVaultIO(this.ctx,exec):await this.editorFor(args),scan=await io.scan(),routes=[],nodes=[],edges=[];
    const summaries=scan.documents.flatMap(doc=>{try{return parseLessonSummaries(doc);}catch{return [];}});
    for(const document of scan.documents.filter(doc=>doc.type==='route')){
      // A route the planner cannot read (a hand edit broke its blocks) is listed
      // with its reason and no lessons; the other routes are unaffected.
      let route;
      try{route=parseRoute(document);}catch(error){routes.push({path:document.path,title:document.title,revision:document.revision,ref:document.ref,overview:'',error:error instanceof Error?error.message:'lesson_route_invalid'});continue;}
      routes.push({path:document.path,title:route.title,revision:document.revision,ref:document.ref,overview:route.overview??''});
      for(const node of route.nodes){
        const summary=summaries.find(hit=>hit.sessionId===node.sessionId);
        nodes.push({...node,routePath:document.path,routeRevision:document.revision,parent:node.parent??null,scriptPath:node.scriptPath||null,sessionId:node.sessionId||null,summary:summary?{path:summary.path,anchor:summary.anchor,title:summary.title,continuation:summary.continuation,savedAt:summary.savedAt||summary.throughAt||null}:null});
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
        ...(withinBudget?{brief}:{readWith:'用原生 Bash 中的 "$DSH_NOTARA_RG"（缺省时 grep）定位该 node id 的路线正文块，再用 sed 按行读取；未读部分不推测。'}),
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
  /** Bind one lesson session to a route node: its script, the predecessor's summary, materials and subjects. */
  async bindRouteNode(session,io,{path,doc,route,node,existing=null}) {
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
    // A lesson that already had a script bound keeps it when the node brings none.
    const kept=!script&&existing?.scriptPath?existing:null;
    bindTeachingLesson(session,{scriptPath:node.scriptPath||kept?.scriptPath||null,scriptRevision:script?.revision??kept?.scriptRevision??null,scriptBodyRevision:script?scriptBodyRevision(script.content):kept?.scriptBodyRevision??null,scriptWorkspaceId:script?io.workspace.id:kept?.scriptWorkspaceId??null,scriptSnapshot:script?this.scriptSnapshot(script):kept?.scriptSnapshot??null,routePath:path,nodeId:node.id,continuation,materials});
    const subjects=script?.frontmatter?.subjects??doc.frontmatter?.subjects;
    if(Array.isArray(subjects)&&subjects.length) updateTeachingSettings(session,{subjects},readTeachingSettings(session).revision);
  }
  /** Whether a lesson session has had the student in it: a real student message. */
  async hasStudentTurns(sessionId) {
    try{return (await this.agentFor(sessionId)).session.snapshotEvents().some(event=>event.type==='user/message'&&event.data?.source?.kind==='user');}
    catch{return false;}
  }
  /**
   * The teacher opens a route node from inside a lesson. The student stays in
   * this lesson, so this lesson becomes the node's classroom when it is not bound
   * yet and the node has no lesson the student has been in; otherwise nothing is
   * rebound and the result says why and what the teacher can do.
   */
  async openRouteLessonHere({path,nodeId,expectedRevision,repeat=false},exec) {
    // One lock per route file: writes to any of its nodes are serialized, so a
    // neighbour's write cannot fail this node's revision check half-way.
    const io=createAgentVaultIO(this.ctx,exec,{writeApproved:true}),session=exec.agent.session,key=`${io.workspace.id}:${path}`;
    const previous=this.routeLocks.get(key)??Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{
      const doc=await io.read(path,expectedRevision),route=parseRoute(doc);let node=route.nodes.find(item=>item.id===nodeId);
      if(!node) fail('lesson_route_node_missing');
      const current=readTeachingSettings(session);
      if(current.routePath&&current.nodeId){
        const own=route.nodes.find(item=>item.id===current.nodeId);
        if(current.routePath===path&&(current.nodeId===node.id||own?.parent===node.id)){
          // An earlier version could bind the lesson and then fail to write the
          // route; the node it is bound to gets this lesson back.
          if(own&&!own.sessionId){own.sessionId=session.id;await io.save(path,renderRoute({title:route.title,nodes:route.nodes},doc.content),doc.revision);}
          return {sessionId:session.id,bound:true,already:true};
        }
        return {sessionId:session.id,bound:false,reason:`这节课已经对应另一节${own?.title?`「${own.title}」`:''}，没有改绑定；要学这一节，请学生从计划页打开它。`};
      }
      if(repeat){node={...node,id:randomUUID(),sessionId:undefined,parent:node.id};route.nodes.push(node);}
      else if(node.sessionId&&node.sessionId!==session.id&&await this.hasStudentTurns(node.sessionId)){
        return {sessionId:node.sessionId,bound:false,reason:'这一节已经有上过课的课堂，当前课堂没有绑定。可以请学生从计划页进入那节课接着上；想在当前课堂再学一遍，用 repeat。'};
      }
      // The route first: if binding then fails, the node already names this
      // lesson and opening it again binds it; the other order left a bound
      // lesson the route did not know about.
      node.sessionId=session.id;
      await io.save(path,renderRoute({title:route.title,nodes:route.nodes},doc.content),doc.revision);
      await this.bindRouteNode(session,io,{path,doc,route,node,existing:current});
      await this.flush(session);
      return {sessionId:session.id,bound:true,...(repeat?{repeat:true}:{})};
    });
    this.routeLocks.set(key,work);try{return await work;}finally{if(this.routeLocks.get(key)===work)this.routeLocks.delete(key);}
  }
  async openRouteLesson({path,nodeId,expectedRevision,sessionId:callerSessionId,repeat=false},exec) {
    const io=exec?createAgentVaultIO(this.ctx,exec,{writeApproved:true}):await this.editorFor({sessionId:callerSessionId}),key=`${io.workspace.id}:${path}`;
    const previous=this.routeLocks.get(key)??Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{
      const doc=await io.read(path,expectedRevision),route=parseRoute(doc);let node=route.nodes.find(item=>item.id===nodeId);
      if(!node) fail('lesson_route_node_missing');
      if(repeat){node={...node,id:randomUUID(),sessionId:undefined,parent:node.id};route.nodes.push(node);}
      const sessionId=node.sessionId||stableSessionId(io.workspace.id,path,nodeId);
      const created=await this.ctx.sessionController.create({sessionId:repeat?stableSessionId(io.workspace.id,path,node.id):sessionId,workspaceId:io.workspace.id,agentPreset:TEACHING_PRESET});
      const agent=await this.agentFor(created.sessionId);
      if(!agent.session.snapshotEvents().some(event=>pluginEventType(event.type)===LESSON_EVENT)){
        await this.bindRouteNode(agent.session,io,{path,doc,route,node});
        await this.ctx.sessionController.rename({sessionId:created.sessionId,title:node.title});await this.flush(agent.session);
      }
      if(!node.sessionId){node.sessionId=created.sessionId;await io.save(path,renderRoute({title:route.title,nodes:route.nodes},doc.content),doc.revision);}
      return {sessionId:created.sessionId};
    });
    this.routeLocks.set(key,work);try{return await work;}finally{if(this.routeLocks.get(key)===work)this.routeLocks.delete(key);}
  }
  async requestSummary({sessionId}) {
    const agent=await this.agentFor(sessionId);
    if(this.requests.has(sessionId)) return {queued:true};
    // A saved summary is reused while the class has not moved on. This
    // lesson-level action keeps the session open; native archival is separate.
    const prior=summaryRecords(agent.session).at(-1)?.data;
    if(prior&&prior.cutoff===teachingCutoff(agent.session).cutoff&&!pendingInputs(agent.session)) {
      const io=createAgentVaultIO(this.ctx,{agent,signal:new AbortController().signal},{scope:prior.workspaceId??'current'});
      let doc=null,hit=null;
      try{doc=await io.read(prior.path);hit=parseLessonSummaries(doc).find(row=>row.sessionId===sessionId);}catch{}
      if(hit){
        return {...prior,revision:doc.revision,saved:true,archived:false,replayed:true};
      }
    }
    const requestId=randomUUID();this.requests.set(sessionId,requestId);
    try{await this.ctx.sessionController.prompt({sessionId,requestId,mode:'queue',content:[{type:'text',text:SUMMARY_REQUEST}]},new AbortController().signal);}
    catch(error){this.requests.delete(sessionId);throw error;}
    return {queued:true};
  }
  async executeTool(name,args,exec) {
    if(name==='write_lesson_board'){
      const {action='write',...input}=args,sessionId=exec.agent.session.id;
      const options={operationId:exec.callId,signal:exec.signal};
      if(action==='write')return this.lessonBoard.write(exec,input);
      if(action==='list')return this.lessonBoard.list({sessionId});
      if(action==='read')return this.lessonBoard.readForTeacher({sessionId,blockId:input.blockId});
      if(action==='apply')return this.lessonBoard.apply({...input,sessionId},options);
      if(action==='undo')return this.lessonBoard.undo({...input,sessionId},options);
      fail('board_action_invalid');
    }
    if(name==='save_lesson_summary')return this.saveSummary(exec,args);
    if(name==='open_learning_lesson'){
      const path=safeRelativePath(args.path?.startsWith('vault/')?args.path.slice(6):args.path);
      const doc=await createAgentVaultIO(this.ctx,exec).read(path);
      return this.openRouteLessonHere({path,nodeId:args.nodeId,expectedRevision:doc.revision,repeat:args.repeat??false},exec);
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
  installBoardForks(ctx,service);
  installAgentTools(ctx,service);
  ctx.inject(['shellEnv'],scope=>scope.effect(()=>scope.shellEnv.register({
    name:'notara-vault-cli',
    variables:{
      DSH_NOTARA_NODE:{description:'Node executable for the bundled Notara helper.'},
      DSH_NOTARA_CLI:{description:'Bundled helper entry; invoke help for progressive command disclosure.'},
      DSH_NOTARA_WORKSPACE:{description:'Current registered classroom workspace root.'},
      DSH_NOTARA_VAULT_ROOT:{description:'Current classroom material root; use this path for Bash reads and writes.'},
      DSH_NOTARA_VAULT_PREFIX:{description:'Legacy relative path prefix for the material root; empty when the selected workspace is itself the Vault.'},
      DSH_NOTARA_WORKSPACE_ID:{description:'Current registered workspace identity, provided by Host.'},
      DSH_NOTARA_CALL_ID:{description:'Current native shell call identity, provided by Host.'},
      DSH_NOTARA_LESSON:{description:'Bound lesson location and revision, provided by Host; do not construct or override.'},
      DSH_NOTARA_TEACHING:{description:'Installed teaching resource directory; optional examples can be read here, never treated as learner records.'},
      DSH_NOTARA_RG:{description:'Packaged ripgrep executable; call it for rg searches instead of relying on a system rg. Absent when unavailable.'},
    },
    resolve(exec){
      if(!service.isTeaching(exec.agent)||exec.agent.session.header.origin==='subagent')return {};
      const workspace=vaultScopes(ctx,exec)[0];
      const vaultRoot=materialRoot(workspace.path);
      const settings=readTeachingSettings(exec.agent.session);
      const bound=settings.scriptPath?vaultScopes(ctx,exec,'all').find(item=>item.id===(settings.scriptWorkspaceId??workspace.id)):null;
      const lesson=bound?lessonPinText(bound,settings):'';
      const rg=packagedRipgrep();
      return {...(rg?{DSH_NOTARA_RG:shellPath(rg)}:{}),DSH_NOTARA_NODE:shellPath(process.execPath),DSH_NOTARA_CLI:shellPath(fileURLToPath(new URL('./vault-cli.js',import.meta.url))),DSH_NOTARA_WORKSPACE:shellPath(workspace.path),DSH_NOTARA_VAULT_ROOT:shellPath(vaultRoot.path),DSH_NOTARA_VAULT_PREFIX:vaultRoot.prefix,DSH_NOTARA_WORKSPACE_ID:workspace.id,DSH_NOTARA_CALL_ID:exec.callId??'',DSH_NOTARA_LESSON:lesson,DSH_NOTARA_TEACHING:shellPath(teachingResourcePath('.'))};
    },
  })));

  service.solver=installSolver(ctx,service);
  ctx.effect(()=>ctx.systemPrompt.section({name:'notara:teaching',order:20000,text:({agent})=>{
    if(!service.isTeaching(agent)) return '';
    // The fixed solver owns its own prompt and receives only supplied material.
    if(agent.session.header.origin==='subagent') return '';
    const settings=readTeachingSettings(agent.session);
    // No workspace lookup here: this section must compose before any learning
    // set is registered. The concrete material root travels in the per-turn
    // context below, and the path rule itself lives in the teaching resources.
    return teacherPersona(settings,teachingResource('persona.md'))+'\n\n'+teachingResource('base.md')+'\n\n'+teachingResource('concepts.md')+'\n\n'+currentTeachingBody(settings.teachingRef);
  }}));
  ctx.on('system-prompt/assemble',async(assembly,context,next)=>{
    const result=await next(),agent=context.agent;
    if(!service.isTeaching(agent)||agent.session.header.origin==='subagent') return result;
    const settings=readTeachingSettings(agent.session);
    service.prepared.set(agent,{revision:settings.revision,cutoff:teachingCutoff(agent.session)});
    let memory,materialsRoot=null,profileContexts=[];
    try{
      const exec={agent,signal:context.signal},io=createAgentVaultIO(ctx,exec),readers=[{scope:io.workspace,read:io.read}];
      await service.boardReferences.prepare(agent.session);
      materialsRoot=materialRoot(io.workspace.path);
      profileContexts=await learnerProfileContext({session:agent.session,workspaceId:io.workspace.id,scan:()=>io.scan({limit:10000}),signal:context.signal,flush:session=>service.flush(session)});
      // Explicitly bound cross-set scripts retain their scope. Never substitute
      // a same-named file from the current learning set.
      if(settings.scriptWorkspaceId&&settings.scriptWorkspaceId!==io.workspace.id){
        try{const bound=createAgentVaultIO(ctx,exec,{scope:settings.scriptWorkspaceId});readers.push({scope:bound.workspace,read:bound.read});}
        catch(error){if(error.message!=='vault_scope_unavailable')throw error;}
      }
      memory=await assembleTeachingContext({readers,settings:{...settings,learningGoal:null,temporaryInstructions:''}});
      const board=await readBoardDocument(io,agent.session.id);
      Object.assign(service.prepared.get(agent),{boardRevision:board.revision,boardBodies:boardBodyView(board.board)});
      // Semantic titles let the teacher target a block without inventing IDs or coordinates.
      memory.text+='\n\n当前白板（同名标题替换该块正文，作答与位置保留；只写已向学生公开的内容；需核对已有正文时读取 '+resolve(io.rootPath,boardPath(agent.session.id))+'）：\n'+boardOverview(board.board);
    }
    catch(error){if(!['vault_scope_unavailable','vault_session_required'].includes(error.message))throw error;memory={text:'当前课堂尚未连接学习集，可以继续讨论题目；资料和学习记录需要先通过原生工作区入口接入，不能推测已有记录。'};}
    // Bindings and navigation are separate from the L0 memory budget. No script
    // body (including legacy snapshots) is injected before a stage is read.
    const bound=settings.scriptPath?ctx.get('workspaceRegistry')?.list().find(item=>item.id===settings.scriptWorkspaceId):null;
    const readPath=bound?resolve(resolveVaultRoot(bound.path),settings.scriptPath):settings.scriptWorkspaceId?null:settings.scriptPath;
    const course=await service.routeContext({agent,signal:context.signal},settings);
    // The overview is read at every turn so a conversation always starts from it.
    let learningSet=null;
    if(materialsRoot){
      const shared=(await activeUserSkills().catch(()=>[])).map(row=>({name:row.name,subjects:[row.title,...(row.tags??[])]}));
      learningSet=await learningSetOverview(materialsRoot.path,{subjectSkills:[...BUILTIN_SUBJECT_SKILLS,...shared]}).catch(()=>null);
    }
    const lessonSubjects=Array.isArray(settings.subjects)&&settings.subjects.length?settings.subjects:null;
    const subjects=lessonSubjects??(learningSet?.status==='active'?learningSet.subjects:settings.subjects);
    const background={learningGoal:settings.learningGoal,temporaryInstructions:settings.temporaryInstructions,subjects,subjectsSource:lessonSubjects?'lesson':learningSet?.status==='active'?'learning-set':'none',learningSet,materialsRoot:materialsRoot?{env:'DSH_NOTARA_VAULT_ROOT',path:materialsRoot.path,legacyPrefix:materialsRoot.prefix}:null,course,script:settings.scriptPath?{...memory.script,path:settings.scriptPath,readPath,workspaceId:settings.scriptWorkspaceId,boundRevision:settings.scriptRevision,bodyRead:false}:null,previousLesson:settings.continuation,materials:settings.materials};
    return {...result,contexts:[...result.contexts,...profileContexts,{name:'notara:learning-context',text:memory.text},{name:'notara:lesson-background',text:JSON.stringify(background)}]};
  });
  ctx.on('session/event',(session,event)=>{if(event.type==='turn/end'){service.requests.delete(session.id);const cutoff=service.archiveAfterTurn.get(session.id);if(service.archiveAfterTurn.delete(session.id))service.archiveWhenIdle(session,cutoff);for(const key of service.operations.keys())if(key.startsWith(session.id+':'))service.operations.delete(key);}});
  // Native archival must resolve only after the registry persists it, and must
  // retain its running-work confirmation and stopActivity option. Summaries use
  // the separate lesson action or the teacher's explicit save-and-archive tool.
  return service;
}
