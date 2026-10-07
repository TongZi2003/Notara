import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,lstat,open,link,rm,realpath,readdir,unlink} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw Error(code);};
const sameFile=(a,b)=>a.isFile()&&b.isFile()&&!a.isSymbolicLink()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino;
const sameDirectory=(a,b)=>a.isDirectory()&&b.isDirectory()&&!a.isSymbolicLink()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino;
const inside=(parent,child)=>{const rel=relative(parent,child);return rel!==''&&rel!=='.'&&rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);};
const recognizedObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&['scene','asset','commit'].includes(value.kind);
export const boardObjectHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Host-only immutable objects. A board Markdown reference is the commit point.
 * Maintenance is offline-only: before collecting, the caller must stop all
 * clients using this shared workspace, including read-only board clients.
 * Ordinary reads, writes, polling, and fork setup never invoke collection.
 */
export function createBoardObjectStore(materialRoot){
 const root=resolve(materialRoot);
 function namespaceFor(sessionId){
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>300)fail('board_binding_invalid');
  return createHash('sha256').update(sessionId).digest('hex').slice(0,32);
 }
 async function ensureDirectory(path){
  await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())fail('vault_path_invalid');
  return path;
 }
 async function boardsDirectory(create=false){
  const path=join(root,'.notara-boards');if(create)await ensureDirectory(path);
  const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())fail('vault_path_invalid');
  const canonical=await realpath(root),actual=await realpath(path);if(!inside(canonical,actual))fail('vault_path_invalid');
  return path;
 }
 async function directory(sessionId,create=false){
  const path=join(await boardsDirectory(create),namespaceFor(sessionId));if(create)await ensureDirectory(path);
  const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())fail('vault_path_invalid');
  const canonical=await realpath(root),actual=await realpath(path);if(!inside(canonical,actual))fail('vault_path_invalid');
  return path;
 }
 async function read(sessionId,ref){
  if(!HASH.test(ref))fail('board_content_invalid');
  let path;try{path=join(await directory(sessionId),ref+'.json');}catch(error){if(error.code==='ENOENT')fail('board_content_missing');throw error;}
  let handle;try{
   const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())fail('vault_path_invalid');if(info.size>12*1024*1024)fail('board_content_too_large');
   handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
   const opened=await handle.stat(),current=await lstat(path);if(!sameFile(info,opened)||!sameFile(opened,current))fail('vault_path_invalid');
   const content=await handle.readFile('utf8'),value=JSON.parse(content);if(boardObjectHash(value)!==ref)fail('board_content_corrupt');return value;
  }catch(error){if(error.code==='ENOENT')fail('board_content_missing');throw error;}finally{await handle?.close();}
 }
 async function write(sessionId,value){
  const content=JSON.stringify(value);if(Buffer.byteLength(content)>12*1024*1024)fail('board_content_too_large');
  const ref=boardObjectHash(value),dir=await directory(sessionId,true),target=join(dir,ref+'.json'),temp=join(dir,randomUUID()+'.tmp');let handle;
  try{
   handle=await open(temp,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;
   await link(temp,target).catch(error=>{if(error.code!=='EEXIST')throw error;});await read(sessionId,ref);return ref;
  }finally{await handle?.close();await rm(temp,{force:true});}
 }
 async function reachableObjects(sessionId,board){
  if(!board||board.sessionId!==sessionId||!Array.isArray(board.blocks)||!Array.isArray(board.historyRefs??[]))fail('board_binding_invalid');
  const refs=new Set();
  async function visit(ref){
   if(ref===null||ref===undefined||ref==='')return;
   if(typeof ref!=='string'||!HASH.test(ref))fail('board_content_invalid');
   if(refs.has(ref))return;
   const value=await read(sessionId,ref);if(!value||!['scene','asset','commit'].includes(value.kind))fail('board_content_corrupt');
   refs.add(ref);
   if(value.kind==='scene'){
    if(!value.scene||typeof value.scene!=='object'||Array.isArray(value.scene)||!value.scene.files||typeof value.scene.files!=='object'||Array.isArray(value.scene.files))fail('board_content_corrupt');
    for(const file of Object.values(value.scene.files))if(file?.assetRef)await visit(file.assetRef);
   }else if(value.kind==='commit'){
    if(!Array.isArray(value.changes))fail('board_content_corrupt');
    for(const change of value.changes){
     if(!change||typeof change!=='object'||Array.isArray(change))fail('board_content_corrupt');
     if(change.field==='contentRef'){await visit(change.before);await visit(change.after);}
     else if(!change.field){await visit(change.before?.contentRef);await visit(change.after?.contentRef);}
    }
   }
  }
  for(const block of board.blocks){if(!block||typeof block!=='object'||Array.isArray(block))fail('board_content_corrupt');await visit(block.contentRef);}
  for(const ref of board.historyRefs??[])await visit(ref);
  return refs;
 }
 function scopedRoot(state,sessionId){
  const scope=state?.scope;
  if(state?.board?.sessionId!==sessionId||typeof state.revision!=='string'||!state.revision||!scope||scope.sessionId!==sessionId||typeof scope.workspaceId!=='string'||!scope.workspaceId||typeof scope.rootPath!=='string'||resolve(scope.rootPath)!==root)fail('board_gc_root_unavailable');
  return JSON.stringify([scope.workspaceId,root,sessionId]);
 }
 function rootSignature(board){return JSON.stringify([board.sessionId,board.blocks.map(block=>[block.id,block.contentRef??null]),board.historyRefs??[]]);}
 async function verifyCurrentRoot(loadBoard,sessionId,revision,scopeKey,signature){
  const latest=await loadBoard(),board=latest?.board??latest;
  const latestScope=scopedRoot({...latest,board},sessionId);
  if(latest.revision!==revision||latestScope!==scopeKey||rootSignature(board)!==signature)fail('vault_revision_conflict');
  return board;
 }
 async function maintain(sessionId,{loadBoard,workspaceWritersStopped=false}={}){
  if(typeof loadBoard!=='function')fail('board_content_invalid');
  const initial=await loadBoard(),board=initial?.board??initial,reachable=await reachableObjects(sessionId,board);
  let scopeKey=null;
  if(initial?.revision)try{scopeKey=scopedRoot({...initial,board},sessionId);}catch(error){if(error.message!=='board_gc_root_unavailable')throw error;}
  const signature=rootSignature(board);
  const dir=await directory(sessionId).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const directoryInfo=dir?await lstat(dir):null,files=dir?await readdir(dir,{withFileTypes:true}):[],orphans=[];
  for(const file of files){
   if(!file.isFile()||file.isSymbolicLink()||!file.name.endsWith('.json'))continue;
   const ref=file.name.slice(0,-5);if(!HASH.test(ref)||reachable.has(ref))continue;
   const path=join(dir,file.name),info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())continue;
   orphans.push({ref,size:info.size,path,info});
  }
  orphans.sort((a,b)=>a.ref.localeCompare(b.ref));
  const deleted=[];let deletionSkipped;
  if(workspaceWritersStopped===true){
   try{
    if(!scopeKey)deletionSkipped='board_root_unavailable';
    else if(orphans.length){
     for(const orphan of orphans){
      const candidate=await read(sessionId,orphan.ref);
      if(!recognizedObject(candidate))fail('board_gc_object_kind_unknown');
     }
     await verifyCurrentRoot(loadBoard,sessionId,initial.revision,scopeKey,signature);
     for(const orphan of orphans){
      if(!recognizedObject(await read(sessionId,orphan.ref)))fail('board_gc_object_kind_unknown');
      await verifyCurrentRoot(loadBoard,sessionId,initial.revision,scopeKey,signature);
      const currentDir=await directory(sessionId).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),currentDirInfo=currentDir?await lstat(currentDir):null;
      if(!directoryInfo||!currentDirInfo||!sameDirectory(directoryInfo,currentDirInfo))fail('board_gc_scope_changed');
      const current=await lstat(orphan.path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(!current)continue;
      if(!sameFile(orphan.info,current))fail('board_gc_scope_changed');
      await unlink(orphan.path).catch(error=>{if(error.code!=='ENOENT')throw error;});deleted.push(orphan.ref);
     }
    }
   }catch(error){
    if(error.message==='board_gc_root_unavailable')deletionSkipped='board_root_unavailable';
    else throw error;
   }
  }
  const readOnly=workspaceWritersStopped!==true||Boolean(deletionSkipped);
  return {sessionId,reachableCount:reachable.size,orphanRefs:orphans.map(({ref})=>ref),orphanBytes:orphans.reduce((sum,item)=>sum+item.size,0),deletedRefs:deleted,readOnly,...(deletionSkipped?{deletionSkipped}:{})};
 }
 return {read,write,async copy(from,to,ref){const value=await read(from,ref);return write(to,value);},maintain};
}
