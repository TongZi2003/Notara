import css from './board-client.css';
import { createVaultClient, visibleInterval } from './remote-client.js';
import { VIEW_IDS } from './views-client.js';
import { renderBoardMarkdown,renderBoardInline,highlightBoardText,HIGHLIGHTS,exportBoard,boardImageTargets,stableBoardPreview,boardSelectionText } from './board-render.js';
import { getBoardStream,subscribeBoardStream } from './board-stream.js';
import { createMathInteractive } from './interactive-math-client.js';
import { readComponent,splitBoardBody } from './board-components.js';
import { BOARD_RESIZE_LIMITS,layoutBoard,readingOrder,isPinned } from './board-layout.js';
import { createBoardAnswers } from './board-answer-client.js';
import { createBoardVisuals, snapshotFigures } from './board-visual-client.js';
import { createBoardFrames } from './board-frames-client.js';
import { FLOW_CSS } from './board-flow.js';
import { mathStyleText } from './math-latex.js';

const EMPTY={revision:null,sections:[],blocks:[],sources:[],edges:[]};
const unwrap=result=>{if(!result?.ok)throw new Error(result?.error?.message??'白板暂时无法读取，请稍后重试。');return result.value;};
const colorNames={blue:'蓝色',green:'绿色',orange:'橙色',pink:'粉色'};
/** Below this board width the canvas becomes one readable column. */
const READING_WIDTH=600;
const BLOCK_WIDTH={min:BOARD_RESIZE_LIMITS.minWidth,max:BOARD_RESIZE_LIMITS.maxWidth},BLOCK_HEIGHT={min:BOARD_RESIZE_LIMITS.minHeight,max:BOARD_RESIZE_LIMITS.maxHeight};
const bounded=(value,range)=>Math.max(range.min,Math.min(range.max,Math.round(value)));
const editableTarget=element=>element instanceof Element&&!!element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
const interactiveTarget=element=>element instanceof Element&&!!element.closest('.nb-space-figure,.nb-interactive');
function localWheelTarget(element,viewport){
  if(!(element instanceof Element))return false;
  if(editableTarget(element)||interactiveTarget(element))return true;
  // A scrollable card keeps its wheel at both ends, without jumping to canvas zoom.
  for(let node=element;node&&node!==viewport;node=node.parentElement){
    const style=getComputedStyle(node);
    if((['auto','scroll'].includes(style.overflowY)&&node.scrollHeight>node.clientHeight+1)||(['auto','scroll'].includes(style.overflowX)&&node.scrollWidth>node.clientWidth+1))return true;
  }
  return false;
}

// One rendered HTML per Markdown text: a poll or a drag never re-renders prose.
const markdownCache=new Map();
const EMPTY_ASSET_URLS=Object.freeze({});
function cachedMarkdown(text,assetUrls){
  // Image content is owned by this classroom's client. Never reuse another
  // classroom's rendered data URL, or keep large URLs in global cache keys.
  if(boardImageTargets(text).length)return renderBoardMarkdown(text,{assetUrls});
  if(markdownCache.has(text)){const html=markdownCache.get(text);markdownCache.delete(text);markdownCache.set(text,html);return html;}
  const html=renderBoardMarkdown(text,{assetUrls});
  markdownCache.set(text,html);if(markdownCache.size>400)markdownCache.delete(markdownCache.keys().next().value);
  return html;
}
const answersKey=block=>(block.answers??[]).map(entry=>entry.id).join(',');
const sameBlock=(a,b)=>a===b||(a&&b&&a.id===b.id&&a.title===b.title&&a.body===b.body&&a.kind===b.kind&&a.size===b.size&&a.width===b.width&&a.height===b.height&&a.stream===b.stream&&a.missing===b.missing&&answersKey(a)===answersKey(b)&&a.interactive?.revision===b.interactive?.revision&&JSON.stringify(a.interactiveScene)===JSON.stringify(b.interactiveScene)&&a.interactiveState===b.interactiveState&&isPinned(a)===isPinned(b)&&(a.usedBy??[]).join()===(b.usedBy??[]).join());
const samePosition=(a,b)=>a===b||(a&&b&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height);

