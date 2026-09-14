/** Runs inside an opaque iframe. It exposes no Host Remote or workspace identity. */
export function draftSDK(): string { return `
let draftRevision=null,draftQueue=Promise.resolve();const requests=new Map();let sequence=0;
function request(type,value){return new Promise((resolve,reject)=>{const requestId=String(++sequence),timer=setTimeout(()=>{requests.delete(requestId);reject(new Error('草稿保存结果未知，请保留内容并重新加载核对。'));},30000);requests.set(requestId,{resolve,reject,timer});parent.postMessage({channel,nonce,type,requestId,...value},'*');});}
window.Notara.loadDraft=()=>request('draft-read',{}).then(data=>{draftRevision=data.revision;return data.value;});
window.Notara.saveDraft=value=>{const task=draftQueue.then(async()=>{if(draftRevision===null)await window.Notara.loadDraft();const result=await request('draft-save',{value,expectedVersion:draftRevision});draftRevision=result.revision;return result.value;});draftQueue=task.catch(()=>{});return task;};
addEventListener('message',event=>{const data=event.data;if(event.source!==parent||data?.channel!==channel||data?.nonce!==nonce||data.type!=='draft-result')return;const request=requests.get(data.requestId);if(!request)return;requests.delete(data.requestId);clearTimeout(request.timer);data.ok?request.resolve(data.value):request.reject(new Error('草稿未能保存或已在别处修改。当前内容仍保留，请复制后重新加载。'));});
`; }
