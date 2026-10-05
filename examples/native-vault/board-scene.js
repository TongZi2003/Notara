import { validateMindmap, reparentMindmap, removeMindmapBranch, layoutMindmapBranch } from './board-mindmap.js';

export const BOARD_SCENE_LIMITS=Object.freeze({elements:500,jsonBytes:1024*1024,imageBytes:2*1024*1024,totalImageBytes:8*1024*1024});
const fail=(code='invalid')=>{throw new Error('board_scene_'+code);};
// Electron utilityProcess can deliver records from another V8 realm. Native
// Object.prototype identity is realm-local; the terminal prototype/constructor
// shape identifies a plain record without admitting Date, Map or class values.
export function isBoardRecord(value) {
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);if(proto===null)return true;
  const constructor=Object.getOwnPropertyDescriptor(proto,'constructor')?.value;
  return Object.getPrototypeOf(proto)===null&&typeof constructor==='function'&&constructor.name==='Object'&&constructor.prototype===proto;
}
const object=isBoardRecord;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v);
const number=(v,min=-50000,max=50000)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const string=(v,max=50000)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const color=v=>typeof v==='string'&&(/^(?:transparent|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey)$/i.test(v)||/^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(v)||/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/.test(v));
const bytes=v=>new TextEncoder().encode(v).length;
const exact=(v,keys)=>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))fail();};

