import katex from 'katex';
import type {PluginDocument,PluginLink,SeminarView,SeminarRole} from '../../packages/contracts/src/plugin-learning.ts';
declare global {interface Window {Notara:{loadDraft():Promise<any>;saveDraft(value:unknown):Promise<unknown>;saveNote(note:{title:string;body:string}):void;onSaved(fn:(note:{title:string})=>void):void;loadDocument():Promise<{revision:number;document:PluginDocument}>;saveDocument(revision:number,document:PluginDocument):Promise<{revision:number;document:PluginDocument}>;pickSource():Promise<PluginLink>;openSource(link:PluginLink):Promise<unknown>;compose(text:string):Promise<unknown>;worldbook(query:string):Promise<{text:string}>;seminars():Promise<SeminarView[]>;startSeminar(input:{topic:string;materials:string;standard:string;roles:SeminarRole[]}):Promise<SeminarView[]>;followSeminar(ref:string,role:SeminarRole,text:string):Promise<unknown>;stopSeminar(ref:string):Promise<unknown>}}}
export const N=window.Notara;
export const $=<T extends HTMLElement=HTMLElement>(id:string):T=>document.getElementById(id) as T;
export const value=(id:string):string=>$<HTMLInputElement>(id).value;
export function shell(title:string,subtitle:string,body:string):void {const main=document.createElement('main');main.innerHTML=`<header><h1>${title}</h1><p>${subtitle}</p></header>${body}<footer><p id="status" role="status"></p></footer>`;document.body.append(main);N.onSaved(({title})=>status('已保存：'+title));window.addEventListener('unhandledrejection',()=>status('工作台暂时无法加载，请检查插件状态后重新打开。'));}
export function status(text:string):void{$('status').textContent=text;}
export function click(id:string,fn:()=>void|Promise<void>):void{$(id).addEventListener('click',()=>{void Promise.resolve().then(fn).catch(e=>status(e instanceof Error?e.message:'操作未完成'));});}
export function math(target:HTMLElement,text:string):void {target.replaceChildren();for(const line of text.split(/\n\n/)){const p=document.createElement('p');for(const part of line.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g)){if(part.startsWith('$')&&part.endsWith('$')){const node=document.createElement('span'),display=part.startsWith('$$');try{katex.render(part.slice(display?2:1,display?-2:-1),node,{displayMode:display,throwOnError:false,trust:false,strict:'warn'});}catch{node.textContent=part;}p.append(node);}else p.append(document.createTextNode(part));}target.append(p);}}
export function sourceButtons(target:HTMLElement,links:PluginLink[],changed?:()=>void):void{for(const link of links){const b=document.createElement('button');b.className='source';b.textContent='↗ '+link.title;b.onclick=()=>{void N.openSource(link).catch(e=>status(e.message));};target.append(b);if(changed){const remove=textButton('×',()=>{links.splice(links.indexOf(link),1);changed();});remove.setAttribute('aria-label','移除来源：'+link.title);target.append(remove);}}}
export function textButton(title:string,fn:()=>void):HTMLButtonElement{const b=document.createElement('button');b.textContent=title;b.onclick=fn;return b;}
export async function workingDocument<K extends PluginDocument['kind']>(kind:K,render:()=>void){
 const load=async():ReturnType<typeof N.loadDocument>=>{for(;;){try{return await N.loadDocument();}catch{status('工作台暂时无法加载。');await new Promise<void>(resolve=>{const button=textButton('重新读取工作台',()=>{button.remove();resolve();});$('status').after(button);});}}};
 const initial=await load();if(initial.document.kind!==kind)throw new Error('工作台内容类型不匹配。');
 const state={data:initial.document as Extract<PluginDocument,{kind:K}>,revision:initial.revision,dirty:false,busy:false,
  changed(){state.dirty=true;status('有未保存的修改');},
  async save(){if(state.busy)return;state.busy=true;const snapshot=structuredClone(state.data);try{const result=await N.saveDocument(state.revision,snapshot);state.revision=result.revision;state.dirty=JSON.stringify(state.data)!==JSON.stringify(snapshot);status(state.dirty?'先前内容已保存，仍有新修改':'已保存');}finally{state.busy=false;}},
  async reload(){if(state.dirty&&!confirm('重新加载会替换未保存的修改。继续？'))return;const row=await N.loadDocument();if(row.document.kind!==kind)return;state.data=row.document as typeof state.data;state.revision=row.revision;state.dirty=false;render();status('已读取最新内容');},
 };
 setInterval(()=>{if(state.busy||document.hidden)return;void N.loadDocument().then(row=>{if(row.revision===state.revision)return;if(state.dirty){status('老师或其他页面更新了内容；当前编辑仍保留，保存前请先核对。');return;}if(row.document.kind!==kind)return;state.data=row.document as typeof state.data;state.revision=row.revision;render();status('已同步课堂更新');}).catch(()=>status('暂时无法同步，请检查插件状态。'));},3000);
 return state;
}
export function note(title:string,body:string):void{if(!body.trim()){status('先写下一项内容。');return;}N.saveNote({title,body});}
export async function ask(text:string):Promise<void>{await N.compose(text);status('已放入对话输入框，检查后发送。');}
export async function draftControls(read:()=>unknown,restore:(v:any)=>void):Promise<void>{try{const saved=await N.loadDraft();if(saved)restore(saved);status(saved?'已恢复本课草稿':'草稿只保存在本课');}catch(e){status(String(e));}click('draft',async()=>{await N.saveDraft(read());status('草稿已保存');});}
