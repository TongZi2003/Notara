import assert from 'node:assert/strict';
import test from 'node:test';
import {createVaultNavigation,readView,selectedVaultDirectory,directoryLessons} from './shell-client.js';

// DSH 0.2.0 has no `current` on the session list: the main view marks its
// session in `retainedBy.mainView`. The fixtures keep a `current` field for
// readability and turn it into that mark here.
const main=snapshot=>({...snapshot,byId:Object.fromEntries(Object.entries(snapshot.byId??{}).map(([id,row])=>[id,{...row,id,retainedBy:id===snapshot.current?{mainView:1}:{}}]))});
const selected=(spaces,sessions,...rest)=>selectedVaultDirectory(spaces,main(sessions),...rest);
const lessons=(directory,spaces,sessions)=>directoryLessons(directory,spaces,main(sessions));

function runtime(connect){
  const state={phase:'ready',current:'old',byId:{old:{blank:false,cwd:'/course'},fresh:{blank:true,cwd:'/course'}}};
  const opened=[];
  return {state,opened,ctx:{
    workspaces:{list:{getSnapshot:()=>({phase:'ready',items:[{workspaceId:'w',path:'/course',sessionIds:['old','fresh']}]}),subscribe:()=>()=>{}}},
    sessions:{list:{getSnapshot:()=>main(state)}},
    uiWorkspace:{connectWorkspace:connect,openSession:id=>{opened.push(id);state.current=id;}},
  }};
}
test('Home prepares the native blank lesson without copying, clearing or submitting a draft',async()=>{
  const r=runtime(async()=> 'fresh'),nav=createVaultNavigation();
  // No input service is needed: native input owns text, attachments and send.
  await nav.prepareHome(r.ctx);
  assert.equal(nav.getSnapshot().section,'home');
  assert.equal(nav.getSnapshot().homeSession,'fresh');
  assert.equal(r.state.current,'fresh');
});
test('leaving Home during preparation never steals the selected lesson',async()=>{
  let resolve;const r=runtime(()=>new Promise(done=>{resolve=done;})),nav=createVaultNavigation();
  const pending=nav.prepareHome(r.ctx);nav.show('vault','graph');resolve('fresh');await pending;
  assert.equal(nav.getSnapshot().section,'vault');assert.equal(r.state.current,'old');
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
  assert.equal(selected(spaces,sessions,'other',prepared)?.workspaceId,'w');
  assert.equal(selected(spaces,{...sessions,current:'foreign',byId:{foreign:{blank:true}}},'w',prepared),null);
  assert.equal(selected(spaces,{...sessions,byId:{fresh:{blank:false}}},'w',prepared),null);
});
test('a worker record shown from a lesson keeps the lesson\'s directory',()=>{
  const spaces={items:[{workspaceId:'w',sessionIds:['lesson']},{workspaceId:'other',sessionIds:[]}]};
  const sessions={current:'child',byId:{lesson:{blank:false},child:{blank:false,origin:'subagent',parentId:'lesson'}}};
  assert.equal(selected(spaces,sessions,'other')?.workspaceId,'w');
  assert.equal(selected(spaces,{...sessions,byId:{...sessions.byId,child:{blank:false,origin:'subagent',parentId:'gone'}}},'other'),null);
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
  const directory=selected(spaces,sessions,'b');
  assert.equal(directory.workspaceId,'a');
  assert.deepEqual(lessons(directory,spaces,sessions).map(row=>row.id),['a1','a2']);
  assert.deepEqual(lessons(null,spaces,sessions),[]);
});
test('clearing the current lesson keeps a still-registered directory without guessing another',()=>{
  const spaces={items:[{workspaceId:'a',sessionIds:[]},{workspaceId:'b',sessionIds:[]}]};
  assert.equal(selected(spaces,{byId:{}},'b')?.workspaceId,'b');
  assert.equal(selected(spaces,{byId:{}},'removed'),null);
  assert.equal(selected(spaces,{current:'foreign',byId:{foreign:{}}},'b'),null);
});
test('an empty single directory can be selected before any lesson exists',()=>{
  const directory={workspaceId:'only',sessionIds:[]};
  assert.equal(selected({items:[directory]},{ids:[],byId:{}}),directory);
  assert.equal(selected({items:[]},{ids:[],byId:{}}),null);
});

