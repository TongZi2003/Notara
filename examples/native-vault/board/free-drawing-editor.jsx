import React,{useEffect,useRef,useState} from 'react';
import {Excalidraw,MainMenu,convertToExcalidrawElements,newElementWith,CaptureUpdateAction} from '@excalidraw/excalidraw';
import excalidrawStyles from '@excalidraw/excalidraw/index.css';
const style=document.createElement('style');style.dataset.notaraExcalidraw='true';style.textContent=excalidrawStyles;document.head.append(style);
import {branchIds,changeParent,reconcileMindmap,layoutBranch,emptyMindmap} from './mindmap-operations.js';
import {persistentEditorScene} from './board-editing.js';
import {navigationPreferenceFor,wheelCamera} from './board-navigation.js';

// All published font families are shipped at this path. The existing CSP
// prevents the upstream CDN fallback and remote embeds from gaining access.
window.EXCALIDRAW_ASSET_PATH=new URL('/notara/vault/lazy/excalidraw/',location.origin).href;
const nodeTag='notaraMindmapNode',relationTag='notaraMindmapRelation';
export default function FreeDrawingEditor({scene,mindmap,onChange,onSelect,onSource,onError,sources=[],onExit}) {
 const api=useRef(null),semantic=useRef(scene.mindmap??emptyMindmap()),registry=useRef(new Map((scene.mindmap?.nodes??[]).map(n=>[n.elementId,n]))),relationRegistry=useRef(new Map()),initialKey=useRef(JSON.stringify(scene)),[selected,setSelected]=useState([]),[nodeText,setNodeText]=useState('新节点'),[target,setTarget]=useState(''),[note,setNote]=useState(''),[nodes,setNodes]=useState(scene.mindmap?.nodes??[]),[undoCount,setUndoCount]=useState(0);
 const menuHistory=useRef([]),last=useRef(scene),isApplying=useRef(false);
 const canvasHost=useRef(),navigationCamera=useRef(null);
 useEffect(()=>{const element=canvasHost.current,wheel=event=>{const current=api.current;if(!current||!event.target.closest('canvas'))return;event.preventDefault();event.stopPropagation();const state=current.getAppState(),rect=event.target.getBoundingClientRect(),scale=rect.width/(state.width||rect.width),camera=navigationCamera.current??{x:state.scrollX*state.zoom.value,y:state.scrollY*state.zoom.value,z:state.zoom.value},point={x:(event.clientX-rect.left)/scale,y:(event.clientY-rect.top)/scale},next=wheelCamera(camera,event,navigationPreferenceFor(element),point,rect.height,.1,30);navigationCamera.current=next;current.updateScene({appState:{scrollX:next.x/next.z,scrollY:next.y/next.z,zoom:{value:next.z}},captureUpdate:CaptureUpdateAction.NEVER});};element.addEventListener('wheel',wheel,{capture:true,passive:false});return()=>element.removeEventListener('wheel',wheel,true);},[]);
 const [sourceChoice,setSourceChoice]=useState('');
 const nativeTheme=()=>document.body.hasAttribute('data-ds-dark-theme')?'dark':'light';
 const [theme,setTheme]=useState(nativeTheme);
 useEffect(()=>{const observer=new MutationObserver(()=>setTheme(nativeTheme()));observer.observe(document.body,{attributes:true,attributeFilter:['data-ds-dark-theme']});return()=>observer.disconnect();},[]);
 const selectedNode=selected.find(id=>semantic.current.nodes.some(n=>n.elementId===id));
 useEffect(()=>()=>{api.current=null;menuHistory.current=[];registry.current.clear();relationRegistry.current.clear();},[]);
 const labelFor=id=>{const elements=api.current?.getSceneElements()??last.current.elements,e=elements.find(e=>e.id===id);return (e?.type==='text'?e.text:elements.find(t=>t.containerId===id&&t.type==='text')?.text)??'节点';};
 function publish(elements,appState,files){
  navigationCamera.current={x:appState.scrollX*appState.zoom.value,y:appState.scrollY*appState.zoom.value,z:appState.zoom.value};
  onSelect(Object.keys(appState.selectedElementIds??{}));setSelected(previous=>{const next=Object.keys(appState.selectedElementIds??{});return previous.join()===next.join()?previous:next;});
  // Semantics survive a local graphical undo only for known node identities.
  // Cloned elements do not acquire a second node by copying customData.
  let map=semantic.current;
  if(mindmap){const live=new Set(elements.filter(e=>!e.isDeleted).map(e=>e.id));
   const known=[...registry.current.values()].filter(n=>live.has(n.elementId)).map(n=>{const e=elements.find(e=>e.id===n.elementId),value=e?.customData?.[nodeTag]??n,next={elementId:n.elementId,parentId:value.parentId};for(const field of ['sourceRef','parentEdgeId'])if(value[field]!==undefined)next[field]=value[field];return next;});
   map=reconcileMindmap({...map,nodes:known},elements);semantic.current=map;setNodes(previous=>JSON.stringify(previous)===JSON.stringify(map.nodes)?previous:map.nodes);
  }
  const liveElements=elements.filter(e=>!e.isDeleted),usedFiles=new Set(liveElements.filter(e=>e.type==='image').map(e=>e.fileId));
  const cleanFiles=Object.fromEntries(Object.entries(files??{}).filter(([id])=>usedFiles.has(id)).map(([id,file])=>[id,{id:file.id,dataURL:file.dataURL,mimeType:file.mimeType,...(file.created===undefined?{}:{created:file.created})}]));
  const next=persistentEditorScene({version:1,elements:liveElements,appState:{viewBackgroundColor:appState.viewBackgroundColor??'#ffffff'},files:cleanFiles,...(mindmap?{mindmap:map}:{})});
  const key=JSON.stringify(next);last.current=next;if(key!==initialKey.current){initialKey.current=key;onChange(next);}
 }
 function apply(elements,map,selectionIds=selected){
  if(!api.current)return;
  menuHistory.current.push(structuredClone(last.current));setUndoCount(menuHistory.current.length);
  semantic.current=map;map.nodes.forEach(n=>registry.current.set(n.elementId,n));
  const tagged=elements.map(e=>map.nodes.some(n=>n.elementId===e.id)?newElementWith(e,{customData:{...e.customData,[nodeTag]:map.nodes.find(n=>n.elementId===e.id)}}):e);
  api.current.updateScene({elements:tagged,appState:{selectedElementIds:Object.fromEntries(selectionIds.map(id=>[id,true]))},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
  publish(tagged,api.current.getAppState(),api.current.getFiles());
 }
 function perform(action){try{action();}catch(error){onError(error.message);}}
 function addNode(mode){
  const elements=api.current.getSceneElements(),map=semantic.current,node=map.nodes.find(n=>n.elementId===selectedNode),parent=mode==='child'?node?.elementId:mode==='sibling'?node?.parentId:null;
  if(mode!=='root'&&!node)throw Error('请选中一个导图节点。');
  const anchor=elements.find(e=>e.id===(mode==='child'?selectedNode:parent)),siblings=map.nodes.filter(n=>n.parentId===(parent??null)),id=crypto.randomUUID();
  const generated=convertToExcalidrawElements([{id,type:'rectangle',x:anchor?anchor.x+240:80,y:anchor?anchor.y+siblings.length*110:80+siblings.length*110,width:180,height:65,roundness:{type:3},backgroundColor:'#eef4f8',strokeColor:'#577792',label:{text:nodeText||'新节点',fontFamily:5,fontSize:20}}],{regenerateIds:false});
  const next={...map,nodes:[...map.nodes,{elementId:id,parentId:parent??null}]};
  applyTree([...elements,...generated],next,[id]);
 }
 function withTreeArrows(elements,map){
  const active=new Map(elements.filter(e=>!e.isDeleted).map(e=>[e.id,e])),owned=new Set(semantic.current.nodes.map(n=>n.parentEdgeId).filter(Boolean)),rest=elements.filter(e=>!owned.has(e.id));
  const nodes=map.nodes.map(node=>{const parent=active.get(node.parentId),child=active.get(node.elementId);if(!parent||!child){const root={...node};delete root.parentEdgeId;return root;}
   const old=node.parentEdgeId&&active.get(node.parentEdgeId),id=old?.id??crypto.randomUUID(),x=parent.x+parent.width,y=parent.y+parent.height/2,points=[[0,0],[child.x-x,child.y+child.height/2-y]];
   const draft=convertToExcalidrawElements([{id,type:'arrow',x,y,points,strokeColor:'#91a8ba'}],{regenerateIds:false})[0];
   rest.push(newElementWith(old??draft,{x,y,points,width:Math.abs(points[1][0]),height:Math.abs(points[1][1]),startBinding:{elementId:parent.id,focus:0,gap:0},endBinding:{elementId:child.id,focus:0,gap:0}}));return {...node,parentEdgeId:id};
  });
  // bind references on the existing endpoints, not a duplicate copy of them.
  const ids=new Set(rest.map(e=>e.id));return {map:{...map,nodes},elements:rest.map(e=>{if(!map.nodes.some(n=>n.elementId===e.id))return e;const arrows=rest.filter(a=>a.type==='arrow'&&(a.startBinding?.elementId===e.id||a.endBinding?.elementId===e.id)).map(a=>({id:a.id,type:'arrow'}));return newElementWith(e,{boundElements:[...(e.boundElements??[]).filter(b=>b.type!=='arrow'&&ids.has(b.id)),...arrows]});})};
 }
 function applyTree(elements,map,selectionIds=selected){const tree=withTreeArrows(elements,map);apply(tree.elements,tree.map,selectionIds);}
 function rename(){if(!selectedNode)throw Error('请选中一个导图节点。');const elements=api.current.getSceneElements(),node=elements.find(e=>e.id===selectedNode),label=elements.find(e=>e.id===selectedNode&&e.type==='text'||e.containerId===selectedNode&&e.type==='text');if(!label)throw Error('双击节点添加文字后再改名。');
  const replacement=convertToExcalidrawElements([{...label,type:'text',text:nodeText,originalText:nodeText}],{regenerateIds:false})[0];
  apply(elements.map(e=>e.id===label.id?newElementWith(e,{text:nodeText,originalText:nodeText,width:replacement.width,height:replacement.height}):e),semantic.current);
 }
 function reparent(){const map=changeParent(semantic.current,selectedNode,target||null);applyTree(api.current.getSceneElements(),map);}
 function removeBranch(){if(!selectedNode)throw Error('请选中一个导图节点。');const ids=new Set(branchIds(semantic.current,selectedNode)),elements=api.current.getSceneElements().filter(e=>!ids.has(e.id)&&!ids.has(e.containerId)&&!ids.has(e.startBinding?.elementId)&&!ids.has(e.endBinding?.elementId));const map=reconcileMindmap(semantic.current,elements);applyTree(elements,map,[]);}
 function crossLink(){if(!selectedNode||!target||target===selectedNode)throw Error('请选择另一个关联节点。');const map={...semantic.current,links:[...semantic.current.links,{from:selectedNode,to:target,label:note}]},elements=api.current.getSceneElements(),a=elements.find(e=>e.id===selectedNode),b=elements.find(e=>e.id===target),arrows=convertToExcalidrawElements([{type:'arrow',x:a.x,y:a.y,points:[[0,0],[b.x-a.x,b.y-a.y]],start:{id:a.id},end:{id:b.id},strokeStyle:'dashed',label:note?{text:note}:undefined,customData:{[relationTag]:'cross'}}]);apply([...elements,...arrows],map);}
 function addNote(){if(!selectedNode||!note.trim())throw Error('选择节点并填写注释。');const e=api.current.getSceneElements().find(e=>e.id===selectedNode),extra=convertToExcalidrawElements([{type:'text',x:e.x,y:e.y+e.height+16,text:note,fontSize:16,fontFamily:5,strokeColor:'#677b8d'}]);apply([...api.current.getSceneElements(),...extra],{...semantic.current,notes:[...semantic.current.notes.filter(n=>n.elementId!==selectedNode),{elementId:selectedNode,text:note}]});}
 function undoMenu(){const previous=menuHistory.current.pop();if(!previous)return;semantic.current=previous.mindmap??emptyMindmap();registry.current=new Map(semantic.current.nodes.map(n=>[n.elementId,n]));api.current.updateScene({elements:previous.elements,captureUpdate:CaptureUpdateAction.IMMEDIATELY});publish(previous.elements,api.current.getAppState(),{});setUndoCount(menuHistory.current.length);}
 return <div className="nb-excalidraw-layer">
  {mindmap&&<div className="nb-mindmap-menu" role="toolbar" aria-label="导图节点操作">
   <input aria-label="节点文字" value={nodeText} onChange={e=>setNodeText(e.target.value)} maxLength={2000}/>
   <button onClick={()=>perform(()=>addNode('root'))}>新增根节点</button><button disabled={!selectedNode} onClick={()=>perform(()=>addNode('child'))}>新增子分支</button><button disabled={!selectedNode} onClick={()=>perform(()=>addNode('sibling'))}>新增同级</button><button disabled={!selectedNode} onClick={()=>perform(rename)}>改节点文字</button>
   <select aria-label="目标节点" value={target} onChange={e=>setTarget(e.target.value)}><option value="">根节点（无父节点）</option>{nodes.map(n=><option key={n.elementId} value={n.elementId}>{labelFor(n.elementId)}</option>)}</select>
   <button disabled={!selectedNode} onClick={()=>perform(reparent)}>换父节点</button><button disabled={!selectedNode} onClick={()=>perform(()=>applyTree(layoutBranch(api.current.getSceneElements(),semantic.current,selectedNode),semantic.current))}>整理所选分支</button><button disabled={!selectedNode} onClick={()=>perform(removeBranch)}>删除分支</button>
   <input aria-label="关联或注释文字" value={note} onChange={e=>setNote(e.target.value)} maxLength={160}/><button disabled={!selectedNode||!target} onClick={()=>perform(crossLink)}>跨支关联</button><button disabled={!selectedNode} onClick={()=>perform(addNote)}>添加注释</button><button disabled={!undoCount} onClick={undoMenu}>撤销导图操作</button>
   <select aria-label="节点资料" value={sourceChoice} onChange={e=>setSourceChoice(e.target.value)}><option value="">选择白板上的资料卡</option>{sources.map((s,i)=><option key={i} value={s.sourceRef}>{s.title}</option>)}</select><button disabled={!selectedNode||!sourceChoice} onClick={()=>perform(()=>apply(api.current.getSceneElements(),{...semantic.current,nodes:semantic.current.nodes.map(n=>n.elementId===selectedNode?{...n,sourceRef:sourceChoice}:n)}))}>关联资料</button>
   {selectedNode&&semantic.current.nodes.find(n=>n.elementId===selectedNode)?.sourceRef&&<button onClick={()=>onSource(semantic.current.nodes.find(n=>n.elementId===selectedNode).sourceRef)}>打开节点资料</button>}
  </div>}
  <div ref={canvasHost} className="nb-excalidraw-canvas" onKeyDownCapture={e=>{const state=api.current?.getAppState();if(e.key==='Escape'&&state&&!state.editingTextElement&&!state.editingLinearElement&&!state.draggingElement&&!state.resizingElement&&!state.rotatingElement&&!state.openDialog&&!state.openMenu&&!Object.values(state.selectedElementIds??{}).some(Boolean)&&state.activeTool.type==='selection'){e.preventDefault();e.stopPropagation();onExit?.();}}}>
   <Excalidraw excalidrawAPI={value=>{api.current=value;}} initialData={{elements:scene.elements,appState:{...scene.appState,currentItemFontFamily:5},files:scene.files??{}}} langCode="zh-CN" theme={theme} handleKeyboardGlobally={false} autoFocus={false} onChange={publish} onLinkOpen={(element,event)=>{event.preventDefault();if(element.link?.startsWith('vault:'))onSource(element.link);else onError('请通过白板资料卡打开链接。');}} validateEmbeddable={()=>false} UIOptions={{tools:{image:true},canvasActions:{loadScene:false,saveToActiveFile:false,export:false,saveAsImage:false,toggleTheme:false}}}>
    <MainMenu><MainMenu.DefaultItems.ClearCanvas/></MainMenu>
   </Excalidraw>
  </div>
 </div>;
}
