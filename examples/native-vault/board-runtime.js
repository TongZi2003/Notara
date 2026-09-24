import { createHash,randomUUID } from 'node:crypto';
import { createAgentVaultIO } from './agent-io.js';
import { parseBoard,renderBoard,upsertBoard,projectBoard,validateBoardBody,validateLayout } from './board-data.js';
const fail=code=>{throw new Error(code);};
export const boardPath=sessionId=>'lesson-board/'+createHash('sha256').update(sessionId).digest('hex').slice(0,32)+'.md';
export async function readBoardDocument(io,sessionId){
  let document=null;try{document=await io.read(boardPath(sessionId));}catch(error){if(error.message!=='vault_file_not_found')throw error;}
  return {board:parseBoard(document?.content??null,sessionId),revision:document?.revision??null};
}
export function createBoardRuntime(service){
  async function editor(sessionId){const agent=await service.agentFor(sessionId);if(agent.session.header.origin==='subagent')fail('teaching_session_required');return service.editorFor({sessionId});}
  async function projection(io,state){const scan=await io.scan();return projectBoard(state.board,state.revision,[...scan.files.filter(file=>file.kind!=='page'),...scan.documents]);}
  return {
    async read({sessionId}){const io=await editor(sessionId);return projection(io,await readBoardDocument(io,sessionId));},
    async mutate({sessionId,expectedRevision,blockId,sourcePath,patch}){
      const io=await editor(sessionId),state=await readBoardDocument(io,sessionId);
      if(expectedRevision!==state.revision)fail('vault_revision_conflict');
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['x','y','width','body'].includes(key))||Boolean(blockId)===Boolean(sourcePath))fail('board_content_invalid');
      validateLayout(patch);if(patch.body!==undefined)validateBoardBody(patch.body);
      if(blockId){const block=state.board.blocks.find(block=>block.id===blockId);if(!block)fail('board_block_missing');Object.assign(block,patch);}
      else {const current=await projection(io,state);if(!current.sources.some(source=>source.path===sourcePath))fail('board_source_missing');Object.defineProperty(state.board.sourceNotes,sourcePath,{value:{...(state.board.sourceNotes[sourcePath]??{}),...patch},enumerable:true,configurable:true,writable:true});}
      const saved=await io.save(boardPath(sessionId),renderBoard(state.board),state.revision);return projection(io,{board:state.board,revision:saved.revision});
    },
    async write(exec,args){
      if(!service.isTeaching(exec.agent)||exec.agent.session.header.origin==='subagent')fail('teaching_session_required');
      const io=createAgentVaultIO(service.ctx,exec,{writeApproved:true}),sessionId=exec.agent.session.id,state=await readBoardDocument(io,sessionId);
      const prepared=service.prepared.get(exec.agent);
      if(prepared&&Object.hasOwn(prepared,'boardRevision')&&prepared.boardRevision!==state.revision)fail('vault_revision_conflict');
      const block=upsertBoard(state.board,args,randomUUID());
      const saved=await io.save(boardPath(sessionId),renderBoard(state.board),state.revision);
      if(prepared)prepared.boardRevision=saved.revision;
      return {saved:true,title:block.title,revision:saved.revision};
    },
  };
}