function tabStore(initial){
  const map=new Map(initial?[['notara-vault-view',JSON.stringify(initial)]]:[]);
  return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
}
test('a reloaded tab reopens its lesson with the same panes instead of preparing Home',async()=>{
  const r=runtime(async()=> 'fresh'),storage=tabStore({sessionId:'old',layout:{left:'board',right:'chat',ratio:68}});
  r.state.current='fresh';
  const nav=createVaultNavigation({storage});
  assert.equal(nav.getSnapshot().section,'lesson','Home must not replace the selection first');
  await nav.resume(r.ctx);
  assert.deepEqual(r.opened,['old']);
  assert.equal(nav.getSnapshot().resuming,false);
  assert.deepEqual(nav.takeLayout('old'),{left:'board',right:'chat',ratio:68});
  assert.equal(nav.takeLayout('old'),undefined,'the panes are handed out once');
});
test('a reload waits for DSH to restore its own selection before reopening the lesson',async()=>{
  const r=runtime(async()=> 'fresh'),listeners=new Set(),storage=tabStore({sessionId:'old',layout:{left:'chat',right:null,ratio:62}});
  r.state.current=undefined;
  r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  const nav=createVaultNavigation({storage}),pending=nav.resume(r.ctx);
  await new Promise(done=>setTimeout(done,20));
  assert.deepEqual(r.opened,[],'nothing is opened while DSH is still restoring');
  r.state.current='fresh';for(const fn of [...listeners])fn();
  await pending;
  assert.deepEqual(r.opened,['old']);
  assert.equal(listeners.size,0,'the wait unsubscribes');
});
test('a reloaded blank lesson keeps its exact identity even when DSH restored another blank first',async()=>{
  const r=runtime(async()=> 'other'),storage=tabStore({sessionId:'fresh',layout:{left:'chat',right:null,ratio:62}});
  r.state.byId.other={blank:true,cwd:'/course'};r.state.current='other';
  r.ctx.workspaces.list.getSnapshot=()=>({phase:'ready',items:[{workspaceId:'w',path:'/course',sessionIds:['other','fresh']}]});
  const nav=createVaultNavigation({storage});await nav.resume(r.ctx);
  assert.equal(nav.getSnapshot().section,'lesson');assert.equal(r.state.current,'fresh');
  assert.deepEqual(r.opened,['fresh']);
  let starts=0;r.ctx.uiWorkspace.startSession=()=>{starts++;};
  assert.equal(nav.startLesson(r.ctx,'w'),true);
  assert.deepEqual(r.opened,['fresh','fresh']);assert.equal(starts,0,'native blank enumeration must not replace the current blank');
});
test('a reloaded tab drops missing, archived, worker and foreign blank lessons',async()=>{
  for(const id of ['missing','archived','worker','unregistered','foreign']){
    const r=runtime(async()=> 'fresh'),storage=tabStore({sessionId:id,layout:{left:'chat',right:null,ratio:62}}),nav=createVaultNavigation({storage});
    r.state.byId.archived={blank:true,cwd:'/course'};r.state.byId.worker={blank:false,origin:'subagent'};
    r.state.byId.unregistered={blank:true,cwd:'/course'};r.state.byId.foreign={blank:true,cwd:'/elsewhere'};
    r.ctx.workspaces.list.getSnapshot=()=>({phase:'ready',items:[{workspaceId:'w',path:'/course',sessionIds:['old','fresh','archived','worker','foreign']}],archivedSessionIds:['archived']});
    await nav.resume(r.ctx);
    assert.equal(nav.getSnapshot().section,'home');assert.deepEqual(r.opened,[]);
    assert.deepEqual(readView(storage),{section:'home',plan:'calendar',vault:'files'},'the lesson is forgotten; Home is remembered');
  }
});
test('new lessons wait for restoration and keep explicit workspace switches native',()=>{
  const r=runtime(async()=> 'fresh'),nav=createVaultNavigation({storage:tabStore({sessionId:'fresh'})}),starts=[];
  r.ctx.uiWorkspace.startSession=id=>starts.push(id);
  assert.equal(nav.startLesson(r.ctx,'w'),false);assert.deepEqual(starts,[]);
  nav.show('home');r.state.current=undefined;
  assert.equal(nav.startLesson(r.ctx,'w'),false);assert.deepEqual(starts,[]);
  r.state.current='fresh';
  r.ctx.workspaces.list.getSnapshot=()=>({phase:'ready',items:[{workspaceId:'w',path:'/course',sessionIds:['old','fresh']},{workspaceId:'other',path:'/other',sessionIds:[]}]});
  assert.equal(nav.startLesson(r.ctx,'other'),true);assert.deepEqual(starts,['other']);assert.deepEqual(r.opened,[]);
  r.state.current='old';assert.equal(nav.startLesson(r.ctx,'w'),true);assert.deepEqual(starts,['other','w']);
});
test('blank lesson restoration waits for workspace membership instead of forgetting a pending directory',async()=>{
  const r=runtime(async()=> 'fresh'),listeners=new Set(),spaceListeners=new Set(),storage=tabStore({sessionId:'fresh'});
  let spaces={phase:'pending',items:[]};
  r.ctx.workspaces.list.getSnapshot=()=>spaces;
  r.ctx.workspaces.list.subscribe=fn=>{spaceListeners.add(fn);return()=>spaceListeners.delete(fn);};
  r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  const nav=createVaultNavigation({storage}),pending=nav.resume(r.ctx);
  await new Promise(done=>setTimeout(done,20));
  assert.equal(nav.getSnapshot().resuming,true);assert.deepEqual(r.opened,[]);
  assert.equal(readView(storage).sessionId,'fresh');
  spaces={phase:'ready',items:[{workspaceId:'w',path:'/course',sessionIds:['old','fresh']}]};
  for(const fn of [...spaceListeners])fn();await pending;
  assert.equal(nav.getSnapshot().section,'lesson');assert.equal(nav.getSnapshot().resuming,false);
  assert.deepEqual(r.opened,['fresh']);assert.equal(listeners.size,0);assert.equal(spaceListeners.size,0);
});
test('a late workspace feed preserves the saved blank identity after the bounded restore wait',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const r=runtime(async()=> 'fresh'),listeners=new Set(),spaceListeners=new Set(),storage=tabStore({sessionId:'fresh'});
  let spaces={phase:'pending',items:[]};
  r.ctx.workspaces.list.getSnapshot=()=>spaces;
  r.ctx.workspaces.list.subscribe=fn=>{spaceListeners.add(fn);return()=>spaceListeners.delete(fn);};
  r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  const nav=createVaultNavigation({storage}),pending=nav.resume(r.ctx);
  t.mock.timers.tick(5000);await pending;
  assert.equal(nav.getSnapshot().resuming,true);assert.equal(readView(storage).sessionId,'fresh');
  assert.equal(listeners.size,1);assert.equal(spaceListeners.size,1);
  spaces={phase:'ready',items:[{workspaceId:'w',path:'/course',sessionIds:['old','fresh']}]};
  for(const fn of [...spaceListeners])fn();
  assert.equal(nav.getSnapshot().resuming,false);assert.deepEqual(r.opened,['fresh']);assert.equal(listeners.size,0);assert.equal(spaceListeners.size,0);
});
test('a pending session feed cannot erase the saved lesson when the restore timeout expires',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const r=runtime(async()=> 'fresh'),listeners=new Set(),spaceListeners=new Set(),storage=tabStore({sessionId:'fresh'}),rows=r.state.byId;
  r.state.phase='pending';r.state.current=undefined;r.state.byId={};
  r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  r.ctx.workspaces.list.subscribe=fn=>{spaceListeners.add(fn);return()=>spaceListeners.delete(fn);};
  const nav=createVaultNavigation({storage}),pending=nav.resume(r.ctx);
  t.mock.timers.tick(5000);await pending;
  assert.equal(nav.getSnapshot().section,'lesson');assert.equal(nav.getSnapshot().resuming,true);
  assert.equal(readView(storage).sessionId,'fresh');assert.deepEqual(r.opened,[]);
  assert.equal(listeners.size,1);assert.equal(spaceListeners.size,1);
  r.state.phase='ready';r.state.current='old';r.state.byId=rows;
  for(const fn of [...listeners])fn();
  assert.equal(nav.getSnapshot().resuming,false);assert.deepEqual(r.opened,['fresh']);
  assert.equal(listeners.size,0);assert.equal(spaceListeners.size,0);
});
test('late session and workspace baselines may arrive in either order without changing the saved lesson',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const first of ['sessions','workspaces']){
    const r=runtime(async()=> 'fresh'),listeners=new Set(),spaceListeners=new Set(),storage=tabStore({sessionId:'fresh'}),rows=r.state.byId;
    let spaces={phase:'pending',items:[]};
    r.state.phase='pending';r.state.current=undefined;r.state.byId={};
    r.ctx.workspaces.list.getSnapshot=()=>spaces;
    r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
    r.ctx.workspaces.list.subscribe=fn=>{spaceListeners.add(fn);return()=>spaceListeners.delete(fn);};
    const nav=createVaultNavigation({storage}),pending=nav.resume(r.ctx);
    t.mock.timers.tick(5000);await pending;
    for(const feed of [first,first==='sessions'?'workspaces':'sessions']){
      if(feed==='sessions'){r.state.phase='ready';r.state.current='old';r.state.byId=rows;for(const fn of [...listeners])fn();}
      else{spaces={phase:'ready',items:[{workspaceId:'w',path:'/course',sessionIds:['old','fresh']}]};for(const fn of [...spaceListeners])fn();}
      if(feed===first){assert.equal(nav.getSnapshot().resuming,true);assert.equal(readView(storage).sessionId,'fresh');assert.deepEqual(r.opened,[]);}
    }
    assert.equal(nav.getSnapshot().resuming,false);assert.deepEqual(r.opened,['fresh']);
    assert.equal(listeners.size,0);assert.equal(spaceListeners.size,0);
  }
});
test('ready baselines still restore the saved lesson after the bounded native-selection wait',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const r=runtime(async()=> 'fresh'),listeners=new Set(),spaceListeners=new Set(),nav=createVaultNavigation({storage:tabStore({sessionId:'fresh'})});
  r.state.current=undefined;
  r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  r.ctx.workspaces.list.subscribe=fn=>{spaceListeners.add(fn);return()=>spaceListeners.delete(fn);};
  const pending=nav.resume(r.ctx);t.mock.timers.tick(5000);await pending;
  assert.equal(nav.getSnapshot().resuming,false);assert.deepEqual(r.opened,['fresh']);
  assert.equal(listeners.size,0);assert.equal(spaceListeners.size,0);
});
test('explicit navigation cancels the initial restore wait immediately',async()=>{
  const r=runtime(async()=> 'fresh'),listeners=new Set(),spaceListeners=new Set(),nav=createVaultNavigation({storage:tabStore({sessionId:'fresh'})});
  r.state.current=undefined;
  r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  r.ctx.workspaces.list.subscribe=fn=>{spaceListeners.add(fn);return()=>spaceListeners.delete(fn);};
  const pending=nav.resume(r.ctx);nav.show('plan');
  assert.equal(listeners.size,0);assert.equal(spaceListeners.size,0);await pending;
  assert.equal(nav.getSnapshot().section,'plan');assert.equal(nav.getSnapshot().resuming,false);assert.deepEqual(r.opened,[]);
});
test('explicit navigation removes both late-feed subscriptions and never reopens the previous lesson',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const moves=[nav=>nav.show('plan'),nav=>nav.showReviewQueue(),nav=>nav.adoptHome('fresh','w'),(nav,ctx)=>nav.openLesson(ctx,'old')];
  for(const move of moves){
    const r=runtime(async()=> 'fresh'),listeners=new Set(),spaceListeners=new Set(),nav=createVaultNavigation({storage:tabStore({sessionId:'fresh'})});
    let spaces={phase:'pending',items:[]};
    r.ctx.workspaces.list.getSnapshot=()=>spaces;
    r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
    r.ctx.workspaces.list.subscribe=fn=>{spaceListeners.add(fn);return()=>spaceListeners.delete(fn);};
    const pending=nav.resume(r.ctx);t.mock.timers.tick(5000);await pending;
    assert.equal(listeners.size,1);assert.equal(spaceListeners.size,1);
    const queued=[...listeners,...spaceListeners];move(nav,r.ctx);
    assert.equal(nav.getSnapshot().resuming,false);assert.equal(listeners.size,0);assert.equal(spaceListeners.size,0);
    const opened=[...r.opened];
    spaces={phase:'ready',items:[{workspaceId:'w',path:'/course',sessionIds:['old','fresh']}]};
    for(const fn of queued)fn();
    assert.deepEqual(r.opened,opened,'even an already queued feed notification cannot reopen the saved lesson');
  }
});
test('disposing navigation cancels pending restoration and all of its subscriptions',async()=>{
  const r=runtime(async()=> 'fresh'),listeners=new Set(),spaceListeners=new Set(),nav=createVaultNavigation({storage:tabStore({sessionId:'fresh'})});
  r.state.current=undefined;
  r.ctx.sessions.list.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  r.ctx.workspaces.list.subscribe=fn=>{spaceListeners.add(fn);return()=>spaceListeners.delete(fn);};
  const pending=nav.resume(r.ctx);nav.dispose();await pending;
  assert.equal(listeners.size,0);assert.equal(spaceListeners.size,0);assert.deepEqual(r.opened,[]);
  assert.equal(nav.startLesson(r.ctx,'w'),false);
});
test('a lesson is remembered with its panes, any other section as itself; never while resuming, and moving away first cancels the resume',async()=>{
  const storage=tabStore(),nav=createVaultNavigation({storage});
  // Nothing to resume: asking for panes, even before any lesson is selected, is harmless.
  assert.equal(nav.takeLayout(undefined),undefined);assert.equal(nav.takeLayout('old'),undefined);
  nav.rememberLesson('old',{left:'chat',right:null,ratio:62});
  assert.deepEqual(JSON.parse(storage.map.get('notara-vault-view')),{section:'home',plan:'calendar',vault:'files'},'Home is not a lesson');
  nav.show('lesson');nav.rememberLesson('old',{left:'board',right:'chat',ratio:68,extra:1});
  assert.deepEqual(JSON.parse(storage.map.get('notara-vault-view')),{section:'lesson',sessionId:'old',layout:{left:'board',right:'chat',ratio:68}});
  nav.show('vault','graph');
  assert.deepEqual(JSON.parse(storage.map.get('notara-vault-view')),{section:'vault',plan:'calendar',vault:'graph'});
  const r=runtime(async()=> 'fresh'),again=createVaultNavigation({storage:tabStore({sessionId:'old',layout:{left:'chat',right:null,ratio:62}})});
  again.rememberLesson('fresh',{left:'chat',right:null,ratio:62});
  again.show('plan');await again.resume(r.ctx);
  assert.deepEqual(r.opened,[],'the student already moved on');
});

