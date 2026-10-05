import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardReferences} from './board-references.js';
const student=(sessionId,id,text,source='user')=>({id:sessionId,snapshotEvents:()=>[{type:'user/message',data:{id,source:{kind:source},content:[{type:'text',text}]}}]});
test('board edit scopes bind only submitted student receipts, clear on a new message, and reject cross-session tokens',async()=>{
 const calls=[],store=createBoardReferences({read:async()=>({revision:'r1',content:{elements:[{id:'shape'}]}}),bind:async(...args)=>calls.push(args)});
 const pin=await store.issue({sessionId:'A',blockId:'block',elementIds:['shape'],expectedRevision:'r1'});
 assert.equal(calls.length,0);
 const text=`〔白板选区:${pin.token}〕`;
 await assert.rejects(store.prepare(student('B','b1',text)),/board_reference_expired/);assert.equal(calls.length,0);
 await store.prepare(student('A','a1',text));assert.deepEqual(calls.at(-1),[[{blockId:'block',elementIds:['shape']}],{sessionId:'A',expectedRevision:'r1'}]);
 const n=calls.length;await store.prepare(student('A','a1',text));assert.equal(calls.length,n);
 await store.prepare(student('A','a2','现在讲新内容'));assert.deepEqual(calls.at(-1),[[],{sessionId:'A'}]);
 await assert.rejects(store.prepare(student('A','a3',text)),/board_reference_expired/);
});

test('submitted selections merge duplicate pins and consume receipts only after revision validation succeeds',async()=>{
 let revision='r1',reject=true;const calls=[];
 const store=createBoardReferences({read:async()=>({revision,content:{elements:[{id:'a'},{id:'b'}]}}),bind:async(...args)=>{calls.push(args);if(reject)throw Error('vault_revision_conflict');}});
 const a=await store.issue({sessionId:'A',blockId:'block',elementIds:['a'],expectedRevision:'r1'}),b=await store.issue({sessionId:'A',blockId:'block',elementIds:['b'],expectedRevision:'r1'});
 const text=`〔白板选区:${a.token}〕〔白板选区:${a.token}〕〔白板选区:${b.token}〕`;
 await assert.rejects(store.prepare(student('A','m1',text)),/vault_revision_conflict/);
 reject=false;await store.prepare(student('A','m1',text));
 assert.deepEqual(calls.at(-1),[[{blockId:'block',elementIds:['a','b']}],{sessionId:'A',expectedRevision:'r1'}]);
 revision='r2';const c=await store.issue({sessionId:'B',blockId:'block',elementIds:[],expectedRevision:'r2'});
 revision='r3';const d=await store.issue({sessionId:'B',blockId:'block',elementIds:[],expectedRevision:'r3'});
 await assert.rejects(store.prepare(student('B','m2',`〔白板选区:${c.token}〕〔白板选区:${d.token}〕`)),/board_conflict/);
});

test('ordinary sessions cannot evict a still-active scope and capacity fails closed',async()=>{
 const calls=[],store=createBoardReferences({read:async()=>({revision:'r1'}),bind:async(...args)=>calls.push(args)});
 for(let i=0;i<100;i++){
  const pin=await store.issue({sessionId:'S'+i,blockId:'block',elementIds:[],expectedRevision:'r1'});
  await store.prepare(student('S'+i,'scope',`〔白板选区:${pin.token}〕`));
 }
 for(let i=0;i<150;i++)await store.prepare(student('plain'+i,'m','普通消息'));
 const pin=await store.issue({sessionId:'next',blockId:'block',elementIds:[],expectedRevision:'r1'});
 await assert.rejects(store.prepare(student('next','scope',`〔白板选区:${pin.token}〕`)),/board_patch_scope_capacity/);
 await store.prepare(student('S0','new','新普通消息'));assert.deepEqual(calls.at(-1),[[],{sessionId:'S0'}]);
 await store.prepare(student('next','scope',`〔白板选区:${pin.token}〕`));assert.equal(calls.at(-1)[1].sessionId,'next');
});
test('stale, unknown, expired and runtime-context references cannot authorize selected edits',async()=>{
 let time=0;const calls=[],store=createBoardReferences({now:()=>time,read:async()=>({revision:'r1',content:{elements:[{id:'shape'}]}}),bind:async(refs)=>calls.push(refs)});
 await assert.rejects(store.issue({sessionId:'A',blockId:'block',elementIds:['shape'],expectedRevision:'r0'}),/board_conflict/);
 await assert.rejects(store.issue({sessionId:'A',blockId:'block',elementIds:['unknown'],expectedRevision:'r1'}),/board_patch_scope_invalid/);
 const pin=await store.issue({sessionId:'A',blockId:'block',elementIds:['shape'],expectedRevision:'r1'});
 await store.prepare(student('A','fake',`〔白板选区:${pin.token}〕`,'runtime-context'));assert.equal(calls.length,0);
 time=600001;await assert.rejects(store.prepare(student('A','expired',`〔白板选区:${pin.token}〕`)),/board_reference_expired/);assert.equal(calls.length,0);
});
