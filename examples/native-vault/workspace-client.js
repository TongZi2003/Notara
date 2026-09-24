import { UI_CSS } from './ui-client.js';
import { VIEW_IDS } from './views-client.js';
import { CLASSROOM_VIEW } from './classroom-client.js';
import { attachConversationFileNavigation } from './conversation-file-navigation.js';

/** One keyed seat per view. Navigation changes visibility, never clones a composer/editor. */
export function createVaultWorkspace(React,{App,GraphView,CardsView,RoutesView,CalendarView,ClassroomView,Board,BoardStream,TeachingEntry,SummaryEntry,IconButton,onBring,ensureSession=async()=>undefined,navigation,Today}) {
  const h=React.createElement,{useState,useRef,useEffect,useCallback,useSyncExternalStore}=React;
  const choices=[['chat','对话'],['board','白板'],['trajectory','轨迹'],[VIEW_IDS.assets,'文件'],[VIEW_IDS.graph,'图谱'],[VIEW_IDS.cards,'卡片'],[VIEW_IDS.routes,'路线'],[VIEW_IDS.calendar,'日历'],[CLASSROOM_VIEW,'教室']];
  const components={board:Board,[VIEW_IDS.assets]:App,[VIEW_IDS.graph]:GraphView,[VIEW_IDS.cards]:CardsView,[VIEW_IDS.routes]:RoutesView,[VIEW_IDS.calendar]:CalendarView,[CLASSROOM_VIEW]:ClassroomView};
  const layouts=new Map();
  const libraryTabs=[['files','文件'],['cards','卡片'],['graph','图谱']],planTabs=[['routes','路线'],['calendar','日历'],['review','复习']];
  const libraryIds={files:VIEW_IDS.assets,cards:VIEW_IDS.cards,graph:VIEW_IDS.graph};
  function Workspace(props) {
    const {sessionId,nativeConversationBody,nativeHeader,nativeTrajectory}=props,ctx=props.ctx;
    const nav=useSyncExternalStore(navigation.subscribe,navigation.getSnapshot);
    const sessions=ctx.sessions.list;
    const sessionState=useSyncExternalStore(fn=>sessions.subscribe(fn),()=>sessions.getSnapshot());
    const current=sessionState.byId[sessionId??sessionState.current];
    const teaching=current?.projectionValues?.agentPreset==='notara-teacher'&&current?.origin!=='subagent';
    const [layout,setLayout]=useState(()=>layouts.get(sessionId)??{sessionId,left:'chat',right:null,ratio:62});
    const [requests,setRequests]=useState({}),[visited,setVisited]=useState(new Set(['chat']));
    const [narrow,setNarrow]=useState(()=>window.innerWidth<800),[narrowFace,setNarrowFace]=useState('board');
    useEffect(()=>{const observer=new ResizeObserver(entries=>setNarrow(entries[0].contentRect.width<700));if(root.current)observer.observe(root.current);return()=>observer.disconnect();},[]);
    const root=useRef(null),drag=useRef(false),serial=useRef(0),previous=useRef(sessionId);
    const debug=nav.debug;
    const globalView=nav.section==='today'?'today':nav.section==='library'?libraryIds[nav.library]:nav.section==='plan'?(nav.plan==='routes'?VIEW_IDS.routes:VIEW_IDS.calendar):null;
    if(layout.sessionId!==sessionId){setLayout(layouts.get(sessionId)??{sessionId,left:'chat',right:null,ratio:62});setRequests({});}
    useEffect(()=>{
      if(previous.current!==sessionId){
        const state=navigation.getSnapshot(),homeOwnsSelection=state.section==='today'&&(state.preparingHome||state.homeSession===sessionId);
        if(previous.current!==undefined&&!homeOwnsSelection)navigation.show('lesson');previous.current=sessionId;
      }
    },[sessionId]);
    useEffect(()=>{layouts.set(sessionId,layout);},[sessionId,layout]);
    useEffect(()=>{setVisited(prev=>new Set([...prev,layout.left,...(layout.right?[layout.right]:[]),...(globalView?[globalView]:[])]));},[layout.left,layout.right,globalView]);
    useEffect(()=>{if(teaching||(layout.left!==CLASSROOM_VIEW&&layout.right!==CLASSROOM_VIEW))return;setLayout(prev=>({...prev,left:'chat',right:null}));},[teaching,layout.left,layout.right]);
    useEffect(()=>{if(debug||(layout.left!=='trajectory'&&layout.right!=='trajectory'))return;setLayout(prev=>({...prev,left:prev.left==='trajectory'?'chat':prev.left,right:prev.right==='trajectory'?null:prev.right}));},[debug,layout.left,layout.right]);
    const choose=(side,id)=>{
      if(id==='board'){if(teaching)setLayout(prev=>({...prev,left:'board',right:'chat',ratio:68}));setNarrowFace('board');return;}
      if(id===CLASSROOM_VIEW&&!teaching)return;
      setLayout(prev=>{const other=side==='left'?'right':'left';return {...prev,[side]:id,...(prev[other]===id?{[other]:prev[side]}:{})};});
    };
    const primaryView=narrow&&layout.left==='board'?narrowFace:layout.left;
    const choosePrimary=id=>{
      if(narrow&&layout.left==='board'&&['chat','board'].includes(id)){setNarrowFace(id);return;}
      if(id==='board'){choose('left',id);return;}
      setLayout(prev=>({...prev,left:id,right:null}));
    };
    const secondaryLabel=layout.left==='board'?(layout.right?'收起对话':'打开对话'):(layout.right?'收起资料面板':'打开资料面板');
    const toggleSecondary=()=>setLayout(prev=>({...prev,right:prev.right?null:prev.left==='board'?'chat':VIEW_IDS.assets}));
    const globalOpen=(id,focus='')=>{
      if(id===VIEW_IDS.assets)navigation.show('library','files',focus);
      else if(id===VIEW_IDS.cards)navigation.show('library','cards',focus);
      else if(id===VIEW_IDS.graph)navigation.show('library','graph',focus);
      else if(id===VIEW_IDS.routes)navigation.show('plan','routes',focus);
      else if(id===VIEW_IDS.calendar)navigation.show('plan',focus&&!/^\d{4}-\d{2}-\d{2}$/.test(focus)?'review':'calendar',focus);
    };
    const openView=(origin,id,focus='')=>{
      if(id==='chat'){
        if(globalView)setLayout(prev=>({...prev,left:'chat',right:globalView==='today'?null:globalView}));
        else setLayout(prev=>prev.left==='chat'||prev.right==='chat'?prev:{...prev,[origin==='right'?'left':'right']:'chat'});
        navigation.show('lesson');
        requestAnimationFrame(()=>document.querySelector('[data-composer-input]')?.focus({preventScroll:true}));
      }else if(globalView)globalOpen(id,focus);
      else{
        const side=layout.left===id?'left':layout.right===id?'right':origin;
        choose(side,id);if(focus)setRequests(prev=>({...prev,[id]:{focus,nonce:++serial.current}}));
      }
    };
    const navigate=useRef(null),detach=useRef(null);
    useEffect(()=>{navigate.current=path=>openView(layout.left==='chat'?'right':'left',VIEW_IDS.assets,path);});
    const bindChatNavigation=useCallback(node=>{detach.current?.();detach.current=null;if(node)detach.current=attachConversationFileNavigation(node,{open:path=>navigate.current?.(path)});},[]);
    useEffect(()=>()=>{detach.current?.();},[]);
    const bar=side=>{
      const tabs=side==='left'?[['chat','对话'],...(teaching?[['board','白板'],[CLASSROOM_VIEW,'教室']]:[]),...(debug?[['trajectory','轨迹']]:[])]:layout.right==='chat'?[['chat','对话']]:choices.filter(([id])=>!['today','chat','board','trajectory',CLASSROOM_VIEW].includes(id));
      return h('div',{className:'nv-bar'},
        h('div',{className:'nv-workspace-tabs',role:'tablist','aria-label':side==='left'?'课堂视图':'资料面板视图'},tabs.map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':layout[side]===id,onClick:()=>choose(side,id)},label))),
        h('div',{style:{marginLeft:'auto',display:'flex',gap:3}},
          side==='left'&&teaching&&h(TeachingEntry,{ctx,sessionId,ensureSession:()=>ensureSession(ctx)}),
          side==='left'&&teaching&&h(SummaryEntry,{ctx,sessionId}),
          side==='left'&&h(IconButton,{icon:'split',label:layout.right?'收起资料面板':'打开资料面板','aria-pressed':!!layout.right,onClick:()=>setLayout(prev=>({...prev,right:prev.right?null:VIEW_IDS.assets}))}),
          side==='right'&&h(IconButton,{icon:'close',label:'关闭资料面板',onClick:()=>setLayout(prev=>({...prev,right:null}))})));
    };
    const lessonHeader=teaching&&h('div',{className:'nv-class-topbar','data-narrow':narrow?'true':undefined},
      h('div',{className:'nv-class-native'},nativeHeader),
      h('nav',{className:'nv-class-views nv-workspace-tabs',role:'tablist','aria-label':'课堂视图'},
        [['chat','对话'],['board','白板'],[CLASSROOM_VIEW,'教室'],...(debug?[['trajectory','轨迹']]:[])].map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':primaryView===id,onClick:()=>choosePrimary(id)},label))),
      h('div',{className:'nv-class-actions'},
        h(TeachingEntry,{ctx,sessionId,ensureSession:()=>ensureSession(ctx)}),
        h(SummaryEntry,{ctx,sessionId}),
        !(narrow&&layout.left==='board')&&h(IconButton,{icon:layout.left==='board'?'chat':'split',label:secondaryLabel,'aria-pressed':!!layout.right,onClick:toggleSecondary})));
    const globalHeader=globalView&&globalView!=='today'&&h('header',{className:'nv-shell-heading'},
      h('h1',null,nav.section==='library'?'资料库':'计划'),
      h('div',{className:'nv-shell-tabs',role:'tablist','aria-label':nav.section==='library'?'资料库视图':'计划视图'},
        (nav.section==='library'?libraryTabs:planTabs).map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':(nav.section==='library'?nav.library:nav.plan)===id,onClick:()=>navigation.show(nav.section,id)},label))));
    return h('div',{className:'nv-workspace','data-section':nav.section},
      teaching&&BoardStream&&h(BoardStream,{ctx,sessionId}),
      h('style',null,UI_CSS),!globalView&&(teaching?lessonHeader:nativeHeader),globalHeader,
      h('div',{ref:root,className:'nv-panes','data-nv-board':layout.left==='board'?'true':undefined,'data-nv-split':!globalView&&layout.right&&!(narrow&&layout.left==='board')?'true':undefined,
        style:{gridTemplateColumns:!globalView&&layout.right&&!(narrow&&layout.left==='board')?'minmax(0,'+layout.ratio+'fr) 5px minmax(0,'+(100-layout.ratio)+'fr)':'minmax(0,1fr)',gridTemplateRows:'minmax(0,1fr)'}},
        choices.map(([id,label])=>{
          const side=globalView?(id===(globalView==='today'?'chat':globalView)?'left':null):narrow&&layout.left==='board'?(id===narrowFace?'left':null):layout.left===id?'left':layout.right===id?'right':null;
          if(id==='board'&&!teaching)return null;
          if(id===CLASSROOM_VIEW&&!teaching)return null;
          if(id==='trajectory'&&!debug)return null;
          const request=globalView===id?nav.request:requests[id];
          const childProps={...props,key:sessionId,global:!!globalView,visible:!!side,viewRequest:request,completeViewRequest:()=>globalView===id?navigation.complete():setRequests(prev=>({...prev,[id]:null})),
            ...(id===VIEW_IDS.calendar&&globalView?{mode:nav.plan==='review'?'review':'calendar',hideModes:true}:{}),
            openView:(target,focus)=>openView(side??'left',target,focus),onBring:(file,selection,page,intent)=>onBring(ctx,sessionId,file,selection,page,intent,(target,focus)=>openView(side??'left',target,focus))};
          return h('section',{key:id,className:'nv-pane','aria-label':label+'区域','aria-hidden':!side,...(!side?{inert:''}:{}),
            style:{display:side?'flex':'none',gridColumn:side==='right'?3:1,gridRow:1,'--nv-row':side==='right'?3:1}},
            side&&!globalView&&!(narrow&&layout.left==='board')&&(!teaching||side==='right')&&bar(side),
            h('div',{className:'nv-pane-content',ref:id==='chat'?bindChatNavigation:undefined},
              id==='chat'?h(Today,{ctx,sessionId,visible:globalView==='today',onView:globalOpen},nativeConversationBody):id==='trajectory'?(side||visited.has(id))&&nativeTrajectory:
              (side||visited.has(id))&&h(components[id],childProps)));
        }),
        !globalView&&layout.right&&!(narrow&&layout.left==='board')&&h('div',{className:'nv-split-handle',role:'separator','aria-label':'调整资料面板宽度','aria-orientation':'vertical','aria-valuemin':25,'aria-valuemax':75,'aria-valuenow':layout.ratio,tabIndex:0,style:{gridColumn:2,gridRow:1},
          onKeyDown:e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setLayout(prev=>({...prev,ratio:Math.max(25,Math.min(75,prev.ratio+(e.key==='ArrowRight'?5:-5)))}));}},
          onPointerDown:e=>{drag.current=true;e.currentTarget.setPointerCapture(e.pointerId);},
          onPointerMove:e=>{if(!drag.current)return;const rect=root.current.getBoundingClientRect();const ratio=innerWidth<=760?(e.clientY-rect.top)/rect.height:(e.clientX-rect.left)/rect.width;setLayout(prev=>({...prev,ratio:Math.max(25,Math.min(75,ratio*100))}));},
          onPointerUp:e=>{drag.current=false;e.currentTarget.releasePointerCapture(e.pointerId);},onPointerCancel:()=>{drag.current=false;}})));
  }
  return Workspace;
}
