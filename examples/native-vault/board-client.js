import baseCss from './board-client.css';
import freeCss from './board/free-board.css';
import {createFreeBoardUI,DEFAULT_FIGURE,isDrawing} from './board/ui-client.js';
const css=baseCss+freeCss;
import { createVaultClient, visibleInterval } from './remote-client.js';
import { createProjectionReader } from './projection-client.js';
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
import {EMPTY_SCENE,teacherRequest,sourceTarget,sourceRefForRead,requestId,captureBoardCreation} from './board/board-editing.js';
import {mediaLocatorSuffix} from './media.js';
import {createDraftStore} from './draft-client.js';
import {boardNavigationPreference,isTextEntry,isInnerBoardEditor,panIntent,zoomAt,wheelCamera} from './board/board-navigation.js';
const creationDrafts=createDraftStore('free-board-create');

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
const sameBlock=(a,b)=>a===b||(a&&b&&a.id===b.id&&a.title===b.title&&a.body===b.body&&a.contentType===b.contentType&&a.contentRef===b.contentRef&&a.sourceRef===b.sourceRef&&a.sourceState===b.sourceState&&a.url===b.url&&a.kind===b.kind&&a.size===b.size&&a.width===b.width&&a.height===b.height&&a.stream===b.stream&&a.missing===b.missing&&answersKey(a)===answersKey(b)&&a.interactive?.revision===b.interactive?.revision&&JSON.stringify(a.interactiveScene)===JSON.stringify(b.interactiveScene)&&a.interactiveState===b.interactiveState&&isPinned(a)===isPinned(b)&&(a.usedBy??[]).join()===(b.usedBy??[]).join());
const samePosition=(a,b)=>a===b||(a&&b&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height);

/** The draft block the teacher is writing right now, merged into the saved board. */
function withStream(board,stream){
  if(!stream||!['streaming','pending'].includes(stream.status)||!stream.title&&!stream.blockId)return {sections:board.sections,blocks:board.blocks};
  let sections=board.sections,section=board.sections.find(item=>item.title===stream.section?.trim())?.id;
  if(stream.section?.trim()&&!section){section='pending-section';sections=[...sections,{id:section,title:stream.section.trim()}];}
  const existing=board.blocks.find(block=>stream.blockId?block.id===stream.blockId:block.title===stream.title);
  if(existing)return {sections,blocks:board.blocks.map(block=>block===existing?{...block,body:stream.operation==='patch'?block.body:stream.body??block.body,...(stream.kind?{kind:stream.kind}:{}),...(stream.size?{size:stream.size}:{}),stream:stream.operation==='patch'?'patch':stream.status}:block)};
  if(stream.operation==='patch')return {sections:board.sections,blocks:board.blocks};
  if(!section){section=[...board.blocks].reverse().find(block=>block.section)?.section;if(!section){section='pending-section';sections=[...sections,{id:section,title:'板书'}];}}
  return {sections,blocks:[...board.blocks,{id:'pending-'+stream.callId,title:stream.title,body:stream.body??'',kind:stream.kind??'note',size:stream.size??'narrow',section,stream:stream.status,pending:true}]};
}

