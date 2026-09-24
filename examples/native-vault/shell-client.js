import { createVaultClient } from './remote-client.js';
import { civilDay } from './calendar-data.js';
import { VIEW_IDS } from './views-client.js';
import { homeQueue } from './home-queue.js';

/** Directory membership comes from the native registry, not a path-prefix guess. */
export function selectedVaultDirectory(spaces,sessions,rememberedId,prepared){
  const items=spaces.items??[];
  const owner=items.find(item=>item.sessionIds?.includes(sessions.current));
  if(owner)return owner;
  // A session created by Home has a known workspace even if that workspace's
  // membership notification arrives one tick after the session notification.
  if(prepared?.homeSession===sessions.current&&sessions.byId?.[sessions.current]?.blank===true){
    const pending=items.find(item=>item.workspaceId===prepared.homeWorkspaceId);if(pending)return pending;
  }
  // A loaded but unregistered selection must not display another folder's lessons.
  if(sessions.current&&sessions.byId?.[sessions.current])return null;
  return items.find(item=>item.workspaceId===rememberedId)??(items.length===1?items[0]:null);
}
export function directoryLessons(directory,spaces,sessions){
  if(!directory)return [];
  const members=new Set(directory.sessionIds??[]),archived=new Set(spaces.archivedSessionIds??[]);
  return sessions.ids.map(id=>sessions.byId[id]).filter(row=>row&&members.has(row.id)&&!archived.has(row.id)&&!row.blank&&row.origin!=='subagent');
}

/** UI navigation only. Session identity, drafts and all learning facts stay native. */
export function createVaultNavigation() {
  let value={section:'today',library:'files',plan:'routes',request:null,serial:0,preparingHome:false,homeSession:null,homeWorkspaceId:null,homeError:'',debug:false,directoryId:null};
  const listeners=new Set();
  let controller=null;
  const publish=patch=>{value={...value,...patch};for(const fn of listeners)fn();};
  return {
    getSnapshot:()=>value,
    subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    show(section,tab,focus=''){
      if(section!=='today')controller?.abort();
      value={...value,section,...(section==='today'?{homeSession:null,homeError:''}:{}),...(section==='library'&&tab?{library:tab}:{}),...(section==='plan'&&tab?{plan:tab}:{}),
        request:focus?{focus,nonce:value.serial+1}:null,serial:value.serial+1};
      for(const fn of listeners)fn();
    },
    complete(){if(!value.request)return;value={...value,request:null};for(const fn of listeners)fn();},
    showReviewQueue(){
      controller?.abort();
      publish({section:'plan',plan:'review',request:{reviewFilter:'due',nonce:value.serial+1},serial:value.serial+1});
    },
    setDebug(debug){publish({debug});},
    rememberDirectory(directoryId){if(value.directoryId!==directoryId)publish({directoryId});},
    async prepareHome(ctx){
      if(value.preparingHome||value.section!=='today')return;
      const spaces=ctx.workspaces.list.getSnapshot(),sessions=ctx.sessions.list.getSnapshot();
      const directory=selectedVaultDirectory(spaces,sessions,value.directoryId);
      if(!directory){publish({homeError:'请先在左上角选择学习目录。'});return;}
      const attempt=new AbortController(),before=sessions.current,serial=value.serial;
      controller=attempt;publish({preparingHome:true,homeError:''});
      try{
        const id=await ctx.uiWorkspace.connectWorkspace(directory.workspaceId);
        if(attempt.signal.aborted||controller!==attempt||value.serial!==serial||value.section!=='today')return;
        const latest=ctx.sessions.list.getSnapshot();
        if(latest.current!==before&&latest.current!==id)return;
        if(!id||latest.byId[id]?.blank!==true)throw new Error('not_blank');
        // Publish ownership before selection changes, so the workspace knows
        // this is Home preparing its native input, not an explicit lesson open.
        publish({homeSession:id,homeWorkspaceId:directory.workspaceId,directoryId:directory.workspaceId});ctx.sessions.open(id);
      }catch{if(!attempt.signal.aborted&&value.serial===serial)publish({homeError:'输入框暂时没有准备好，请重试。'});}
      finally{if(controller===attempt){controller=null;publish({preparingHome:false});}}
    },
    dispose(){controller?.abort();controller=null;listeners.clear();},
  };
}

