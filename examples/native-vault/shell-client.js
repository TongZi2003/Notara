import { createVaultClient, visibleInterval } from './remote-client.js';
import { civilDay } from './calendar-data.js';
import { VIEW_IDS } from './views-client.js';
import { homeQueue } from './home-queue.js';
import { insertComposerText } from './composer-insert.js';
import { currentSessionId, mainViewSettled } from './session-current.js';

/** Set by the build from the plugin's package.json; absent when this module runs unbundled in tests. */
// eslint-disable-next-line no-undef
const NOTARA_VERSION=typeof __NOTARA_VERSION__==='string'?__NOTARA_VERSION__:'';

/** Directory membership comes from the native registry, not a path-prefix guess. */
export function selectedVaultDirectory(spaces,sessions,rememberedId,prepared){
  const items=spaces.items??[];
  const current=currentSessionId(sessions);
  const owner=items.find(item=>item.sessionIds?.includes(current));
  if(owner)return owner;
  // A worker's record opened from the classroom belongs to its lesson's directory.
  const row=sessions.byId?.[current];
  if(row?.origin==='subagent'&&row.parentId){
    const lesson=items.find(item=>item.sessionIds?.includes(row.parentId));if(lesson)return lesson;
  }
  // A session created by Home has a known workspace even if that workspace's
  // membership notification arrives one tick after the session notification.
  if(prepared?.homeSession===currentSessionId(sessions)&&sessions.byId?.[currentSessionId(sessions)]?.blank===true){
    const pending=items.find(item=>item.workspaceId===prepared.homeWorkspaceId);if(pending)return pending;
  }
  // A loaded but unregistered selection must not display another folder's lessons.
  if(currentSessionId(sessions)&&sessions.byId?.[currentSessionId(sessions)])return null;
  return items.find(item=>item.workspaceId===rememberedId)??(items.length===1?items[0]:null);
}
export function directoryLessons(directory,spaces,sessions){
  if(!directory)return [];
  const members=new Set(directory.sessionIds??[]),archived=new Set(spaces.archivedSessionIds??[]);
  return sessions.ids.map(id=>sessions.byId[id]).filter(row=>row&&members.has(row.id)&&!archived.has(row.id)&&!row.blank&&row.origin!=='subagent');
}

/** What a tab showed survives a reload of that tab; sessionStorage is per tab,
 * so a new tab or a fresh login still opens Home. */
const VIEW_KEY='notara-vault-view';
const SECTIONS=new Set(['home','plan','vault','skills']);
const PLAN_VIEW_IDS=['calendar','routes','review','scheduled'],VAULT_VIEW_IDS=['files','cards','graph'];
/** How long a reload waits for DSH to restore its selection before reopening the lesson anyway. */
const RESUME_WAIT_MS=5000;
function tabStorage(storage){try{return storage??globalThis.sessionStorage??null;}catch{return null;}}
/** What this tab showed before a reload: a lesson with its panes, or a section and its view. */
export function readView(storage){
  try{
    const value=JSON.parse(storage?.getItem(VIEW_KEY)??'null');
    if(!value||typeof value!=='object')return null;
    // Records written before 0.18.0 carry only the lesson.
    if((value.section===undefined||value.section==='lesson')&&typeof value.sessionId==='string'&&value.sessionId)
      return {section:'lesson',sessionId:value.sessionId,layout:value.layout&&typeof value.layout==='object'?value.layout:null};
    if(!SECTIONS.has(value.section))return null;
    return {section:value.section,plan:PLAN_VIEW_IDS.includes(value.plan)?value.plan:'calendar',vault:VAULT_VIEW_IDS.includes(value.vault)?value.vault:'files'};
  }catch{return null;}
}

