import { validateBoardScene, removeSceneElements, isBoardRecord } from './board-scene.js';

const fail=()=>{throw new Error('board_mindmap_invalid');};
const object=isBoardRecord;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const exact=(v,keys)=>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))fail();};
/** Existing opaque Vault reference format, deliberately without IO. The Host
 * must separately verify the workspace and source are in the authorized set. */
export function validateBoardSourceRef(ref){
  if(typeof ref!=='string'||ref.length>8000||!/^vault:[A-Za-z0-9_-]+$/.test(ref))fail();
  let value;try{const s=ref.slice(6).replace(/-/g,'+').replace(/_/g,'/');value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0))));}catch{fail();}
  exact(value,['workspaceId','path','revision','locator']);
  if(typeof value.workspaceId!=='string'||!value.workspaceId||value.workspaceId.length>2048||typeof value.revision!=='string'||!/^[a-f0-9]{24}$/.test(value.revision)||typeof value.path!=='string'||value.path.length>2048||/[\u0000-\u001f\\:]/.test(value.path)||value.path.startsWith('/')||value.path.split('/').some(p=>!p||p.startsWith('.')))fail();
  if(value.locator!==undefined){
    const l=value.locator,keys={ 'pdf-page':['kind','page','revision'],'pdf-region':['kind','page','rect','revision','annotationId'],'video-time':['kind','startMs','endMs'],'image-region':['kind','rect'],'html-range':['kind','anchor'] };
    exact(l,l?.kind===undefined?['anchor','page']:keys[l.kind]??[]);
    if(l.kind!==undefined&&!Object.hasOwn(keys,l.kind))fail();
    if(l.anchor!==undefined&&(typeof l.anchor!=='string'||!l.anchor||l.anchor.length>500||/[\u0000-\u001f]/.test(l.anchor)))fail();
    if(l.page!==undefined&&(!Number.isInteger(l.page)||l.page<1||l.page>100000))fail();
    if(['pdf-page','pdf-region'].includes(l.kind)&&l.page===undefined)fail();
    if(l.revision!==undefined&&(typeof l.revision!=='string'||!/^[a-f0-9]{24}$/.test(l.revision)))fail();
    if(l.annotationId!==undefined&&(typeof l.annotationId!=='string'||!l.annotationId||l.annotationId.length>160||/[\u0000-\u001f]/.test(l.annotationId)))fail();
    if(['pdf-region','image-region'].includes(l.kind)){
      if(!Array.isArray(l.rect)||l.rect.length!==4||!l.rect.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)||!l.rect[2]||!l.rect[3])fail();
      if(l.kind==='pdf-region'){const [x,y,w,h]=l.rect.map(n=>Math.round(n*1e6)/1e6);if(!w||!h||x+w>1+1e-9||y+h>1+1e-9)fail();}
    }
    if(l.kind==='video-time'&&(!Number.isSafeInteger(l.startMs)||l.startMs<0||l.endMs!==undefined&&(!Number.isSafeInteger(l.endMs)||l.endMs<l.startMs)))fail();
    if(l.kind==='html-range'&&l.anchor===undefined)fail();
  }
  return ref;
}
export function validateMindmap(meta,elements){
  exact(meta,['version','nodes','links','notes']);
  if(meta.version!==undefined&&meta.version!==1||!Array.isArray(meta.nodes)||meta.nodes.length>500||!Array.isArray(meta.links??[])||(meta.links??[]).length>1000||!Array.isArray(meta.notes??[])||(meta.notes??[]).length>500||!Array.isArray(elements))fail();
  const available=new Map(Array.from(elements,e=>{if(!object(e)||!id(e.id))fail();return [e.id,e];})),byId=new Map(),owners=new Set();
  const nodes=Array.from(meta.nodes,n=>{
    exact(n,['elementId','parentId','sourceRef','parentEdgeId']);
    if(!id(n.elementId)||n.parentId!==null&&!id(n.parentId)||owners.has(n.elementId)||!available.has(n.elementId)||available.get(n.elementId).isDeleted)fail();
    if(n.parentEdgeId!==undefined&&!id(n.parentEdgeId))fail();
    const clean={elementId:n.elementId,parentId:n.parentId,...(n.sourceRef===undefined?{}:{sourceRef:validateBoardSourceRef(n.sourceRef)}),...(n.parentEdgeId===undefined?{}:{parentEdgeId:n.parentEdgeId})};byId.set(n.elementId,clean);owners.add(n.elementId);return clean;
  });
  for(const n of nodes){const seen=new Set([n.elementId]);let parent=n.parentId;while(parent!==null){if(seen.has(parent)||!byId.has(parent))fail();seen.add(parent);parent=byId.get(parent).parentId;}}
  const treeEdges=new Set();
  for(const n of nodes)if(n.parentEdgeId!==undefined){const edge=available.get(n.parentEdgeId);if(n.parentId===null||!edge||edge.isDeleted||edge.type!=='arrow'||treeEdges.has(edge.id)||edge.startBinding?.elementId!==n.parentId||edge.endBinding?.elementId!==n.elementId)fail();treeEdges.add(edge.id);}
  const seenLinks=new Set();
  const links=Array.from(meta.links??[],l=>{exact(l,['id','from','to','label']);if(l.id!==undefined&&(!id(l.id)||seenLinks.has(l.id)||available.has(l.id))||!byId.has(l.from)||!byId.has(l.to)||l.from===l.to||l.label!==undefined&&(typeof l.label!=='string'||l.label.length>500||/[\u0000-\u001f]/.test(l.label)))fail();if(l.id!==undefined)seenLinks.add(l.id);return {...(l.id===undefined?{}:{id:l.id}),from:l.from,to:l.to,...(l.label===undefined?{}:{label:l.label})};});
  const noteIds=new Set(),notes=Array.from(meta.notes??[],n=>{exact(n,['elementId','text']);if(!byId.has(n.elementId)||noteIds.has(n.elementId)||typeof n.text!=='string'||n.text.length>10000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(n.text))fail();noteIds.add(n.elementId);return {...n};});
  return {...(meta.version===undefined?{}:{version:1}),nodes,links,notes};
}
function checked(input,nodeId){const scene=validateBoardScene(input);if(!scene.mindmap||!scene.mindmap.nodes.some(n=>n.elementId===nodeId))fail();return scene;}
function descendants(meta,nodeId){const found=new Set([nodeId]);for(let grew=true;grew;){grew=false;for(const n of meta.nodes)if(found.has(n.parentId)&&!found.has(n.elementId)){found.add(n.elementId);grew=true;}}return found;}
export function reparentMindmap(input,nodeId,parentId){
  const scene=checked(input,nodeId),node=scene.mindmap.nodes.find(n=>n.elementId===nodeId),edge=node.parentEdgeId&&scene.elements.find(e=>e.id===node.parentEdgeId);node.parentId=parentId;
  if(edge){
    if(parentId===null){removeSceneElements(scene,[edge.id]);delete node.parentEdgeId;}
    else{const parent=scene.elements.find(e=>e.id===parentId);if(!parent)fail();for(const e of scene.elements)if(e.boundElements)e.boundElements=e.boundElements.filter(b=>b.id!==edge.id);parent.boundElements=[...(parent.boundElements??[]),{id:edge.id,type:'arrow'}];const child=scene.elements.find(e=>e.id===nodeId);child.boundElements=[...(child.boundElements??[]),{id:edge.id,type:'arrow'}];edge.startBinding={elementId:parentId,focus:0,gap:0};edge.x=parent.x+parent.width;edge.y=parent.y+parent.height/2;edge.points=[[0,0],[child.x-edge.x,child.y+child.height/2-edge.y]];edge.width=Math.abs(edge.points[1][0]);edge.height=Math.abs(edge.points[1][1]);}
  }
  return validateBoardScene(scene);
}
export function removeMindmapBranch(input,nodeId){
  const scene=checked(input,nodeId),branch=descendants(scene.mindmap,nodeId),owned=new Set(scene.mindmap.nodes.filter(n=>branch.has(n.elementId)).map(n=>n.elementId));
  // Incident arrows and their labels belong to the removed relationship, but
  // the far endpoint may be an unrelated surviving branch.
  for(const e of scene.elements)if(e.type==='arrow'&&(owned.has(e.startBinding?.elementId)||owned.has(e.endBinding?.elementId)))owned.add(e.id);
  for(const e of scene.elements)if(owned.has(e.containerId))owned.add(e.id);
  removeSceneElements(scene,[...owned]);return validateBoardScene(scene);
}
/** Explicit local tidy. Root stays anchored; locked nodes reserve their whole
 * subtree. Neither other branches nor tree semantics are changed by layout. */
