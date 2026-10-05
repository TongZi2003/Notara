export const EMPTY_SCENE={version:1,elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}};
// Electron preserves undefined record fields across IPC, while JSON transport
// drops them. Persist the same explicit source structure through both routes;
// editor customData is transient and mindmap semantics have their own field.
export function persistentEditorScene(scene){
 const clean=value=>{
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object'){
   const prototype=Object.getPrototypeOf(value);if(prototype!==null&&prototype!==Object.prototype)return value;
   return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).map(([key,item])=>[key,clean(item)]));
  }
  return value;
 };
 return clean({...scene,elements:scene.elements.map(({customData,...element})=>element)});
}
export function validateScene(scene) {
 if(scene?.version!==1||!Array.isArray(scene.elements))throw Error('暂不支持这个绘图版本，请保留原内容。');
 if(scene.elements.length>500)throw Error('一块绘图最多保存 500 个元素，请拆成几块。');
 const files=scene.files??{};
 for(const file of Object.values(files))if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.mimeType)||!file.dataURL?.startsWith(`data:${file.mimeType};base64,`))throw Error('这张图片的格式不能保存，请使用 PNG、JPEG、GIF 或 WebP。');
 if(new TextEncoder().encode(JSON.stringify({...scene,files:{}})).length>1024*1024)throw Error('这块绘图超过 1 MiB，请拆成几块后保存。');
 if(new TextEncoder().encode(JSON.stringify(scene)).length>1_800_000)throw Error('绘图与图片超过保存容量，请改用图片资料卡。');
 return scene;
}
export function teacherRequest(block,elementIds=[],intent='请老师完善') {
 return {text:`〔白板｜${block.title}〕${intent}`,reference:{kind:'board',blockId:block.id,elementIds:elementIds.slice(0,500),title:'白板：'+block.title,...(block.revision?{revision:block.revision}:{})}};
}
export function createBoardDraft(initial) {
 let value=structuredClone(initial),version=0,saved=0;
 return {
  get value(){return value;},get dirty(){return version!==saved;},
  edit(patch){value={...value,...patch};version++;},
  capture(){return {...structuredClone(value),editVersion:version};},
  acknowledge(flight,revision){value={...value,revision};saved=flight.editVersion;},
 };
}
// This decodes the existing vault: sourceRef solely for reader navigation.
// The Host still checks collection, path, revision and permissions on read/write.
export function sourceTarget(ref) {
 try{
  if(typeof ref!=='string'||!ref.startsWith('vault:')||ref.length>8000)throw Error();
  const encoded=ref.slice(6).replace(/-/g,'+').replace(/_/g,'/');
  const value=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))));
  if(typeof value.path!=='string'||!value.path||typeof value.workspaceId!=='string')throw Error();
  return {workspaceId:value.workspaceId,path:value.path,revision:value.revision,...(value.locator?{locator:value.locator}:{})};
 }catch{throw Error('资料引用暂不可用，请重新选择本集资料。');}
}
export function sourceRefForRead(read,workspaceId,locator) {
 const value=read.ref?sourceTarget(read.ref):{workspaceId,path:read.path,revision:read.revision};
 if(value.workspaceId!==workspaceId||typeof value.path!=='string'||!value.path||!/^([a-f0-9]{24})$/.test(value.revision??''))throw Error('这份资料未返回可用引用，请重试。');
 if(read.ref&&!locator)return read.ref;
 const encoded=new TextEncoder().encode(JSON.stringify({...value,...(locator?{locator}:{})}));
 return 'vault:'+btoa(String.fromCharCode(...encoded)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function requestId(){return globalThis.crypto.randomUUID();}
/** Keep one submitted creation through an uncertain reply, polling and reload. */
export function captureBoardCreation(form,op){
 return {...form,pendingCreate:form.pendingCreate??{op:structuredClone(op),requestId:requestId()}};
}