export function createVaultShell(React,{navigation,Icon,IconButton,Dialog,TodayEntry}) {
  const h=React.createElement,{useState,useEffect,useRef,useMemo,useSyncExternalStore}=React;
  const useNav=()=>useSyncExternalStore(navigation.subscribe,navigation.getSnapshot);
  const useSessions=ctx=>useSyncExternalStore(fn=>ctx.sessions.list.subscribe(fn),()=>ctx.sessions.list.getSnapshot());
  const useSpaces=ctx=>useSyncExternalStore(fn=>ctx.workspaces.list.subscribe(fn),()=>ctx.workspaces.list.getSnapshot());
  function Sidebar({ctx,collapsed,renderSidebarSlot}) {
    const nav=useNav(),sessions=useSessions(ctx);
    const spaces=useSpaces(ctx),directory=selectedVaultDirectory(spaces,sessions,nav.directoryId,nav);
    const rows=directoryLessons(directory,spaces,sessions);
    const [pickerOpen,setPickerOpen]=useState(false),[switching,setSwitching]=useState(false),[directoryError,setDirectoryError]=useState(''),[directoryPath,setDirectoryPath]=useState('');
    const [directoryListing,setDirectoryListing]=useState(null),[scanning,setScanning]=useState(false);
    const pickerAttempt=useRef(0),busyRef=useRef(false);
    useEffect(()=>{if(directory)navigation.rememberDirectory(directory.workspaceId);},[directory?.workspaceId]);
    useEffect(()=>()=>{pickerAttempt.current++;},[]);
    const closePicker=()=>{pickerAttempt.current++;setPickerOpen(false);setDirectoryError('');setScanning(false);};
    const pickDirectory=async workspaceId=>{
      pickerAttempt.current++;setScanning(false);setPickerOpen(false);setDirectoryError('');
      if(workspaceId===directory?.workspaceId&&directory.sessionIds?.includes(sessions.current))return;
      setSwitching(true);
      try{await ctx.uiWorkspace.openWorkspace(workspaceId,()=>navigation.show('lesson'));}
      catch{setDirectoryError('目录没有打开，请重新选择。');}
      finally{setSwitching(false);}
    };
    const addDirectory=async path=>{
      if(!path.trim()||busyRef.current)return;
      const attempt=++pickerAttempt.current;busyRef.current=true;setSwitching(true);setDirectoryError('');
      try{
        const workspace=await ctx.workspaces.create({path:path.trim()});
        if(attempt!==pickerAttempt.current)return;
        await pickDirectory(workspace.workspaceId);setDirectoryPath('');
      }catch{if(attempt===pickerAttempt.current)setDirectoryError('无法打开这个目录，请检查路径是否存在并且可以访问。');}
      finally{busyRef.current=false;setSwitching(false);}
    };
    const browseDirectory=async path=>{
      const attempt=++pickerAttempt.current;setDirectoryError('');setScanning(true);
      try{
        const listing=await ctx.uiWorkspace.listDirectory(path||directoryPath.trim()||directory?.path);
        if(attempt===pickerAttempt.current){setDirectoryListing(listing);setDirectoryPath(listing.path);}
      }catch(error){
        if(attempt!==pickerAttempt.current)return;
        // Native-only hosts refuse browse; use their system picker. Actual path
        // failures keep the typed path and never silently choose a different one.
        if(error?.rpcError?.code==='directory-picker/unavailable'){
          try{const picked=await ctx.uiWorkspace.pickDirectory();if(picked&&attempt===pickerAttempt.current)setDirectoryPath(picked);}
          catch{if(attempt===pickerAttempt.current)setDirectoryError('目录选择器暂不可用，可以直接填写目录路径。');}
        }else if(attempt===pickerAttempt.current)setDirectoryError('无法浏览此目录，请检查路径，或直接打开目录。');
      }finally{if(attempt===pickerAttempt.current)setScanning(false);}
    };
    const dismiss=()=>{if(innerWidth<=760&&!collapsed)ctx.layout.toggleSidebar();};
    const show=(section)=>{navigation.show(section);ctx.layout.selectPanel(null);dismiss();};
    const open=row=>{navigation.show('lesson');ctx.uiWorkspace.openSession(row.id);dismiss();};
    return h('aside',{className:'nv-sidebar','data-collapsed':collapsed||undefined,'aria-label':'Notara 导航'},
      h('div',{className:'nv-sidebar-brand'},h('span',{className:'nv-brand-mark'},'拾'),!collapsed&&h('span',null,'Notara · 拾页'),
        h(IconButton,{icon:'sidebar',label:collapsed?'展开导航':'收起导航',onClick:()=>ctx.layout.toggleSidebar()})),
      h('div',{className:'nv-directory'},
        h('button',{className:'nv-directory-button','aria-label':directory?'选择目录，当前：'+directory.title:'选择学习目录','aria-haspopup':'dialog','aria-expanded':pickerOpen,disabled:switching||spaces.phase!=='ready',title:directory?.path||'选择学习目录',onClick:()=>{setDirectoryError('');setPickerOpen(v=>!v);}},
          h(Icon,{name:'folder'}),!collapsed&&h('span',null,switching?'正在打开…':directory?.title||'选择学习目录'),!collapsed&&h('span',{className:'nv-directory-chevron','aria-hidden':true},'⌄')),
        directoryError&&!pickerOpen&&h('p',{role:'alert',className:'nv-directory-error'},directoryError)),
      pickerOpen&&h(Dialog,{title:'选择学习目录',onClose:closePicker},
        h('div',{className:'nv-directory-options'},spaces.items.map(item=>h('button',{key:item.workspaceId,type:'button','aria-pressed':directory?.workspaceId===item.workspaceId,disabled:switching,onClick:()=>pickDirectory(item.workspaceId)},
          h(Icon,{name:'folder'}),h('span',null,h('strong',null,item.title),h('small',null,item.path)),directory?.workspaceId===item.workspaceId&&h('span',{'aria-hidden':true},'✓')))),
        h('form',{className:'nv-directory-form',onSubmit:event=>{event.preventDefault();void addDirectory(directoryPath);}},
          h('label',null,'打开其他目录',h('input',{'aria-label':'目录路径',value:directoryPath,placeholder:'粘贴文件夹的完整路径',disabled:switching,onChange:event=>setDirectoryPath(event.target.value)})),
          h('div',{className:'nv-directory-actions'},h('button',{type:'button',disabled:switching||scanning,onClick:()=>browseDirectory()},scanning?'正在读取…':'浏览文件夹'),h('button',{type:'submit',disabled:switching||scanning||!directoryPath.trim()},switching?'正在打开…':'打开目录')),
          directoryListing&&h('div',{className:'nv-directory-browser','aria-label':'目录浏览'},
            h('div',{className:'nv-directory-browser-head'},h('span',null,'当前目录'),h('button',{type:'button',disabled:scanning||directoryListing.crumbs.length<2,onClick:()=>browseDirectory(directoryListing.crumbs.at(-2)?.path)},'上一级')),
            directoryListing.entries.filter(entry=>!entry.hidden).map(entry=>h('button',{key:entry.path,type:'button',disabled:scanning,onClick:()=>browseDirectory(entry.path)},h(Icon,{name:'folder'}),entry.name)),
            !directoryListing.entries.some(entry=>!entry.hidden)&&h('p',null,'没有可见的子文件夹，可以直接打开当前目录。'),
            directoryListing.truncated&&h('p',null,'此目录较大，未显示全部文件夹；可以直接填写完整路径。')),
          directoryError&&h('p',{role:'alert',className:'nv-directory-error'},directoryError))),
      h('button',{className:'nv-new-lesson','aria-label':'新的一课',title:'新的一课',disabled:switching,onClick:()=>{if(!directory){setPickerOpen(true);return;}navigation.show('lesson');ctx.uiWorkspace.startSession(directory.workspaceId);dismiss();}},h(Icon,{name:'plus'}),!collapsed&&'新的一课'),
      h('nav',{'aria-label':'学习导航'},[['today','今天','今日'],['library','book','资料库'],['plan','calendar','计划']].map(([id,ic,label])=>
        h('button',{key:id,className:'nv-nav-button','aria-current':nav.section===id?'page':undefined,title:label,onClick:()=>show(id)},h(Icon,{name:ic==='今天'?'calendar':ic}),!collapsed&&label))),
      !collapsed&&h('div',{className:'nv-sidebar-lessons'},h('div',{className:'nv-sidebar-label'},'课堂'),
        rows.length?rows.map(row=>h('button',{key:row.id,className:'nv-session-row','aria-current':nav.section==='lesson'&&sessions.current===row.id?'page':undefined,title:row.title||'未命名课堂',onClick:()=>open(row)},
          h('i',{className:'nv-session-dot','data-running':!!row.running}),h('span',null,row.title||'未命名课堂'),
          h('time',null,row.running?'进行中':new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(new Date(row.updatedAt)))))
          :h('p',{className:'nv-sidebar-label'},directory?'这个目录还没有课堂':'选择目录后查看课堂')),
      h('footer',{className:'nv-sidebar-foot'},
        renderSidebarSlot('sidebar.footer.action',{wide:!collapsed}),renderSidebarSlot('sidebar.settings',{wide:!collapsed})));
  }

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
      void read();const timer=setInterval(read,15000);
      window.addEventListener('focus',read);window.addEventListener('notara-vault-changed',read);
      return()=>{request.current++;clearInterval(timer);window.removeEventListener('focus',read);window.removeEventListener('notara-vault-changed',read);};
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
    return h('div',{className:visible?'nv-today':'nv-home-pass'},h(TodayEntry,{
      items,loading,visible,composerReady,active:visible&&!appointment,
      error:error||(!ready&&spaces.phase==='ready'?'请先在侧栏选择学习目录。':''),
      composerError:nav.homeError,onPrepare:()=>navigation.prepareHome(ctx),
      onOpen:open,onRetry:()=>setTick(value=>value+1),
    },children),appointment&&h(Dialog,{title:'安排课程',onClose:()=>{if(!savingRef.current)setAppointment(null);}},
      h('form',{className:'nv-home-schedule',onSubmit:event=>{event.preventDefault();void schedule();}},
        h('p',null,appointment.title),h('label',null,'安排日期',h('input',{type:'date','aria-label':'安排日期',required:true,value:date,disabled:saving,onChange:event=>setDate(event.target.value)})),
        scheduleError&&h('p',{role:'alert',className:'nv-home-error'},scheduleError),
        h('button',{type:'submit',disabled:saving||!date},saving?'正在保存…':'确认安排'))));
  }
  return {Sidebar,Today};
}

