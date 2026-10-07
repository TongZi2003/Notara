import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore,DRAFT_STORAGE_NOTICE} from './draft-client.js';
import {restoreAnswerDraft} from './board-answer-client.js';
function storage(t,value){const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{value,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});}

test('draft writes coalesce, flush the latest input, and cancel after a save',t=>{
  const writes=[],values=new Map();
  storage(t,{getItem:key=>values.get(key),setItem:(key,value)=>{writes.push(value);values.set(key,value);},removeItem:key=>values.delete(key)});
  const store=createDraftStore('regression');
  for(let n=0;n<100;n++)store.set('lesson',{text:String(n)});
  assert.equal(writes.length,0);
  assert.deepEqual(store.get('lesson'),{text:'99'});
  store.flush();
  assert.equal(writes.length,1);
  assert.deepEqual(JSON.parse(writes[0]),{text:'99'});
  store.set('lesson',{text:'saved'});store.delete('lesson');store.flush();
  assert.equal(writes.length,1);
  assert.equal(store.get('lesson'),undefined);
});

test('quota failure reports a notice while retaining the draft in memory',t=>{
  storage(t,{getItem:()=>null,setItem:()=>{throw new DOMException('full','QuotaExceededError');}});
  const store=createDraftStore('quota'),notices=[];
  store.subscribe((id,message)=>notices.push({id,message}));
  store.set('lesson',{text:'retained input'});store.flush();
  assert.deepEqual(store.get('lesson'),{text:'retained input'});
  assert.deepEqual(notices,[{id:'lesson',message:DRAFT_STORAGE_NOTICE}]);
});

test('old or malformed answer drafts fall back to the current component shape',()=>{
  const blank={fills:['',''],exit:null,note:''};
  for(const value of [null,{},[],{answer:'old'},{fills:['one'],exit:null,note:''},{fills:[null,''],exit:null,note:''}])assert.deepEqual(restoreAnswerDraft(value,blank),blank);
  const retained={fills:['one','two'],exit:null,note:'my input'};
  assert.equal(restoreAnswerDraft(retained,blank),retained);
  const choice={pick:[],reason:'',exit:null,note:''};
  assert.deepEqual(restoreAnswerDraft({pick:[0,1],reason:'why',exit:'unsure',note:''},choice),{pick:[0,1],reason:'why',exit:'unsure',note:''});
  const component={type:'choice',spec:{options:['a','b'],multiple:true}};
  for(const pick of [['x'],[999],[1.5],[0,0]])assert.equal(restoreAnswerDraft({...choice,pick},choice,component),choice);
  const validChoice={...choice,pick:[1]};assert.equal(restoreAnswerDraft(validChoice,choice,component),validChoice);
  const order={order:[0,1],exit:null,note:''},ordering={type:'order',spec:{items:['a','b']}};
  for(const items of [[999,1],[0,0],[0.5,1]])assert.equal(restoreAnswerDraft({...order,order:items},order,ordering),order);
  const grouped={assign:[-1,-1],exit:null,note:''},grouping={type:'order',spec:{items:['a','b'],groups:['one']}};
  assert.equal(restoreAnswerDraft({...grouped,assign:[0,0]},grouped,grouping).assign[0],0);
  assert.equal(restoreAnswerDraft({...grouped,assign:[0,2]},grouped,grouping),grouped);
  const point={values:{},point:null,exit:null,note:''},placed={values:{},point:{x:1,y:2},exit:null,note:''};
  assert.equal(restoreAnswerDraft(placed,point),placed);
});

test('discarded drafts do not resurrect when storage removal fails',t=>{
  const values=new Map([['notara:discard:lesson',JSON.stringify({text:'old draft'})]]);
  let failWrite=false;
  storage(t,{getItem:key=>values.get(key),removeItem:()=>{throw Error('remove failed');},setItem:(key,value)=>{if(failWrite)throw Error('write failed');values.set(key,value);}});
  const store=createDraftStore('discard');
  assert.deepEqual(store.get('lesson'),{text:'old draft'});
  assert.equal(store.delete('lesson'),true);
  assert.equal(createDraftStore('discard').get('lesson'),undefined,'the tombstone survives a new store');
  values.set('notara:discard:lesson',JSON.stringify({text:'another old draft'}));failWrite=true;
  const notices=[];store.subscribe((id,message)=>notices.push({id,message}));
  assert.equal(store.delete('lesson'),false);
  assert.equal(store.get('lesson'),undefined,'a failed persistent removal cannot restore a discarded draft in this page');
  assert.equal(notices.length,1);
  store.set('lesson',{text:'new input'});
  assert.deepEqual(store.get('lesson'),{text:'new input'});
  store.delete('lesson');
});
