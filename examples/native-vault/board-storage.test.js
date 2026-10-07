import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBoardObjectStore} from './board-storage.js';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'notara-board-storage-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 return {root,store:createBoardObjectStore(root)};
}
const sessionHash=sessionId=>createHash('sha256').update(sessionId).digest('hex').slice(0,32);
const scoped=(root,sessionId,workspaceId='synthetic')=>({workspaceId,rootPath:root,sessionId});

test('default plan never unlinks; offline collection preserves current, undo, and asset closure',async t=>{
 const {root,store}=await fixture(t),sessionId='lesson';
 const beforeAsset=await store.write(sessionId,{kind:'asset',file:{id:'before',mimeType:'image/png',dataURL:'before-bytes'}});
 const afterAsset=await store.write(sessionId,{kind:'asset',file:{id:'after',mimeType:'image/png',dataURL:'after-bytes'}});
 const beforeScene=await store.write(sessionId,{kind:'scene',scene:{files:{image:{assetRef:beforeAsset}}}});
 const afterScene=await store.write(sessionId,{kind:'scene',scene:{files:{image:{assetRef:afterAsset}}}});
 const undoCommit=await store.write(sessionId,{kind:'commit',id:'undoable',changes:[
  {collection:'blocks',id:'drawing',before:{contentRef:beforeScene},after:{contentRef:afterScene}},
  {collection:'blocks',id:'drawing',field:'contentRef',before:beforeScene,after:afterScene},
 ]});
 const orphanAsset=await store.write(sessionId,{kind:'asset',file:{id:'orphan',mimeType:'image/png',dataURL:'unreferenced'}});
 const orphanScene=await store.write(sessionId,{kind:'scene',scene:{files:{}}});
 const orphanCommit=await store.write(sessionId,{kind:'commit',id:'cas-loser',changes:[]});
 const board={sessionId,blocks:[{id:'drawing',contentRef:afterScene}],historyRefs:[undoCommit]};
 const loadBoard=async()=>({board,revision:'revision-1',scope:scoped(root,sessionId)});

 const plan=await store.maintain(sessionId,{loadBoard});
 assert.equal(plan.readOnly,true);
 assert.deepEqual(new Set(plan.orphanRefs),new Set([orphanAsset,orphanScene,orphanCommit]));
 for(const ref of plan.orphanRefs)assert.ok(await store.read(sessionId,ref),'default maintenance must not unlink');
 const denied=await store.maintain(sessionId,{loadBoard,workspaceWritersStopped:false});
 assert.deepEqual(denied.deletedRefs,[],'collection requires the explicit offline capability');
 for(const ref of denied.orphanRefs)assert.ok(await store.read(sessionId,ref));

 const collected=await store.maintain(sessionId,{loadBoard,workspaceWritersStopped:true});
 assert.equal(collected.readOnly,false);
 assert.deepEqual(new Set(collected.deletedRefs),new Set([orphanAsset,orphanScene,orphanCommit]));
 for(const ref of [beforeAsset,afterAsset,beforeScene,afterScene,undoCommit])assert.ok(await store.read(sessionId,ref),'undo and current scene closure must survive');
 for(const ref of collected.deletedRefs)await assert.rejects(()=>store.read(sessionId,ref),/board_content_missing/);
});

test('missing or malformed current roots cannot authorize deletion',async t=>{
 const {root,store}=await fixture(t),sessionId='missing-root';
 const orphan=await store.write(sessionId,{kind:'asset',file:{id:'orphan',dataURL:'x'}});
 const board={sessionId,blocks:[],historyRefs:[]};
 const missing=await store.maintain(sessionId,{loadBoard:async()=>({board,revision:null,scope:scoped(root,sessionId)}),workspaceWritersStopped:true});
 assert.equal(missing.readOnly,true);assert.equal(missing.deletionSkipped,'board_root_unavailable');
 assert.ok(await store.read(sessionId,orphan));
 await assert.rejects(()=>store.maintain(sessionId,{loadBoard:async()=>{throw new Error('board_parse_failed');},workspaceWritersStopped:true}),/board_parse_failed/);
 assert.ok(await store.read(sessionId,orphan));
});

