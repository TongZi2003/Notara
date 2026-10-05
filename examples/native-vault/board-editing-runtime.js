import {randomUUID,createHash} from 'node:crypto';
import {createBoardObjectStore} from './board-storage.js';
import {applySceneOperations,validateBoardScene,validateBoardUrl} from './board-scene.js';
import {validateBoardSourceRef} from './board-mindmap.js';
import {parseSourceRef,createEditorVaultIO} from './agent-io.js';
import {safeRelativePath} from './vault.js';
import {BOARD_CONTENT_TYPES,BOARD_KINDS,parseBoard,renderBoard,validateBoardBody,validateLayout} from './board-data.js';
import {boardComponents,validateBoardComponents} from './board-components.js';
const fail=code=>{throw new Error(code);};
const exact=(value,keys,code='board_content_invalid')=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail(code);return value;};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const id=()=>randomUUID();
const line=(v,max=160)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\r\n\0]/.test(v);
const contentFields=new Set(['title','body','contentRef','sourceRef','url','kind','contentType']);
const editorCounters=new Set(['version','versionNonce','updated','index']);
function changesBetween(before,after) {
 const changes=[];
 for(const collection of ['blocks','manualEdges','groups']){
  const old=new Map((before[collection]??[]).map(o=>[o.id,o])),fresh=new Map((after[collection]??[]).map(o=>[o.id,o]));
  for(const key of new Set([...old.keys(),...fresh.keys()])){
   if(!old.has(key)||!fresh.has(key)){changes.push({collection,id:key,before:old.get(key)??null,after:fresh.get(key)??null});continue;}
   for(const field of new Set([...Object.keys(old.get(key)),...Object.keys(fresh.get(key))]))if(!equal(old.get(key)[field],fresh.get(key)[field]))changes.push({collection,id:key,field,before:old.get(key)[field]??null,after:fresh.get(key)[field]??null});
  }
 }
 return changes;
}
// Check the fields this operation will actually write, including objects a
// branch operation finds only in the latest graph. Counters are not content.
function assertSceneBaseline(before,after,reference){
 const compare=(old,fresh,live,key)=>{
  const a=new Map(old.map(row=>[key(row),row])),b=new Map(fresh.map(row=>[key(row),row])),c=new Map(live.map(row=>[key(row),row]));
  for(const objectId of new Set([...a.keys(),...b.keys()])){
   const prior=a.get(objectId),next=b.get(objectId),observed=c.get(objectId);if(equal(prior,next))continue;
   if(!prior||!next){if(!equal(prior,observed))fail('board_edit_conflict');continue;}
   if(!observed)fail('board_edit_conflict');
   for(const field of new Set([...Object.keys(prior),...Object.keys(next)]))if(!editorCounters.has(field)&&!equal(prior[field],next[field])&&!equal(prior[field],observed[field]))fail('board_edit_conflict');
  }
 };
 compare(before.elements,after.elements,reference.elements,row=>row.id);
 for(const field of ['nodes','links','notes'])compare(before.mindmap?.[field]??[],after.mindmap?.[field]??[],reference.mindmap?.[field]??[],row=>field==='links'?(row.id??`${row.from}:${row.to}`):row.elementId);
 for(const field of ['appState','files'])if(!equal(before[field],after[field])&&!equal(before[field],reference[field]))fail('board_edit_conflict');
}
function insertRestoredRow(rows,row,original,key){
 const at=original.findIndex(item=>key(item)===key(row)),positions=new Map(rows.map((item,index)=>[key(item),index]));
 const previous=original.slice(0,at).reverse().find(item=>positions.has(key(item))),next=original.slice(at+1).find(item=>positions.has(key(item)));
 if(previous&&next&&positions.get(key(previous))>=positions.get(key(next)))fail('board_undo_conflict');
 const index=next?positions.get(key(next)):previous?positions.get(key(previous))+1:0;
 rows.splice(index,0,structuredClone(row));
}
function assertSelectedUndo(current,next,original,selected){
 const allowed=new Set(selected),present=new Set(current.elements.map(e=>e.id));
 // Existing scope comes from the current graph. History may add only missing
 // objects owned by that branch, not pull a surviving outside branch into it.
 for(let grew=true;grew;){
  grew=false;
  for(const scene of [current,original]){
   const historical=scene===original,add=id=>{if(id&&!allowed.has(id)&&(!historical||!present.has(id))){allowed.add(id);grew=true;}};
   for(const node of scene.mindmap?.nodes??[]){if(allowed.has(node.parentId))add(node.elementId);if(allowed.has(node.elementId))add(node.parentEdgeId);}
   for(const element of scene.elements)if(allowed.has(element.containerId))add(element.id);
  }
 }
 const changedRows=(before,after,key,check)=>{
  const a=new Map(before.map(row=>[key(row),row])),b=new Map(after.map(row=>[key(row),row]));
  for(const id of new Set([...a.keys(),...b.keys()]))if(!equal(a.get(id),b.get(id)))check(a.get(id),b.get(id),id);
 };
 changedRows(current.elements,next.elements,e=>e.id,(a,b,id)=>{
  if(a&&b&&[...new Set([...Object.keys(a),...Object.keys(b)])].every(field=>editorCounters.has(field)||equal(a[field],b[field])))return;
  if(!allowed.has(id))fail('board_patch_scope_invalid');
 });
 for(const field of ['nodes','notes'])changedRows(current.mindmap?.[field]??[],next.mindmap?.[field]??[],row=>row.elementId,(a,b,id)=>{if(!allowed.has(id))fail('board_patch_scope_invalid');});
 changedRows(current.mindmap?.links??[],next.mindmap?.links??[],row=>row.id??`${row.from}:${row.to}`,(a,b)=>{for(const row of [a,b])if(row&&(!allowed.has(row.from)||!allowed.has(row.to)))fail('board_patch_scope_invalid');});
 if(!equal(current.appState,next.appState)||!equal(current.files,next.files))fail('board_patch_scope_invalid');
}
export function createBoardEditing(service,{readState,project,pathFor}) {
 const baselines=new Map(),selectionScopes=new Map(),stores=new Map();
 async function getContext(sessionId,signal){
  const agent=await service.agentFor(sessionId);
  if(agent.session.header.origin==='subagent')fail('teaching_session_required');
  const base=await service.editorFor({sessionId});
  const io=signal?createEditorVaultIO(service.ctx,base.workspace.path,signal):base;
  if(!io.workspace?.id||!io.rootPath)fail('board_store_unavailable');
  if(agent.session.id!==sessionId)fail('teaching_session_required');
  const key=io.workspace.id+'\0'+io.rootPath;
  if(!stores.has(key))stores.set(key,createBoardObjectStore(io.rootPath));
  return {session:{sessionId,agent},io,store:stores.get(key)};
 }
 function captureScope(context,signal){
  const {io,session,store}=context,workspaceId=io.workspace.id,rootPath=io.rootPath;
  const check=()=>{signal?.throwIfAborted();if(io.workspace.id!==workspaceId||io.rootPath!==rootPath||session.agent.session.id!==session.sessionId)fail('scope_override_denied');};
  const checked=async operation=>{check();try{const value=await operation();check();return value;}catch(error){check();throw error;}};
  return {io,workspaceId,check,store:{read:(...args)=>checked(()=>store.read(...args)),write:(...args)=>checked(()=>store.write(...args)),copy:(...args)=>checked(()=>store.copy(...args))}};
 }
 async function loadScene(block,session,scope) {
  scope.check();if(!block.contentRef)return null;const stored=await scope.store.read(session.sessionId,block.contentRef);if(stored.kind!=='scene')fail('board_content_corrupt');
  const scene=structuredClone(stored.scene);scene.files??={};
  for(const [key,file] of Object.entries(scene.files))if(file.assetRef){const asset=await scope.store.read(session.sessionId,file.assetRef);if(asset.kind!=='asset')fail('board_content_corrupt');scene.files[key]={...asset.file};}
  scope.check();return validateBoardScene(scene);
 }
 async function saveScene(value,session,scope) {
  scope.check();const scene=validateBoardScene(value);
  for(const node of scene.mindmap?.nodes??[])if(node.sourceRef){validateBoardSourceRef(node.sourceRef);if(parseSourceRef(node.sourceRef).workspaceId!==scope.workspaceId)fail('vault_scope_unavailable');}
  if(Buffer.byteLength(JSON.stringify(scene))>10*1024*1024)fail('board_content_too_large');
  const stored=structuredClone(scene);
  for(const [key,file] of Object.entries(stored.files??{})){const assetRef=await scope.store.write(session.sessionId,{kind:'asset',file});stored.files[key]={id:key,assetRef,mimeType:file.mimeType};}
  return scope.store.write(session.sessionId,{kind:'scene',scene:stored});
 }
 async function newTeacherScene(value){
  const scene=validateBoardScene(value),mapping=new Map(scene.elements.map(e=>[e.id,id()])),groups=new Map();
  const resolve=ref=>mapping.get(ref)??ref;
  for(const e of scene.elements){e.id=resolve(e.id);if(e.containerId)e.containerId=resolve(e.containerId);if(e.boundElements)e.boundElements=e.boundElements.map(b=>({...b,id:resolve(b.id)}));for(const field of ['startBinding','endBinding'])if(e[field])e[field].elementId=resolve(e[field].elementId);e.groupIds=(e.groupIds??[]).map(g=>{if(!groups.has(g))groups.set(g,id());return groups.get(g);});}
  if(scene.mindmap){scene.mindmap.nodes=scene.mindmap.nodes.map(n=>({...n,elementId:resolve(n.elementId),parentId:n.parentId===null?null:resolve(n.parentId),...(n.parentEdgeId?{parentEdgeId:resolve(n.parentEdgeId)}:{})}));scene.mindmap.links=scene.mindmap.links.map(l=>({...l,...(l.id?{id:id()}:{}),from:resolve(l.from),to:resolve(l.to)}));scene.mindmap.notes=(scene.mindmap.notes??[]).map(n=>({...n,elementId:resolve(n.elementId)}));}
  return validateBoardScene(scene);
 }
 async function history(board,session,scope){const result=[];for(const ref of board.historyRefs??[]){const value=await scope.store.read(session.sessionId,ref);if(value.kind!=='commit')fail('board_content_corrupt');result.push(value);}return result;}
 function contribution(entry,entries){return {id:entry.id,actor:entry.actor,at:entry.at,targetIds:[...new Set(entry.changes.filter(c=>c.collection==='blocks').map(c=>c.id))],contentChanged:entry.changes.some(c=>!c.field||contentFields.has(c.field)),undoOf:entry.undoOf??null,canUndo:!entry.undoOf&&!entries.some(e=>e.undoOf===entry.id),undone:entries.some(e=>e.undoOf===entry.id)};}
 async function contributions(board,session,scope){const entries=await history(board,session,scope);return entries.map(entry=>contribution(entry,entries));}
 async function content(input,{teacher=false}={}) {
  exact(input,['sessionId','blockId']);const context=await getContext(input.sessionId),{session,io}=context,scope=captureScope(context),state=await readState(io,input.sessionId);scope.check();const block=state.board.blocks.find(b=>b.id===input.blockId);if(!block)fail('board_block_missing');
  const scene=await loadScene(block,session,scope);
  if(teacher){const key=session.sessionId+':'+block.id;baselines.delete(key);baselines.set(key,{block:structuredClone(block),scene:structuredClone(scene)});while(baselines.size>100)baselines.delete(baselines.keys().next().value);}
  const entries=await history(state.board,session,scope);scope.check();
  let value=scene;
  if(teacher&&scene)value={...scene,files:Object.fromEntries(Object.entries(scene.files??{}).map(([key,f])=>[key,{id:key,mimeType:f.mimeType}]))};
  return {blockId:block.id,contentType:block.contentType??'text',revision:state.revision,block,content:value,contributions:entries.filter(e=>e.changes.some(c=>c.collection==='blocks'&&c.id===block.id)).map(e=>({...contribution(e,entries),original:e.changes.filter(c=>c.id===block.id&&(c.field==='body'||c.field==='title')).map(({field,before,after})=>({field,before,after}))}))};
 }
 async function readForTeacher({sessionId,blockId}={}) {
  const context=await getContext(sessionId),{io}=context;
  if(blockId)return content({sessionId,blockId},{teacher:true});
  const scope=captureScope(context),state=await readState(io,sessionId);scope.check();return {revision:state.revision,blocks:state.board.blocks.slice(0,100).map(({id,title,body,contentType,sourceRef,contentRef})=>({id,title,body:body.slice(0,2000),contentType:contentType??'text',sourceRef,hasScene:!!contentRef})),manualEdges:state.board.manualEdges??[],groups:state.board.groups??[],contributions:await contributions(state.board,context.session,scope),readTargetBeforePatch:true};
 }
 async function contributionView({sessionId}={}){
  const context=await getContext(sessionId),scope=captureScope(context),state=await readState(context.io,sessionId);scope.check();return contributions(state.board,context.session,scope);
 }
 async function patchScene(current,baseline,ops) {
  const assigned=[];let cursor=0,wanted;
  if(baseline)wanted=(await applySceneOperations(baseline,ops,{newId:()=>{const value=id();assigned.push(value);return value;}})).scene;
  const actual=(await applySceneOperations(current,ops,{newId:()=>assigned[cursor++]??id()})).scene;
  if(baseline){assertSceneBaseline(baseline,wanted,current);assertSceneBaseline(current,actual,baseline);}
  return {scene:actual,baseline:wanted};
 }
 async function undoScene(currentRef,beforeRef,afterRef,session,scope,selected) {
  const [current,before,after]=await Promise.all([loadScene({contentRef:currentRef},session,scope),loadScene({contentRef:beforeRef},session,scope),loadScene({contentRef:afterRef},session,scope)]);
  if(!current||!before||!after)fail('board_undo_conflict');
  const fresh=structuredClone(current),old=new Map(before.elements.map(e=>[e.id,e])),changed=new Map(after.elements.map(e=>[e.id,e]));
  for(const key of new Set([...old.keys(),...changed.keys()])){
   const b=old.get(key),a=changed.get(key),index=fresh.elements.findIndex(e=>e.id===key),now=fresh.elements[index];if(equal(b,a))continue;
   if(!b||!a){if(!equal(now,a))fail('board_undo_conflict');if(b)insertRestoredRow(fresh.elements,b,before.elements,row=>row.id);else fresh.elements.splice(index,1);continue;}
   if(!now)fail('board_undo_conflict');
   for(const field of new Set([...Object.keys(b),...Object.keys(a)]))if(!editorCounters.has(field)&&!equal(b[field],a[field])){if(!equal(now[field],a[field]))fail('board_undo_conflict');if(b[field]===undefined)delete now[field];else now[field]=structuredClone(b[field]);}
  }
  const restoreFields=(old={},changed={},live={},skipCounters=false)=>{
   const out=structuredClone(live);for(const field of new Set([...Object.keys(old),...Object.keys(changed)]))if(!(skipCounters&&editorCounters.has(field))&&!equal(old[field],changed[field])){if(!equal(live[field],changed[field]))fail('board_undo_conflict');if(old[field]===undefined)delete out[field];else out[field]=structuredClone(old[field]);}return out;
  };
  fresh.appState=restoreFields(before.appState,after.appState,current.appState);fresh.files=restoreFields(before.files,after.files,current.files);
  if(before.mindmap||after.mindmap){
   const restoreRows=(old,changed,live,key)=>{const rows=structuredClone(live),a=new Map(old.map(r=>[key(r),r])),b=new Map(changed.map(r=>[key(r),r]));for(const objectId of new Set([...a.keys(),...b.keys()])){const before=a.get(objectId),after=b.get(objectId),index=rows.findIndex(r=>key(r)===objectId),now=rows[index];if(equal(before,after))continue;if(!before||!after){if(!equal(now,after))fail('board_undo_conflict');if(before)insertRestoredRow(rows,before,old,key);else rows.splice(index,1);}else {if(!now)fail('board_undo_conflict');rows[index]=restoreFields(before,after,now);}}return rows;};
   fresh.mindmap={...(current.mindmap??{}),nodes:restoreRows(before.mindmap?.nodes??[],after.mindmap?.nodes??[],current.mindmap?.nodes??[],r=>r.elementId),links:restoreRows(before.mindmap?.links??[],after.mindmap?.links??[],current.mindmap?.links??[],r=>r.id??`${r.from}:${r.to}`),notes:restoreRows(before.mindmap?.notes??[],after.mindmap?.notes??[],current.mindmap?.notes??[],r=>r.elementId)};
  }
  if(selected?.size)assertSelectedUndo(current,fresh,before,selected);
  return saveScene(fresh,session,scope);
 }
 async function commit(input,{actor='student',operationId,targetId,signal}={}) {
  signal?.throwIfAborted();
  exact(input,['sessionId','expectedRevision','requestId','ops']);const context=await getContext(input.sessionId,signal),{session,io}=context,scope=captureScope(context,signal);scope.check();
  if(!['student','teacher'].includes(actor))fail('board_content_invalid');
  if(actor==='teacher'&&!service.isTeaching(session.agent))fail('teaching_session_required');
  if(!Array.isArray(input.ops)||!input.ops.length||input.ops.length>80)fail('board_content_invalid');
  if(input.requestId!==undefined&&!line(input.requestId,100))fail('board_content_invalid');
  const state=await readState(io,input.sessionId);scope.check();const entries=await history(state.board,session,scope),requestId=operationId??input.requestId,requestHash=digest(input.ops);
  const previous=requestId&&entries.find(e=>e.requestId===requestId&&e.actor===actor);
  if(previous){if(previous.requestHash!==requestHash)fail('board_request_reused');return {...await project(io,state,input.sessionId),saved:true,commitId:previous.id,created:previous.created,contributions:await contributions(state.board,session,scope)};}
  if(actor==='student'&&input.expectedRevision!==state.revision)fail('vault_revision_conflict');
  if(actor==='teacher'&&input.ops.some(op=>op.type!=='patch')&&input.expectedRevision!==undefined&&input.expectedRevision!==state.revision)fail('vault_revision_conflict');
  const before=structuredClone(state.board),board=state.board,created={};board.version=2;board.manualEdges??=[];board.groups??=[];board.historyRefs??=[];
  const resolve=value=>Object.hasOwn(created,value)?created[value]:value,blockFor=value=>board.blocks.find(b=>b.id===resolve(value))??fail('board_block_missing');
  const workingBaselines=new Map();
  const baselineFor=block=>{
   if(actor!=='teacher')return null;
   if(!workingBaselines.has(block.id))workingBaselines.set(block.id,structuredClone(baselines.get(session.sessionId+':'+block.id)??fail('board_read_required')));
   return workingBaselines.get(block.id);
  };
  const selectedScope=actor==='teacher'?selectionScopes.get(session.sessionId):null;
  const shape=body=>boardComponents(body).map(c=>`${c.type}:${c.fingerprint??'error'}`).join('|');
  const validSource=async ref=>{scope.check();validateBoardSourceRef(ref);const source=parseSourceRef(ref);if(source.workspaceId!==scope.workspaceId)fail('vault_scope_unavailable');safeRelativePath(source.path);if(source.path.split('/').some(s=>s.startsWith('.')))fail('vault_path_invalid');const doc=source.path.toLowerCase().endsWith('.md')?await io.read(source.path):await io.readAsset(source.path);scope.check();if(doc.revision!==source.revision)fail('vault_reference_stale');return ref;};
  for(const op of input.ops){
   scope.check();
   if(!object(op))fail('board_content_invalid');
   if(selectedScope?.size&&op.type==='undo'){
    const entry=entries.find(e=>e.id===op.commitId);if(!entry||entry.changes.some(change=>change.collection!=='blocks'||!selectedScope.has(change.id)||selectedScope.get(change.id).size&&change.field!=='contentRef'))fail('board_patch_scope_invalid');
   }else if(selectedScope?.size){
    if(op.type!=='patch'||!selectedScope.has(resolve(op.blockId)))fail('board_patch_scope_invalid');
    const selected=selectedScope.get(resolve(op.blockId));
    // Element-level references authorize edits inside the immutable scene only.
    // Block metadata and markdown need the whole-block scope, even when the
    // same request also carries valid scene operations.
    if(selected.size&&object(op.patch??{})&&Object.keys(op.patch??{}).length)fail('board_patch_scope_invalid');
    if(selected.size&&op.sceneOps){
     const current=await loadScene(blockFor(op.blockId),session,scope),allowed=new Set(selected);
     if(current.mindmap)for(let grew=true;grew;){grew=false;for(const n of current.mindmap.nodes)if(allowed.has(n.parentId)&&!allowed.has(n.elementId)){allowed.add(n.elementId);grew=true;}}
     for(const e of current.elements)if(allowed.has(e.containerId))allowed.add(e.id);
     for(const sceneOp of op.sceneOps){
       if(sceneOp.type==='addElement')fail('board_patch_scope_invalid');
       if(['addNode','addLink'].includes(sceneOp.type)){
       if(sceneOp.type==='addNode'&&!allowed.has(sceneOp.parentId))fail('board_patch_scope_invalid');
       if(sceneOp.type==='addLink'&&(!allowed.has(sceneOp.from)||!allowed.has(sceneOp.to)))fail('board_patch_scope_invalid');
       allowed.add(sceneOp.ref);
      }
      else if(sceneOp.type==='removeLink'){const links=(current.mindmap?.links??[]).filter(link=>sceneOp.linkId?link.id===sceneOp.linkId:link.from===sceneOp.from&&link.to===sceneOp.to);if(links.length!==1||!allowed.has(links[0].from)||!allowed.has(links[0].to))fail('board_patch_scope_invalid');}
      else {const target=sceneOp.elementId??sceneOp.nodeId;if(!target||!allowed.has(target))fail('board_patch_scope_invalid');if(sceneOp.type==='reparentNode'&&sceneOp.parentId!==null&&!allowed.has(sceneOp.parentId))fail('board_patch_scope_invalid');}
     }
    }
   }
   if(actor==='teacher'&&targetId&&op.type!=='patch')fail('board_patch_scope_invalid');
   if(op.type==='create'){
    exact(op,['type','ref','title','body','contentType','content','sourceRef','url','x','y','width','height','kind','section','size','placement']);if(!line(op.title)||!line(op.ref,80)||!/^[A-Za-z0-9_-]+$/.test(op.ref)||['__proto__','prototype','constructor'].includes(op.ref)||Object.hasOwn(created,op.ref))fail('board_content_invalid');
    const contentType=op.contentType??'text';if(!BOARD_CONTENT_TYPES.includes(contentType))fail('board_content_invalid');validateLayout(op);if((op.x===undefined)!==(op.y===undefined))fail('board_layout_invalid');
    validateBoardBody(op.body??'',contentType);validateBoardComponents(op.body??'');if(op.kind!==undefined&&!BOARD_KINDS.includes(op.kind))fail('board_content_invalid');
    if(op.section!==undefined&&!line(op.section,80))fail('board_section_invalid');let section=op.section?board.sections.find(s=>s.title===op.section.trim())?.id:board.sections.at(-1)?.id;if(!section){section='s-'+randomUUID().replaceAll('-','').slice(0,8);board.sections.push({id:section,title:op.section?.trim()??'板书'});}
    const block={id:id(),section,kind:op.kind??'note',size:op.size??(contentType==='drawing'||contentType==='mindmap'?'wide':'narrow'),title:op.title.trim(),body:op.body??'',contentType,...(op.x!==undefined?{x:op.x,y:op.y}:{}),...(op.width!==undefined?{width:op.width}:{}),...(op.height!==undefined?{height:op.height}:{})};
    if(op.placement){const p=exact(op.placement,['relativeTo','position'],'board_layout_invalid'),anchor=blockFor(p.relativeTo);if(!['beside','below'].includes(p.position)||anchor.section!==section)fail('board_anchor_section');block.place={relativeTo:anchor.id,position:p.position};}
    if(contentType==='drawing'||contentType==='mindmap'){const value=op.content??{version:1,elements:[],appState:{},files:{}};block.contentRef=await saveScene(actor==='teacher'?await newTeacherScene(value):value,session,scope);}
    else if(op.content!==undefined)fail('board_content_invalid');
    if(contentType==='source')block.sourceRef=await validSource(op.sourceRef);else if(op.sourceRef!==undefined)fail('board_content_invalid');
    if(contentType==='link'){try{block.url=validateBoardUrl(op.url);}catch{fail('board_content_invalid');}}else if(op.url!==undefined)fail('board_content_invalid');
    board.blocks.push(block);created[op.ref]=block.id;
   }else if(op.type==='patch'){
    exact(op,['type','blockId','patch','sceneOps']);const block=blockFor(op.blockId);if(targetId&&targetId!==block.id)fail('board_patch_scope_invalid');const baseline=baselineFor(block);
    const patch=exact(op.patch??{},['title','body','x','y','width','height','content'],'board_content_invalid');validateLayout(patch);
    if(patch.title!==undefined&&!line(patch.title))fail('board_content_invalid');
    if(patch.body!==undefined){validateBoardBody(patch.body,block.contentType);validateBoardComponents(patch.body);if(block.contentType!=='figure'&&shape(block.body)!==shape(patch.body))fail('board_component_locked');}
    for(const [field,value] of Object.entries(patch)){
     if(field==='content'){if(actor==='teacher')fail('board_scene_patch_required');if(!['drawing','mindmap'].includes(block.contentType))fail('board_content_invalid');block.contentRef=await saveScene(value,session,scope);}
     else {if(baseline&&!equal(baseline.block[field],block[field]))fail('board_edit_conflict');block[field]=value;if(baseline)baseline.block[field]=structuredClone(value);}
    }
    if((block.x===undefined)!==(block.y===undefined))fail('board_layout_invalid');
    if(op.sceneOps!==undefined){if(!['drawing','mindmap'].includes(block.contentType))fail('board_content_invalid');const scene=await loadScene(block,session,scope),patched=await patchScene(scene,baseline?.scene,op.sceneOps);block.contentRef=await saveScene(patched.scene,session,scope);if(baseline)baseline.scene=patched.baseline;}
   }else if(op.type==='remove'){
    exact(op,['type','blockId']);const block=blockFor(op.blockId);board.blocks=board.blocks.filter(b=>b!==block);board.manualEdges=board.manualEdges.filter(e=>e.from!==block.id&&e.to!==block.id);board.groups=board.groups.map(g=>({...g,members:g.members.filter(m=>m!==block.id)})).filter(g=>g.members.length);
   }else if(op.type==='connect'){
    exact(op,['type','from','to','label','direction']);const from=blockFor(op.from).id,to=blockFor(op.to).id;if(from===to||typeof(op.label??'')!=='string'||(op.label??'').length>160||!['forward','both','none'].includes(op.direction??'forward'))fail('board_content_invalid');board.manualEdges.push({id:id(),from,to,label:op.label??'',direction:op.direction??'forward'});
   }else if(op.type==='disconnect'){
    exact(op,['type','edgeId']);if(!board.manualEdges.some(e=>e.id===op.edgeId))fail('board_edge_missing');board.manualEdges=board.manualEdges.filter(e=>e.id!==op.edgeId);
   }else if(op.type==='group'){
    exact(op,['type','title','members']);if(!line(op.title,80)||!Array.isArray(op.members)||!op.members.length||op.members.length>100)fail('board_content_invalid');board.groups.push({id:id(),title:op.title.trim(),members:[...new Set(op.members.map(m=>blockFor(m).id))]});
   }else if(op.type==='ungroup'){
    exact(op,['type','groupId']);if(!board.groups.some(g=>g.id===op.groupId))fail('board_group_missing');board.groups=board.groups.filter(g=>g.id!==op.groupId);
   }else if(op.type==='undo'){
    exact(op,['type','commitId']);if(input.ops.length!==1)fail('board_content_invalid');const entry=entries.find(e=>e.id===op.commitId);if(!entry||entry.undoOf||entries.some(e=>e.undoOf===entry.id)||actor==='teacher'&&entry.actor!=='teacher')fail('board_undo_unavailable');
    for(const change of [...entry.changes].reverse()){
     const rows=board[change.collection]??=[],index=rows.findIndex(r=>r.id===change.id),now=rows[index];
     if(!change.field){if(!equal(now??null,change.after))fail('board_undo_conflict');if(change.before)rows.push(structuredClone(change.before));if(now)rows.splice(index,1);}
     else {if(!now)fail('board_undo_conflict');const selected=selectedScope?.get(change.id);if(change.field==='contentRef'&&(!equal(now.contentRef,change.after)||selected?.size)){now.contentRef=await undoScene(now.contentRef,change.before,change.after,session,scope,selected);continue;}if(!equal(now[change.field]??null,change.after))fail('board_undo_conflict');if(change.before===null)delete now[change.field];else now[change.field]=structuredClone(change.before);}
    }
   }else fail('board_content_invalid');
  }
  const changes=changesBetween(before,board);if(!changes.length)return {...await project(io,state,input.sessionId),saved:true,created,contributions:await contributions(board,session,scope)};
  const commitId=id(),entry={kind:'commit',id:commitId,actor,at:new Date().toISOString(),requestId:requestId??null,requestHash,created,changes,...(input.ops[0].type==='undo'?{undoOf:input.ops[0].commitId}:{})};
  const historyRef=await scope.store.write(session.sessionId,entry);board.historyRefs.push(historyRef);if(board.historyRefs.length>2000)fail('board_history_full');
  const rendered=renderBoard(board);parseBoard(rendered,session.sessionId);scope.check();const saved=await io.save(pathFor(session.sessionId),rendered,state.revision);
  // Invalidate only successfully modified teacher baselines, retaining reread evidence.
  if(actor==='teacher')for(const change of changes)if(change.collection==='blocks')baselines.delete(session.sessionId+':'+change.id);
  const committed=[...entries,entry],receipt={saved:true,revision:saved.revision,commitId,created,contributions:committed.map(e=>contribution(e,committed))};
  try{scope.check();const result=await project(io,{board,revision:saved.revision},session.sessionId);scope.check();return {...result,...receipt};}
  catch(error){return {...receipt,scopeChanged:Boolean(signal?.aborted),projectionPending:true};}
 }
 async function cloneObjects(board,sourceSessionId,targetSessionId,sourceIO){
  const context=sourceIO?{session:{sessionId:sourceSessionId},io:sourceIO,store:createBoardObjectStore(sourceIO.rootPath)}:await getContext(sourceSessionId),scope=captureScope(context),store=scope.store;
  const copied=new Set(),copy=async ref=>{scope.check();if(!ref||copied.has(ref))return;const value=await store.read(sourceSessionId,ref);if(value.kind==='scene')for(const file of Object.values(value.scene.files??{}))await copy(file.assetRef);if(value.kind==='commit')for(const change of value.changes)if(change.field==='contentRef'){await copy(change.before);await copy(change.after);}else if(!change.field){await copy(change.before?.contentRef);await copy(change.after?.contentRef);}await store.copy(sourceSessionId,targetSessionId,ref);copied.add(ref);};
  for(const block of board.blocks)await copy(block.contentRef);for(const ref of board.historyRefs??[])await copy(ref);scope.check();
 }
 async function list({sessionId}={}){return readForTeacher({sessionId});}
 async function apply(input,options={}){return commit(input,{...options,actor:'teacher'});}
 async function undo(input,options={}){exact(input,['sessionId','commitId','expectedRevision','requestId']);if(typeof input.commitId!=='string'||!input.commitId)fail('board_content_invalid');return apply({sessionId:input.sessionId,...(input.expectedRevision===undefined?{}:{expectedRevision:input.expectedRevision}),...(input.requestId===undefined?{}:{requestId:input.requestId}),ops:[{type:'undo',commitId:input.commitId}]},options);}
 async function bindSelection(references,{sessionId,expectedRevision}={}){
  if(!Array.isArray(references)||references.length>100)fail('board_patch_scope_invalid');const context=await getContext(sessionId),state=await readState(context.io,sessionId);
  if(expectedRevision!==undefined&&state.revision!==expectedRevision)fail('vault_revision_conflict');
  const scope=captureScope(context),map=new Map();
  for(const reference of references){exact(reference,['blockId','elementIds']);if(typeof reference.blockId!=='string'||map.has(reference.blockId)||!Array.isArray(reference.elementIds)||reference.elementIds.length>500||new Set(reference.elementIds).size!==reference.elementIds.length)fail('board_patch_scope_invalid');const block=state.board.blocks.find(item=>item.id===reference.blockId);if(!block)fail('board_block_missing');
   if(reference.elementIds.length){if(!['drawing','mindmap'].includes(block.contentType))fail('board_patch_scope_invalid');const scene=await loadScene(block,context.session,scope),known=new Set([...(scene?.elements??[]).map(element=>element.id),...(scene?.mindmap?.links??[]).map(link=>link.id).filter(Boolean)]);if(reference.elementIds.some(id=>typeof id!=='string'||!known.has(id)))fail('board_patch_scope_invalid');}
   map.set(reference.blockId,new Set(reference.elementIds));
  }
  if(map.size&&!selectionScopes.has(sessionId)&&selectionScopes.size>=100)fail('board_patch_scope_capacity');
  selectionScopes.delete(sessionId);if(map.size)selectionScopes.set(sessionId,map);
 }
 function assertLegacyWriteScope(sessionId){if(selectionScopes.get(sessionId)?.size)fail('board_patch_scope_invalid');}
 async function forgetRead(blockId,{sessionId}={}){baselines.delete(sessionId+':'+blockId);}
 return {commit,apply,undo,content,list,readForTeacher,loadScene,contributions,contributionView,cloneObjects,bindSelection,forgetRead,assertLegacyWriteScope};
}