/** UI navigation only. Session identity, drafts and all learning facts stay native. */
export function createVaultNavigation({storage}={}) {
  const store=tabStorage(storage),saved=readView(store),resume=saved?.section==='lesson'?saved:null;
  // A reloaded lesson starts on the lesson page, so Home never replaces the
  // native selection with a blank lesson before resume() reopens it.
  let value={section:saved?.section??'home',vault:saved?.vault??'files',plan:saved?.plan??'calendar',request:null,serial:0,preparingHome:false,homeSession:null,homeWorkspaceId:null,homeError:'',debug:false,directoryId:null,resuming:!!resume,
    routePath:'',filePath:'',pendingDraft:null,pickerRequest:0,boardFocus:false};
  let resumeLayout=resume?.layout?{sessionId:resume.sessionId,layout:resume.layout}:null;
  const listeners=new Set();
  let controller=null;
  const notify=()=>{for(const fn of listeners)fn();};
  const publish=patch=>{value={...value,...patch};notify();};
  const write=record=>{try{store?.setItem(VIEW_KEY,JSON.stringify(record));}catch{/* storage unavailable */}};
  const forget=()=>{resumeLayout=null;try{store?.removeItem(VIEW_KEY);}catch{/* storage unavailable */}};
  const rememberSection=()=>{if(!value.resuming&&value.section!=='lesson')write({section:value.section,plan:value.plan,vault:value.vault});};
  const move=(section,tab,request)=>{
    if(section!=='home')controller?.abort();
    // A sentence waiting for Home's composer is meant for this visit only.
    value={...value,section,resuming:false,...(section==='home'?{homeSession:null,homeError:''}:{pendingDraft:null}),...(section==='vault'&&tab?{vault:tab}:{}),...(section==='plan'&&tab?{plan:tab}:{}),request,serial:value.serial+1};
    rememberSection();notify();
  };
  return {
    getSnapshot:()=>value,
    subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    show(section,tab,focus=''){move(section,tab,focus?{focus,nonce:value.serial+1}:null);},
    /** Ask the view of a section to run one of its own actions (新建, 导入, 带入对话…). */
    command(section,tab,command){move(section,tab,{command,nonce:value.serial+1});},
    complete(){if(!value.request)return;value={...value,request:null};notify();},
    showReviewQueue(){
      controller?.abort();
      value={...value,section:'plan',plan:'review',resuming:false,pendingDraft:null,request:{reviewFilter:'due',nonce:value.serial+1},serial:value.serial+1};
      rememberSection();notify();
    },
    selectRoute(path){if(value.routePath!==path)publish({routePath:path});},
    selectFile(path){if(value.filePath!==path)publish({filePath:path});},
    /** Home, with a sentence waiting to go into its composer (inserted, never sent). */
    queueDraft(text){move('home',undefined,null);publish({pendingDraft:{text,nonce:value.serial}});},
    takeDraft(){const draft=value.pendingDraft;if(draft)publish({pendingDraft:null});return draft??null;},
    requestDirectoryPicker(){publish({pickerRequest:value.pickerRequest+1});},
    /** A directory picked on Home: its blank lesson becomes Home's own, so the student stays on Home. */
    adoptHome(sessionId,workspaceId){
      controller?.abort();
      value={...value,section:'home',resuming:false,homeSession:sessionId,homeWorkspaceId:workspaceId,directoryId:workspaceId,homeError:'',request:null,serial:value.serial+1};
      rememberSection();notify();
    },
    setBoardFocus(focused){if(value.boardFocus!==focused)publish({boardFocus:focused});},
    setDebug(debug){publish({debug});},
    rememberDirectory(directoryId){if(value.directoryId!==directoryId)publish({directoryId});},
    async prepareHome(ctx){
      if(value.preparingHome||value.section!=='home')return;
      const spaces=ctx.workspaces.list.getSnapshot(),sessions=ctx.sessions.list.getSnapshot();
      const directory=selectedVaultDirectory(spaces,sessions,value.directoryId);
      if(!directory){publish({homeError:'请先选择学习目录。'});return;}
      const attempt=new AbortController(),before=currentSessionId(sessions),serial=value.serial;
      controller=attempt;publish({preparingHome:true,homeError:''});
      try{
        const id=await ctx.uiWorkspace.connectWorkspace(directory.workspaceId);
        if(attempt.signal.aborted||controller!==attempt||value.serial!==serial||value.section!=='home')return;
        const latest=ctx.sessions.list.getSnapshot();
        if(currentSessionId(latest)!==before&&currentSessionId(latest)!==id)return;
        if(!id||latest.byId[id]?.blank!==true)throw new Error('not_blank');
        // Publish ownership before selection changes, so the workspace knows
        // this is Home preparing its native input, not an explicit lesson open.
        publish({homeSession:id,homeWorkspaceId:directory.workspaceId,directoryId:directory.workspaceId});ctx.uiWorkspace.openSession(id);
      }catch{if(!attempt.signal.aborted&&value.serial===serial)publish({homeError:'输入框暂时没有准备好，请重试。'});}
      finally{if(controller===attempt){controller=null;publish({preparingHome:false});}}
    },
    /** Open a lesson from elsewhere (the library, a record) on a chosen view. */
    openLesson(ctx,sessionId,view='chat'){
      controller?.abort();
      publish({section:'lesson',resuming:false,homeSession:null,pendingDraft:null,layoutRequest:{sessionId,view,nonce:value.serial+1},serial:value.serial+1});
      ctx.uiWorkspace.openSession(sessionId);
    },
    completeLayoutRequest(){if(value.layoutRequest)publish({layoutRequest:null});},
    /** Remember the lesson and its panes shown in this tab; any other section remembers itself. */
    rememberLesson(sessionId,layout){
      if(value.resuming)return;
      if(value.section!=='lesson'){rememberSection();return;}
      if(!sessionId){forget();return;}
      write({section:'lesson',sessionId,layout:{left:layout.left,right:layout.right,ratio:layout.ratio}});
    },
    /** The panes a reloaded lesson had, handed out once. */
    takeLayout(sessionId){
      if(!resumeLayout||!sessionId||resumeLayout.sessionId!==sessionId)return undefined;
      const {layout}=resumeLayout;resumeLayout=null;return layout;
    },
    /** Reopen the lesson this tab showed before a reload, once DSH has restored its
     * own selection: opening earlier races that restore. The wait is bounded, so a
     * restore that never lands still lets the lesson come back. */
    async resume(ctx){
      if(!resume||!value.resuming)return;
      const list=ctx.sessions.list,settled=()=>{const snapshot=list.getSnapshot();return snapshot.phase!=='pending'&&currentSessionId(snapshot)!==undefined;};
      if(!settled())await new Promise(done=>{
        let stop=()=>{};
        const finish=()=>{clearTimeout(timer);stop();done();};
        const timer=setTimeout(finish,RESUME_WAIT_MS);
        stop=list.subscribe(()=>{if(settled())finish();});
        if(settled())finish();
      });
      if(!value.resuming)return;
      const snapshot=list.getSnapshot(),row=snapshot.byId?.[resume.sessionId];
      publish({resuming:false});
      if(!row||row.blank===true||row.origin==='subagent'){forget();if(value.section==='lesson')this.show('home');return;}
      if(currentSessionId(snapshot)!==resume.sessionId)ctx.uiWorkspace.openSession(resume.sessionId);
    },
    dispose(){controller?.abort();controller=null;listeners.clear();},
  };
}

