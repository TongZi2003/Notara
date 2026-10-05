import { createHash,randomUUID } from 'node:crypto';
import { BOARD_RESIZE_LIMITS } from './board-layout.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createAgentVaultIO,parseSourceRef } from './agent-io.js';
import { BOARD_DIRECTORY,parseBoard,renderBoard,upsertBoard,projectBoard,validateBoardBody,validateLayout } from './board-data.js';
import { BOARD_COMPONENTS,appendBoardAnswer,boardAnswerMessage,boardComponents,fingerprint,validateBoardAnswer } from './board-components.js';
import { createInteractionRuntime } from './interactive-runtime.js';
import { createBoardEditing } from './board-editing-runtime.js';
const fail=code=>{throw new Error(code);};
export const boardPath=sessionId=>BOARD_DIRECTORY+'/'+createHash('sha256').update(sessionId).digest('hex').slice(0,32)+'.md';
export async function readBoardDocument(io,sessionId){
  let document=null;try{document=await io.read(boardPath(sessionId));}catch(error){if(error.message!=='vault_file_not_found')throw error;}
  return {board:parseBoard(document?.content??null,sessionId),revision:document?.revision??null};
}
const newSectionId=()=>'s-'+randomUUID().replace(/-/g,'').slice(0,8);
/** What the student is asked in a body: its components' types and fingerprints, in order. */
const componentShape=body=>boardComponents(body).map(component=>`${component.type}:${component.fingerprint??'error'}`).join('|');
/** The body fingerprints the teacher saw this turn; only a changed body blocks a rewrite. */
export const boardBodyView=board=>new Map(board.blocks.map(block=>[block.id,fingerprint(block.body)]));