export function createLessonBoard(React,readers) {
  const {VaultFileContainer,DrawingPreview,FreeBlockEditor,ContributionOriginal}=createFreeBoardUI(React,readers);
  const h=React.createElement,{useState,useRef,useEffect,useMemo,useCallback}=React;
  const MathInteractive=props=>createMathInteractive(React,props);
  const visuals=createBoardVisuals(React);
  const FramesView=createBoardFrames(React,{renderMarkdown:text=>cachedMarkdown(text,{})});
  const AnswerView=createBoardAnswers(React,{renderInline:renderBoardInline,inputs:visuals.inputs});
  const icon=name=>name==='ai'?h('span',{'aria-hidden':true},'✨'):h('svg',{viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:({move:'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',edit:'M4 20l4-1L20 7l-3-3L5 16l-1 4M14 7l3 3',inline:'M4 4h16v16H4zM8 8v8M11 8h5M11 12h5M11 16h3',connect:'M8 8l8 8M4 4h5v5H4zM15 15h5v5h-5z',unpin:'M8 7H4v4M4 7l5 5M10 4h10v16H10M10 16h6'})[name]}));
  const tool=(label,title,name,props={})=>h('button',{...props,'aria-label':label,title,className:'nb-block-icon'+(props.className?' '+props.className:'')},icon(name));

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
  const Block=React.memo(function Block({block,position,source,sessionId,assetUrls,actions,measure,reading,selected,client,visible,contribution,inline,editorProps,cameraScale}) {
    const ref=useCallback(element=>measure?.(block.id,element),[block.id,measure]);
    const stream=block.stream;
    const inner=h(BlockBody,{block,sessionId,assetUrls,actions,source});
    const interactive=block.interactive?.provider==='math'&&block.interactiveScene
      ? h(MathInteractive,{scene:block.interactiveScene,onChange:patch=>actions.interaction(block,patch),onExpand:()=>actions.expand(block),onDiscuss:actions.discuss})
      : block.interactiveState==='unavailable'?h('div',{className:'nb-interactive-unavailable'},'互动图暂时不可用，板书文字仍然保留。'):null;
    const folded=block.kind&&!['note','question'].includes(block.kind);
    const fixedHeight=!reading&&Number.isFinite(position?.height);
    const resizeHandle=!reading&&!stream&&position&&h('button',{type:'button',className:'nb-resize-handle','aria-label':`调整大小 ${block.title}，使用方向键微调`,title:'拖动以调整宽度和高度',style:{transform:`scale(${Math.max(.8,Math.min(3,1/(cameraScale??1)))})`},onPointerDown:event=>actions.resizeDrag(event,block,position,source),onKeyDown:event=>actions.resizeKey(event,block,position,source)},'◢');
    return h('article',{ref,className:'nb-block','data-block-id':block.id??block.path,'data-fixed-height':fixedHeight?'true':undefined,'data-content-type':block.contentType,'data-selected':selected?'true':undefined,'data-kind':block.kind,'data-stream':stream?'true':undefined,'data-pinned':!source&&isPinned(block)?'true':undefined,style:reading||!position?undefined:{left:position.x,top:position.y,width:position.width,...(fixedHeight?{height:position.height}:{})},onDoubleClick:event=>{if(!source&&!stream&&!isInnerBoardEditor(event.target)&&!event.target.closest('button,input,textarea,select,a,.nb-q,.nb-interactive'))actions.edit(block);}},
      h('div',{className:'nb-block-tools'},
        !source&&!stream&&h('label',{className:'nb-select-block',title:'选择 '+block.title},h('input',{type:'checkbox','aria-label':'选择 '+block.title,checked:!!selected,onChange:()=>actions.choose(block)})),
        !reading&&tool('移动 '+block.title,'拖动移动此块','move',{className:'nb-grip',onPointerDown:event=>actions.drag(event,block,source,position)}),
        !source&&!stream&&tool(block.contentType?'请老师完善':'追问这块',block.contentType?'请老师完善此块':'追问这块','ai',{onClick:()=>actions.ask(block)}),
        !source&&!stream&&tool('编辑','放大编辑此块','edit',{onClick:()=>actions.edit(block)}),
        !source&&!stream&&block.contentType&&tool('原位编辑','在此块内编辑','inline',{onClick:()=>actions.inline(block)}),
        !source&&!stream&&tool('连线','连接另一块','connect',{onClick:()=>actions.connect(block)}),
        !source&&!reading&&isPinned(block)&&block.section&&tool('放回排版','放回自动排版','unpin',{onClick:()=>actions.unpin(block)}),
        source&&block.missing?h('span',null,'资料已移动或不可用'):null),
      !source&&contribution?.actor==='teacher'&&h('span',{className:'nb-contribution-badge'},'老师补充 · 可在修改记录中回看与撤销'),
      stream&&h('div',{className:'nb-live-label'},stream==='patch'?'老师正在完善这块…':stream==='streaming'?'正在板书…':'等待保存…'),
      h('div',{className:'nb-card-content'},folded?h('details',null,h('summary',null,h('span',{dangerouslySetInnerHTML:{__html:renderBoardInline(block.title)}})),inner,interactive):h(React.Fragment,null,h('h2',{className:!reading?'nb-block-title-grip':undefined,onPointerDown:!reading?event=>actions.drag(event,block,source,position):undefined},block.kind==='question'&&h('span',{className:'nb-kind-tag'},'题目'),h('span',{dangerouslySetInnerHTML:{__html:renderBoardInline(block.title)}})),!inline&&isDrawing(block)&&h(DrawingPreview,{block,client,visible}),!inline&&inner,!inline&&interactive),
      inline&&block.contentType!=='source'&&h(FreeBlockEditor,{...editorProps,block,inline:true,onExpand:()=>actions.edit(block)}),
      !source&&block.contentType==='source'&&h(React.Fragment,null,h(VaultFileContainer,{block,client,workspaceId:editorProps.workspaceId,draftKey:editorProps.draftKey,active:inline,visible,onClose:editorProps.onClose,onExpand:actions.sourceRef,onDiscuss:()=>actions.ask(block),onNotice:editorProps.onNotice,onFlush:editorProps.onFlush,onOpenFile:editorProps.onOpenFile}),h('div',{className:'nb-card-source'},block.sourceState==='changed'&&h('p',{role:'status'},'资料已更新，原引用版本保留'),['missing','unavailable'].includes(block.sourceState)&&h('p',{role:'status'},'资料已移动或不可用'),h('button',{disabled:['missing','unavailable'].includes(block.sourceState),onClick:()=>actions.sourceRef(block.sourceRef)},block.sourceState==='changed'?'打开最新原文':'打开资料'))),
      !source&&block.contentType==='link'&&/^https?:\/\//i.test(block.url??'')&&h('a',{href:block.url,target:'_blank',rel:'noopener noreferrer',className:'nb-external-link'},'打开链接'),
      !source&&!stream&&block.contentType&&h('div',{className:'nb-card-actions'},h('button',{onClick:()=>actions.remove(block)},'删除块'),!reading&&h('button',{onClick:()=>actions.resize(block)},'调整大小')),
      source&&h('div',{className:'nb-source-actions'},h('button',{disabled:block.missing,onClick:()=>actions.source(block.path)},'打开资料'),...block.usedBy.map((id,index)=>h('button',{key:id,onClick:()=>actions.back(id)},block.usedBy.length===1?'回到板书':'引用位置 '+(index+1))))),resizeHandle);
  },(previous,next)=>sameBlock(previous.block,next.block)&&previous.block.height===next.block.height&&previous.inline===next.inline&&previous.editorProps?.boardRevision===next.editorProps?.boardRevision&&samePosition(previous.position,next.position)&&previous.source===next.source&&previous.assetUrls===next.assetUrls&&previous.reading===next.reading&&previous.sessionId===next.sessionId&&previous.selected===next.selected&&previous.client===next.client&&previous.visible===next.visible&&previous.contribution?.id===next.contribution?.id);

  return function Board({ctx,sessionId,visible,openView,onDiscuss}) {
    const client=useMemo(()=>createVaultClient(ctx,sessionId),[ctx,sessionId]);
    const reader=useMemo(()=>createProjectionReader(input=>client.board(input)),[client]);
    const [board,setBoard]=useState(EMPTY),[face,setFace]=useState('board'),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[stream,setStream]=useState(()=>getBoardStream(sessionId)),[expandedInteraction,setExpandedInteraction]=useState(null);
    const [camera,setCamera]=useState({board:{x:0,y:0,z:1},sources:{x:0,y:0,z:1}}),[follow,setFollow]=useState(true),[exporting,setExporting]=useState(false),[include,setInclude]=useState({}),[outline,setOutline]=useState(false);
    const [heights,setHeights]=useState(()=>new Map()),[drag,setDrag]=useState(null),[reading,setReading]=useState(false);
    const navigation=React.useSyncExternalStore(boardNavigationPreference.subscribe,boardNavigationPreference.getSnapshot),cameraRef=useRef(camera),space=useRef(false);
    const [zoomInput,setZoomInput]=useState('100'),zoomEditing=useRef(false);
    const workspaceId=board.workspaceId??ctx.workspaces?.list?.getSnapshot()?.items?.find(item=>item.sessionIds?.includes(sessionId))?.workspaceId??'';
    const draftKey=workspaceId+':'+sessionId;
    const [editing,setEditing]=useState(null),[inlineId,setInlineId]=useState(null),[selectedBlocks,setSelectedBlocks]=useState([]),[panel,setPanel]=useState(null),[form,setForm]=useState(()=>creationDrafts.get(draftKey)??{contentType:'text',title:'',body:'',url:'',path:'',page:1,width:420,height:420,label:'',direction:'forward',from:'',to:''}),[files,setFiles]=useState([]);
    useEffect(()=>{if(panel==='create'){if(form.title||form.body||form.url||form.path)creationDrafts.set(draftKey,form);else creationDrafts.delete(draftKey);}const retained=creationDrafts.get(draftKey),dirty=!!retained&&!retained.savedReceipt,key='board-create:'+draftKey;window.dispatchEvent(new CustomEvent('notara-editor-dirty',{detail:{key,dirty}}));return()=>window.dispatchEvent(new CustomEvent('notara-editor-dirty',{detail:{key,dirty:false}}));},[panel,form,draftKey]);
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
    const current=useRef(board),mounted=useRef(true),saving=useRef(false),root=useRef(null),viewport=useRef(null),gesture=useRef(null),selection=useRef(null),focusedCall=useRef(null),focusedSection=useRef(null),request=useRef(0),observed=useRef(false),expandedId=useRef(null),boardKey=useRef(''),editorFlush=useRef(null),exportBusy=useRef(false),lastReceipt=useRef(null),projectionOutstanding=useRef(false);
    function registerEditorFlush(owner,flush){if(flush)editorFlush.current={owner,flush};else if(editorFlush.current?.owner===owner)editorFlush.current=null;}
    async function flushEditor(){return !editorFlush.current||await editorFlush.current.flush()!==false;}
    async function activateEditor(block,inline){if(!await flushEditor())return false;setInlineId(inline?block.id:null);setEditing(inline?null:block.id);setPanel(null);return true;}
    current.current=board;const cam=camera[face];
    useEffect(()=>{if(face==='board'&&reading)zoomEditing.current=false;if(!zoomEditing.current)setZoomInput(String(Math.round(cam.z*100)));},[cam.z,face,reading]);
    const accept=(value,fromPoll=false)=>{if(!Array.isArray(value?.blocks))return;if(!fromPoll)reader.invalidate();if(value===boardKey.current)return;boardKey.current=value;current.current=value;setBoard(value);};
    async function refresh(){const serial=++request.current;try{const value=unwrap(await reader.read());if(mounted.current&&serial===request.current&&!saving.current&&Array.isArray(value.blocks)){accept(value,true);projectionOutstanding.current=false;if(!observed.current){observed.current=true;setNotice('');}return value;}}catch(error){if(mounted.current)setNotice(projectionOutstanding.current?'内容已经保存，白板视图暂未同步，请稍后重试。':error.message);}return null;}
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
    async function commit(ops,expectedRevision=current.current.revision,id=requestId()) {
      if(saving.current)throw Error('上一处修改正在保存，请稍后再试。');
      saving.current=true;request.current++;setBusy(true);setNotice('');
      try{const input={expectedRevision,requestId:id,ops};if(new TextEncoder().encode(JSON.stringify({...input,sessionId})).length>1_800_000)throw Error('这次含图内容超过保存容量，请改用图片资料卡或分开保存。');const result=unwrap(await client.commitBoard(input));
        if(Array.isArray(result.blocks)){lastReceipt.current=result;projectionOutstanding.current=false;if(mounted.current)accept(result);return result;}
        if(result.saved!==true||typeof result.revision!=='string')throw Error('白板保存回执不完整，请重试。');
        lastReceipt.current=result;projectionOutstanding.current=true;saving.current=false;const hydrated=await refresh();
        if(mounted.current&&!hydrated)setNotice('内容已经保存，白板视图暂未同步，请稍后重试。');
        return {...result,projectionPending:!hydrated};
      }
      finally{saving.current=false;if(mounted.current){setBusy(false);setDrag(null);}}
    }
    async function operate(ops){try{await commit(ops);return true;}catch(error){setNotice(error.message);return false;}}
    async function openSource(ref){try{if(!await flushEditor())return;const target=sourceTarget(ref);if(target.workspaceId!==workspaceId)throw Error('这份引用来自其他学习集，当前白板不能打开。');const card=current.current.blocks.find(b=>b.sourceRef===ref);if(['missing','unavailable'].includes(card?.sourceState))throw Error('资料已移动或不可用，白板引用仍保留。');if(card?.sourceState==='changed')setNotice('正在打开最新原文；白板保留原引用版本。');setInlineId(null);openView(VIEW_IDS.assets,{path:target.path,fragment:mediaLocatorSuffix(target.locator)});}catch(error){setNotice(error.message);}}
    async function resumeCreated(receipt){if(!await flushEditor())return false;const result=await refresh(),id=receipt.created?.['new-block'],block=result?.blocks.find(b=>b.id===id);if(!block){setNotice('内容已经保存，白板视图暂未同步，请稍后重试。');return false;}creationDrafts.delete(draftKey);setPanel(null);setForm(prev=>({...prev,title:'',body:'',url:'',path:'',pendingCreate:undefined,savedReceipt:undefined}));setSelectedBlocks([id]);if(['text','drawing','mindmap','figure'].includes(block.contentType))await activateEditor(block,false);focus({x:block.x??0,y:block.y??0,width:block.width??420});return true;}
    async function createBlock(){try{if(!await flushEditor())return;
      if(form.savedReceipt){await resumeCreated(form.savedReceipt);return;}
      if(!form.title.trim())throw Error('请填写标题。');
      let op=form.pendingCreate?.op;
      if(!op){op={type:'create',ref:'new-block',title:form.title.trim(),body:form.body,contentType:form.contentType,x:Math.round((50-cam.x)/cam.z),y:Math.round((60-cam.y)/cam.z),width:420};
      // New cards get a free nearby spot; manual positions are then preserved.
      for(let attempt=0;attempt<100;attempt++){const overlap=[...layout.positions.entries()].some(([id,p])=>op.x<p.x+p.width+24&&op.x+op.width+24>p.x&&op.y<p.y+(heights.get(id)??260)+24&&op.y+280>p.y);if(!overlap)break;op.x+=460;}
      if(isDrawing(op))op.content={...structuredClone(EMPTY_SCENE),...(op.contentType==='mindmap'?{mindmap:{nodes:[],links:[],notes:[]}}:{})};
      if(op.contentType==='figure')op.body=form.body.trim()||DEFAULT_FIGURE;
      if(op.contentType==='link'){const url=new URL(form.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('请输入 http 或 https 网页链接。');op.url=url.href;}
      if(op.contentType==='source'){
        if(!form.path)throw Error('请选择本集资料。');
        const file=files.find(row=>row.path===form.path),read=unwrap(await (file?.kind==='page'||/\.md$/i.test(form.path)?client.read({path:form.path}):client.readAsset({path:form.path})));
        op.sourceRef=sourceRefForRead(read,workspaceId,/\.pdf$/i.test(form.path)?{kind:'pdf-page',page:Math.max(1,Number(form.page)||1)}:undefined);
      }
      }
      const retainedDraft=captureBoardCreation(form,op),pending=retainedDraft.pendingCreate;
      creationDrafts.set(draftKey,retainedDraft);setForm(retainedDraft);
      const result=await commit([pending.op],current.current.revision,pending.requestId),id=result.created?.['new-block'];if(!result.projectionPending)creationDrafts.delete(draftKey);else{const retained={...form,savedReceipt:{revision:result.revision,commitId:result.commitId,created:result.created}};creationDrafts.set(draftKey,retained);setForm(retained);}setPanel(null);if(!result.projectionPending)setForm(prev=>({...prev,title:'',body:'',url:'',path:'',pendingCreate:undefined,savedReceipt:undefined}));if(id){setSelectedBlocks([id]);const block=current.current.blocks.find(b=>b.id===id);if(block){if(['text','drawing','mindmap','figure'].includes(op.contentType))await activateEditor(block,false);focus({x:block.x??0,y:block.y??0,width:block.width??420});}}
    }catch(error){setNotice(error.message);}}
    async function startCreate(){const retained=creationDrafts.get(draftKey);if(retained?.savedReceipt&&await resumeCreated(retained.savedReceipt))return;if(retained)setForm(retained);setPanel('create');if(!retained?.savedReceipt)setNotice('');client.list({}).then(unwrap).then(result=>setFiles(result.files??[])).catch(()=>setNotice('资料列表未读到，可先创建文字或绘图块。'));}
    async function saveInteraction(block,patch){if(saving.current){setNotice('上一处调整正在保存，请稍后再试。');return false;}const ref=block.interactive;if(!ref)return false;saving.current=true;request.current++;setBusy(true);setNotice('');try{const result=unwrap(await client.mutateBoardInteraction({boardRevision:current.current.revision,interactionId:ref.interactionId,interactionRevision:ref.revision,patch}));if(mounted.current){accept(result);if(expandedId.current===block.id)setExpandedInteraction(result.blocks.find(item=>item.id===block.id)??null);}return true;}catch(error){if(mounted.current)setNotice(error.message);return false;}finally{saving.current=false;if(mounted.current){setBusy(false);refresh();}}}
    const moveCamera=(patch,target=face)=>{const previous=cameraRef.current;const next={...previous,[target]:{...previous[target],...(typeof patch==='function'?patch(previous[target]):patch)}};cameraRef.current=next;setCamera(next);};
    const focus=(rect,target=face)=>{const width=viewport.current?.clientWidth??500,z=Math.min(1,Math.max(.45,(width-48)/rect.width));moveCamera({x:24-rect.x*z,y:30-rect.y*z,z},target);};

    const merged=useMemo(()=>withStream(board,stream),[board,stream]);
    const layout=useMemo(()=>layoutBoard(merged.sections,merged.blocks,heights),[merged,heights]);
    const sectionTitle=id=>merged.sections.find(section=>section.id===id)?.title;
    const blocks=face==='board'?merged.blocks:board.sources;
    const positionOf=block=>{if(face!=='board'){const position={x:block.x,y:block.y,width:block.width,...(Number.isFinite(block.height)?{height:block.height}:{})};return drag?.path===block.path?{...position,x:drag.x??position.x,y:drag.y??position.y,width:drag.width??position.width,height:drag.height??position.height}:position;}const base=layout.positions.get(block.id);if(!base)return base;const position=Number.isFinite(block.height)?{...base,height:block.height}:base;return drag?.id===block.id?{...position,x:drag.x??position.x,y:drag.y??position.y,width:drag.width??position.width,height:drag.height??position.height}:position;};
    // Follow the teacher: move when the writing enters another section, and
    // within a section only when the block being written is off screen.
    useEffect(()=>{
      if(!follow||face!=='board'||reading||!stream?.title&&!stream?.blockId||focusedCall.current===stream.callId)return;
      const block=merged.blocks.find(item=>stream.blockId?item.id===stream.blockId:item.title===stream.title),position=block&&layout.positions.get(block.id);if(!block||!position)return;
      focusedCall.current=stream.callId;
      const frameOf=layout.frames.find(item=>item.id===block.section);
      if(frameOf&&focusedSection.current!==block.section){focusedSection.current=block.section;focus(frameOf);return;}
      const box=viewport.current?.getBoundingClientRect(),latestCamera=cameraRef.current.board,left=position.x*latestCamera.z+latestCamera.x,top=position.y*latestCamera.z+latestCamera.y;
      if(box&&(left<0||top<0||left+position.width*latestCamera.z>box.width||top+120>box.height))focus(position);
    },[stream?.callId,stream?.title,follow,face,reading,layout]);
    // Opening the board lands on the latest block once per visit, after the first measurements.
    const landed=useRef(false);
    useEffect(()=>{if(!visible){landed.current=false;return;}if(landed.current||face!=='board'||reading||stream||!merged.blocks.length||!heights.size)return;if(land())landed.current=true;},[visible,face,reading,stream,merged.blocks.length,heights.size>0,layout]);
    const setZoom=value=>{const rect=viewport.current?.getBoundingClientRect();if(!rect)return;setFollow(false);moveCamera(previous=>zoomAt(previous,typeof value==='function'?value(previous.z):value,{x:rect.width/2,y:rect.height/2}));};
    const zoom=delta=>setZoom(previous=>previous+delta);
    const commitZoom=value=>{zoomEditing.current=false;const percent=Number(value);if(value.trim()&&Number.isFinite(percent)){const bounded=Math.max(30,Math.min(200,Math.round(percent)));setZoom(bounded/100);setZoomInput(String(bounded));}else setZoomInput(String(Math.round(cameraRef.current[face].z*100)));};
    useEffect(()=>{const element=viewport.current;if(!visible||!element||face==='board'&&reading)return;const wheel=event=>{if(event.defaultPrevented||isInnerBoardEditor(event.target)||localWheelTarget(event.target,element))return;event.preventDefault();event.stopPropagation();const rect=element.getBoundingClientRect();setFollow(false);moveCamera(previous=>wheelCamera(previous,event,navigation,{x:event.clientX-rect.left,y:event.clientY-rect.top},rect.height));};element.addEventListener('wheel',wheel,{capture:true,passive:false});return()=>element.removeEventListener('wheel',wheel,true);},[visible,face,reading,navigation]);
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
      drag:(event,block,source,position)=>{if(event.button!==0||space.current||saving.current||block.stream||!position)return;event.preventDefault();event.stopPropagation();setFollow(false);selection.current=null;gesture.current={type:'block',block,source,pointerId:event.pointerId,button:0,startX:event.clientX,startY:event.clientY,x:position.x,y:position.y,z:cameraRef.current[face].z};viewport.current.setPointerCapture(event.pointerId);},
      resizeDrag:(event,block,position,source)=>{if(saving.current||block.stream||!position)return;event.preventDefault();event.stopPropagation();setFollow(false);selection.current=null;const element=event.currentTarget.closest('.nb-block');gesture.current={type:'resize',pointerId:event.pointerId,button:0,z:cameraRef.current[face].z,block,source,startX:event.clientX,startY:event.clientY,x:position.x,y:position.y,width:position.width,height:position.height??element?.offsetHeight??BLOCK_HEIGHT.min};viewport.current.setPointerCapture(event.pointerId);},
      resizeKey:(event,block,position,source)=>{if(!position)return;const step=event.shiftKey?40:12,element=event.currentTarget.closest('.nb-block'),height=position.height??element?.offsetHeight??BLOCK_HEIGHT.min;let width=bounded(position.width,BLOCK_WIDTH),nextHeight=height;if(event.key==='ArrowRight')width=bounded(width+step,BLOCK_WIDTH);else if(event.key==='ArrowLeft')width=bounded(width-step,BLOCK_WIDTH);else if(event.key==='ArrowDown')nextHeight=bounded(height+step,BLOCK_HEIGHT);else if(event.key==='ArrowUp')nextHeight=bounded(height-step,BLOCK_HEIGHT);else return;event.preventDefault();save(block,{x:position.x,y:position.y,width,height:nextHeight},source);},
      select:(event,block,source)=>{selection.current=null;const selected=window.getSelection();if(!selected||selected.isCollapsed)return;const text=boardSelectionText(event.currentTarget,selected);selection.current=text?{block,source,text}:{blocked:true};},
      source:path=>openView(VIEW_IDS.assets,path),
      back:id=>{const position=layout.positions.get(id);if(position){setFace('board');setFollow(false);focus(position,'board');}},
      interaction:(block,patch)=>saveInteraction(block,patch),
      expand:block=>{expandedId.current=block.id;setExpandedInteraction(block);},
      discuss:text=>onDiscuss?.(text),
      prefix:block=>`〔白板｜${[sectionTitle(block.section),block.title].filter(Boolean).join('｜')}〕`,
      ask:async block=>{if(!await flushEditor())return;const quoted=selection.current?.block?.id===block.id?selection.current.text.trim():'';onDiscuss?.(block.contentType?teacherRequest(block,[],quoted?`请老师完善这段：${quoted.slice(0,300)}`:'请老师完善'):`${actions.current.prefix(block)}${quoted?`“${quoted.slice(0,300)}”`:''}`);},
      edit:async block=>{if(block.contentType==='source')return openSource(block.sourceRef);await activateEditor(block,false);},
      inline:block=>activateEditor(block,true),
      choose:block=>setSelectedBlocks(prev=>prev.includes(block.id)?prev.filter(id=>id!==block.id):[...prev,block.id]),
      connect:block=>{setPanel('connect');setForm(prev=>({...prev,from:block.id,to:'',label:'',direction:'forward'}));},
      sourceRef:openSource,
      remove:async block=>{if((inlineId===block.id||editing===block.id)&&!await flushEditor())return;if(await operate([{type:'remove',blockId:block.id}]))setSelectedBlocks(prev=>prev.filter(id=>id!==block.id));},
      resize:block=>{setPanel('resize');setForm(prev=>({...prev,from:block.id,width:block.width??420,height:block.height??420}));},
      unpin:block=>save(block,{pinned:false}),
      submit:async(block,component,value)=>{const result=unwrap(await client.answerBoard({blockId:block.id,component:component.index,fingerprint:component.fingerprint,value}));const {delivery,...next}=result;if(mounted.current)accept(next);return delivery;},
      resend:async(block,answerId)=>unwrap(await client.resendBoardAnswer({blockId:block.id,answerId})).delivery,
    });
    const stableActions=useMemo(()=>Object.fromEntries(['drag','resizeDrag','resizeKey','select','source','back','interaction','expand','discuss','prefix','ask','unpin','submit','resend','edit','inline','choose','connect','sourceRef','remove','resize'].map(name=>[name,(...args)=>actions.current[name](...args)])),[]);
    const endGesture=(event,commitMove=true)=>{const g=gesture.current;if(!g||event?.pointerId!=null&&event.pointerId!==g.pointerId)return;gesture.current=null;if(viewport.current?.hasPointerCapture(g.pointerId))viewport.current.releasePointerCapture(g.pointerId);viewport.current?.removeAttribute('data-gesturing');if(g.type==='block'||g.type==='resize'){if(commitMove&&g.patch){if(!g.source&&g.block.contentType)operate([{type:'patch',blockId:g.block.id,patch:g.patch}]);else save(g.block,g.patch,g.source);}else setDrag(null);}};
    const pointerMove=event=>{const g=gesture.current;if(!g||event.pointerId!==g.pointerId)return;if(!(event.buttons&(g.button===1?4:1))){endGesture(event,false);return;}const dx=event.clientX-g.startX,dy=event.clientY-g.startY;if(g.type==='pan')moveCamera({x:g.x+dx,y:g.y+dy});else if(g.type==='resize'){g.patch={x:g.x,y:g.y,width:bounded(g.width+dx/g.z,BLOCK_WIDTH),height:bounded(g.height+dy/g.z,BLOCK_HEIGHT)};setDrag(g.source?{path:g.block.path,...g.patch}:{id:g.block.id,...g.patch});}else{g.patch={x:Math.round(g.x+dx/g.z),y:Math.round(g.y+dy/g.z)};setDrag(g.source?{path:g.block.path,...g.patch}:{id:g.block.id,...g.patch});}};
    const beginPan=event=>{if(gesture.current||!panIntent(event,space.current))return;event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});setFollow(false);const c=cameraRef.current[face];gesture.current={type:'pan',pointerId:event.pointerId,button:event.button,startX:event.clientX,startY:event.clientY,x:c.x,y:c.y};event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.dataset.gesturing='pan';};
    const latestGesture=useRef();latestGesture.current=endGesture;
    useEffect(()=>{const release=()=>{space.current=false;latestGesture.current?.(null,false);};const keyup=event=>{if(event.code==='Space')space.current=false;};window.addEventListener('blur',release);window.addEventListener('keyup',keyup);if(!visible)release();return()=>{release();window.removeEventListener('blur',release);window.removeEventListener('keyup',keyup);};},[visible,face,reading]);
    const highlight=color=>{const selected=selection.current;if(!selected){setNotice('先选中板书或资料说明中的文字，再选择颜色。');return;}if(selected.blocked){setNotice('请只选择一处完整的普通文字，再添加高亮。');return;}try{const body=highlightBoardText(selected.block.body,selected.text,color);save(selected.block,{body},selected.source);selection.current={...selected,block:{...selected.block,body}};}catch(error){setNotice(error.message);}};
    async function requestExport(){if(!await flushEditor())return;setExporting(value=>!value);}
    async function download(type){if(exportBusy.current)return;exportBusy.current=true;try{
      if(!await flushEditor())return;
      if(projectionOutstanding.current&&!await refresh())throw Error('内容已经保存，请等白板视图同步后再导出。');
      const snapshot=structuredClone(current.current);
      for(const block of snapshot.blocks)if(block.contentRef){const value=unwrap(await client.contentBoard({blockId:block.id}));if(value.revision!==snapshot.revision)throw Error('白板刚有新的修改，请重试导出最新版。');block.content=value.content;if(!block.content)throw Error('绘图内容未读到，请重试导出。');}
      const output=exportBoard(snapshot,{...include,assetUrls,figureSvgs:snapshotFigures(),mathCss:mathStyleText()});const url=URL.createObjectURL(new Blob([type==='md'?output.markdown:output.html],{type:type==='md'?'text/markdown;charset=utf-8':'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='课堂笔记.'+type;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setExporting(false);
    }catch(error){setNotice(error.message);}finally{exportBusy.current=false;}}
    const sourceMap=new Map(board.sources.map(s=>[s.path,s]));
    const writing=stream&&['streaming','pending'].includes(stream.status);
    const sharedEditorProps={client,draftKey,workspaceId,visible,boardRevision:board.revision,onCommit:commit,onClose:()=>setInlineId(null),onDiscuss,onSource:openSource,onOpenFile:async path=>{if(!await flushEditor())return;setInlineId(null);setEditing(null);openView(VIEW_IDS.assets,path);},onNotice:setNotice,onFlush:handler=>registerEditorFlush('expanded:'+editing,handler),onExport:requestExport,sources:board.blocks.filter(b=>b.sourceRef).map(b=>({title:b.title,sourceRef:b.sourceRef}))};
    const blockProps=block=>({key:block.id??block.path,block,sessionId,assetUrls,actions:stableActions,source:face==='sources',measure:face==='board'&&!reading?measure:undefined,reading:face==='board'&&reading,selected:selectedBlocks.includes(block.id),client,visible,cameraScale:cam.z,inline:inlineId===block.id,editorProps:{...sharedEditorProps,onFlush:handler=>registerEditorFlush('inline:'+block.id,handler)},contribution:(board.contributions??[]).filter(c=>!c.undone&&c.contentChanged&&c.targetIds?.includes(block.id)).at(-1)});
    const canvas=h('div',{className:'nb-viewport',ref:viewport,tabIndex:0,'aria-label':face==='board'?'课堂板书画布':'本课资料关系画布',onPointerDownCapture:beginPan,onPointerMove:pointerMove,onPointerUp:event=>endGesture(event),onPointerCancel:event=>endGesture(event,false),onLostPointerCapture:event=>endGesture(event,false),onAuxClick:event=>{if(event.button===1)event.preventDefault();}},
      h('div',{className:'nb-world',style:{transform:`translate(${cam.x}px,${cam.y}px) scale(${cam.z})`}},
        face==='board'&&(board.groups??[]).map(group=>{const positions=(group.members??[]).map(id=>{const block=merged.blocks.find(b=>b.id===id),position=block&&positionOf(block);return position?{...position,id}:null;}).filter(Boolean);if(!positions.length)return null;const x=Math.min(...positions.map(p=>p.x))-16,y=Math.min(...positions.map(p=>p.y))-36,right=Math.max(...positions.map(p=>p.x+p.width))+16,bottom=Math.max(...positions.map(p=>p.y+(heights.get(p.id)??260)))+16;return h('div',{key:group.id,className:'nb-canvas-group',style:{left:x,top:y,width:right-x,height:bottom-y}},h('strong',null,group.title));}),
        face==='board'&&h('svg',{className:'nb-edges nb-manual-edges','aria-label':'白板手工关联'},h('defs',null,h('marker',{id:'nb-arrow-'+sessionId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},h('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#7b94a9',stroke:'none'}))),(board.manualEdges??[]).map(edge=>{const from=merged.blocks.find(b=>b.id===edge.from),to=merged.blocks.find(b=>b.id===edge.to),a=from&&positionOf(from),b=to&&positionOf(to);if(!a||!b)return null;const x=a.x+a.width,y=a.y+60,tx=b.x,ty=b.y+60;return h('g',{key:edge.id},h('path',{d:`M ${x} ${y} C ${x+70} ${y},${tx-70} ${ty},${tx} ${ty}`,markerEnd:edge.direction!=='none'?`url(#nb-arrow-${sessionId})`:undefined,markerStart:edge.direction==='both'?`url(#nb-arrow-${sessionId})`:undefined}),h('text',{x:(x+tx)/2,y:(y+ty)/2-9},edge.label));})),
        face==='sources'&&h('svg',{className:'nb-edges'},board.edges.map((edge,index)=>{const a=sourceMap.get(edge.from),b=sourceMap.get(edge.to);if(!a||!b)return null;const x=a.x+a.width,y=a.y+80;return h('g',{key:index},h('path',{d:`M ${x} ${y} C ${x+50} ${y},${b.x-50} ${b.y+80},${b.x} ${b.y+80}`}),h('text',{x:(x+b.x)/2,y:(y+b.y+80)/2-8},edge.label));})),
        face==='board'&&layout.frames.map(item=>h('h1',{key:item.id,className:'nb-section-title',title:item.title,style:{left:item.x,top:item.y,maxWidth:item.titleWidth??item.width},dangerouslySetInnerHTML:{__html:renderBoardInline(item.title)}})),
        blocks.map(block=>h(Block,{...blockProps(block),position:positionOf(block)}))));
    const controls=h(React.Fragment,null,
h('div',{className:'nb-toolbar',role:'toolbar','aria-label':'画布控制'},
        h('div',{className:'nb-zoom-controls',role:'group','aria-label':'画布缩放'},
          h('button',{'aria-label':'缩小',disabled:cam.z<=.3,onClick:()=>zoom(-.1)},'−'),
          h('input',{className:'nb-zoom-slider',type:'range','aria-label':'缩放滑条',min:30,max:200,step:1,value:Math.round(cam.z*100),onChange:event=>setZoom(Number(event.target.value)/100)}),
          h('button',{'aria-label':'放大',disabled:cam.z>=2,onClick:()=>zoom(.1)},'+')),
        h('label',{className:'nb-zoom-value'},h('input',{type:'number','aria-label':'缩放百分比',min:30,max:200,step:1,inputMode:'numeric',value:zoomInput,onFocus:()=>{zoomEditing.current=true;},onChange:event=>setZoomInput(event.target.value),onBlur:event=>commitZoom(event.target.value),onKeyDown:event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}),h('span',{'aria-hidden':true},'%')),
        h('button',{onClick:fit},'全览'),
        face==='board'&&layout.frames.length>0&&h('button',{onClick:()=>{setFollow(false);const section=currentSection();if(section)fitRect(section);}},'本板块'),
        face==='board'&&layout.frames.length>0&&h('button',{'aria-expanded':outline,'aria-haspopup':'true',onClick:()=>setOutline(!outline)},'板块'),
        h('span',{className:'nb-sep'}),HIGHLIGHTS.map(color=>h('button',{key:color,className:'nb-color','data-color':color,'aria-label':colorNames[color]+'高亮',onMouseDown:e=>e.preventDefault(),onClick:()=>highlight(color)})),h('button',{'aria-label':'清除高亮',onMouseDown:e=>e.preventDefault(),onClick:()=>highlight(null)},'清除'),h('span',{className:'nb-sep'}),h('button',{className:'nb-follow','aria-pressed':follow,onClick:()=>{const next=!follow;setFollow(next);focusedCall.current=null;focusedSection.current=null;if(next&&face==='board'&&!stream)land();}},follow?'跟随中':'跟随板书')),
      outline&&face==='board'&&h('nav',{className:'nb-outline','aria-label':'板块目录'},
        h('strong',null,'板块'),
        h('ol',null,layout.frames.map(item=>{const live=writing&&merged.blocks.some(block=>block.stream&&block.section===item.id);return h('li',{key:item.id},h('button',{'aria-current':live?'true':undefined,onClick:()=>{setFollow(false);setOutline(false);focusedSection.current=item.id;fitRect(item);}},item.title,live?h('span',{className:'nb-outline-live'},'正在写'):null));})),
        h('strong',null,'板书列表'),
        h('ol',null,merged.blocks.filter(b=>!b.stream).map(block=>h('li',{key:block.id},h('button',{onClick:()=>{const p=layout.positions.get(block.id);if(p){setOutline(false);setFollow(false);focus(p);}}},block.title))))
      ));
    const readingView=h('div',{className:'nb-reading','aria-label':'课堂板书'},readingOrder(merged.sections,merged.blocks).map(group=>h('section',{key:group.id??'legacy',className:'nb-reading-section'},group.title&&h('h1',{className:'nb-section-title',title:group.title,dangerouslySetInnerHTML:{__html:renderBoardInline(group.title)}}),group.blocks.map(block=>h(Block,{...blockProps(block),position:null})))));
    return h('div',{className:'nb-board',ref:root,'data-navigation':navigation.device,'data-mouse-wheel':navigation.mouseWheel,'data-reading':face==='board'&&reading?'true':undefined,onKeyDownCapture:event=>{if(event.code==='Space'&&!isTextEntry(event.target)&&!event.target.closest('button,a,summary,[role="button"]')&&!isInnerBoardEditor(event.target)&&!(face==='board'&&reading)){event.preventDefault();space.current=true;}if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopPropagation();endGesture(null,false);space.current=false;}},onKeyDown:event=>{if(event.key!=='Escape'||event.defaultPrevented||isInnerBoardEditor(event.target))return;if(exporting){event.preventDefault();setExporting(false);}else if(panel){event.preventDefault();setPanel(null);}else if(outline){event.preventDefault();setOutline(false);}}},h('style',null,css+FLOW_CSS),
      h('header',{className:'nb-head'},h('div',{className:'nb-tabs',role:'tablist','aria-label':'白板两面'},[['board','课堂板书'],['sources','知识视图']].map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':face===id,onClick:async()=>{if(!await flushEditor())return;setInlineId(null);setEditing(null);setFace(id);selection.current=null;setOutline(false);}},label))),face==='board'&&h('button',{disabled:busy,onClick:startCreate},'新增'),face==='board'&&h('button',{disabled:selectedBlocks.length<2||busy,onClick:()=>{setPanel('group');setForm(prev=>({...prev,title:''}));}},'分组'+(selectedBlocks.length?' ('+selectedBlocks.length+')':'')),h('button',{onClick:()=>setPanel(panel==='relations'?null:'relations')},'关系'),h('button',{onClick:()=>setPanel(panel==='contributions'?null:'contributions')},'修改记录'),h('span',{className:'nb-status',role:'status'},busy?'正在保存…':writing?'老师正在板书':board.revision?'已保存':''),h('button',{onClick:requestExport,'aria-expanded':exporting},'导出')),
      notice&&h('div',{className:'nb-notice',role:'status'},notice),
      face==='board'&&reading?readingView:canvas,
      !(face==='board'&&reading)&&controls,
      editing&&h(FreeBlockEditor,{key:draftKey+':'+editing,block:board.blocks.find(b=>b.id===editing)??{id:editing,title:'未保存内容'},client,draftKey,visible,boardRevision:board.revision,onCommit:commit,onClose:()=>setEditing(null),onDiscuss:text=>onDiscuss?.(text),onSource:openSource,onNotice:setNotice,onFlush:handler=>registerEditorFlush('expanded:'+editing,handler),onExport:requestExport,sources:board.blocks.filter(b=>b.sourceRef).map(b=>({title:b.title,sourceRef:b.sourceRef}))}),
      panel&&h('div',{className:'nb-operation-panel',role:'dialog','aria-label':({create:'新增白板块',connect:'连接白板块',group:'白板分组',resize:'调整块宽度',relations:'白板关系',contributions:'白板修改记录'})[panel]},
        h('header',null,h('strong',null,({create:'新增白板块',connect:'连接白板块',group:'白板分组',resize:'调整块宽度',relations:'白板关系',contributions:'白板修改记录'})[panel]),h('button',{onClick:()=>{if(panel==='create'&&(form.title||form.body||form.url||form.path)){setNotice('输入已保留，再点新增可以继续。');}setPanel(null);}},'关闭')),
        panel==='create'&&h(React.Fragment,null,h('label',null,'内容类型',h('select',{'aria-label':'内容类型',disabled:busy||!!form.savedReceipt||!!form.pendingCreate,value:form.contentType,onChange:e=>setForm(prev=>({...prev,contentType:e.target.value}))},[['text','文字 / 公式'],['figure','函数图'],['drawing','自由绘图'],['mindmap','思维导图'],['source','本集资料'],['link','网页链接']].map(([id,label])=>h('option',{key:id,value:id},label)))),h('label',null,'标题',h('input',{'aria-label':'新块标题',disabled:busy||!!form.savedReceipt||!!form.pendingCreate,maxLength:160,value:form.title,onChange:e=>setForm(prev=>({...prev,title:e.target.value}))})),h('label',null,'正文 / 说明',h('textarea',{'aria-label':'新块正文',disabled:busy||!!form.savedReceipt||!!form.pendingCreate,maxLength:50000,value:form.body,onChange:e=>setForm(prev=>({...prev,body:e.target.value}))})),form.contentType==='link'&&h('label',null,'网页链接',h('input',{'aria-label':'网页链接',disabled:busy||!!form.savedReceipt||!!form.pendingCreate,type:'url',value:form.url,onChange:e=>setForm(prev=>({...prev,url:e.target.value}))})),form.contentType==='source'&&h(React.Fragment,null,h('label',null,'本集资料',h('select',{'aria-label':'本集资料',disabled:busy||!!form.savedReceipt||!!form.pendingCreate,value:form.path,onChange:e=>setForm(prev=>({...prev,path:e.target.value}))},h('option',{value:''},'选择资料'),files.map(file=>h('option',{key:file.path,value:file.path},file.title??file.path)))),/\.pdf$/i.test(form.path)&&h('label',null,'PDF 页码',h('input',{'aria-label':'PDF 页码',disabled:busy||!!form.savedReceipt||!!form.pendingCreate,type:'number',min:1,value:form.page,onChange:e=>setForm(prev=>({...prev,page:e.target.value}))}))),h('button',{disabled:busy,onClick:createBlock},form.savedReceipt?'同步已保存内容':form.pendingCreate?'确认这次创建':'创建并编辑'),h('button',{onClick:()=>{creationDrafts.delete(draftKey);setForm(prev=>({...prev,title:'',body:'',url:'',path:'',pendingCreate:undefined,savedReceipt:undefined}));setPanel(null);}},'丢弃未创建内容')),
        panel==='connect'&&h(React.Fragment,null,h('p',null,'从：'+(board.blocks.find(b=>b.id===form.from)?.title??'')),h('label',null,'连接到',h('select',{'aria-label':'连接到',value:form.to,onChange:e=>setForm(prev=>({...prev,to:e.target.value}))},h('option',{value:''},'选择另一块'),board.blocks.filter(b=>b.id!==form.from).map(b=>h('option',{key:b.id,value:b.id},b.title)))),h('label',null,'关系文字',h('input',{'aria-label':'关系文字',maxLength:160,value:form.label,onChange:e=>setForm(prev=>({...prev,label:e.target.value}))})),h('label',null,'方向',h('select',{'aria-label':'连线方向',value:form.direction,onChange:e=>setForm(prev=>({...prev,direction:e.target.value}))},[['forward','单向'],['both','双向'],['none','无方向']].map(([id,label])=>h('option',{key:id,value:id},label)))),h('button',{disabled:busy||!form.to,onClick:async()=>{if(await operate([{type:'connect',from:form.from,to:form.to,label:form.label,direction:form.direction}]))setPanel(null);}},'保存连线')),
        panel==='group'&&h(React.Fragment,null,h('p',null,'所选 '+selectedBlocks.length+' 个块'),h('label',null,'分组名称',h('input',{'aria-label':'分组名称',maxLength:80,value:form.title,onChange:e=>setForm(prev=>({...prev,title:e.target.value}))})),h('button',{disabled:busy||!form.title.trim(),onClick:async()=>{if(await operate([{type:'group',title:form.title,members:selectedBlocks}]))setPanel(null);}},'建立分组')),
        panel==='resize'&&h(React.Fragment,null,h('label',null,'高度',h('input',{'aria-label':'容器高度',type:'number',min:180,max:4000,value:form.height,onChange:e=>setForm(prev=>({...prev,height:Number(e.target.value)}))})),h('label',null,'宽度',h('input',{'aria-label':'块宽度',type:'number',min:240,max:1600,value:form.width,onChange:e=>setForm(prev=>({...prev,width:Number(e.target.value)}))})),h('button',{disabled:busy,onClick:async()=>{if(await operate([{type:'patch',blockId:form.from,patch:{width:form.width,height:form.height}}]))setPanel(null);}},'保存大小')),
        panel==='relations'&&h(React.Fragment,null,h('strong',null,'手工连线'),...(board.manualEdges??[]).map(edge=>h('div',{key:edge.id,className:'nb-record'},h('span',null,`${board.blocks.find(b=>b.id===edge.from)?.title??'块'} ${edge.direction==='both'?'↔':edge.direction==='none'?'—':'→'} ${board.blocks.find(b=>b.id===edge.to)?.title??'块'} ${edge.label??''}`),h('button',{disabled:busy,onClick:()=>operate([{type:'disconnect',edgeId:edge.id}])},'删除连线'))),h('strong',null,'分组'),...(board.groups??[]).map(group=>h('div',{key:group.id,className:'nb-record'},h('span',null,group.title),h('button',{disabled:busy,onClick:()=>operate([{type:'ungroup',groupId:group.id}])},'解除分组')))),
        panel==='contributions'&&h(React.Fragment,null,!(board.contributions??[]).length&&h('p',null,'还没有内容修改记录。'),...[...(board.contributions??[])].reverse().map(entry=>h('div',{key:entry.id,className:'nb-record','data-contribution':entry.id},h('div',null,h('strong',null,entry.actor==='teacher'?(entry.contentChanged?'老师补充':'老师整理布局'):entry.actor==='student'?(entry.contentChanged?'我的修改':'我的布局调整'):'白板修改'),h('small',null,entry.at?new Date(entry.at).toLocaleString():''),h('p',null,(entry.targetIds??[]).map(id=>board.blocks.find(b=>b.id===id)?.title??'已删除的块').join('、')),h(ContributionOriginal,{entry,client,boardRevision:board.revision})),h('button',{disabled:busy||entry.undone||entry.canUndo===false,onClick:async()=>{if(await operate([{type:'undo',commitId:entry.id}]))setNotice('已撤销这次修改，保留后续内容。');}},entry.undoOf?'撤销回执':entry.undone?'已撤销':'撤销这次修改'))))),
      expandedInteraction&&expandedInteraction.interactiveScene&&h('div',{className:'nb-interactive-modal-host'},h(MathInteractive,{scene:expandedInteraction.interactiveScene,expanded:true,onChange:patch=>saveInteraction(expandedInteraction,patch),onDiscuss:text=>onDiscuss?.(text),onClose:()=>{expandedId.current=null;setExpandedInteraction(null);}})),
      exporting&&h('div',{className:'nb-export',role:'dialog','aria-label':'导出课堂笔记'},h('strong',null,'带走这一课'),h('div',null,'选择要包含的内容'),[['hint','已给出的提示'],['reference','参考推导'],['attempt','个人尝试（含白板作答）']].map(([key,label])=>h('label',{key},h('input',{type:'checkbox',checked:!!include[key],onChange:e=>setInclude(prev=>({...prev,[key]:e.target.checked}))}),label)),h('div',{className:'nb-export-actions'},h('button',{onClick:()=>download('md')},'Markdown'),h('button',{onClick:()=>download('html')},'HTML'),h('button',{onClick:()=>setExporting(false)},'取消'))));
  };
}