test('sections are home, plan, vault and skills; a lesson still belongs to Home',()=>{
  const navigation=createVaultNavigation({storage:tabStore()});
  assert.equal(navigation.getSnapshot().section,'home');
  assert.equal(navigation.getSnapshot().plan,'calendar','计划 opens on 日历');
  navigation.show('vault','cards');
  assert.deepEqual([navigation.getSnapshot().section,navigation.getSnapshot().vault],['vault','cards']);
  navigation.show('plan','scheduled');
  assert.equal(navigation.getSnapshot().plan,'scheduled');
  navigation.show('lesson');
  navigation.show('home');
  assert.equal(navigation.getSnapshot().homeSession,null,'Home prepares its own blank lesson again');
});

test('a reload returns to the section and view; old lesson-only records still resume the lesson',()=>{
  const storage=tabStore();
  const first=createVaultNavigation({storage});
  first.show('plan','review');
  first.rememberLesson(null,{left:'chat',right:null,ratio:62});
  assert.deepEqual(readView(storage),{section:'plan',plan:'review',vault:'files'});
  const again=createVaultNavigation({storage});
  assert.deepEqual([again.getSnapshot().section,again.getSnapshot().plan,again.getSnapshot().resuming],['plan','review',false]);
  // Records written before 0.18.0 carry only the lesson.
  const resumed=createVaultNavigation({storage:tabStore({sessionId:'s1',layout:{left:'board',right:'chat',ratio:68}})});
  assert.deepEqual([resumed.getSnapshot().section,resumed.getSnapshot().resuming],['lesson',true]);
  assert.deepEqual(resumed.takeLayout('s1'),{left:'board',right:'chat',ratio:68});
  // Unknown sections and views fall back instead of opening nothing.
  assert.equal(readView(tabStore({section:'plugins'})),null);
  assert.deepEqual(readView(tabStore({section:'vault',vault:'x'})),{section:'vault',plan:'calendar',vault:'files'});
});

