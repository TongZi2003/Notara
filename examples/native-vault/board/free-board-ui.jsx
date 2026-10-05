import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {createDraftStore} from '../draft-client.js';
import {EMPTY_SCENE,validateScene,teacherRequest,createBoardDraft,requestId} from './board-editing.js';
import {FigureEditor} from './figure-editor.jsx';
import {bindWheelBoundary} from './board-navigation.js';

const DrawingEditor=lazy(()=>loadLazyModule('free-drawing-editor.mjs'));
import {loadLazyModule} from '../lazy-assets.js';
const drafts=createDraftStore('free-board-draft');
const unwrap=result=>{if(!result?.ok)throw Error(result?.error?.message??'白板操作未完成。');return result.value;};
export const isDrawing=block=>['drawing','mindmap'].includes(block.contentType);
class EditorBoundary extends React.Component {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error){console.error('Whiteboard editor failed:',error);this.props.onError('绘图工具未能打开，原内容和草稿已保留。');}
 render(){return this.state.failed?<div role="status">绘图工具未能打开。请返回白板后重试。</div>:this.props.children;}
}
export function ContributionOriginal({entry,client,boardRevision}) {
 const [rows,setRows]=useState(null),[error,setError]=useState('');
 async function read(){try{const values=await Promise.all((entry.targetIds??[]).map(blockId=>client.contentBoard({blockId}).then(unwrap)));setRows(values.flatMap(value=>value.contributions.filter(row=>row.id===entry.id).flatMap(row=>(row.original??[]).map(original=>({...original,title:value.block?.title??'白板内容'})))));setError('');}catch{setError('这次原稿暂不可用，请重试。');}}
 useEffect(()=>{setRows(null);},[boardRevision]);
 return <details className="nb-contribution-original" onToggle={e=>{if(e.currentTarget.open&&rows===null)read();}}><summary>查看修改前后</summary>{error?<button onClick={read}>{error}</button>:rows===null?'正在读取…':rows.length?rows.map((row,i)=><div key={i}><strong>{row.title} · {row.field==='title'?'标题':'正文'}</strong><div className="nb-original-pair"><div><small>原稿</small><pre>{row.before??'（空）'}</pre></div><div><small>修改后</small><pre>{row.after??'（空）'}</pre></div></div></div>):<p>这次修改涉及布局或绘图，可通过撤销回看。</p>}</details>;
}

// A small projection, with no editor dependency and no raw SVG from the scene.
export function ScenePreview({scene}) {
 const elements=(scene?.elements??[]).filter(e=>!e.isDeleted),minX=Math.min(0,...elements.map(e=>e.x)),minY=Math.min(0,...elements.map(e=>e.y));
 const width=Math.max(320,...elements.map(e=>e.x+(e.width??0)-minX+24)),height=Math.max(180,...elements.map(e=>e.y+(e.height??0)-minY+24));
 return <svg className="nb-scene-preview" viewBox={`${minX-12} ${minY-12} ${width+24} ${height+24}`} role="img" aria-label="可编辑绘图预览">
  {elements.map(e=>{const common={key:e.id,transform:`translate(${e.x} ${e.y}) rotate(${(e.angle??0)*180/Math.PI} ${e.width/2} ${e.height/2})`,stroke:e.strokeColor??'#30343b',strokeWidth:e.strokeWidth??1,fill:e.backgroundColor??'none',opacity:(e.opacity??100)/100};
   if(e.type==='text')return <text {...common} stroke="none" fill={e.strokeColor} fontSize={e.fontSize??20} fontFamily="sans-serif">{String(e.text??'').split('\n').map((line,i)=><tspan key={i} x="0" y={(i+1)*(e.fontSize??20)*1.25}>{line}</tspan>)}</text>;
   if(e.type==='ellipse')return <ellipse {...common} cx={e.width/2} cy={e.height/2} rx={e.width/2} ry={e.height/2}/>;
   if(e.type==='diamond')return <polygon {...common} points={`${e.width/2},0 ${e.width},${e.height/2} ${e.width/2},${e.height} 0,${e.height/2}`}/>;
   if(['arrow','line','freedraw'].includes(e.type))return <g {...common} fill="none"><polyline points={(e.points??[]).map(p=>p.join(',')).join(' ')}/>{e.type==='arrow'&&e.endArrowhead&&e.points?.length>1&&(()=>{const a=e.points.at(-2),b=e.points.at(-1),angle=Math.atan2(b[1]-a[1],b[0]-a[0]);return <path d={`M ${b[0]-10*Math.cos(angle-.5)} ${b[1]-10*Math.sin(angle-.5)} L ${b[0]} ${b[1]} L ${b[0]-10*Math.cos(angle+.5)} ${b[1]-10*Math.sin(angle+.5)}`}/>;})()}</g>;
   if(e.type==='rectangle'||e.type==='frame')return <rect {...common} width={e.width} height={e.height} rx="6"/>;
   if(e.type==='image'){const file=scene.files?.[e.fileId];if(file&&['image/png','image/jpeg','image/gif','image/webp'].includes(file.mimeType)&&file.dataURL?.startsWith(`data:${file.mimeType};base64,`))return <image key={e.id} transform={common.transform} href={file.dataURL} width={e.width} height={e.height} opacity={common.opacity}/>;}
   return null;
  })}
  {!elements.length&&<text x="24" y="80" fill="#7c8a96" fontSize="16">双击进入自由编辑</text>}
 </svg>;
}
export function DrawingPreview({block,client,visible}) {
 const [scene,setScene]=useState(null),[error,setError]=useState(''),[near,setNear]=useState(false),host=useRef();
 useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))setNear(true);});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!near||!visible)return;let alive=true;client.contentBoard({blockId:block.id}).then(unwrap).then(value=>{if(alive){setScene(value.content);setError('');}}).catch(()=>{if(alive)setError('绘图暂不可用，请重试打开。');});return()=>{alive=false;};},[client,block.id,block.contentRef,near,visible]);
 return <div ref={host}>{error?<p role="status">{error}</p>:<ScenePreview scene={scene}/>}</div>;
}