export function layoutMindmapBranch(input,nodeId,{gapX=80,gapY=30}={}){
  const scene=checked(input,nodeId);gapX??=80;gapY??=30;
  if(!Number.isFinite(gapX)||gapX<10||gapX>2000||!Number.isFinite(gapY)||gapY<0||gapY>2000)fail();
  const byNode=new Map(scene.mindmap.nodes.map(n=>[n.elementId,n])),byElement=new Map(scene.elements.map(e=>[e.id,e]));
  const children=id=>scene.mindmap.nodes.filter(n=>n.parentId===id);
  const height=n=>{const e=byElement.get(n.elementId);if(e.locked)return e.height;const list=children(n.elementId);return Math.max(e.height,list.reduce((sum,c)=>sum+height(c),0)+Math.max(0,list.length-1)*gapY);};
  const arrange=(n,x,y,root=false)=>{
    const e=byElement.get(n.elementId);if(e.locked)return;
    if(!root){const dx=x-e.x,dy=y-e.y;e.x=x;e.y=y;for(const text of scene.elements)if(text.containerId===e.id){text.x+=dx;text.y+=dy;}}
    let top=e.y+e.height/2-height(n)/2;
    for(const child of children(n.elementId)){const h=height(child),ce=byElement.get(child.elementId);arrange(child,e.x+e.width+gapX,top+(h-ce.height)/2);top+=h+gapY;}
  };
  const root=byNode.get(nodeId),e=byElement.get(root.elementId);arrange(root,e.x,e.y,true);return validateBoardScene(scene);
}
