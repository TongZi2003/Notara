import {afterEach,expect,test} from 'vitest';
import {resolve} from 'node:path';
import type {RemoteResult} from '@deepseek-ai/dsh-typert-protocol';
import type {SessionListValue,SessionPage} from '@deepseek-ai/dsh-api-session-controller';
import type {PluginCandidate,PluginView} from '@studyforge/contracts/plugins';
import {startIsolated,type IsolatedRuntime} from '../../scripts/dev-isolated.ts';
import {connectRuntime} from '../fixtures/http-runtime.ts';
let runtime:IsolatedRuntime|undefined;afterEach(async()=>{await runtime?.stop();});
function value<T>(reply:RemoteResult<T>):T{if(!reply.ok)throw new Error(JSON.stringify(reply.error));return reply.value;}
test('native math tools preserve shared 2D/3D edits, reject stale projections and restore explicit versions',async()=>{
  runtime=await startIsolated({testModel:true});let client=await connectRuntime(runtime);
  const candidate=value(await client.rpc<PluginCandidate>('studyforgePlugins/prepare',{input:{kind:'directory',path:resolve('examples/plugins/math-workbench')}}));
  const plugin=value(await client.rpc<PluginView>('studyforgePlugins/installPackage',{input:{candidateId:candidate.candidateId,expectedVersion:0,trustNative:false}}));
  const session=value(await client.rpc<{sessionId:string}>('studyforgeCreation/openTeacher',{})),target={...session,id:'plugin-'+plugin.ref.slice(7)+'-board',digest:plugin.digest};
  const read=()=>client.rpc<{revision:number;json:string}>('notaraWorkbench/readDocument',{input:target}).then(value);
  async function tool(name:string,args:unknown){
    value(await client.rpc('session/prompt',{request:{...session,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'[tool]'+JSON.stringify({name,arguments:args})}]}}));
    await expect.poll(async()=>value(await client.rpc<SessionListValue>('session/list',{_request:{}})).items.find(row=>row.sessionId===session.sessionId)?.running).toBe(false);
    const end=await client.rpc<SessionPage>('session/page',{request:{address:{kind:'session',...session},throughSeq:1_000_000,maxMessages:1}});
    const cursor=end.ok?-1:Number(/past cursor (-?\d+)/.exec(end.error.message)?.[1]??-1);
    const page=value(await client.rpc<SessionPage>('session/page',{request:{address:{kind:'session',...session},throughSeq:cursor,maxMessages:300}}));
    const record=page.records.filter(r=>r.type==='event'&&r.event.type==='tool/result').at(-1);if(!record||record.type!=='event')throw new Error('tool_result_missing');
    const block=(record.event.data as {message:{content:{isError?:boolean;content:{text?:string}[]}[]}}).message.content[0]!;
    return {failed:!!block.isError,text:block.content.find(c=>c.text)?.text??''};
  }
  const edits=[{action:'put-parameter',parameter:{name:'a',value:2,min:0,max:5,step:.1}},...[
    {kind:'function',name:'f',expression:'a*x^2'},
    {kind:'point3d',name:'A',x:0,y:0,z:0},{kind:'point3d',name:'B',x:3,y:4,z:0},
    {kind:'line3d',name:'AB',from:'A',to:'B',segment:true},
  ].map(object=>({action:'put-object',object}))];
  expect((await tool('edit_math_scene',{id:target.id,expectedVersion:0,edits})).failed).toBe(false);
  let inspected=JSON.parse((await tool('read_math_scene',{id:target.id})).text);expect(inspected.revision).toBe(1);expect(inspected.rendering).toBe('unavailable');expect(inspected.projection).toBeNull();
  // Transport contract only; browser acceptance separately verifies JSXGraph produces these values.
  const projection={revision:1,objects:[{name:'f',state:'defined'},{name:'A',state:'defined',coordinates:[0,0,0]},{name:'B',state:'defined',coordinates:[3,4,0]},{name:'AB',state:'defined',values:{length:5}}]};
  expect((await client.rpc('notaraWorkbench/publishMath',{input:{...target,json:JSON.stringify(projection)}})).ok).toBe(true);
  inspected=JSON.parse((await tool('read_math_scene',{id:target.id})).text);expect(inspected.rendering).toBe('current');expect(inspected.projection.objects[3].values.length).toBe(5);
  const answer=await tool('calculate_math',{id:target.id,expectedVersion:1,operation:'numeric',expression:'a^2+1'});expect(answer.failed).toBe(false);expect(JSON.parse(answer.text)).toMatchObject({status:'result',numeric:5,revision:1});
  const doc=JSON.parse((await read()).json);doc.observation='学生保存的观察';doc.objects.find((o:{name:string})=>o.name==='B').z=2;
  const write={...target,expectedVersion:1,operationId:'student-3d-move',json:JSON.stringify(doc)};
  expect(value(await client.rpc<{revision:number}>('notaraWorkbench/writeDocument',{input:write})).revision).toBe(2);
  expect(value(await client.rpc<{revision:number}>('notaraWorkbench/writeDocument',{input:write})).revision).toBe(2);
  expect((await client.rpc('notaraWorkbench/publishMath',{input:{...target,json:JSON.stringify(projection)}})).ok).toBe(false);
  inspected=JSON.parse((await tool('read_math_scene',{id:target.id})).text);expect(inspected.rendering).toBe('unavailable');expect(inspected.document.observation).toBe(doc.observation);
  expect((await tool('edit_math_scene',{id:target.id,expectedVersion:1,edits:[{action:'remove-object',name:'A'}]})).failed).toBe(true);
  expect((await read()).revision).toBe(2);
  expect((await tool('edit_math_scene',{id:target.id,expectedVersion:2,edits:[{action:'put-object',object:{kind:'point3d',name:'C',x:1,y:1,z:1}}]})).failed).toBe(false);
  expect(JSON.parse((await read()).json).observation).toBe(doc.observation);
  expect((await tool('restore_math_scene',{id:target.id,expectedVersion:3,targetRevision:2})).failed).toBe(false);
  expect((await read()).revision).toBe(4);expect(JSON.parse((await read()).json).objects.some((o:{name:string})=>o.name==='C')).toBe(false);
  expect((await tool('edit_math_scene',{id:target.id,expectedVersion:4,edits:[{action:'remove-object',name:'A'}]})).failed).toBe(false);
  expect(JSON.parse((await read()).json).objects.map((o:{name:string})=>o.name)).toEqual(['f','B']);
  expect((await tool('restore_math_scene',{id:target.id,expectedVersion:5,targetRevision:4})).failed).toBe(false);
  expect(JSON.parse((await read()).json).objects.map((o:{name:string})=>o.name)).toEqual(['f','A','B','AB']);
  await runtime.restart();client=await connectRuntime(runtime);expect((await read()).revision).toBe(6);
  inspected=JSON.parse((await tool('read_math_scene',{id:target.id})).text);expect(inspected.projection).toBeNull();
},90000);
