import test from 'node:test';
import assert from 'node:assert/strict';
import {publishBoardStream,subscribeBoardStream,createBoardEventTracker} from './board-stream.js';

test('mounting after the initial board event receives cached text and later cancellation',()=>{
  const before=globalThis.window;globalThis.window=new EventTarget();
  try{
    publishBoardStream('current',{callId:'call',status:'streaming',title:'模型',body:'已经写到这里'});
    const seen=[],stop=subscribeBoardStream('current',value=>seen.push(value));
    assert.equal(seen.length,1);assert.equal(seen[0].body,'已经写到这里');
    publishBoardStream('another',{callId:'other',status:'pending'});assert.equal(seen.length,1);
    publishBoardStream('current',{callId:'call',status:'error'});assert.equal(seen.at(-1).status,'error');
    stop();publishBoardStream('current',{callId:'next',status:'streaming'});assert.equal(seen.length,2);
  }finally{globalThis.window=before;}
});

test('coauthor reads remain invisible while patches preview only their stable target and receipt status',()=>{
  const tracker=createBoardEventTracker(),entries=[];
  const append=event=>{entries.push({event});return tracker({revision:entries.length,entries});};
  for(const action of ['list','read','undo']){
    const result=append({type:'tool/call',data:{callId:action,name:'write_lesson_board',arguments:JSON.stringify({action,title:'不是待写板书',blockId:'card'})}});
    assert.equal(result.size,0,action+' must not create a writing preview');
  }
  const result=append({type:'tool/call',data:{callId:'patch',name:'write_lesson_board',arguments:JSON.stringify({action:'apply',ops:[{type:'patch',blockId:'saved-card',patch:{body:'老师的新正文'}}]})}});
  assert.deepEqual(result.get('patch'),{callId:'patch',status:'pending',action:'apply',blockId:'saved-card',operation:'patch'});
  assert.equal(Object.hasOwn(result.get('patch'),'body'),false,'saved card prose remains until the commit lands');
  const completed=append({type:'tool/result',data:{message:{source:{callId:'patch'},isError:false}}});
  assert.equal(completed.get('patch').status,'completed');
  append({type:'tool/call',data:{callId:'cancel',name:'write_lesson_board',arguments:JSON.stringify({action:'apply',ops:[{type:'patch',blockId:'saved-card',patch:{title:'新标题'}}]})}});
  append({type:'turn/end',data:{}});
  assert.equal(tracker({revision:entries.length,entries}).get('cancel').status,'error');
});
