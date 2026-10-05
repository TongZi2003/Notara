import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBoardCreation} from './board-editing.js';
test('an uncertain creation reply retries the same request and operation after a poll or restored draft',()=>{
 const op={type:'create',ref:'new-block',title:'原始块',body:'原稿',x:20,y:30,sourceRef:'original-reference'};
 const draft=captureBoardCreation({title:op.title,body:op.body},op);
 op.x=500;op.body='后来的输入';
 const restored=JSON.parse(JSON.stringify(draft));
 const retry=captureBoardCreation(restored,{...op,x:900});
 assert.equal(retry.pendingCreate.requestId,draft.pendingCreate.requestId);
 assert.deepEqual(retry.pendingCreate.op,{type:'create',ref:'new-block',title:'原始块',body:'原稿',x:20,y:30,sourceRef:'original-reference'});
 const fresh=captureBoardCreation({...restored,pendingCreate:undefined},{type:'create',ref:'new-block',title:'下一块',body:''});
 assert.notEqual(fresh.pendingCreate.requestId,draft.pendingCreate.requestId);
});