export function createVaultShell(React,{navigation,Icon,IconButton,Dialog,TodayEntry,EmptyState}) {
  const h=React.createElement,{useState,useEffect,useRef,useMemo,useSyncExternalStore}=React;
  const useNav=()=>useSyncExternalStore(navigation.subscribe,navigation.getSnapshot);
  const useSessions=ctx=>useSyncExternalStore(fn=>ctx.sessions.list.subscribe(fn),()=>ctx.sessions.list.getSnapshot());
  const useSpaces=ctx=>useSyncExternalStore(fn=>ctx.workspaces.list.subscribe(fn),()=>ctx.workspaces.list.getSnapshot());
  function Today({ctx,sessionId,visible,onView,children}) {
    const sessions=useSessions(ctx),spaces=useSpaces(ctx),nav=useNav();
    const directory=selectedVaultDirectory(spaces,sessions,nav.directoryId,nav);
    const targetSession=directory?.sessionIds?.includes(sessionId)||(sessionId===nav.homeSession&&nav.homeWorkspaceId===directory?.workspaceId)?sessionId:directory?.sessionIds?.find(id=>sessions.byId[id]);
    const ready=spaces.phase==='ready'&&!!directory&&(!!targetSession||spaces.items.length===1);
    const scopeKey=directory?.workspaceId??'',vault=useMemo(()=>createVaultClient(ctx,targetSession),[ctx,targetSession]);
    const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[tick,setTick]=useState(0);
    const [appointment,setAppointment]=useState(null),[date,setDate]=useState(''),[saving,setSaving]=useState(false),[scheduleError,setScheduleError]=useState('');
    const savingRef=useRef(false),scope=useRef(scopeKey),request=useRef(0);scope.current=scopeKey;
    const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const current=sessions.byId[sessionId];
    const composerReady=!!sessionId&&sessionId===nav.homeSession&&current?.blank===true;
    // A sentence another page asked to put into Home's composer (去对话里规划): inserted, never sent.
    const [draftError,setDraftError]=useState('');
    useEffect(()=>{if(!visible)setDraftError('');},[visible]);
    useEffect(()=>{
      if(!visible||!composerReady||!nav.pendingDraft)return;
      const draft=navigation.takeDraft();
      if(draft&&!insertComposerText(ctx,sessionId,draft.text))setDraftError(`没能放进输入框，直接在输入框里说“${draft.text}”就好。`);
      else{setDraftError('');requestAnimationFrame(()=>document.querySelector('[data-composer-input]')?.focus({preventScroll:true}));}
    },[visible,composerReady,nav.pendingDraft?.nonce]);
    useEffect(()=>{
      if(!visible||spaces.phase!=='ready'||!directory||nav.preparingHome||nav.homeError)return;
      if(sessionId&&sessionId===nav.homeSession){
        if(current&&current.blank!==true)navigation.show('lesson');
        return;
      }
      void navigation.prepareHome(ctx);
    },[visible,spaces.phase,scopeKey,sessionId,current?.blank,nav.homeSession,nav.preparingHome,nav.homeError]);
    const items=useMemo(()=>data?.scopeKey===scopeKey?homeQueue(data.queue,data.routes).slice(0,8):[],[data,scopeKey]);
    async function read(){
      if(!ready)return;
      const serial=++request.current,owner=scopeKey;
      const results=await Promise.allSettled([vault.reviewQueue({status:'due',limit:8,offset:0,timeZone}),vault.routes({})]);
      if(serial!==request.current||scope.current!==owner)return;
      const values=results.map(result=>result.status==='fulfilled'&&result.value?.ok?result.value.value:null);
      setData({scopeKey:owner,queue:values[0],routes:values[1]});
      setError(values.some(value=>!value)?'部分待办暂时无法读取。':values.some(value=>value.truncated||value.unreadable||value.invalid?.length)?'部分资料需要检查，当前只显示可读取的待办。':'');
      setLoading(false);
    }
    useEffect(()=>{
      if(!visible)return;
      setError('');setLoading(true);setData(null);
      if(!ready){setLoading(spaces.phase!=='ready');return;}
      void read();const timer=visibleInterval(read,15000);
      window.addEventListener('focus',read);window.addEventListener('notara-vault-changed',read);
      return()=>{request.current++;timer();window.removeEventListener('focus',read);window.removeEventListener('notara-vault-changed',read);};
    },[vault,visible,ready,scopeKey,tick]);
    useEffect(()=>{setAppointment(null);setScheduleError('');},[scopeKey,visible]);
    const open=item=>{
      if(item.kind==='review-group'){navigation.showReviewQueue();return;}
      if(item.kind==='review'){onView(VIEW_IDS.calendar,item.path);return;}
      setScheduleError('');setDate(civilDay(new Date(),timeZone));setAppointment(item);
    };
    async function schedule(){
      if(savingRef.current||!appointment||!date||!ready)return;
      savingRef.current=true;setSaving(true);setScheduleError('');const owner=scopeKey;
      try{
        const result=await vault.scheduleLesson({path:appointment.path,nodeId:appointment.nodeId,date,expectedRevision:appointment.revision});
        if(!result?.ok)throw new Error(result?.error?.message?.includes('revision_conflict')?'课程已发生变化，请关闭后重新安排。':'安排未保存，请重试。');
        if(scope.current===owner){setAppointment(null);void read();}
        window.dispatchEvent(new Event('notara-vault-changed'));
      }catch(error){if(scope.current===owner)setScheduleError(error.message);}
      finally{savingRef.current=false;setSaving(false);}
    }
    // Without a directory there is nothing to prepare: say so warmly and offer the picker.
    // …but only once the main view holds a session: until then the current lesson (and its directory) is not known yet.
    if(visible&&spaces.phase==='ready'&&mainViewSettled(sessions)&&!directory&&EmptyState)return h('div',{className:'nv-today'},
      h(EmptyState,{kind:'homeNoDirectory',onAction:[()=>navigation.requestDirectoryPicker()]}),h('div',{className:'nv-home-pass'},children));
    return h('div',{className:visible?'nv-today':'nv-home-pass'},h(TodayEntry,{
      items,loading,visible,composerReady,active:visible&&!appointment,
      error:error||(!ready&&spaces.phase==='ready'&&mainViewSettled(sessions)?'请先在首页面板里选择学习目录。':''),
      composerError:nav.homeError,draftNotice:draftError,onPrepare:()=>navigation.prepareHome(ctx),
      onOpen:open,onRetry:()=>setTick(value=>value+1),
    },children),appointment&&h(Dialog,{title:'安排课程',onClose:()=>{if(!savingRef.current)setAppointment(null);}},
      h('form',{className:'nv-home-schedule',onSubmit:event=>{event.preventDefault();void schedule();}},
        h('p',null,appointment.title),h('label',null,'安排日期',h('input',{type:'date','aria-label':'安排日期',required:true,value:date,disabled:saving,onChange:event=>setDate(event.target.value)})),
        scheduleError&&h('p',{role:'alert',className:'nv-home-error'},scheduleError),
        h('button',{type:'submit',disabled:saving||!date},saving?'正在保存…':'确认安排'))));
  }
  return {Today};
}