test('unknown object kinds abort collection before any orphan is unlinked',async t=>{
 const {root,store}=await fixture(t),sessionId='unknown-object-kind';
 const future=await store.write(sessionId,{kind:'future-format',payload:'preserve me'});
 let known;
 for(let index=0;index<100;index++){
  const ref=await store.write(sessionId,{kind:'asset',file:{id:`known-${index}`,dataURL:'keep until the full plan validates'}});
  if(ref.localeCompare(future)<0){known=ref;break;}
 }
 assert.ok(known,'fixture must put a valid orphan before the unknown kind in deletion order');
 const board={sessionId,blocks:[],historyRefs:[]},loadBoard=async()=>({board,revision:'stable-revision',scope:scoped(root,sessionId)});
 await assert.rejects(()=>store.maintain(sessionId,{loadBoard,workspaceWritersStopped:true}),/board_gc_object_kind_unknown/);
 assert.ok(await store.read(sessionId,known),'valid orphan must remain when any later candidate is unknown');
 assert.ok(await store.read(sessionId,future),'unknown object kind must be preserved');
});

test('root revision changes before collection abort before unlinking any orphan',async t=>{
 const {root,store}=await fixture(t),sessionId='revision-check';
 const orphan=await store.write(sessionId,{kind:'asset',file:{id:'orphan',dataURL:'x'}}),board={sessionId,blocks:[],historyRefs:[]},scope=scoped(root,sessionId);
 let loads=0;
 await assert.rejects(()=>store.maintain(sessionId,{loadBoard:async()=>({board,revision:++loads===1?'rev-1':'rev-2',scope}),workspaceWritersStopped:true}),/vault_revision_conflict/);
 assert.equal(loads,2);assert.ok(await store.read(sessionId,orphan),'changed Markdown revision must abort before unlink');
});

test('each unlink rechecks the root and stops after a concurrent pointer change',async t=>{
 const {root,store}=await fixture(t),sessionId='per-unlink-check';
 const orphanA=await store.write(sessionId,{kind:'asset',file:{id:'orphan-a',dataURL:'a'}});
 const orphanB=await store.write(sessionId,{kind:'asset',file:{id:'orphan-b',dataURL:'b'}});
 const refs=[orphanA,orphanB].sort((a,b)=>a.localeCompare(b)),board={sessionId,blocks:[],historyRefs:[]},scope=scoped(root,sessionId);
 let loads=0;
 await assert.rejects(()=>store.maintain(sessionId,{loadBoard:async()=>({board,revision:++loads===4?'rev-2':'rev-1',scope}),workspaceWritersStopped:true}),/vault_revision_conflict/);
 assert.equal(loads,4);
 await assert.rejects(()=>store.read(sessionId,refs[0]),/board_content_missing/,'the first checked orphan may be reclaimed');
 assert.ok(await store.read(sessionId,refs[1]),'the changed root is checked before the next unlink');
});

test('collection rejects a replaced object namespace before unlink',async t=>{
 const {root,store}=await fixture(t),sessionId='namespace-check';
 const orphan=await store.write(sessionId,{kind:'asset',file:{id:'orphan',dataURL:'x'}}),board={sessionId,blocks:[],historyRefs:[]},scope=scoped(root,sessionId);
 const namespace=join(root,'.notara-boards',sessionHash(sessionId)),moved=join(root,'moved-object-namespace');let loads=0;
 await assert.rejects(()=>store.maintain(sessionId,{loadBoard:async()=>{
  if(++loads===3){await rename(namespace,moved);await mkdir(namespace);}
  return {board,revision:'stable-revision',scope};
 },workspaceWritersStopped:true}),/board_gc_scope_changed/);
 assert.ok(await readFile(join(moved,`${orphan}.json`),'utf8'),'replacement must not be recursively removed or unlinked');
});
