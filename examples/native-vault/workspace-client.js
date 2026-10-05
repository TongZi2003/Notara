import { UI_CSS } from './ui-client.js';
import { VIEW_IDS } from './views-client.js';
import { CLASSROOM_VIEW } from './classroom-client.js';
import { attachConversationFileNavigation } from './conversation-file-navigation.js';
import { currentSessionId } from './session-current.js';
import { normalizeNavigationFocus, primaryPaneSide } from './workspace-split-layout.js';

/** The placeholder view of 计划 → 定时任务, and the skills page. */
export const SCHEDULED_VIEW='notara-vault-scheduled',SKILLS_VIEW='notara-vault-skills';

/** One keyed seat per view. Navigation changes visibility, never clones a composer/editor. */
export function createVaultWorkspace(React,{ScheduledView,SkillsView,EMPTY_STATES,App,GraphView,CardsView,RoutesView,CalendarView,ClassroomView,Board,BoardStream,TeachingEntry,SummaryEntry,PomodoroEntry,IconButton,onBring,onBringMany,onDiscuss,ensureSession=async()=>undefined,navigation,Today}) {
  const h=React.createElement,{useState,useRef,useEffect,useCallback,useSyncExternalStore}=React;
  const choices=[['chat','对话'],['board','白板'],[VIEW_IDS.assets,'文件'],[VIEW_IDS.graph,'图谱'],[VIEW_IDS.cards,'卡片'],[VIEW_IDS.routes,'路线'],[VIEW_IDS.calendar,'日历'],[CLASSROOM_VIEW,'教室'],[SCHEDULED_VIEW,'定时任务'],[SKILLS_VIEW,'技能']];
  const components={board:Board,[VIEW_IDS.assets]:App,[VIEW_IDS.graph]:GraphView,[VIEW_IDS.cards]:CardsView,[VIEW_IDS.routes]:RoutesView,[VIEW_IDS.calendar]:CalendarView,[CLASSROOM_VIEW]:ClassroomView,[SCHEDULED_VIEW]:ScheduledView,[SKILLS_VIEW]:SkillsView};
  const layouts=new Map();
  const vaultIds={files:VIEW_IDS.assets,cards:VIEW_IDS.cards,graph:VIEW_IDS.graph};
  const planIds={calendar:VIEW_IDS.calendar,routes:VIEW_IDS.routes,review:VIEW_IDS.calendar,scheduled:SCHEDULED_VIEW};
  function Workspace(props) {
    const ctx=props.ctx,sessionId=props.sessionId;
    const nav=useSyncExternalStore(navigation.subscribe,navigation.getSnapshot);
    const sessions=ctx.sessions.list;
    const sessionState=useSyncExternalStore(fn=>sessions.subscribe(fn),()=>sessions.getSnapshot());
    const current=sessionState.byId[sessionId??currentSessionId(sessionState)];
    const teaching=current?.projectionValues?.agentPreset==='notara-teacher'&&current?.origin!=='subagent';
    // A worker's record opened from 教室 leads back to that lesson's classroom.
    const parentLesson=current?.origin==='subagent'&&sessionState.byId[current.parentId]?.projectionValues?.agentPreset==='notara-teacher'?current.parentId:null;
    const initialLayout=id=>{const resumed=navigation.takeLayout?.(id),saved=layouts.get(id)??(resumed?{...resumed,swapped:resumed.swapped===true,sessionId:id}:{sessionId:id,left:'chat',right:null,ratio:62,swapped:false});return {...saved,swapped:!!saved.right&&saved.swapped===true,fileFocus:normalizeNavigationFocus(saved.fileFocus)};};
    const [layout,setLayout]=useState(()=>initialLayout(sessionId));
    const [requests,setRequests]=useState(()=>layout.fileFocus?{[VIEW_IDS.assets]:{focus:layout.fileFocus,nonce:1}}:{}),[visited,setVisited]=useState(new Set(['chat']));
    const [narrow,setNarrow]=useState(()=>window.innerWidth<700),[narrowFace,setNarrowFace]=useState('board');
    const [stacked,setStacked]=useState(()=>window.matchMedia('(max-width:760px)').matches);
    useEffect(()=>{const media=window.matchMedia('(max-width:760px)'),update=()=>setStacked(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
    useEffect(()=>{const observer=new ResizeObserver(entries=>setNarrow(entries[0].contentRect.width<700));if(root.current)observer.observe(root.current);return()=>observer.disconnect();},[]);
    const root=useRef(null),drag=useRef(false),serial=useRef(0),previous=useRef(sessionId),closedSplit=useRef(null);
    // 显示调试记录 brings back the native view tabs, so the conversation can switch to
    // the native trajectory (offered while DSH's Coding Tools are on); otherwise it shows chat only.
    const debug=nav.debug,nativeConversationBody=debug?props.nativeDebugConversationBody:props.nativeConversationBody,nativeHeader=debug?props.nativeDebugHeader:props.nativeHeader;
    const globalView=nav.section==='home'?'home':nav.section==='vault'?vaultIds[nav.vault]:nav.section==='plan'?planIds[nav.plan]:nav.section==='skills'?SKILLS_VIEW:null;
    if(layout.sessionId!==sessionId){const next=initialLayout(sessionId);setLayout(next);setRequests(next.fileFocus?{[VIEW_IDS.assets]:{focus:next.fileFocus,nonce:1}}:{});}
    useEffect(()=>{
      if(previous.current!==sessionId){
        const state=navigation.getSnapshot(),homeOwnsSelection=state.section==='home'&&(state.preparingHome||state.homeSession===sessionId);
        if(previous.current!==undefined&&!homeOwnsSelection)navigation.show('lesson');previous.current=sessionId;closedSplit.current=null;
      }
    },[sessionId]);
    useEffect(()=>{layouts.set(sessionId,layout);},[sessionId,layout]);
    useEffect(()=>{navigation.rememberLesson?.(teaching?sessionId:null,layout);},[nav.section,nav.resuming,sessionId,layout,teaching]);
    useEffect(()=>{setVisited(prev=>new Set([...prev,layout.left,...(layout.right?[layout.right]:[]),...(globalView?[globalView]:[])]));},[layout.left,layout.right,globalView]);
    useEffect(()=>{if(teaching||(layout.left!==CLASSROOM_VIEW&&layout.right!==CLASSROOM_VIEW))return;setLayout(prev=>({...prev,left:'chat',right:null}));},[teaching,layout.left,layout.right]);
    // A layout remembered before DSH 0.2.0 may name the old separate trajectory pane.
    useEffect(()=>{if(layout.left!=='trajectory'&&layout.right!=='trajectory')return;setLayout(prev=>({...prev,left:prev.left==='trajectory'?'chat':prev.left,right:prev.right==='trajectory'?null:prev.right}));},[layout.left,layout.right]);
    const primarySide=primaryPaneSide(layout),secondarySide=primarySide==='left'?'right':'left';
    const primaryId=layout[primarySide],boardFace=narrow&&primaryId==='board';
    const choose=(side,id)=>{
      if(id==='board'){if(teaching)setLayout(prev=>({...prev,[primarySide]:'board',[secondarySide]:'chat',ratio:prev.right?prev.ratio:68}));setNarrowFace('board');return;}
      if(id===CLASSROOM_VIEW&&!teaching)return;
      setLayout(prev=>{const other=side==='left'?'right':'left';return {...prev,[side]:id,...(prev[other]===id?{[other]:prev[side]}:{})};});
    };
    const primaryView=boardFace?narrowFace:primaryId;
    // The sidebar folds its panel for the board and unfolds it when the lesson leaves the board.
    useEffect(()=>{navigation.setBoardFocus(!globalView&&teaching&&primaryView==='board');},[globalView,teaching,primaryView]);
    useEffect(()=>()=>navigation.setBoardFocus(false),[]);
    const choosePrimary=id=>{
      if(boardFace&&['chat','board'].includes(id)){setNarrowFace(id);return;}
      closedSplit.current=null;
      if(id==='board'){choose(primarySide,id);return;}
      setLayout(prev=>({...prev,left:id,right:null,swapped:false}));
    };
    useEffect(()=>{const request=nav.layoutRequest;if(!request||request.sessionId!==sessionId||!current||(request.view!=='chat'&&!teaching))return;choosePrimary(request.view);navigation.completeLayoutRequest();},[nav.layoutRequest,sessionId,teaching,!!current]);
    const secondaryId=layout[secondarySide];
    const closed=closedSplit.current,closedPrimarySide=closed&&primaryPaneSide(closed),canRestoreClosed=!!closed&&!layout.right&&closed.sessionId===sessionId&&closed[closedPrimarySide]===layout.left;
    const reopenId=canRestoreClosed?closed[closedPrimarySide==='left'?'right':'left']:primaryId==='board'?'chat':VIEW_IDS.assets;
    const secondaryLabel=secondaryId?(secondaryId==='chat'?'收起对话':'收起资料面板'):(reopenId==='chat'?'打开对话':'打开资料面板');
    const toggleSecondary=()=>setLayout(prev=>{
      if(prev.right){closedSplit.current=prev;return {...prev,left:prev[primaryPaneSide(prev)],right:null,swapped:false};}
      const closed=closedSplit.current;
      if(closed&&closed.sessionId===sessionId&&closed[primaryPaneSide(closed)]===prev.left)return {...closed,ratio:prev.ratio};
      const primary=primaryPaneSide(prev),secondary=primary==='left'?'right':'left';
      return {...prev,[secondary]:prev[primary]==='board'?'chat':VIEW_IDS.assets,swapped:false};
    });
    const globalOpen=(id,focus='')=>{
      focus=normalizeNavigationFocus(focus);
      if(id===VIEW_IDS.assets)navigation.show('vault','files',focus);
      else if(id===VIEW_IDS.cards)navigation.show('vault','cards',focus);
      else if(id===VIEW_IDS.graph)navigation.show('vault','graph',focus);
      else if(id===VIEW_IDS.routes)navigation.show('plan','routes',focus);
      else if(id===VIEW_IDS.calendar)navigation.show('plan',focus&&!/^\d{4}-\d{2}-\d{2}$/.test(focus)?'review':'calendar',focus);
    };
    const openView=(origin,id,focus='')=>{
      focus=normalizeNavigationFocus(focus);
      if(id==='chat'){
        if(globalView)setLayout(prev=>({...prev,left:'chat',right:globalView==='home'?null:globalView}));
        // A narrow board shows one face at a time: turn it to the conversation.
        else if(boardFace)setNarrowFace('chat');
        else setLayout(prev=>prev.left==='chat'||prev.right==='chat'?prev:{...prev,[origin==='right'?'left':'right']:'chat'});
        navigation.show('lesson');
        requestAnimationFrame(()=>document.querySelector('[data-composer-input]')?.focus({preventScroll:true}));
      }else if(globalView)globalOpen(id,focus);
      else{
        const side=layout.left===id?'left':layout.right===id?'right':id===VIEW_IDS.assets&&primaryId==='board'?secondarySide:origin;
        choose(side,id);
        if(id===VIEW_IDS.assets&&focus)setLayout(prev=>({...prev,fileFocus:focus}));
        if(boardFace&&id===VIEW_IDS.assets)setNarrowFace(id);
        if(focus)setRequests(prev=>({...prev,[id]:{focus,nonce:++serial.current}}));
      }
    };
    const navigate=useRef(null),detach=useRef(null);
    useEffect(()=>{navigate.current=path=>openView(layout.left==='chat'?'right':'left',VIEW_IDS.assets,path);});
    const bindChatNavigation=useCallback(node=>{detach.current?.();detach.current=null;if(node)detach.current=attachConversationFileNavigation(node,{open:path=>navigate.current?.(path)});},[]);
    useEffect(()=>()=>{detach.current?.();},[]);
    const bar=side=>{
      const primary=side===primarySide;
      const tabs=primary?[['chat','对话'],...(teaching?[['board','白板'],[CLASSROOM_VIEW,'教室']]:[])]:layout[side]==='chat'?[['chat','对话']]:choices.filter(([id])=>!['chat','board',CLASSROOM_VIEW,SCHEDULED_VIEW,SKILLS_VIEW].includes(id));
      return h('div',{className:'nv-bar'},
        h('div',{className:'nv-workspace-tabs',role:'tablist','aria-label':primary?'课堂视图':'资料面板视图'},tabs.map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':layout[side]===id,onClick:()=>choose(side,id)},label))),
        h('div',{style:{marginLeft:'auto',display:'flex',gap:3}},
          primary&&parentLesson&&h('button',{type:'button',className:'nv-quiet',onClick:()=>navigation.openLesson(ctx,parentLesson,CLASSROOM_VIEW)},'返回课堂'),
          primary&&teaching&&h(TeachingEntry,{ctx,sessionId,ensureSession:()=>ensureSession(ctx)}),
          primary&&teaching&&h(SummaryEntry,{ctx,sessionId}),
          primary&&h(IconButton,{icon:secondaryId==='chat'||(!secondaryId&&primaryId==='board')?'chat':'split',label:secondaryLabel,'aria-pressed':!!layout.right,onClick:toggleSecondary}),
          !primary&&h(IconButton,{icon:'close',label:layout[side]==='chat'?'关闭对话':'关闭资料面板',onClick:toggleSecondary})));
    };
    const lessonHeader=teaching&&h('div',{className:'nv-class-topbar','data-narrow':narrow?'true':undefined},
      h('div',{className:'nv-class-native'},nativeHeader),
      h('nav',{className:'nv-class-views nv-workspace-tabs',role:'tablist','aria-label':'课堂视图'},
        [['chat','对话'],['board','白板'],[CLASSROOM_VIEW,'教室']].map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':primaryView===id,onClick:()=>choosePrimary(id)},label))),
      h('div',{className:'nv-class-actions'},
        PomodoroEntry&&h(PomodoroEntry,{ctx,sessionId}),
        h(TeachingEntry,{ctx,sessionId,ensureSession:()=>ensureSession(ctx)}),
        h(SummaryEntry,{ctx,sessionId}),
        !boardFace&&h(IconButton,{icon:primaryId==='board'?'chat':'split',label:secondaryLabel,'aria-pressed':!!layout.right,onClick:toggleSecondary})));
    const split=!globalView&&!!layout.right&&!boardFace;
    const isStacked=split&&stacked;
    return h('div',{className:'nv-workspace','data-section':nav.section},
      teaching&&BoardStream&&h(BoardStream,{ctx,sessionId}),
      h('style',null,UI_CSS),!globalView&&(teaching?lessonHeader:nativeHeader),
      h('div',{ref:root,className:'nv-panes','data-nv-board':primaryId==='board'?'true':undefined,'data-nv-split':split?'true':undefined,'data-nv-axis':isStacked?'stacked':'columns',
        style:{gridTemplateColumns:split&&!isStacked?'minmax(0,'+layout.ratio+'fr) 5px minmax(0,'+(100-layout.ratio)+'fr)':'minmax(0,1fr)',gridTemplateRows:isStacked?'minmax(0,'+layout.ratio+'fr) 5px minmax(0,'+(100-layout.ratio)+'fr)':'minmax(0,1fr)'}},
        choices.map(([id,label])=>{
          const side=globalView?(id===(globalView==='home'?'chat':globalView)?'left':null):boardFace?(id===narrowFace?'left':null):layout.left===id?'left':layout.right===id?'right':null;
          if(id==='board'&&!teaching)return null;
          if(id===CLASSROOM_VIEW&&!teaching)return null;
          const request=globalView===id?nav.request:requests[id];
          const childProps={...props,key:sessionId,global:!!globalView,visible:!!side,viewRequest:request,completeViewRequest:()=>globalView===id?navigation.complete():setRequests(prev=>({...prev,[id]:null})),
            ...(id===VIEW_IDS.calendar&&globalView?{mode:nav.plan==='review'?'review':'calendar',hideModes:true}:{}),
            ...(id===VIEW_IDS.assets&&globalView?{onSelectedChange:navigation.selectFile}:{}),
            ...(id===VIEW_IDS.routes?{routePath:globalView?nav.routePath:undefined,onRouteChange:globalView?navigation.selectRoute:undefined,
              onPlanInConversation:()=>globalView?navigation.queueDraft(EMPTY_STATES.routes.draft):onDiscuss?.(ctx,sessionId,EMPTY_STATES.routes.draft,(target,focus)=>openView(side??'left',target,focus))}:{}),
            openView:(target,focus)=>openView(side??'left',target,focus),onDiscuss:(text)=>onDiscuss?.(ctx,sessionId,text,(target,focus)=>openView(side??'left',target,focus)),onBring:(file,selection,page,intent)=>onBring(ctx,sessionId,file,selection,page,intent,(target,focus)=>openView(side??'left',target,focus)),onBringMany:(pins,intent)=>onBringMany?.(ctx,sessionId,pins,intent,(target,focus)=>openView(side??'left',target,focus))};
          const physicalSide=split&&layout.swapped?(side==='left'?'right':side==='right'?'left':null):side;
          return h('section',{key:id,className:'nv-pane','aria-label':label+'区域','aria-hidden':!side,'data-nv-side':physicalSide,...(!side?{inert:''}:{}),
            style:{display:side?'flex':'none',gridColumn:isStacked?1:physicalSide==='right'?3:1,gridRow:isStacked&&physicalSide==='right'?3:1,'--nv-row':physicalSide==='right'?3:1}},
            side&&!globalView&&!boardFace&&(!teaching||side===secondarySide)&&bar(side),
            h('div',{className:'nv-pane-content',ref:id==='chat'?bindChatNavigation:undefined},
              id==='chat'?h(Today,{ctx,sessionId,visible:globalView==='home',onView:globalOpen},nativeConversationBody):
              (side||visited.has(id))&&h(components[id],childProps)));
        }),
        split&&h('div',{className:'nv-split-handle',style:{gridColumn:isStacked?1:2,gridRow:isStacked?2:1}},
          h('div',{className:'nv-split-resize',role:'separator','aria-label':isStacked?'调整窗格高度':'调整资料面板宽度','aria-orientation':isStacked?'horizontal':'vertical','aria-valuemin':25,'aria-valuemax':75,'aria-valuenow':layout.ratio,tabIndex:0,
            onKeyDown:e=>{const decrease=isStacked?'ArrowUp':'ArrowLeft',increase=isStacked?'ArrowDown':'ArrowRight';if([decrease,increase].includes(e.key)){e.preventDefault();setLayout(prev=>({...prev,ratio:Math.max(25,Math.min(75,prev.ratio+(e.key===increase?5:-5)))}));}},
            onPointerDown:e=>{if(e.button!==0)return;e.preventDefault();drag.current=true;e.currentTarget.setPointerCapture(e.pointerId);},
            onPointerMove:e=>{if(!drag.current)return;const rect=root.current.getBoundingClientRect(),ratio=isStacked?(e.clientY-rect.top)/rect.height:(e.clientX-rect.left)/rect.width;setLayout(prev=>({...prev,ratio:Math.max(25,Math.min(75,ratio*100))}));},
            onPointerUp:e=>{drag.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);},onPointerCancel:()=>{drag.current=false;},onLostPointerCapture:()=>{drag.current=false;}}),
          h(IconButton,{icon:'swap',label:'调换窗格',title:isStacked?'调换上下窗格':'调换左右窗格',className:'nv-icon nv-pane-swap','aria-pressed':layout.swapped===true,onPointerDown:e=>e.stopPropagation(),onClick:()=>setLayout(prev=>({...prev,swapped:!prev.swapped}))}))));
  }
  return Workspace;
}