export function validateBoardUrl(value) {
  if(typeof value!=='string'||value.length>2048||!/^https?:\/\//i.test(value)||/[\s\u0000-\u001f\\]/.test(value))fail('url_invalid');
  let url;try{url=new URL(value);}catch{fail('url_invalid');}
  if(!['https:','http:'].includes(url.protocol)||!url.hostname||url.username||url.password)fail('url_invalid');
  return value;
}
function jsonData(value,depth=0) {
  if(depth>20)fail();
  if(value===null||typeof value==='boolean'||typeof value==='string')return;
  if(typeof value==='number'){if(!Number.isFinite(value))fail();return;}
  if(Array.isArray(value)){for(const item of value)jsonData(item,depth+1);return;}
  if(!object(value))fail();
  for(const [key,item] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))fail();jsonData(item,depth+1);}
}
const COMMON=['id','type','x','y','width','height','angle','strokeColor','backgroundColor','fillStyle','strokeWidth','strokeStyle','roughness','opacity','groupIds','frameId','roundness','seed','version','versionNonce','isDeleted','boundElements','updated','link','locked','index','customData'];
const TEXT=['fontSize','fontFamily','text','originalText','textAlign','verticalAlign','containerId','autoResize','lineHeight'];
const LINE=['points','lastCommittedPoint','startBinding','endBinding','startArrowhead','endArrowhead','elbowed','fixedSegments','startIsSpecial','endIsSpecial'];
const FREE=['points','pressures','simulatePressure','lastCommittedPoint'];
const IMAGE=['fileId','status','scale','crop'];
const TYPES=['rectangle','diamond','ellipse','text','line','arrow','freedraw','image'];
const HEADS=['arrow','bar','dot','circle','circle_outline','triangle','triangle_outline','diamond','diamond_outline','crowfoot_one','crowfoot_many','crowfoot_one_or_many'];
function point(v){if(!Array.isArray(v)||v.length!==2||!v.every(n=>number(n)))fail();return [...v];}
function binding(v){
  if(v===null)return null;
  exact(v,['elementId','focus','gap','fixedPoint']);
  if(!id(v.elementId)||!number(v.focus,-1,1)||!number(v.gap,0))fail('binding_invalid');
  return {elementId:v.elementId,focus:v.focus,gap:v.gap,...(v.fixedPoint===undefined?{}:{fixedPoint:point(v.fixedPoint)})};
}
function cleanElement(input){
  if(!object(input))fail();
  const type={rect:'rectangle',freehand:'freedraw'}[input.type]??input.type;
  if(!TYPES.includes(type)||!id(input.id))fail();
  const fields=[...COMMON,...(type==='text'?TEXT:[]),...(['line','arrow'].includes(type)?LINE:[]),...(type==='freedraw'?FREE:[]),...(type==='image'?IMAGE:[])];
  exact(input,fields);
  const out={};
  for(const key of Object.keys(input))if(key!=='customData')out[key]=input[key];
  out.type=type;
  for(const key of ['x','y'])if(!number(out[key]))fail();
  for(const key of ['width','height'])if(!number(out[key],0))fail();
  for(const [key,min,max] of [['angle',-Math.PI*100,Math.PI*100],['strokeWidth',0,100],['roughness',0,10],['opacity',0,100],['fontSize',1,500],['fontFamily',1,100],['lineHeight',.1,10],['seed',0,Number.MAX_SAFE_INTEGER],['version',0,Number.MAX_SAFE_INTEGER],['versionNonce',0,Number.MAX_SAFE_INTEGER],['updated',0,Number.MAX_SAFE_INTEGER]])if(out[key]!==undefined&&!number(out[key],min,max))fail();
  for(const key of ['seed','version','versionNonce','fontFamily'])if(out[key]!==undefined&&!Number.isSafeInteger(out[key]))fail();
  for(const key of ['strokeColor','backgroundColor'])if(out[key]!==undefined&&!color(out[key]))fail();
  for(const [key,values] of [['fillStyle',['hachure','cross-hatch','solid','zigzag']],['strokeStyle',['solid','dashed','dotted']],['textAlign',['left','center','right']],['verticalAlign',['top','middle','bottom']],['status',['pending','saved','error']]])if(out[key]!==undefined&&!values.includes(out[key]))fail();
  for(const key of ['locked','isDeleted','autoResize','simulatePressure','elbowed'])if(out[key]!==undefined&&typeof out[key]!=='boolean')fail();
  for(const key of ['startIsSpecial','endIsSpecial'])if(out[key]!==undefined&&out[key]!==null&&typeof out[key]!=='boolean')fail();
  if(out.index!==undefined&&out.index!==null&&(typeof out.index!=='string'||!/^[A-Za-z0-9]{1,80}$/.test(out.index)))fail();
  for(const key of ['text','originalText'])if(out[key]!==undefined&&!string(out[key]))fail();
  if(type==='text'&&typeof out.text!=='string')fail();
  if(out.link!==undefined&&out.link!==null)out.link=validateBoardUrl(out.link);
  if(out.frameId!==undefined&&out.frameId!==null)fail('binding_invalid');
  if(out.groupIds!==undefined){if(!Array.isArray(out.groupIds)||out.groupIds.length>50||!out.groupIds.every(id)||new Set(out.groupIds).size!==out.groupIds.length)fail();out.groupIds=[...out.groupIds];}
  if(out.containerId!==undefined&&out.containerId!==null&&!id(out.containerId))fail('binding_invalid');
  if(out.roundness!==undefined&&out.roundness!==null){exact(out.roundness,['type','value']);if(![1,2,3].includes(out.roundness.type)||out.roundness.value!==undefined&&!number(out.roundness.value,0))fail();out.roundness={...out.roundness};}
  if(out.boundElements!==undefined&&out.boundElements!==null){if(!Array.isArray(out.boundElements)||out.boundElements.length>500)fail();const seen=new Set();out.boundElements=out.boundElements.map(b=>{exact(b,['id','type']);if(!id(b.id)||!['arrow','text'].includes(b.type)||seen.has(b.id))fail('binding_invalid');seen.add(b.id);return {...b};});}
  if(['line','arrow','freedraw'].includes(type)){if(!Array.isArray(out.points)||!out.points.length||out.points.length>20000)fail();out.points=out.points.map(point);}
  if(out.lastCommittedPoint!==undefined&&out.lastCommittedPoint!==null)out.lastCommittedPoint=point(out.lastCommittedPoint);
  for(const key of ['startBinding','endBinding'])if(out[key]!==undefined)out[key]=binding(out[key]);
  for(const key of ['startArrowhead','endArrowhead'])if(out[key]!==undefined&&out[key]!==null&&!HEADS.includes(out[key]))fail();
  if(out.pressures!==undefined){if(!Array.isArray(out.pressures)||out.pressures.length!==out.points.length&&!(out.simulatePressure===true&&out.pressures.length===0)||!out.pressures.every(n=>number(n,0,1)))fail();out.pressures=[...out.pressures];}
  if(out.fixedSegments!==undefined&&out.fixedSegments!==null){if(!Array.isArray(out.fixedSegments)||out.fixedSegments.length>1000)fail();out.fixedSegments=out.fixedSegments.map(s=>{exact(s,['index','start','end']);if(!Number.isInteger(s.index)||s.index<0||s.index>=out.points.length)fail();return {index:s.index,start:point(s.start),end:point(s.end)};});}
  if(type==='image'&&!id(out.fileId))fail('asset_invalid');
  if(out.scale!==undefined){if(!Array.isArray(out.scale)||out.scale.length!==2||!out.scale.every(n=>n===1||n===-1))fail();out.scale=[...out.scale];}
  if(out.crop!==undefined&&out.crop!==null){exact(out.crop,['x','y','width','height','naturalWidth','naturalHeight']);for(const key of Object.keys(out.crop))if(!number(out.crop[key],0,100000))fail();if(!['x','y','width','height','naturalWidth','naturalHeight'].every(k=>out.crop[k]!==undefined)||!out.crop.width||!out.crop.height||!out.crop.naturalWidth||!out.crop.naturalHeight||out.crop.x+out.crop.width>out.crop.naturalWidth||out.crop.y+out.crop.height>out.crop.naturalHeight)fail();out.crop={...out.crop};}
  return out;
}
function cleanFiles(input){
  if(!object(input)||Object.keys(input).length>500)fail('asset_invalid');
  const files={};let total=0;
  for(const [key,file] of Object.entries(input)){
    exact(file,['id','dataURL','mimeType','created','lastRetrieved','version']);
    if(!id(key)||file.id!==key||!['image/png','image/jpeg','image/gif','image/webp'].includes(file.mimeType)||typeof file.dataURL!=='string')fail('asset_invalid');
    const prefix=`data:${file.mimeType};base64,`,encoded=file.dataURL.slice(prefix.length);
    if(!file.dataURL.startsWith(prefix)||!encoded.length||encoded.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail('asset_invalid');
    const length=encoded.length/4*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
    total+=length;if(length>BOARD_SCENE_LIMITS.imageBytes||total>BOARD_SCENE_LIMITS.totalImageBytes)fail('asset_too_large');
    const head=atob(encoded.slice(0,Math.min(encoded.length,32)));
    const matches=file.mimeType==='image/png'?head.startsWith('\x89PNG\r\n\x1a\n'):file.mimeType==='image/jpeg'?head.startsWith('\xff\xd8\xff'):file.mimeType==='image/gif'?/^GIF8[79]a/.test(head):head.startsWith('RIFF')&&head.slice(8,12)==='WEBP';
    if(!matches||['created','lastRetrieved','version'].some(k=>file[k]!==undefined&&!number(file[k],0,Number.MAX_SAFE_INTEGER)))fail('asset_invalid');
    files[key]={id:key,dataURL:file.dataURL,mimeType:file.mimeType,...(file.created===undefined?{}:{created:file.created})};
  }
  return files;
}

/** Hydrated source only. Host storage extracts raster files before persisting
 * the JSON; no path, actor, permission or editor customData is authoritative. */
export function validateBoardScene(input){
  exact(input,['version','elements','appState','files','mindmap']);
  if(input.version!==1)fail('version_unsupported');
  if(!Array.isArray(input.elements)||input.elements.length>BOARD_SCENE_LIMITS.elements)fail('too_large');
  // Validate raw JSON too: stripping fields must not hide an oversized payload.
  const raw={...input,files:{}};jsonData(raw);
  if(bytes(JSON.stringify(raw))>BOARD_SCENE_LIMITS.jsonBytes)fail('too_large');
  const elements=input.elements.map(cleanElement),byId=new Map();
  for(const e of elements){if(byId.has(e.id))fail('id_invalid');byId.set(e.id,e);}
  for(const e of elements){
    const target=ref=>{const other=byId.get(ref);if(!other||other.id===e.id||other.isDeleted)fail('binding_invalid');return other;};
    if(e.containerId&& !['rectangle','ellipse','diamond','arrow'].includes(target(e.containerId).type))fail('binding_invalid');
    for(const b of e.boundElements??[])if(target(b.id).type!==b.type)fail('binding_invalid');
    for(const key of ['startBinding','endBinding'])if(e[key]&&!['rectangle','ellipse','diamond','text','image'].includes(target(e[key].elementId).type))fail('binding_invalid');
  }
  if(!object(input.appState??{}))fail();
  const appState={};if(input.appState?.viewBackgroundColor!==undefined){if(!color(input.appState.viewBackgroundColor))fail();appState.viewBackgroundColor=input.appState.viewBackgroundColor;}
  const files=cleanFiles(input.files??{});
  for(const e of elements)if(e.type==='image'&&!Object.hasOwn(files,e.fileId))fail('asset_missing');
  const mindmap=input.mindmap===undefined?undefined:validateMindmap(input.mindmap,elements);
  const scene={version:1,elements,appState,files,...(mindmap?{mindmap}:{})};
  const metadata=Object.fromEntries(Object.entries(files).map(([key,{dataURL,...f}])=>[key,f]));
  if(bytes(JSON.stringify({...scene,files:metadata}))>BOARD_SCENE_LIMITS.jsonBytes)fail('too_large');
  return scene;
}

/** Shared removal also cleans bindings for mindmap branch deletion. */
export function removeSceneElements(scene,ids){
  const removed=new Set(ids);
  scene.elements=scene.elements.filter(e=>!removed.has(e.id)).map(e=>{
    const out={...e};
    if(out.boundElements)out.boundElements=out.boundElements.filter(b=>!removed.has(b.id));
    if(removed.has(out.containerId))out.containerId=null;
    for(const key of ['startBinding','endBinding'])if(removed.has(out[key]?.elementId))out[key]=null;
    return out;
  });
  if(scene.mindmap){const nodes=scene.mindmap.nodes.filter(n=>!removed.has(n.elementId)),retained=new Set(nodes.map(n=>n.elementId));scene.mindmap={...scene.mindmap,nodes,links:scene.mindmap.links.filter(l=>retained.has(l.from)&&retained.has(l.to)),notes:scene.mindmap.notes.filter(n=>retained.has(n.elementId))};}
  return scene;
}
export function applySceneOperations(input,ops,{newId}={}){
  let scene=validateBoardScene(input);
  if(!Array.isArray(ops)||ops.length>500)fail('operation_invalid');
  const created={},used=new Set([...scene.elements.map(e=>e.id),...(scene.mindmap?.links??[]).map(l=>l.id).filter(Boolean)]),changed=new Set();
  for(const op of ops){
    if(!['addElement','addNode','addLink'].includes(op?.type))continue;
    exact(op,op.type==='addNode'?['type','ref','element','parentId']:op.type==='addLink'?['type','ref','from','to','label']:['type','ref','element']);if(!id(op.ref)||Object.hasOwn(created,op.ref)||used.has(op.ref)||op.type!=='addLink'&&(!object(op.element)||op.element.id!==undefined)||typeof newId!=='function')fail('operation_invalid');
    const assigned=newId();if(!id(assigned)||used.has(assigned)||ops.some(o=>['addElement','addNode','addLink'].includes(o?.type)&&o.ref===assigned))fail('id_invalid');used.add(assigned);created[op.ref]=assigned;
  }
  const resolve=ref=>Object.hasOwn(created,ref)?created[ref]:ref;
  const remap=element=>{const e={...element};if(e.containerId)e.containerId=resolve(e.containerId);if(e.boundElements)e.boundElements=e.boundElements.map(b=>({...b,id:resolve(b.id)}));for(const key of ['startBinding','endBinding'])if(e[key])e[key]={...e[key],elementId:resolve(e[key].elementId)};return e;};
  for(const op of ops){
    if(!object(op))fail('operation_invalid');
    const before=new Map(scene.elements.map(e=>[e.id,JSON.stringify(e)]));
    if(['addElement','addNode'].includes(op.type)){
      const elementId=created[op.ref];scene.elements.push(remap({...op.element,id:elementId}));
      if(op.type==='addNode'){if(op.parentId!==null&&!id(op.parentId))fail('operation_invalid');scene.mindmap??={nodes:[],links:[],notes:[]};scene.mindmap.nodes.push({elementId,parentId:op.parentId===null?null:resolve(op.parentId)});}
    }
    else if(op.type==='updateElement'){
      exact(op,['type','elementId','patch']);const e=scene.elements.find(e=>e.id===resolve(op.elementId));
      if(!e||!object(op.patch)||['id','type','isDeleted','fileId','customData'].some(k=>Object.hasOwn(op.patch,k)))fail('operation_invalid');Object.assign(e,remap(op.patch));
    }else if(op.type==='removeElement'){
      exact(op,['type','elementId']);const target=resolve(op.elementId);if(!scene.elements.some(e=>e.id===target))fail('operation_invalid');
      if(scene.mindmap?.nodes.some(n=>n.elementId===target))fail('mindmap_branch_required');removeSceneElements(scene,[target]);
    }else if(op.type==='reparentNode'){exact(op,['type','nodeId','parentId']);scene=reparentMindmap(scene,resolve(op.nodeId),op.parentId===null?null:resolve(op.parentId));}
    else if(op.type==='removeBranch'){exact(op,['type','nodeId']);scene=removeMindmapBranch(scene,resolve(op.nodeId));}
    else if(op.type==='layoutBranch'){exact(op,['type','nodeId','gapX','gapY']);scene=layoutMindmapBranch(scene,resolve(op.nodeId),{gapX:op.gapX,gapY:op.gapY});}
    else if(op.type==='addLink'){
      if(!scene.mindmap)fail('operation_invalid');scene.mindmap.links.push({id:created[op.ref],from:resolve(op.from),to:resolve(op.to),...(op.label===undefined?{}:{label:op.label})});changed.add(resolve(op.from));changed.add(resolve(op.to));
    }else if(op.type==='removeLink'){
      exact(op,['type','linkId','from','to']);
      const links=scene.mindmap?.links.filter(l=>op.linkId!==undefined?l.id===resolve(op.linkId):l.from===resolve(op.from)&&l.to===resolve(op.to))??[];
      if(op.linkId!==undefined&&(op.from!==undefined||op.to!==undefined)||links.length!==1)fail('operation_invalid');const link=links[0];scene.mindmap.links=scene.mindmap.links.filter(l=>l!==link);changed.add(link.from);changed.add(link.to);
    }else if(op.type==='setNote'){
      exact(op,['type','elementId','text']);const elementId=resolve(op.elementId);
      if(!scene.mindmap?.nodes.some(n=>n.elementId===elementId)||typeof op.text!=='string')fail('operation_invalid');scene.mindmap.notes=scene.mindmap.notes.filter(n=>n.elementId!==elementId);if(op.text)scene.mindmap.notes.push({elementId,text:op.text});changed.add(elementId);
    }
    else fail('operation_invalid');
    for(const [elementId,old] of before)if(JSON.stringify(scene.elements.find(e=>e.id===elementId))!==old)changed.add(elementId);
    for(const e of scene.elements)if(!before.has(e.id))changed.add(e.id);
    if(op.type==='reparentNode'){changed.add(resolve(op.nodeId));}
  }
  return {scene:validateBoardScene(scene),created,changedIds:[...changed]};
}
