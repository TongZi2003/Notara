import {afterEach,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {RemoteResult} from '@deepseek-ai/dsh-typert-protocol';
import type {PluginCandidate,PluginView,WorkbenchContent} from '@studyforge/contracts/plugins';
import type {SeminarView} from '@studyforge/contracts/plugin-learning';
import {startIsolated,type IsolatedRuntime} from '../../scripts/dev-isolated.ts';
import {connectRuntime} from '../fixtures/http-runtime.ts';
import {catalog} from '../../examples/plugin-sources/catalog.ts';
let runtime:IsolatedRuntime|undefined;afterEach(async()=>{await runtime?.stop();});
const value=<T,>(r:RemoteResult<T>):T=>{if(!r.ok)throw new Error(JSON.stringify(r.error));return r.value;};
test('seven packages install, teacher board updates reach documents and true independent seminar children can be followed',async()=>{
 runtime=await startIsolated({testModel:true});let client=await connectRuntime(runtime);
 const plugins:Record<string,PluginView>={};for(const item of catalog){const candidate=value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare',{input:{kind:'directory',path:resolve('examples/plugins',item.name)}}));plugins[item.name]=value(await client.rpc<PluginView>('studyforgePlugins/installPackage',{input:{candidateId:candidate.candidateId,expectedVersion:0,trustNative:false}}));expect(plugins[item.name]!.state).toBe('enabled');}
 const session=value(await client.rpc<{sessionId:string}>('studyforgeCreation/openTeacher',{}));
 const target=(name:string)=>({...session,id:'plugin-'+plugins[name]!.ref.slice(7)+'-workbench',digest:plugins[name]!.digest});
 for(const item of catalog){const opened=value(await client.rpc<WorkbenchContent>('studyforgePlugins/openWorkbench',{input:{...session,id:target(item.name).id}}));expect(opened.html).toContain('script');if('seed'in item){const doc=value(await client.rpc<{revision:number;json:string}>('notaraWorkbench/readDocument',{input:target(item.name)}));expect(JSON.parse(doc.json).kind).toBe(item.seed.kind);}}
 const board=target('blackboard'),before=value(await client.rpc<{revision:number;json:string}>('notaraWorkbench/readDocument',{input:board})),document=JSON.parse(before.json);document.blocks.push({title:'原生老师新增',body:'$1+1=2$',links:[]});
 const sources=value(await client.rpc<Array<{kind:string;sessionId?:string}>>('notaraWorkbench/sources',{input:{...board,query:''}}));expect(sources.some(link=>link.kind==='lesson'&&link.sessionId===session.sessionId)).toBe(true);
 const calls=[{name:'load_tools',arguments:{names:['read_workbench','update_workbench']}},{name:'read_workbench',arguments:{id:board.id}},{name:'update_workbench',arguments:{id:board.id,expectedVersion:0,documentJson:JSON.stringify(document)}}];
 value(await client.rpc('session/prompt',{request:{...session,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'[tools]'+JSON.stringify(calls)}]}}));
 await expect.poll(async()=>value(await client.rpc<{revision:number;json:string}>('notaraWorkbench/readDocument',{input:board})).json,{timeout:20000}).toContain('原生老师新增');
 await expect.poll(async()=>value(await client.rpc<any>('session/list',{_request:{}})).items.find((r:any)=>r.sessionId===session.sessionId)?.running,{timeout:20000}).toBe(false);
 expect((await client.rpc('notaraWorkbench/writeDocument',{input:{...board,expectedVersion:0,operationId:'stale',json:before.json}})).ok).toBe(false);
 expect((await client.rpc('notaraWorkbench/readDocument',{input:target('geometry-lab')})).ok).toBe(false);
 const seminar=target('seminar-room');expect((await client.rpc('notaraWorkbench/startSeminar',{input:{...seminar,topic:'无标准',materials:'材料',standard:'',roles:['assistant']}})).ok).toBe(false);
 const started=value(await client.rpc<SeminarView[]>('notaraWorkbench/startSeminar',{input:{...seminar,topic:'检验一个推理',materials:'SEMINAR_INPUT：所有正方形是矩形，所有矩形是正方形吗？',standard:'只有第一句总成立。',roles:['peer','critic','assistant']}}));
 const ref=started[0]!.ref,ids=started[0]!.participants.map(p=>p.childId);expect(new Set(ids).size).toBe(3);expect(ids.every(Boolean)).toBe(true);
 const list=()=>client.rpc<SeminarView[]>('notaraWorkbench/seminars',{input:seminar}).then(value);
 await expect.poll(async()=>(await list())[0]!.participants.every(p=>p.state==='completed'),{timeout:30000}).toBe(true);
 const requests=(await readFile(join(runtime.root,'model-requests.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 for(const id of ids){const request=requests.find(r=>r.sessionId===id&&r.purpose!=='session-title');expect(request).toBeTruthy();expect(request.toolNames).not.toContain('read_memory');expect(request.toolNames).not.toContain('update_workbench');expect(JSON.stringify(request)).not.toContain('原生老师新增');}
 value(await client.rpc('notaraWorkbench/followSeminar',{input:{...seminar,ref,role:'peer',text:'FOLLOW_SAME_CHILD：请举一个反例。',operationId:crypto.randomUUID()}}));
 await expect.poll(async()=>(await list())[0]!.participants.find(p=>p.role==='peer')!.text,{timeout:20000}).toContain('FOLLOW_SAME_CHILD');
 await expect.poll(async()=>(await list())[0]!.participants.every(p=>p.state==='completed'),{timeout:20000}).toBe(true);
 await runtime.restart();client=await connectRuntime(runtime);expect((await list())[0]!.participants.map(p=>p.childId)).toEqual(ids);
 value(await client.rpc('notaraWorkbench/followSeminar',{input:{...seminar,ref,role:'peer',text:'AFTER_RESTART：请继续。',operationId:crypto.randomUUID()}}));
 await expect.poll(async()=>(await list())[0]!.participants.find(p=>p.role==='peer')!.text,{timeout:20000}).toContain('AFTER_RESTART');
 expect((await client.rpc('notaraWorkbench/stopSeminar',{input:{...seminar,digest:'wrong',ref}})).ok).toBe(false);
 value(await client.rpc('notaraWorkbench/stopSeminar',{input:{...seminar,ref}}));
 expect(value(await client.rpc<{revision:number;json:string}>('notaraWorkbench/readDocument',{input:board})).json).toContain('原生老师新增');
 value(await client.rpc('studyforgePlugins/setEnabled',{input:{ref:plugins.blackboard!.ref,expectedVersion:plugins.blackboard!.revision,enabled:false}}));expect((await client.rpc('notaraWorkbench/readDocument',{input:board})).ok).toBe(false);
},150000);
