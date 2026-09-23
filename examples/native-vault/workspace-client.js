import { UI_CSS } from './ui-client.js';
import { VIEW_IDS } from './views-client.js';
import { CLASSROOM_VIEW } from './classroom-client.js';
import { attachConversationFileNavigation } from './conversation-file-navigation.js';

/**
 * One workspace container for every Vault bench: chat, trajectory, assets,
 * graph, cards, routes and 教室. The native conversation keeps exactly one mount —
 * the composer is never copied into another pane — and the benches are tabs of
 * the same container so splitting stays the native split. 教室 is a teaching
 * classroom bench only: a standard session keeps its original roster.
 */
export function createVaultWorkspace(React, { App, GraphView, CardsView, RoutesView, CalendarView, ClassroomView, TeachingEntry, SummaryEntry, IconButton, onBring, ensureSession = async () => undefined }) {
  const h=React.createElement, {useState,useRef,useEffect,useCallback}=React;
  const choices=[['chat','对话'],['trajectory','轨迹'],[VIEW_IDS.assets,'资产'],[VIEW_IDS.graph,'图谱'],[VIEW_IDS.cards,'卡片'],[VIEW_IDS.routes,'路线'],[VIEW_IDS.calendar,'日历'],[CLASSROOM_VIEW,'教室']];
  const hasPane=(id,teaching)=>id!==CLASSROOM_VIEW||teaching;
  const components={ [VIEW_IDS.assets]:App,[VIEW_IDS.graph]:GraphView,[VIEW_IDS.cards]:CardsView,[VIEW_IDS.routes]:RoutesView,[VIEW_IDS.calendar]:CalendarView,[CLASSROOM_VIEW]:ClassroomView };
  const layouts=new Map();
  function Workspace(props) {
    const {sessionId,nativeConversationBody,nativeHeader,nativeTrajectory}=props;
    const nativeSessions=props.ctx.sessions.list;
    const sessionState=React.useSyncExternalStore(callback=>nativeSessions.subscribe(callback),()=>nativeSessions.getSnapshot());
    const current=sessionState.byId[sessionId??sessionState.current];
    const teaching=current?.projectionValues?.agentPreset==='notara-teacher'&&current?.origin!=='subagent';
    const [layout,setLayout]=useState(()=>layouts.get(sessionId)??{sessionId,left:'chat',right:null,ratio:50});
    const [active,setActive]=useState('left'),[requests,setRequests]=useState({}),[visited,setVisited]=useState(new Set(['chat']));
    const root=useRef(null),drag=useRef(null),serial=useRef(0);
    if(layout.sessionId!==sessionId){setLayout(layouts.get(sessionId)??{sessionId,left:'chat',right:null,ratio:50});setRequests({});}
    useEffect(()=>{layouts.set(sessionId,layout);},[sessionId,layout]);
    useEffect(()=>{setVisited(prev=>new Set([...prev,layout.left,...(layout.right?[layout.right]:[])]));},[layout.left,layout.right]);
    // 教室 belongs to the teaching classroom: a standard session neither shows its
    // tab nor keeps it as a pane, so no pick can land on an empty pane.
    useEffect(()=>{if(teaching||(layout.left!==CLASSROOM_VIEW&&layout.right!==CLASSROOM_VIEW))return;setLayout(prev=>{
      const next={...prev,left:prev.left===CLASSROOM_VIEW?'chat':prev.left,right:prev.right===CLASSROOM_VIEW?null:prev.right};
      return next.right===next.left?{...next,right:null}:next;
    });},[teaching,sessionId,layout.left,layout.right]);
    const choose=(side,id)=>{if(!hasPane(id,teaching))return;setVisited(prev=>new Set([...prev,id]));setLayout(prev=>{
      const other=side==='left'?'right':'left';
      return {...prev,[side]:id,...(prev[other]===id?{[other]:prev[side]}:{})};
    });};
    const openView=(origin,id,focus='')=>{
      if(id==='chat'){
        setLayout(prev=>prev.left==='chat'||prev.right==='chat'?prev:{...prev,[origin==='right'?'left':'right']:'chat'});
        requestAnimationFrame(()=>document.querySelector('[data-composer-input]')?.focus({preventScroll:true}));
      }else{
        const side=layout.left===id?'left':layout.right===id?'right':origin;
        choose(side,id);
        if(focus)setRequests(prev=>({...prev,[id]:{focus,nonce:++serial.current}}));
      }
    };
    // A produced Vault file mentioned in the conversation opens in the assets
    // bench instead of the native sidebar document preview. The handler reads
    // the current layout when the click happens — the split may have been
    // swapped or closed since the listener was attached — and it routes through
    // the workspace `openView`, so the assets bench keeps its unsaved-changes
    // guard and the native conversation keeps its draft.
    const navigate=useRef(null), detachNavigation=useRef(null);
    useEffect(()=>{navigate.current=path=>openView(layout.left==='chat'?'right':'left',VIEW_IDS.assets,path);});
    const bindChatNavigation=useCallback(node=>{
      detachNavigation.current?.();detachNavigation.current=null;
      if(node)detachNavigation.current=attachConversationFileNavigation(node,{open:path=>navigate.current?.(path)});
    },[]);
    useEffect(()=>()=>{detachNavigation.current?.();detachNavigation.current=null;},[]);
    // 教学设置 and 总结本课 are the two lesson-level actions: a compact icon
    // pair on the left bar, never a row of teacher identities.
    const bar=side=>h('div',{className:'nv-bar'},h('div',{className:'nv-workspace-tabs',role:'tablist','aria-label':side==='left'?'左侧分页':'右侧分页'},choices.filter(([id])=>hasPane(id,teaching)).map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':layout[side]===id,onClick:()=>{setActive(side);choose(side,id);}},label))),
      h('div',{style:{marginLeft:'auto',display:'flex',alignItems:'center',gap:2,minWidth:0}},
        side==='left'&&teaching&&h(TeachingEntry,{ctx:props.ctx,sessionId,ensureSession:()=>ensureSession(props.ctx)}),
        side==='left'&&teaching&&h(SummaryEntry,{ctx:props.ctx,sessionId})),
      side==='left'&&h(IconButton,{icon:'split',label:layout.right?'退出分屏':'分屏显示','aria-pressed':!!layout.right,onClick:()=>setLayout(prev=>({...prev,right:prev.right?null:prev.left==='chat'?VIEW_IDS.assets:'chat'}))}),
      side==='right'&&h(IconButton,{icon:'swap',label:'交换分屏',onClick:()=>setLayout(prev=>({...prev,left:prev.right,right:prev.left,ratio:100-prev.ratio}))}),
      side==='right'&&h(IconButton,{icon:'close',label:'关闭分屏',onClick:()=>setLayout(prev=>({...prev,right:null}))}));
    // Each view keeps the same keyed parent. In particular the native Lexical
    // composer never gets copied or reparented when panes are swapped/hidden.
    // Use display, not inherited visibility: PDF stages explicitly restore
    // visibility and would otherwise paint through a hidden assets pane.
    return h('div',{className:'nv-workspace'},h('style',null,UI_CSS),nativeHeader,
      teaching&&current?.blank&&current.title&&h('header',{'aria-label':'当前课程',style:{padding:'14px 20px',borderBottom:'1px solid var(--dsw-alias-border-l1)'}},h('h1',{style:{fontSize:16,margin:0,fontWeight:600}},current.title)),
      h('div',{ref:root,className:'nv-panes','data-nv-split':layout.right?'true':undefined,style:{gridTemplateColumns:layout.right?`minmax(0,${layout.ratio}fr) 5px minmax(0,${100-layout.ratio}fr)`:'minmax(0,1fr)',gridTemplateRows:'minmax(0,1fr)'}},
        choices.map(([id,label])=>{
          const side=layout.left===id?'left':layout.right===id?'right':null;
          if(!hasPane(id,teaching))return null;
          return h('section',{key:id,className:'nv-pane','aria-label':`${label}区域`,'aria-hidden':!side,...(!side?{inert:''}:{}),style:{display:side?'flex':'none',gridColumn:side==='right'?3:1,gridRow:1,'--nv-row':side==='right'?3:1},onPointerDown:()=>side&&setActive(side)},
            side&&bar(side),h('div',{className:'nv-pane-content',ref:id==='chat'?bindChatNavigation:undefined},id==='chat'?nativeConversationBody:id==='trajectory'?(side||visited.has(id))&&nativeTrajectory:sessionId&&(side||visited.has(id))&&h(components[id],{...props,key:sessionId,visible:!!side,viewRequest:requests[id],completeViewRequest:()=>setRequests(prev=>({...prev,[id]:null})),openView:(target,focus)=>openView(side??active,target,focus),onBring:(file,selection,page,intent)=>onBring(props.ctx,sessionId,file,selection,page,intent,(target,focus)=>openView(side??active,target,focus))})));
        }),
        layout.right&&h('div',{className:'nv-split-handle',role:'separator','aria-label':'调整分屏宽度','aria-orientation':'vertical','aria-valuemin':25,'aria-valuemax':75,'aria-valuenow':layout.ratio,tabIndex:0,style:{gridColumn:2,gridRow:1},onKeyDown:e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setLayout(prev=>({...prev,ratio:Math.max(25,Math.min(75,prev.ratio+(e.key==='ArrowRight'?5:-5)))}));}},onPointerDown:e=>{drag.current=true;e.currentTarget.setPointerCapture(e.pointerId);},onPointerMove:e=>{if(!drag.current)return;const rect=root.current.getBoundingClientRect();setLayout(prev=>({...prev,ratio:Math.max(25,Math.min(75,(e.clientX-rect.left)/rect.width*100))}));},onPointerUp:e=>{drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);},onPointerCancel:()=>{drag.current=null;}})));
  }
  return Workspace;
}
