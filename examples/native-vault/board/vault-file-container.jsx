import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CodeMirrorMarkdown,CodeEditor,renderPdfPreview} from './native-readers.jsx';

import {createDraftStore} from '../draft-client.js';
import {createBoardDraft,sourceTarget} from './board-editing.js';
import {parseMediaTarget} from '../media.js';
import {bindWheelBoundary} from './board-navigation.js';

const drafts=createDraftStore('board-file-draft');
const unwrap=result=>{if(!result?.ok)throw Error(result?.error?.message??'原文件暂不可用。');return result.value;};
function PdfPreview({asset,locator}){const canvas=useRef(),[error,setError]=useState('');useEffect(()=>{const controller=new AbortController();setError('');renderPdfPreview(asset,locator,canvas.current,controller.signal).catch(()=>{if(!controller.signal.aborted)setError('PDF 原文暂时无法预览，可以在 Vault 中打开。');});return()=>controller.abort();},[asset.path,asset.revision,JSON.stringify(locator)]);return <>{error&&<p role="status">{error}</p>}<canvas ref={canvas} aria-label="PDF 原文预览"/></>;}

// The reference identifies a real Vault file. Its revision and dirty state are
// independent of board layout; a file save never rewrites the board document.
export function VaultFileContainer({block,client,draftKey,active,visible,onClose,onExpand,onDiscuss,onNotice,onFlush,onOpenFile,workspaceId}){
 const target=useMemo(()=>{try{return sourceTarget(block.sourceRef);}catch{return null;}},[block.sourceRef]),key=draftKey+':file:'+target?.path;
 const [value,setValue]=useState(null),[error,setError]=useState(''),[status,setStatus]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[near,setNear]=useState(false),[embeddedAssets,setEmbeddedAssets]=useState({});
 const host=useRef(),buffer=useRef(),pending=useRef(),alive=useRef(true),codeFlush=useRef(),latest=useRef(),boundKey=useRef(key),readSequence=useRef(0);latest.current={active,onNotice};
 useEffect(()=>{if(active)return bindWheelBoundary(host.current);},[active]);
 useEffect(()=>{const observer=new IntersectionObserver(entries=>setNear(entries.some(e=>e.isIntersecting)));if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
 const notify=()=>{if(!buffer.current)return;setDirty(buffer.current.dirty);setValue(previous=>previous?{...previous,content:buffer.current.value.body,revision:buffer.current.value.revision}:previous);if(buffer.current.dirty)drafts.set(key,buffer.current.value);else drafts.delete(key);};
 async function load(){const sequence=++readSequence.current;if(!target||target.workspaceId!==workspaceId||['missing','unavailable'].includes(block.sourceState)){setError('原文件已移动或不在当前学习集，引用仍保留。');return;}try{
  let next;try{next=unwrap(await client.read({path:target.path}));}catch{next=unwrap(await client.readAsset({path:target.path}));}
  if(!alive.current||sequence!==readSequence.current||boundKey.current!==key)return;if(buffer.current?.dirty){setStatus('原文件可能已更新，当前草稿仍保留。');return;}
  if(typeof next.content==='string'){const retained=active?drafts.get(key):null;buffer.current=createBoardDraft(retained??{revision:next.revision,body:next.content});if(retained)buffer.current.edit({});next={...next,content:buffer.current.value.body};setDirty(buffer.current.dirty);}
  setValue(next);setError('');setStatus(next.revision!==target.revision?'原文件已更新，显示当前版本。':'');
 }catch(e){if(alive.current&&sequence===readSequence.current&&boundKey.current===key)setError(e.message);}}
 useEffect(()=>{alive.current=true;if(boundKey.current!==key){readSequence.current++;buffer.current=null;codeFlush.current=null;setValue(null);setEmbeddedAssets({});setDirty(false);boundKey.current=key;}if((near||active)&&visible)load();return()=>{alive.current=false;readSequence.current++;};},[key,near,active,visible,block.sourceState]);
 useEffect(()=>{const detail={key:'board-file:'+draftKey+':'+block.id,dirty};window.dispatchEvent(new CustomEvent('notara-editor-dirty',{detail}));return()=>window.dispatchEvent(new CustomEvent('notara-editor-dirty',{detail:{...detail,dirty:false}}));},[draftKey,block.id,dirty]);
 const embeddedPaths=JSON.stringify([...new Set([...(value?.content??'').matchAll(/!\[\[([^\]]+)\]\]/g)].map(match=>parseMediaTarget(match[1]).path))].slice(0,20));
 useEffect(()=>{let live=true;for(const path of JSON.parse(embeddedPaths))if(path&&!path.toLowerCase().endsWith('.md')&&!embeddedAssets[path])client.readAsset({path}).then(unwrap).then(asset=>{if(live&&boundKey.current===key)setEmbeddedAssets(previous=>({...previous,[path]:asset}));}).catch(()=>{});return()=>{live=false;};},[key,embeddedPaths,client]);
 async function flush(){
  if(codeFlush.current)return codeFlush.current();if(pending.current)await pending.current;if(!buffer.current?.dirty)return true;
  const writingBuffer=buffer.current,snapshot=writingBuffer.capture();setBusy(true);
  const task=(async()=>{try{const saved=unwrap(await client.save({path:target.path,content:snapshot.body,expectedRevision:snapshot.revision}));writingBuffer.acknowledge(snapshot,saved.revision);if(writingBuffer.dirty)drafts.set(key,writingBuffer.value);else drafts.delete(key);if(alive.current&&boundKey.current===key&&buffer.current===writingBuffer){notify();setStatus(writingBuffer.dirty?'有新修改未保存':'原文件已保存');}return !writingBuffer.dirty;}catch(e){if(alive.current&&boundKey.current===key){setStatus('原文件未保存，草稿仍保留。');latest.current.onNotice?.(e.message);}return false;}finally{pending.current=null;if(alive.current&&boundKey.current===key)setBusy(false);}})();pending.current=task;return task;
 }
 const callback=useRef();callback.current=flush;
 useEffect(()=>{if(active)onFlush?.(()=>callback.current());return()=>{if(active)onFlush?.(null);};},[active,onFlush]);
 async function expand(){if(await flush())onExpand?.(block.sourceRef);}
 async function discuss(){if(await flush())onDiscuss?.();}
 function discard(){if(!buffer.current)return;drafts.delete(key);buffer.current=null;setDirty(false);void load();}
 const markdown=value&&typeof value.content==='string';
 return <section ref={host} data-board-editing={active?'true':undefined} className="nb-file-container nb-container-surface" aria-label={'文件容器 '+block.title} style={{height:block.height??360}} onPointerDown={e=>{if(active)e.stopPropagation();}} onKeyDown={e=>{if(!active)return;e.stopPropagation();if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();void flush().then(saved=>{if(saved)onClose?.();});}}}>
  <div className="nb-container-tools"><button onClick={expand}>在 Vault 中打开</button>{active&&markdown&&<><button disabled={!dirty||busy} onClick={()=>flush()}>保存原文件</button><button disabled={!dirty||busy} onClick={discard}>放弃修改</button></>}{active&&<button onClick={discuss}>请老师完善原文件</button>}</div>
  {status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}<button onClick={load}>重试读取</button></p>}{!near&&!active?<p>原文件预览</p>:!value?(!error&&<p role="status">正在读取原文件…</p>):<div className="nb-file-body">
   {markdown?<CodeMirrorMarkdown key={target.path+':'+active} content={value.content} assets={embeddedAssets} readOnly={!active} onChange={body=>{if(!active||body===buffer.current.value.body)return;buffer.current.edit({body});notify();setStatus('原文件有未保存修改');}} onOpenPage={async path=>{if(await flush())onOpenFile?.(path);}} anchor={target.locator?.anchor}/>
   :value.assetKind==='code'&&active?<CodeEditor vault={client} asset={value} draftKey={key} onDirty={dirty=>{if(boundKey.current===key)setDirty(dirty);}} onSaved={saved=>{if(alive.current&&boundKey.current===key&&saved.path===value.path){setValue(previous=>({...previous,...saved}));setStatus('原文件已保存');}}} onFlush={fn=>{if(boundKey.current===key)codeFlush.current=fn;}}/>
   :value.assetKind==='code'?<pre>{(()=>{try{return new TextDecoder().decode(Uint8Array.from(atob(value.dataUrl.split(',')[1]),c=>c.charCodeAt(0)));}catch{return '此文件暂不可预览。';}})()}</pre>
   :value.assetKind==='pdf'?<PdfPreview asset={value} locator={target.locator}/>
   :value.assetKind==='image'?<img src={value.dataUrl} alt={value.title??block.title}/>
   :value.assetKind==='audio'?<audio src={value.dataUrl} controls/>
   :value.assetKind==='video'?<video src={value.dataUrl} controls/>
   :value.assetKind==='html'?<iframe src={value.dataUrl} sandbox="" title={value.title??block.title}/>
   :<a href={value.dataUrl} download={value.title}>下载原文件</a>}
  </div>}
 </section>;
}