/** The draft block the teacher is writing right now, merged into the saved board. */
function withStream(board,stream){
  if(!stream||!['streaming','pending'].includes(stream.status)||!stream.title)return {sections:board.sections,blocks:board.blocks};
  let sections=board.sections,section=board.sections.find(item=>item.title===stream.section?.trim())?.id;
  if(stream.section?.trim()&&!section){section='pending-section';sections=[...sections,{id:section,title:stream.section.trim()}];}
  const existing=board.blocks.find(block=>block.title===stream.title);
  if(existing)return {sections,blocks:board.blocks.map(block=>block===existing?{...block,body:stream.body??block.body,...(stream.kind?{kind:stream.kind}:{}),...(stream.size?{size:stream.size}:{}),stream:stream.status}:block)};
  if(!section){section=[...board.blocks].reverse().find(block=>block.section)?.section;if(!section){section='pending-section';sections=[...sections,{id:section,title:'板书'}];}}
  return {sections,blocks:[...board.blocks,{id:'pending-'+stream.callId,title:stream.title,body:stream.body??'',kind:stream.kind??'note',size:stream.size??'narrow',section,stream:stream.status,pending:true}]};
}

export function createLessonBoard(React) {
  const h=React.createElement,{useState,useRef,useEffect,useMemo,useCallback}=React;
  const MathInteractive=props=>createMathInteractive(React,props);
  const visuals=createBoardVisuals(React);
  const FramesView=createBoardFrames(React,{renderMarkdown:text=>cachedMarkdown(text,{})});
  const AnswerView=createBoardAnswers(React,{renderInline:renderBoardInline,inputs:visuals.inputs});

  function ComponentSlot({segment,block,sessionId,actions}) {
    const component=useMemo(()=>readComponent(segment),[segment.type,segment.source,segment.index]);
    const slotKey=`${block.id}:${component.index}`;
    if(component.error)return h('div',{className:'nb-q-pending',role:'note'},block.stream?'正在画图…':'这一处的写法有误，请让老师重写。');
    if(component.type==='frames')return h(FramesView,{component,block,live:!block.stream&&!block.pending,onSubmit:value=>actions.submit(block,component,value)});
    if(!component.answerable){
      if(component.type==='figure')return h(visuals.FigureView,{component,snapshotKey:block.stream?undefined:slotKey,prefix:actions.prefix(block),onDiscuss:actions.discuss});
      if(component.type==='flow')return h(visuals.FlowView,{component,flowId:`flow-${slotKey.replace(/[^A-Za-z0-9-]/g,'-')}`});
      return null;
    }
    return h(AnswerView,{component,answers:block.answers,live:!block.stream&&!block.pending,slotKey,draftKey:`notara-board-draft:${sessionId}:${block.id}:${component.index}:${component.fingerprint}`,onSubmit:value=>actions.submit(block,component,value),onResend:answerId=>actions.resend(block,answerId)});
  }
  function BlockBody({block,sessionId,assetUrls,actions,source}) {
    const {segments,open}=useMemo(()=>splitBoardBody(block.body??''),[block.body]);
    const last=segments.length-1;
    return h('div',{className:'nb-body',onMouseUp:event=>actions.select(event,block,source),onClick:event=>{const link=event.target.closest('[data-source]');if(link){event.preventDefault();actions.source(link.dataset.source);}}},
      segments.map((segment,index)=>segment.kind==='markdown'
        ?h('div',{key:'m'+index,className:'nb-md',dangerouslySetInnerHTML:{__html:cachedMarkdown(block.stream&&index===last&&!open?stableBoardPreview(segment.text):segment.text,assetUrls)}})
        :h(ComponentSlot,{key:'c'+segment.index,segment,block,sessionId,actions})),
      open&&h('div',{className:'nb-q-pending'},open.type==='figure'||open.type==='flow'||open.type==='frames'?'正在画图…':'正在出题…'));
  }
  const Block=React.memo(function Block({block,position,source,sessionId,assetUrls,actions,measure,reading,cameraScale}) {
    const ref=useCallback(element=>measure?.(block.id,element),[block.id,measure]);
    const stream=block.stream;
    const inner=h(BlockBody,{block,sessionId,assetUrls,actions,source});
    const interactive=block.interactive?.provider==='math'&&block.interactiveScene
      ? h(MathInteractive,{scene:block.interactiveScene,onChange:patch=>actions.interaction(block,patch),onExpand:()=>actions.expand(block),onDiscuss:actions.discuss})
      : block.interactiveState==='unavailable'?h('div',{className:'nb-interactive-unavailable'},'互动图暂时不可用，板书文字仍然保留。'):null;
    const folded=block.kind&&!['note','question'].includes(block.kind);
    const fixedHeight=!reading&&Number.isFinite(position?.height);
    const resizeHandle=!reading&&!stream&&position&&h('button',{type:'button',className:'nb-resize-handle','aria-label':`调整大小 ${block.title}，使用方向键微调`,'title':'拖动以调整宽度和高度',style:{transform:`scale(${Math.max(.8,Math.min(3,1/(cameraScale??1)))})`},onPointerDown:event=>actions.resize(event,block,position,source),onKeyDown:event=>actions.resizeKey(event,block,position,source)},'◢');
    return h('article',{ref,className:'nb-block','data-block-id':block.id??block.path,'data-kind':block.kind,'data-stream':stream?'true':undefined,'data-pinned':!source&&isPinned(block)?'true':undefined,'data-fixed-height':fixedHeight?'true':undefined,onWheel:event=>{
      if(event.ctrlKey||event.metaKey)return;
      let element=event.target instanceof Element?event.target:null;
      const card=element?.closest('.nb-block');if(!card)return;
      const deltaX=event.shiftKey?(event.deltaY||event.deltaX):event.deltaX,deltaY=event.shiftKey?0:event.deltaY;
      while(element&&element!==card){
        const style=getComputedStyle(element),maxX=element.scrollWidth-element.clientWidth,maxY=element.scrollHeight-element.clientHeight;
        const scrollX=['auto','scroll'].includes(style.overflowX)&&maxX>1&&((deltaX<0&&element.scrollLeft>0)||(deltaX>0&&element.scrollLeft<maxX-1));
        const scrollY=['auto','scroll'].includes(style.overflowY)&&maxY>1&&((deltaY<0&&element.scrollTop>0)||(deltaY>0&&element.scrollTop<maxY-1));
        if(scrollX||scrollY){event.stopPropagation();return;}
        element=element.parentElement;
      }
    },style:reading||!position?undefined:{left:position.x,top:position.y,width:position.width,...(fixedHeight?{height:position.height}:{})}},
      h('div',{className:'nb-block-tools'},
        !reading&&h('button',{className:'nb-grip','aria-label':'移动 '+block.title,onPointerDown:event=>actions.drag(event,block,source,position)},'⠿ 拖动'),
        !source&&!stream&&h('button',{onClick:()=>actions.ask(block)},'追问这块'),
        !source&&!reading&&isPinned(block)&&block.section&&h('button',{onClick:()=>actions.unpin(block)},'放回排版'),
        source&&block.missing?h('span',null,'资料已移动或不可用'):null),
      stream&&h('div',{className:'nb-live-label'},stream==='streaming'?'正在板书…':'等待保存…'),
      h('div',{className:'nb-card-content'},folded?h('details',null,h('summary',null,h('span',{dangerouslySetInnerHTML:{__html:renderBoardInline(block.title)}})),inner,interactive):h(React.Fragment,null,h('h2',null,block.kind==='question'&&h('span',{className:'nb-kind-tag'},'题目'),h('span',{dangerouslySetInnerHTML:{__html:renderBoardInline(block.title)}})),inner,interactive),
        source&&h('div',{className:'nb-source-actions'},h('button',{disabled:block.missing,onClick:()=>actions.source(block.path)},'打开资料'),...block.usedBy.map((id,index)=>h('button',{key:id,onClick:()=>actions.back(id)},block.usedBy.length===1?'回到板书':'引用位置 '+(index+1))))),
      resizeHandle);
  },(previous,next)=>sameBlock(previous.block,next.block)&&samePosition(previous.position,next.position)&&previous.source===next.source&&previous.assetUrls===next.assetUrls&&previous.reading===next.reading&&previous.sessionId===next.sessionId&&previous.cameraScale===next.cameraScale);

  return function Board({ctx,sessionId,visible,openView,onDiscuss}) {
    const client=useMemo(()=>createVaultClient(ctx,sessionId),[ctx,sessionId]);
    const [board,setBoard]=useState(EMPTY),[face,setFace]=useState('board'),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[stream,setStream]=useState(()=>getBoardStream(sessionId)),[expandedInteraction,setExpandedInteraction]=useState(null);
    const [camera,setCamera]=useState({board:{x:0,y:0,z:1},sources:{x:0,y:0,z:1}}),[follow,setFollow]=useState(true),[exporting,setExporting]=useState(false),[include,setInclude]=useState({}),[outline,setOutline]=useState(false);
    const [heights,setHeights]=useState(()=>new Map()),[drag,setDrag]=useState(null),[reading,setReading]=useState(false);
    const [assetState,setAssetState]=useState({client:null,urls:EMPTY_ASSET_URLS}),imagePaths=boardImageTargets(board.blocks.map(b=>b.body).join('\n')).join('\n');
    // Hide URLs from the previous client immediately, before effects run.
    const assetUrls=assetState.client===client?assetState.urls:EMPTY_ASSET_URLS;
    useEffect(()=>{
      let alive=true;
      const known=assetState.client===client?assetState.urls:EMPTY_ASSET_URLS;
      setAssetState(previous=>previous.client===client?previous:{client,urls:EMPTY_ASSET_URLS});
      for(const path of imagePaths.split('\n').filter(Boolean))if(!known[path])client.readAsset({path}).then(unwrap).then(asset=>{
        if(alive&&/^image\/(?:png|jpeg|gif|webp|svg\+xml)$/.test(asset.mime))setAssetState(previous=>({client,urls:{...(previous.client===client?previous.urls:EMPTY_ASSET_URLS),[path]:asset.dataUrl}}));
      }).catch(()=>{});
      return()=>{alive=false;};
    },[imagePaths,client]);
    const current=useRef(board),mounted=useRef(true),saving=useRef(false),root=useRef(null),viewport=useRef(null),gesture=useRef(null),selection=useRef(null),focusedCall=useRef(null),focusedSection=useRef(null),request=useRef(0),observed=useRef(false),expandedId=useRef(null),boardKey=useRef('');
    const spacePan=useRef(false);
    current.current=board;const cam=camera[face];
    const accept=value=>{const key=JSON.stringify(value);if(key===boardKey.current)return;boardKey.current=key;setBoard(value);};
    async function refresh(){const serial=++request.current;try{const value=unwrap(await client.board());if(mounted.current&&serial===request.current&&!saving.current){accept(value);if(!observed.current){observed.current=true;setNotice('');}}}catch(error){if(mounted.current)setNotice(error.message);}}
    useEffect(()=>{mounted.current=true;boardKey.current='';refresh();return()=>{mounted.current=false;request.current++;};},[client]);
    useEffect(()=>{if(!visible)return;refresh();const timer=visibleInterval(()=>{if(!saving.current&&!gesture.current)refresh();},2500);return()=>timer();},[visible,client]);
    useEffect(()=>subscribeBoardStream(sessionId,value=>{if(['completed','error'].includes(value.status)){setStream(null);refresh();setNotice(value.status==='error'?'这次板书未保存，保留上次保存的内容。':'');}else{setStream(value);setNotice('');}}),[sessionId,client]);
    // Reading mode follows the board's own width, not the window's.
    useEffect(()=>{const element=root.current;if(!element)return;const observer=new ResizeObserver(()=>setReading(element.clientWidth>0&&element.clientWidth<READING_WIDTH));observer.observe(element);return()=>observer.disconnect();},[]);
    // Heights are measured after render; layout never guesses them from text length.
    const measured=useRef(new Map()),pending=useRef(new Map()),frame=useRef(0);
    const observer=useMemo(()=>typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{for(const entry of entries){const id=entry.target.dataset.blockId;if(id)pending.current.set(id,Math.round(entry.target.offsetHeight));}if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;const updates=pending.current;pending.current=new Map();setHeights(previous=>{let changed=false;const next=new Map(previous);for(const [id,value] of updates)if(Math.abs((previous.get(id)??0)-value)>1){next.set(id,value);changed=true;}return changed?next:previous;});});}),[]);
    useEffect(()=>()=>{observer?.disconnect();cancelAnimationFrame(frame.current);},[observer]);
    const measure=useCallback((id,element)=>{const known=measured.current.get(id);if(known&&known!==element)observer?.unobserve(known);if(element){measured.current.set(id,element);observer?.observe(element);}else measured.current.delete(id);},[observer]);

    async function save(target,patch,source=false){if(saving.current){setNotice('上一处调整正在保存，请稍后再试。');return;}saving.current=true;request.current++;setBusy(true);setNotice('');try{const result=unwrap(await client.mutateBoard({expectedRevision:current.current.revision,...(source?{sourcePath:target.path}:{blockId:target.id}),patch}));if(mounted.current)accept(result);}catch(error){if(mounted.current)setNotice(error.message);}finally{saving.current=false;if(mounted.current){setBusy(false);setDrag(null);refresh();}}}
    async function saveInteraction(block,patch){if(saving.current){setNotice('上一处调整正在保存，请稍后再试。');return false;}const ref=block.interactive;if(!ref)return false;saving.current=true;request.current++;setBusy(true);setNotice('');try{const result=unwrap(await client.mutateBoardInteraction({boardRevision:current.current.revision,interactionId:ref.interactionId,interactionRevision:ref.revision,patch}));if(mounted.current){accept(result);if(expandedId.current===block.id)setExpandedInteraction(result.blocks.find(item=>item.id===block.id)??null);}return true;}catch(error){if(mounted.current)setNotice(error.message);return false;}finally{saving.current=false;if(mounted.current){setBusy(false);refresh();}}}
    const moveCamera=(patch,target=face)=>setCamera(prev=>({...prev,[target]:{...prev[target],...patch}}));
    const focus=(rect,target=face)=>{const width=viewport.current?.clientWidth??500,z=Math.min(1,Math.max(.45,(width-48)/rect.width));moveCamera({x:24-rect.x*z,y:30-rect.y*z,z},target);};

    const merged=useMemo(()=>withStream(board,stream),[board,stream]);
    const layout=useMemo(()=>layoutBoard(merged.sections,merged.blocks,heights),[merged,heights]);
    const sectionTitle=id=>merged.sections.find(section=>section.id===id)?.title;
    const blocks=face==='board'?merged.blocks:board.sources;
    const positionOf=block=>{if(face!=='board'){const position={x:block.x,y:block.y,width:block.width,...(Number.isFinite(block.height)?{height:block.height}:{})};return drag?.path===block.path?{...position,x:drag.x??position.x,y:drag.y??position.y,width:drag.width??position.width,height:drag.height??position.height}:position;}const base=layout.positions.get(block.id);if(!base)return base;const position=Number.isFinite(block.height)?{...base,height:block.height}:base;return drag?.id===block.id?{...position,x:drag.x??position.x,y:drag.y??position.y,width:drag.width??position.width,height:drag.height??position.height}:position;};
    // Follow the teacher: move when the writing enters another section, and
    // within a section only when the block being written is off screen.
    useEffect(()=>{
      if(!follow||face!=='board'||reading||!stream?.title||focusedCall.current===stream.callId)return;
      const block=merged.blocks.find(item=>item.title===stream.title),position=block&&layout.positions.get(block.id);if(!block||!position)return;
      focusedCall.current=stream.callId;
      const frameOf=layout.frames.find(item=>item.id===block.section);
      if(frameOf&&focusedSection.current!==block.section){focusedSection.current=block.section;focus(frameOf);return;}
      const box=viewport.current?.getBoundingClientRect(),left=position.x*cam.z+cam.x,top=position.y*cam.z+cam.y;
      if(box&&(left<0||top<0||left+position.width*cam.z>box.width||top+120>box.height))focus(position);
    },[stream?.callId,stream?.title,follow,face,reading,layout]);
    // Opening the board lands on the latest block once per visit, after the first measurements.
    const landed=useRef(false);
    useEffect(()=>{if(!visible){landed.current=false;return;}if(landed.current||face!=='board'||reading||stream||!merged.blocks.length||!heights.size)return;if(land())landed.current=true;},[visible,face,reading,stream,merged.blocks.length,heights.size>0,layout]);
    const zoom=delta=>{setFollow(false);const rect=viewport.current.getBoundingClientRect(),z=Math.max(.3,Math.min(2,cam.z+delta));moveCamera({z,x:rect.width/2-(rect.width/2-cam.x)*z/cam.z,y:rect.height/2-(rect.height/2-cam.y)*z/cam.z});};
    useEffect(()=>{
      const element=viewport.current;if(!visible||!element||face==='board'&&reading)return;
      const wheel=event=>{
        if(event.defaultPrevented||localWheelTarget(event.target,element))return;
        const amount=(event.deltaY||event.deltaX)*(event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1);
        if(!Number.isFinite(amount)||amount===0)return;
        event.preventDefault();event.stopPropagation();setFollow(false);
        const box=element.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
        setCamera(previous=>{const old=previous[face],z=Math.max(.3,Math.min(2,old.z*Math.exp(-amount*.0015)));
          return {...previous,[face]:{z,x:x-(x-old.x)*z/old.z,y:y-(y-old.y)*z/old.z}};
        });
      };
      const clear=()=>{spacePan.current=false;const g=gesture.current;if(g?.type==='pan'){gesture.current=null;if(element.hasPointerCapture(g.pointerId))element.releasePointerCapture(g.pointerId);}};
      const down=event=>{if((event.code==='Space'||event.key===' ')&&!event.repeat&&!editableTarget(event.target)&&!interactiveTarget(event.target)&&!(event.target instanceof Element&&event.target.closest('button,a[href],summary,[role="button"]'))){spacePan.current=true;event.preventDefault();}};
      const up=event=>{if(event.code==='Space'||event.key===' ')spacePan.current=false;};
      element.addEventListener('wheel',wheel,{passive:false});window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);
      return()=>{element.removeEventListener('wheel',wheel);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);clear();};
    },[visible,face,reading]);
    const fitRect=rect=>{const box=viewport.current.getBoundingClientRect(),z=Math.max(.3,Math.min(1,(box.width-60)/rect.width,(box.height-110)/rect.height));moveCamera({z,x:(box.width-rect.width*z)/2-rect.x*z,y:30-rect.y*z});};
    // The latest block the teacher wrote (writing order) and the section it is in.
    const latest=()=>{const block=[...merged.blocks].reverse().find(item=>!isPinned(item)&&layout.positions.get(item.id));return block?{block,position:layout.positions.get(block.id),frame:layout.frames.find(item=>item.id===block.section)}:null;};
    // Land on the latest block: the width of its section fits, and the block itself is in view.
    const land=()=>{const found=latest(),box=viewport.current?.getBoundingClientRect();if(!found?.frame||!box)return false;const {frame:frameOf,position,block}=found,z=Math.min(1,Math.max(.45,(box.width-48)/frameOf.width)),bottom=position.y+(heights.get(block.id)??260);const top=(bottom-frameOf.y)*z>box.height-120?Math.min(position.y,bottom-(box.height-120)/z):frameOf.y;focusedSection.current=block.section;moveCamera({x:24-frameOf.x*z,y:30-top*z,z},'board');return true;};
    // 全览 never goes below half size: a wider board shows the latest section at the right edge, earlier ones to its left.
    const fit=()=>{setFollow(false);const items=face==='board'?[...layout.frames,...merged.blocks.filter(isPinned).map(block=>({...layout.positions.get(block.id),height:block.height??heights.get(block.id)??200}))]:blocks.map(block=>({x:block.x,y:block.y,width:block.width,height:block.height??260}));if(!items.length){moveCamera({x:0,y:0,z:1});return;}const left=Math.min(...items.map(item=>item.x)),top=Math.min(...items.map(item=>item.y)),right=Math.max(...items.map(item=>item.x+item.width)),bottom=Math.max(...items.map(item=>item.y+(item.height??260)));const box=viewport.current.getBoundingClientRect(),z=Math.min(1,(box.width-60)/(right-left),(box.height-110)/(bottom-top));if(face==='board'&&z<.5){const anchor=latest()?.frame??{x:left,width:0},x=Math.min(24-left*.5,Math.max(24-anchor.x*.5,box.width-24-(anchor.x+anchor.width)*.5));moveCamera({z:.5,x,y:30-top*.5});return;}fitRect({x:left,y:top,width:right-left,height:bottom-top});};
    const currentSection=()=>layout.frames.find(item=>item.id===focusedSection.current)??layout.frames.at(-1);
    const actions=useRef({});
    Object.assign(actions.current,{
      drag:(event,block,source,position)=>{if(saving.current||block.stream||!position)return;event.preventDefault();event.stopPropagation();setFollow(false);selection.current=null;gesture.current={type:'block',block,source,startX:event.clientX,startY:event.clientY,x:position.x,y:position.y};viewport.current.setPointerCapture(event.pointerId);},
      resize:(event,block,position,source)=>{if(saving.current||block.stream||!position)return;event.preventDefault();event.stopPropagation();setFollow(false);selection.current=null;const element=event.currentTarget.closest('.nb-block');gesture.current={type:'resize',block,source,startX:event.clientX,startY:event.clientY,x:position.x,y:position.y,width:position.width,height:position.height??element?.offsetHeight??BLOCK_HEIGHT.min};viewport.current.setPointerCapture(event.pointerId);},
      resizeKey:(event,block,position,source)=>{if(!position)return;const step=event.shiftKey?40:12,element=event.currentTarget.closest('.nb-block'),height=position.height??element?.offsetHeight??BLOCK_HEIGHT.min;let width=bounded(position.width,BLOCK_WIDTH),nextHeight=height;if(event.key==='ArrowRight')width=bounded(width+step,BLOCK_WIDTH);else if(event.key==='ArrowLeft')width=bounded(width-step,BLOCK_WIDTH);else if(event.key==='ArrowDown')nextHeight=bounded(height+step,BLOCK_HEIGHT);else if(event.key==='ArrowUp')nextHeight=bounded(height-step,BLOCK_HEIGHT);else return;event.preventDefault();save(block,{x:position.x,y:position.y,width,height:nextHeight},source);},
      select:(event,block,source)=>{selection.current=null;const selected=window.getSelection();if(!selected||selected.isCollapsed)return;const text=boardSelectionText(event.currentTarget,selected);selection.current=text?{block,source,text}:{blocked:true};},
      source:path=>openView(VIEW_IDS.assets,path),
      back:id=>{const position=layout.positions.get(id);if(position){setFace('board');setFollow(false);focus(position,'board');}},
      interaction:(block,patch)=>saveInteraction(block,patch),
      expand:block=>{expandedId.current=block.id;setExpandedInteraction(block);},
      discuss:text=>onDiscuss?.(text),
      prefix:block=>`〔白板｜${[sectionTitle(block.section),block.title].filter(Boolean).join('｜')}〕`,
      ask:block=>{const quoted=selection.current?.block?.id===block.id?selection.current.text.trim():'';onDiscuss?.(`${actions.current.prefix(block)}${quoted?`“${quoted.slice(0,300)}”`:''}`);},
      unpin:block=>save(block,{pinned:false}),
      submit:async(block,component,value)=>{const result=unwrap(await client.answerBoard({blockId:block.id,component:component.index,fingerprint:component.fingerprint,value}));const {delivery,...next}=result;if(mounted.current)accept(next);return delivery;},
      resend:async(block,answerId)=>unwrap(await client.resendBoardAnswer({blockId:block.id,answerId})).delivery,
    });
    const stableActions=useMemo(()=>Object.fromEntries(['drag','resize','resizeKey','select','source','back','interaction','expand','discuss','prefix','ask','unpin','submit','resend'].map(name=>[name,(...args)=>actions.current[name](...args)])),[]);
    const pointerMove=event=>{const g=gesture.current;if(!g)return;const dx=event.clientX-g.startX,dy=event.clientY-g.startY;if(g.type==='pan')moveCamera({x:g.x+dx,y:g.y+dy});else if(g.type==='resize'){g.patch={x:g.x,y:g.y,width:bounded(g.width+dx/cam.z,BLOCK_WIDTH),height:bounded(g.height+dy/cam.z,BLOCK_HEIGHT)};setDrag(g.source?{path:g.block.path,...g.patch}:{id:g.block.id,...g.patch});}else{g.patch={x:Math.round(g.x+dx/cam.z),y:Math.round(g.y+dy/cam.z)};setDrag(g.source?{path:g.block.path,...g.patch}:{id:g.block.id,...g.patch});}};
    const endGesture=event=>{const g=gesture.current;gesture.current=null;if(viewport.current?.hasPointerCapture(event.pointerId))viewport.current.releasePointerCapture(event.pointerId);if(g?.type==='block'||g?.type==='resize'){if(g.patch)save(g.block,g.patch,g.source);else setDrag(null);}};
    const highlight=color=>{const selected=selection.current;if(!selected){setNotice('先选中板书或资料说明中的文字，再选择颜色。');return;}if(selected.blocked){setNotice('请只选择一处完整的普通文字，再添加高亮。');return;}try{const body=highlightBoardText(selected.block.body,selected.text,color);save(selected.block,{body},selected.source);selection.current={...selected,block:{...selected.block,body}};}catch(error){setNotice(error.message);}};
    function download(type){const output=exportBoard(board,{...include,assetUrls,figureSvgs:snapshotFigures(),mathCss:mathStyleText()});const url=URL.createObjectURL(new Blob([type==='md'?output.markdown:output.html],{type:type==='md'?'text/markdown;charset=utf-8':'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='课堂笔记.'+type;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setExporting(false);}
    const sourceMap=new Map(board.sources.map(s=>[s.path,s]));
    const writing=stream&&['streaming','pending'].includes(stream.status);
    const blockProps=block=>({key:block.id??block.path,block,sessionId,assetUrls,actions:stableActions,source:face==='sources',measure:face==='board'&&!reading?measure:undefined,reading:face==='board'&&reading,cameraScale:cam.z});
    const startPan=(event,forced=false)=>{
      if(event.button!==0&&event.button!==1||editableTarget(event.target)||interactiveTarget(event.target))return;
      if(!forced&&event.target.closest('.nb-block,.nb-toolbar,.nb-outline'))return;
      if(forced&&event.button!==1&&!spacePan.current)return;
      event.preventDefault();event.stopPropagation();setFollow(false);event.currentTarget.focus({preventScroll:true});
      gesture.current={type:'pan',pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:cam.x,y:cam.y};event.currentTarget.setPointerCapture(event.pointerId);
    };
    const canvas=h('div',{className:'nb-viewport',ref:viewport,tabIndex:0,'aria-label':face==='board'?'课堂板书画布':'本课资料关系画布',onPointerDownCapture:event=>{if(event.button===1||spacePan.current)startPan(event,true);},onPointerDown:event=>startPan(event),onAuxClick:event=>{if(event.button===1)event.preventDefault();},onPointerMove:pointerMove,onPointerUp:endGesture,onPointerCancel:endGesture},
      h('div',{className:'nb-world',style:{transform:`translate(${cam.x}px,${cam.y}px) scale(${cam.z})`}},
        face==='sources'&&h('svg',{className:'nb-edges'},board.edges.map((edge,index)=>{const a=sourceMap.get(edge.from),b=sourceMap.get(edge.to);if(!a||!b)return null;const x=a.x+a.width,y=a.y+80;return h('g',{key:index},h('path',{d:`M ${x} ${y} C ${x+50} ${y},${b.x-50} ${b.y+80},${b.x} ${b.y+80}`}),h('text',{x:(x+b.x)/2,y:(y+b.y+80)/2-8},edge.label));})),
        face==='board'&&layout.frames.map(item=>h('h1',{key:item.id,className:'nb-section-title',title:item.title,style:{left:item.x,top:item.y,maxWidth:item.titleWidth??item.width},dangerouslySetInnerHTML:{__html:renderBoardInline(item.title)}})),
        blocks.map(block=>h(Block,{...blockProps(block),position:positionOf(block)}))));
    const controls=h(React.Fragment,null,
h('div',{className:'nb-toolbar',role:'toolbar','aria-label':'画布控制'},h('button',{'aria-label':'缩小',onClick:()=>zoom(-.1)},'−'),h('button',{'aria-label':'重置缩放',onClick:()=>moveCamera({z:1})},Math.round(cam.z*100)+'%'),h('button',{'aria-label':'放大',onClick:()=>zoom(.1)},'+'),h('button',{onClick:fit},'全览'),
        face==='board'&&layout.frames.length>0&&h('button',{onClick:()=>{setFollow(false);const section=currentSection();if(section)fitRect(section);}},'本板块'),
        face==='board'&&layout.frames.length>0&&h('button',{'aria-expanded':outline,'aria-haspopup':'true',onClick:()=>setOutline(!outline)},'板块'),
        h('span',{className:'nb-sep'}),HIGHLIGHTS.map(color=>h('button',{key:color,className:'nb-color','data-color':color,'aria-label':colorNames[color]+'高亮',onMouseDown:e=>e.preventDefault(),onClick:()=>highlight(color)})),h('button',{'aria-label':'清除高亮',onMouseDown:e=>e.preventDefault(),onClick:()=>highlight(null)},'清除'),h('span',{className:'nb-sep'}),h('button',{className:'nb-follow','aria-pressed':follow,onClick:()=>{const next=!follow;setFollow(next);focusedCall.current=null;focusedSection.current=null;if(next&&face==='board'&&!stream)land();}},follow?'跟随中':'跟随板书')),
      outline&&face==='board'&&h('nav',{className:'nb-outline','aria-label':'板块目录'},h('strong',null,'板块'),h('ol',null,layout.frames.map(item=>{const live=writing&&merged.blocks.some(block=>block.stream&&block.section===item.id);return h('li',{key:item.id},h('button',{'aria-current':live?'true':undefined,onClick:()=>{setFollow(false);setOutline(false);focusedSection.current=item.id;fitRect(item);}},item.title,live?h('span',{className:'nb-outline-live'},'正在写'):null));}))));
    const readingView=h('div',{className:'nb-reading','aria-label':'课堂板书'},readingOrder(merged.sections,merged.blocks).map(group=>h('section',{key:group.id??'legacy',className:'nb-reading-section'},group.title&&h('h1',{className:'nb-section-title',title:group.title,dangerouslySetInnerHTML:{__html:renderBoardInline(group.title)}}),group.blocks.map(block=>h(Block,{...blockProps(block),position:null})))));
    return h('div',{className:'nb-board',ref:root,'data-reading':face==='board'&&reading?'true':undefined},h('style',null,css+FLOW_CSS),
      h('header',{className:'nb-head'},h('div',{className:'nb-tabs',role:'tablist','aria-label':'白板两面'},[['board','课堂板书'],['sources','知识视图']].map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':face===id,onClick:()=>{setFace(id);selection.current=null;setOutline(false);}},label))),h('span',{className:'nb-status',role:'status'},busy?'正在保存…':writing?'老师正在板书':board.revision?'已保存':''),h('button',{onClick:()=>setExporting(!exporting),'aria-expanded':exporting},'导出')),
      notice&&h('div',{className:'nb-notice',role:'status'},notice),
      face==='board'&&reading?readingView:canvas,
      !(face==='board'&&reading)&&controls,
      expandedInteraction&&expandedInteraction.interactiveScene&&h('div',{className:'nb-interactive-modal-host'},h(MathInteractive,{scene:expandedInteraction.interactiveScene,expanded:true,onChange:patch=>saveInteraction(expandedInteraction,patch),onDiscuss:text=>onDiscuss?.(text),onClose:()=>{expandedId.current=null;setExpandedInteraction(null);}})),
      exporting&&h('div',{className:'nb-export',role:'dialog','aria-label':'导出课堂笔记'},h('strong',null,'带走这一课'),h('div',null,'选择要包含的内容'),[['hint','已给出的提示'],['reference','参考推导'],['attempt','个人尝试（含白板作答）']].map(([key,label])=>h('label',{key},h('input',{type:'checkbox',checked:!!include[key],onChange:e=>setInclude(prev=>({...prev,[key]:e.target.checked}))}),label)),h('div',{className:'nb-export-actions'},h('button',{onClick:()=>download('md')},'Markdown'),h('button',{onClick:()=>download('html')},'HTML'),h('button',{onClick:()=>setExporting(false)},'取消'))));
  };
}