test('commands, route and file selection, drafts, the directory picker and board focus',()=>{
  const navigation=createVaultNavigation({storage:tabStore()});
  navigation.command('vault','files',{type:'create-code'});
  assert.deepEqual([navigation.getSnapshot().section,navigation.getSnapshot().request.command],['vault',{type:'create-code'}]);
  navigation.selectRoute('路线/概率.md');navigation.selectFile('卡片/a.md');
  assert.deepEqual([navigation.getSnapshot().routePath,navigation.getSnapshot().filePath],['路线/概率.md','卡片/a.md']);
  navigation.show('plan','routes');
  navigation.queueDraft('帮我规划一条学习路线');
  assert.equal(navigation.getSnapshot().section,'home');
  assert.equal(navigation.takeDraft().text,'帮我规划一条学习路线');
  assert.equal(navigation.takeDraft(),null,'a draft is handed out once');
  const before=navigation.getSnapshot().pickerRequest;
  navigation.requestDirectoryPicker();
  assert.ok(navigation.getSnapshot().pickerRequest>before);
  let calls=0;const stop=navigation.subscribe(()=>calls++);
  navigation.setBoardFocus(true);navigation.setBoardFocus(true);
  assert.equal(calls,1,'an unchanged board focus does not notify');
  stop();
});

test('a sentence waiting for Home is dropped once the student leaves Home',()=>{
  const navigation=createVaultNavigation({storage:tabStore()});
  navigation.queueDraft('帮我规划一条学习路线');
  navigation.show('plan','calendar');
  assert.equal(navigation.getSnapshot().pendingDraft,null);
  assert.equal(navigation.takeDraft(),null);
  navigation.queueDraft('帮我规划一条学习路线');navigation.show('home');
  assert.equal(navigation.takeDraft()?.text,'帮我规划一条学习路线','staying on Home keeps it');
});

test('a directory opened from the picker lands on Home with its blank lesson',()=>{
  const navigation=createVaultNavigation({storage:tabStore()});
  navigation.show('lesson');
  navigation.adoptHome('blank-b','w-b');
  const value=navigation.getSnapshot();
  assert.deepEqual([value.section,value.homeSession,value.homeWorkspaceId,value.directoryId],['home','blank-b','w-b','w-b']);
});