/** Display only; switching diagnostics never edits the original session. */
export function installStudentProjection(ctx,React,navigation) {
  let hidden=[],last;
  const sync=()=>{
    const debug=navigation.getSnapshot().debug;if(debug===last)return;last=debug;
    hidden.forEach(dispose=>dispose());hidden=[];
    if(!debug)for(const key of ['system-prompt','context'])hidden.push(ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({name:'conversation.chat.node',key,priority:-1},()=>null)));
  };
  ctx.effect(()=>{sync();const stop=navigation.subscribe(sync);return()=>{stop();hidden.forEach(dispose=>dispose());};});
  ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'notara.interface',order:35,label:'学习界面'},function InterfaceSettings(){
    const state=React.useSyncExternalStore(navigation.subscribe,navigation.getSnapshot);
    return React.createElement('section',{style:{padding:'16px 0'}},
      React.createElement('h2',{style:{fontSize:16,margin:'0 0 16px'}},'学习界面'),
      React.createElement('label',{style:{display:'flex',alignItems:'center',gap:10}},
        React.createElement('input',{type:'checkbox',checked:state.debug,onChange:e=>navigation.setDebug(e.target.checked)}),'显示调试记录'),
      React.createElement('p',{style:{fontSize:12,color:'var(--dsw-alias-label-secondary)'}},'展开系统上下文和轨迹，供排查问题。'));
  })));
}