export function FreeBlockEditor({block,client,draftKey,visible,boardRevision,onCommit,onClose,onDiscuss,onSource,onNotice,sources,onFlush,onExport,inline=false,onExpand}) {
 const [loaded,setLoaded]=useState(false),[value,setValue]=useState(null),[status,setStatus]=useState('正在读取…'),[saving,setSaving]=useState(false),[dirty,setDirty]=useState(false),[epoch,setEpoch]=useState(0),[intent,setIntent]=useState('请老师完善');
 const draft=useRef(null),flight=useRef(null),pending=useRef(null),timer=useRef(),alive=useRef(true),selected=useRef([]),readTicket=useRef(0),callbacks=useRef({}),projectionPending=useRef(false);
 const host=useRef();
 useEffect(()=>bindWheelBoundary(host.current),[]);
 const key=`${draftKey}:${block.id}`;
 const notify=()=>{if(!alive.current)return;setValue({...draft.current.value});setDirty(draft.current.dirty);if(draft.current.dirty||projectionPending.current)drafts.set(key,{...draft.current.value,...(!draft.current.dirty&&projectionPending.current?{_saved:true}:{})});else drafts.delete(key);};
 async function load(){const ticket=++readTicket.current;try{
  const read=unwrap(await client.contentBoard({blockId:block.id}));if(!alive.current||ticket!==readTicket.current||draft.current?.dirty||pending.current)return;
  if(isDrawing(block)&&read.content)validateScene(read.content);
  const retained=drafts.get(key),restored=retained?._saved?null:retained,initial=restored??{blockId:block.id,revision:read.revision,title:read.block?.title??block.title,body:read.block?.body??block.body??'',content:isDrawing(block)?read.content??structuredClone(EMPTY_SCENE):undefined};
  projectionPending.current=false;draft.current=createBoardDraft(initial);if(restored)draft.current.edit({});notify();setLoaded(true);setEpoch(n=>n+1);setStatus(restored?'已恢复未保存的草稿':'');
 }catch(error){if(alive.current){setStatus(error.message);onNotice(error.message);}}}
 useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;readTicket.current++;clearTimeout(timer.current);};},[client,key]);
 useEffect(()=>{if(loaded&&!draft.current?.dirty&&!pending.current&&(boardRevision!==draft.current?.value.revision||projectionPending.current))load();},[boardRevision]);
 useEffect(()=>{const detail={key:'board:'+key,dirty};window.dispatchEvent(new CustomEvent('notara-editor-dirty',{detail}));return()=>window.dispatchEvent(new CustomEvent('notara-editor-dirty',{detail:{...detail,dirty:false}}));},[dirty,key]);
 function edit(patch){draft.current.edit(patch);flight.current=null;notify();setStatus('未保存');clearTimeout(timer.current);timer.current=setTimeout(()=>flush(),1000);}
 async function flush(){clearTimeout(timer.current);if(pending.current)await pending.current;if(!draft.current)return false;if(!draft.current.dirty)return true;
  const snapshot=flight.current??{...draft.current.capture(),requestId:requestId()};flight.current=snapshot;setSaving(true);
  const task=(async()=>{try{
   if(isDrawing(block))validateScene(snapshot.content);
   const patch={title:snapshot.title,body:snapshot.body,...(isDrawing(block)?{content:snapshot.content}:{})};
   const result=await onCommit([{type:'patch',blockId:block.id,patch}],snapshot.revision,snapshot.requestId);
   draft.current.acknowledge(snapshot,result.revision);projectionPending.current=!!result.projectionPending;flight.current=null;notify();setStatus(draft.current.dirty?'未保存':projectionPending.current?'已保存，视图待同步':'已保存');return true;
  }catch(error){if(alive.current){setStatus('保存失败，草稿已保留');onNotice(error.message);}return false;}finally{pending.current=null;if(alive.current)setSaving(false);}})();
  pending.current=task;return task;
 }
 async function flushAll(){if(!await flush())return false;if(draft.current?.dirty){if(!await flush()||draft.current.dirty){onNotice('仍有新修改未保存，请先保存。');return false;}}return true;}
 async function finish(action){if(await flushAll())action();}
 callbacks.current={flush,finish};
 useEffect(()=>{onFlush(()=>flushAll());return()=>onFlush(null);},[onFlush]);
 useEffect(()=>{if(!visible&&loaded)callbacks.current.flush();},[visible]);
 const close=()=>finish(onClose);
 // Escape returns to the outer board; text entry and drawing retain their own keys.
 return <div ref={host} data-board-editing="true" className={'nb-free-editor'+(inline?' nb-inline-editor':'')} role={inline?'region':'dialog'} aria-modal={inline?undefined:'true'} aria-label={`编辑 ${block.title}`} style={inline?{height:block.height??420}:undefined} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'&&!e.defaultPrevented&&!e.target.closest('.excalidraw')){e.preventDefault();close();}}}>
  <header><strong>{isDrawing(block)?block.contentType==='mindmap'?'导图内编辑':'绘图内编辑':block.contentType==='figure'?'函数图':'编辑白板内容'}</strong><span role="status">{status}</span><button disabled={saving||!loaded} onClick={()=>flush()}>保存</button>{inline?<button disabled={saving} onClick={()=>finish(onExpand)}>放大编辑</button>:<button disabled={saving||!loaded} onClick={onExport}>导出</button>}<button disabled={saving} onClick={close}>{inline?'收起编辑':'返回白板'}</button></header>
  {!loaded?<div className="nb-editor-loading"><p>{status}</p><button onClick={load}>重试读取</button><button onClick={onClose}>关闭</button></div>:<>
   <label className="nb-edit-title">标题<input aria-label="块标题" maxLength={160} value={value.title} onChange={e=>edit({title:e.target.value})}/></label>
   {isDrawing(block)?<div className="nb-drawing-host">{visible&&<EditorBoundary key={epoch} onError={onNotice}><Suspense fallback={<p>正在打开绘图工具…</p>}><DrawingEditor scene={value.content} mindmap={block.contentType==='mindmap'} onChange={content=>edit({content})} onSelect={ids=>{selected.current=ids;}} onSource={onSource} onError={onNotice} sources={sources} onExit={close}/></Suspense></EditorBoundary>}</div>:block.contentType==='figure'?<FigureEditor body={value.body} onChange={body=>edit({body})} onError={onNotice} onDiscuss={text=>finish(()=>onDiscuss(teacherRequest({...block,title:draft.current.value.title,revision:draft.current.value.revision},[],text)))}/>:<label className="nb-edit-body">正文<textarea aria-label="块正文" maxLength={50000} value={value.body} onChange={e=>edit({body:e.target.value})} placeholder="写下你的文字、公式或解题过程"/></label>}
   {isDrawing(block)&&<label className="nb-edit-caption">补充说明<textarea aria-label="绘图说明" maxLength={50000} value={value.body} onChange={e=>edit({body:e.target.value})}/></label>}
   <footer><select aria-label="完善要求" value={intent} onChange={e=>setIntent(e.target.value)}>{['请老师完善','请老师检查','请老师整理','请老师解释','给这个分支补两个反例'].map(s=><option key={s}>{s}</option>)}</select><button disabled={saving} onClick={()=>finish(()=>onDiscuss(teacherRequest({...block,title:draft.current.value.title,revision:draft.current.value.revision},selected.current,intent)))}>请老师完善</button><small>先保存，再带入本课堂输入</small></footer>
  </>}
 </div>;
}
