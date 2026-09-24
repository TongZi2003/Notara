import test from 'node:test';
import assert from 'node:assert/strict';
import {publishBoardStream,subscribeBoardStream} from './board-stream.js';

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
