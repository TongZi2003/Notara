import assert from 'node:assert/strict';
import test from 'node:test';
import {createVaultNavigation,selectedVaultDirectory,directoryLessons} from './shell-client.js';

function runtime(connect){
  const state={current:'old',byId:{old:{blank:false},fresh:{blank:true}}};
  const opened=[];
  return {state,opened,ctx:{
    workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'w',sessionIds:['old','fresh']}]})}},
    sessions:{list:{getSnapshot:()=>state},open:id=>{opened.push(id);state.current=id;}},
    uiWorkspace:{connectWorkspace:connect},
  }};
}
test('Home prepares the native blank lesson without copying, clearing or submitting a draft',async()=>{
  const r=runtime(async()=> 'fresh'),nav=createVaultNavigation();
  // No input service is needed: native input owns text, attachments and send.
  await nav.prepareHome(r.ctx);
  assert.equal(nav.getSnapshot().section,'today');
  assert.equal(nav.getSnapshot().homeSession,'fresh');
  assert.equal(r.state.current,'fresh');
});
test('leaving Home during preparation never steals the selected lesson',async()=>{
  let resolve;const r=runtime(()=>new Promise(done=>{resolve=done;})),nav=createVaultNavigation();
  const pending=nav.prepareHome(r.ctx);nav.show('library','graph');resolve('fresh');await pending;
  assert.equal(nav.getSnapshot().section,'library');assert.equal(r.state.current,'old');
  assert.equal(nav.getSnapshot().preparingHome,false);assert.deepEqual(r.opened,[]);
});
test('duplicate preparation connects once and user selection takes priority',async()=>{
  let resolve,calls=0;const r=runtime(()=>{calls++;return new Promise(done=>{resolve=done;});}),nav=createVaultNavigation();
  const pending=nav.prepareHome(r.ctx);await nav.prepareHome(r.ctx);r.state.current='another';
  resolve('fresh');await pending;assert.equal(calls,1);assert.equal(r.state.current,'another');assert.deepEqual(r.opened,[]);
});
test('Home refuses a nonblank response instead of offering an old lesson as new input',async()=>{
  const r=runtime(async()=> 'old'),nav=createVaultNavigation();await nav.prepareHome(r.ctx);
  assert.equal(nav.getSnapshot().homeSession,null);assert.ok(nav.getSnapshot().homeError);assert.deepEqual(r.opened,[]);
});
test('known prepared blank keeps its workspace while registration catches up, without a foreign-session fallback',()=>{
  const spaces={items:[{workspaceId:'w',sessionIds:[]},{workspaceId:'other',sessionIds:[]}]};
  const sessions={current:'fresh',byId:{fresh:{blank:true}}};
  const prepared={homeSession:'fresh',homeWorkspaceId:'w'};
  assert.equal(selectedVaultDirectory(spaces,sessions,'other',prepared)?.workspaceId,'w');
  assert.equal(selectedVaultDirectory(spaces,{...sessions,current:'foreign',byId:{foreign:{blank:true}}},'w',prepared),null);
  assert.equal(selectedVaultDirectory(spaces,{...sessions,byId:{fresh:{blank:false}}},'w',prepared),null);
});
test('Home respects the retained directory when selection is cleared',async()=>{
  let target;const r=runtime(async id=>{target=id;return 'fresh';}),nav=createVaultNavigation();
  r.state.current=undefined;
  r.ctx.workspaces.list.getSnapshot=()=>({items:[{workspaceId:'a',sessionIds:[]},{workspaceId:'b',sessionIds:['fresh']}]});
  nav.rememberDirectory('b');await nav.prepareHome(r.ctx);assert.equal(target,'b');
});
test('grouped review entry requests the due queue rather than a document path',()=>{
  const nav=createVaultNavigation();nav.showReviewQueue();
  assert.equal(nav.getSnapshot().section,'plan');assert.equal(nav.getSnapshot().plan,'review');
  assert.equal(nav.getSnapshot().request.reviewFilter,'due');assert.equal(nav.getSnapshot().request.focus,undefined);
});
test('directory lessons use registry membership and exclude archived, blank and worker records',()=>{
  const spaces={items:[{workspaceId:'a',sessionIds:['a2','a1','blank','worker','archived']},{workspaceId:'b',sessionIds:['b']}],archivedSessionIds:['archived']};
  const rows=[{id:'b',title:'同名课堂',cwd:'/course-extra'},{id:'a1',title:'同名课堂',cwd:'/course'},{id:'blank',blank:true},{id:'worker',origin:'subagent'},{id:'archived'},{id:'a2',cwd:'/course'},{id:'unregistered',cwd:'/course'}];
  const sessions={current:'a1',ids:rows.map(r=>r.id),byId:Object.fromEntries(rows.map(r=>[r.id,r]))};
  const directory=selectedVaultDirectory(spaces,sessions,'b');
  assert.equal(directory.workspaceId,'a');
  assert.deepEqual(directoryLessons(directory,spaces,sessions).map(row=>row.id),['a1','a2']);
  assert.deepEqual(directoryLessons(null,spaces,sessions),[]);
});
test('clearing the current lesson keeps a still-registered directory without guessing another',()=>{
  const spaces={items:[{workspaceId:'a',sessionIds:[]},{workspaceId:'b',sessionIds:[]}]};
  assert.equal(selectedVaultDirectory(spaces,{byId:{}},'b')?.workspaceId,'b');
  assert.equal(selectedVaultDirectory(spaces,{byId:{}},'removed'),null);
  assert.equal(selectedVaultDirectory(spaces,{current:'foreign',byId:{foreign:{}}},'b'),null);
});
test('an empty single directory can be selected before any lesson exists',()=>{
  const directory={workspaceId:'only',sessionIds:[]};
  assert.equal(selectedVaultDirectory({items:[directory]},{ids:[],byId:{}}),directory);
  assert.equal(selectedVaultDirectory({items:[]},{ids:[],byId:{}}),null);
});