/** Display only; switching diagnostics or the look never edits the original session. */
export function installStudentProjection(ctx,React,navigation,appearance) {
  let hidden=[],last;
  const sync=()=>{
    const debug=navigation.getSnapshot().debug;if(debug===last)return;last=debug;
    document.body.dataset.notaraDebug=String(debug);
    hidden.forEach(dispose=>dispose());hidden=[];
    if(!debug){
      for(const key of ['system-prompt','context'])hidden.push(ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({name:'conversation.chat.node',key,priority:-1},()=>null)));
      hidden.push(ctx.slots.inject('conversation.input.permission',()=>ctx.slots.register({name:'conversation.input.permission',priority:-1},()=>null)));
    }
  };
  ctx.effect(()=>{sync();const stop=navigation.subscribe(sync);return()=>{stop();hidden.forEach(dispose=>dispose());delete document.body.dataset.notaraDebug;};});
  ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'notara.interface',order:35,label:'学习界面'},function InterfaceSettings(){
    const state=React.useSyncExternalStore(navigation.subscribe,navigation.getSnapshot);
    const [debugBusy,setDebugBusy]=React.useState(false),[debugError,setDebugError]=React.useState('');
    const changeDebug=async debug=>{
      const previous=navigation.getSnapshot().debug;
      setDebugBusy(true);setDebugError('');navigation.setDebug(debug);
      try{await ctx.configForms.developerTools.setEnabled(debug);}
      catch{navigation.setDebug(previous);setDebugError('调试设置未保存，请重试。');}
      finally{setDebugBusy(false);}
    };
    const look=React.useSyncExternalStore(appearance?.subscribe??(()=>()=>{}),appearance?.getSnapshot??(()=>({style:'minimal'})));
    const option=(style,label,note)=>React.createElement('label',{key:style,className:'nv-appearance-option','data-selected':look.style===style},
      React.createElement('input',{type:'radio',name:'notara-appearance',value:style,checked:look.style===style,onChange:()=>appearance?.setStyle(style)}),
      React.createElement('span',null,React.createElement('b',null,label),React.createElement('small',null,note)));
    return React.createElement('section',{style:{padding:'16px 0'}},
      React.createElement('h2',{style:{fontSize:16,margin:'0 0 16px'}},'学习界面'),
      appearance&&React.createElement('fieldset',{className:'nv-appearance',style:{border:0,padding:0,margin:'0 0 22px'}},
        React.createElement('legend',{style:{fontSize:13,fontWeight:500,marginBottom:10}},'外观'),
        option('minimal','极简','白底浅灰，系统字体。'),
        option('notebook','手帐','纸张、便签与手写字体；第一次切换需要下载约 7.6 MB 的字体。'),
        React.createElement('p',{style:{fontSize:12,color:'var(--dsw-alias-label-secondary)',margin:'8px 0 0'}},'只改变这台浏览器上的外观；深浅色仍跟随原生的外观设置。')),
      React.createElement('label',{style:{display:'flex',alignItems:'center',gap:10}},
        React.createElement('input',{type:'checkbox',checked:state.debug,disabled:debugBusy,onChange:e=>{void changeDebug(e.target.checked);}}),'显示调试记录'),
      debugError&&React.createElement('p',{role:'alert'},debugError),
      React.createElement('p',{style:{fontSize:12,color:'var(--dsw-alias-label-secondary)'}},'对话上方显示原生的视图切换，可以切到轨迹，看每一步的上下文与工具调用，供排查问题。'),
      NOTARA_VERSION&&React.createElement('p',{className:'nv-version',style:{fontSize:12,color:'var(--dsw-alias-label-secondary)',margin:'22px 0 0'}},`当前版本 ${NOTARA_VERSION}`));
  })));
}