export function createBoardRuntime(service){
  const interactions=createInteractionRuntime(service);
  const editing=createBoardEditing(service,{
    readState:(io,sessionId)=>readBoardDocument(io,sessionId),
    project:(io,state,sessionId)=>projection(io,state,sessionId),
    pathFor:boardPath,
  });
  async function editor(sessionId){const agent=await service.agentFor(sessionId);if(agent.session.header.origin==='subagent')fail('teaching_session_required');return service.editorFor({sessionId});}
  async function projection(io,state,sessionId){
    const scan=await io.scan(),value=projectBoard(state.board,state.revision,[...scan.files.filter(file=>file.kind!=='page'),...scan.documents]);
    for(const block of value.blocks)if(block.contentType==='source'&&block.sourceRef){
      let source;
      try{source=parseSourceRef(block.sourceRef);}catch{block.sourceState='unavailable';continue;}
      // A reference is meaningful only in the workspace that issued it. Do
      // not probe a same-named path in the current workspace for foreign refs.
      if(source.workspaceId!==io.workspace.id){block.sourceState='unavailable';continue;}
      try{
        const current=source.path.toLowerCase().endsWith('.md')?await io.read(source.path):await io.readAsset(source.path);
        block.sourceState=current.revision===source.revision?'current':'changed';
      }catch(error){
        // A missing source is a known condition; permission, cancellation,
        // races, and other IO failures all remain unavailable.
        block.sourceState=error?.message==='vault_file_not_found'?'missing':'unavailable';
      }
    }
    for(const block of value.blocks)if(block.interactive){
      try{const current=await interactions.read({sessionId,interactionId:block.interactive.interactionId});block.interactive={...current.ref};block.interactiveScene=current.scene;}
      catch(error){if(error.message==='interaction_missing'||error.message==='interaction_binding_invalid')block.interactiveState='unavailable';else throw error;}
    }
    value.workspaceId=io.workspace.id;
    value.contributions=await editing.contributionView({sessionId});
    return value;
  }
  function deliver(agent,board,block,component,answer){
    const section=board.sections.find(item=>item.id===block.section);
    const text=boardAnswerMessage({sectionTitle:section?.title,blockTitle:block.title,component,answer});
    const queued=agent.status==='running';
    try{agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user',rpcId:randomUUID()}}));return {sent:true,queued};}
    catch{return {sent:false,queued:false};}
  }
  return {
    commit:(input,options)=>editing.commit(input,{actor:'student',...options}),
    content:input=>editing.content(input),
    list:input=>editing.list(input),
    readForTeacher:input=>editing.readForTeacher(input),
    contributions:input=>editing.contributionView(input),
    apply:(input,options)=>editing.apply(input,options),
    undo:(input,options)=>editing.undo(input,options),
    bindSelection:(references,options)=>editing.bindSelection(references,options),
    forgetRead:(blockId,options)=>editing.forgetRead(blockId,options),
    async read({sessionId}){const io=await editor(sessionId);return projection(io,await readBoardDocument(io,sessionId),sessionId);},
    async mutate({sessionId,expectedRevision,blockId,sourcePath,patch}){
      const io=await editor(sessionId),state=await readBoardDocument(io,sessionId);
      if(expectedRevision!==state.revision)fail('vault_revision_conflict');
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['x','y','width','height','body','pinned'].includes(key))||Boolean(blockId)===Boolean(sourcePath))fail('board_content_invalid');
      if(patch.pinned!==undefined&&(patch.pinned!==false||!blockId||Object.keys(patch).some(key=>key!=='pinned')))fail('board_content_invalid');
      if(blockId&&patch.width!==undefined&&patch.width<BOARD_RESIZE_LIMITS.minWidth)fail('board_layout_invalid');
      if(sourcePath&&patch.width!==undefined&&patch.width<BOARD_RESIZE_LIMITS.minWidth)fail('board_layout_invalid');
      validateLayout(patch);if(patch.body!==undefined)validateBoardBody(patch.body);
      if(blockId){
        const block=state.board.blocks.find(block=>block.id===blockId);if(!block)fail('board_block_missing');
        // A student's highlight edits prose only; the questions and figures stay the teacher's.
        if(patch.body!==undefined&&componentShape(patch.body)!==componentShape(block.body))fail('board_component_locked');
        if(patch.pinned===false){if(!block.section)fail('board_unpin_unavailable');delete block.x;delete block.y;delete block.width;delete block.height;}
        const {pinned,...layout}=patch;Object.assign(block,layout);
        if((block.x===undefined)!==(block.y===undefined))fail('board_layout_invalid');
      }
      else {const current=await projection(io,state,sessionId);if(!current.sources.some(source=>source.path===sourcePath))fail('board_source_missing');Object.defineProperty(state.board.sourceNotes,sourcePath,{value:{...(state.board.sourceNotes[sourcePath]??{}),...patch},enumerable:true,configurable:true,writable:true});}
      const saved=await io.save(boardPath(sessionId),renderBoard(state.board),state.revision);return projection(io,{board:state.board,revision:saved.revision},sessionId);
    },
    async mutateInteraction({sessionId,boardRevision,interactionId,interactionRevision,patch}){
      const io=await editor(sessionId),state=await readBoardDocument(io,sessionId);
      if(boardRevision!==state.revision)fail('vault_revision_conflict');
      const block=state.board.blocks.find(item=>item.interactive?.interactionId===interactionId);
      if(!block)fail('board_interaction_missing');
      const current=await interactions.read({sessionId,interactionId});
      if(current.revision!==interactionRevision)fail('vault_revision_conflict');
      const next=await interactions.mutate({sessionId,interactionId,expectedRevision:interactionRevision,patch});
      block.interactive=next.ref;
      const saved=await io.save(boardPath(sessionId),renderBoard(state.board),state.revision);
      return projection(io,{board:state.board,revision:saved.revision},sessionId);
    },
    /**
     * A student's answer: checked against the question as it is now, stored in
     * the block marker, then sent into this lesson as the student's own message
     * — exactly the message a typed prompt would be. Stored first, sent second:
     * a failed send keeps the answer and can be re-sent without a new record.
     */
    async answer({sessionId,blockId,component,fingerprint:expected,value}){
      const io=await editor(sessionId),agent=await service.agentFor(sessionId);
      let state,block,current,answer,entry;
      for(let attempt=0;;attempt++){
        state=await readBoardDocument(io,sessionId);
        block=state.board.blocks.find(item=>item.id===blockId);
        if(!block)fail('board_block_missing');
        current=boardComponents(block.body)[component];
        if(!current?.answerable||current.error)fail('board_component_missing');
        if(current.fingerprint!==expected)fail('board_answer_stale');
        answer=validateBoardAnswer(current,value);
        entry={id:randomUUID().replace(/-/g,'').slice(0,12),c:component,fp:current.fingerprint,at:new Date().toISOString(),v:answer};
        block.answers=appendBoardAnswer(block.answers,entry);
        try{const saved=await io.save(boardPath(sessionId),renderBoard(state.board),state.revision);state={...state,revision:saved.revision};break;}
        catch(error){if(error.message!=='vault_revision_conflict'||attempt>0)throw error;}
      }
      // A recorded choice such as 直接看 is kept for the overview but not sent.
      const delivery=BOARD_COMPONENTS[current.type].silent?.(answer)?{sent:false,silent:true,queued:false}:deliver(agent,state.board,block,current,answer);
      return {...await projection(io,state,sessionId),delivery:{answerId:entry.id,...delivery}};
    },
    async resendAnswer({sessionId,blockId,answerId}){
      const io=await editor(sessionId),agent=await service.agentFor(sessionId),state=await readBoardDocument(io,sessionId);
      const block=state.board.blocks.find(item=>item.id===blockId),entry=block?.answers?.find(item=>item.id===answerId);
      if(!block||!entry)fail('board_answer_missing');
      const current=boardComponents(block.body)[entry.c];
      if(!current||current.fingerprint!==entry.fp)fail('board_answer_stale');
      return {delivery:{answerId,...deliver(agent,state.board,block,current,entry.v)}};
    },
    async write(exec,args){
      if(!service.isTeaching(exec.agent)||exec.agent.session.header.origin==='subagent')fail('teaching_session_required');
      const sessionId=exec.agent.session.id;editing.assertLegacyWriteScope(sessionId);
      const io=createAgentVaultIO(service.ctx,exec,{writeApproved:true}),state=await readBoardDocument(io,sessionId);
      const prepared=service.prepared.get(exec.agent);
      // Answers, drags and highlights elsewhere never block the teacher; only a
      // block whose body changed since the teacher last saw it must be re-read.
      const target=state.board.blocks.find(block=>block.title===String(args?.title??'').trim());
      if(prepared?.boardBodies){if(target&&prepared.boardBodies.get(target.id)!==fingerprint(target.body))fail('board_block_changed');}
      else if(prepared&&Object.hasOwn(prepared,'boardRevision')&&prepared.boardRevision!==state.revision)fail('vault_revision_conflict');
      const block=upsertBoard(state.board,args,randomUUID(),newSectionId);
      const saved=await io.save(boardPath(sessionId),renderBoard(state.board),state.revision);
      if(prepared){prepared.boardRevision=saved.revision;(prepared.boardBodies??=boardBodyView(state.board)).set(block.id,fingerprint(block.body));}
      const section=state.board.sections.find(item=>item.id===block.section);
      return {saved:true,title:block.title,...(section?{section:section.title}:{}),revision:saved.revision};
    },
  };
}
