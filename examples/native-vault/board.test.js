import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { Session } from '@deepseek-ai/dsh-session';
import { NotaraTeaching } from './teaching-runtime.js';
import { createAgentVaultIO } from './agent-io.js';
import { boardPath } from './board-runtime.js';
import { parseBoard,renderBoard,upsertBoard,projectBoard } from './board-data.js';
import { partialBoardArgs,createBoardEventTracker } from './board-stream.js';
import { renderBoardMarkdown,exportBoard,highlightBoardText } from './board-render.js';

test('Markdown is the only body; revisions preserve stable identities and manual positions',()=>{
  const board=parseBoard(null,'lesson');upsertBoard(board,{title:'推导',body:'第一行'},'block-one');
  board.blocks[0].x=817;upsertBoard(board,{title:'推导',body:'修正后的解释'},'unused');
  const text=renderBoard(board),restored=parseBoard(text,'lesson');assert.deepEqual(restored,board);assert.equal(restored.blocks[0].id,'block-one');assert.equal(restored.blocks[0].x,817);assert.equal(text.match(/修正后的解释/g).length,1);
  assert.throws(()=>parseBoard(text,'other'),/binding/);assert.throws(()=>parseBoard(text+'\n<!-- notara-board broken -->','lesson'),/content/);
  assert.throws(()=>upsertBoard(board,{title:'另一个区域',body:'x',placement:{relativeTo:'不存在',position:'below'}},'new'),/anchor/);
});
test('knowledge face only projects actual references and drops retracted sources',()=>{
  const board=parseBoard(null,'lesson');upsertBoard(board,{title:'比较',body:'[[A|资料甲]] 与 [[B.md|资料乙]]'},'one');
  const files=[{path:'A.md',title:'甲',content:'[[B.md]]'},{path:'B.md',title:'乙',content:'秘密参考答案'},{path:'planned.md',content:'只计划了'}];
  const value=projectBoard(board,'rev',files);assert.equal(value.sources.length,2);assert.deepEqual(value.edges,[{from:'A.md',to:'B.md',label:'引用'}]);assert.ok(!JSON.stringify(value).includes('秘密参考答案'));assert.ok(!JSON.stringify(value).includes('planned'));
  board.blocks[0].body='[[A]]';assert.equal(projectBoard(board,'rev',files).sources.length,1);
});
test('partial argument decoding handles escapes, incomplete unicode and completed tool failure',()=>{
  assert.deepEqual(partialBoardArgs('{"title":"重点","body":"第一行\\n第二'),{title:'重点',body:'第一行\n第二'});
  assert.equal(partialBoardArgs('{"body":"x\\u4e').body,'x');assert.equal(partialBoardArgs('{"body":"x\\u4e2d').body,'x中');

});
test('safe HTML, recoloring and export physically exclude private kinds',()=>{
  const html=renderBoardMarkdown('<img src=x onerror=alert(1)>\n[bad](javascript:alert)\n<mark data-color="pink">重点</mark>');assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('<mark data-color="pink">'));
  const body=highlightBoardText('理解重点。','重点','green');assert.equal(highlightBoardText(body,'重点','pink'),'理解<mark data-color="pink">重点</mark>。');assert.equal(highlightBoardText(body,'重点',null),'理解重点。');assert.throws(()=>highlightBoardText('点和点','点','blue'));
  const board={blocks:[{title:'公开',kind:'note',body:'结论'},{title:'私密标题',kind:'attempt',body:'私密尝试'},{title:'提示',kind:'hint',body:'提示答案'}]};
  for(const value of Object.values(exportBoard(board))){assert.ok(value.includes('结论'));assert.ok(!value.includes('私密'));assert.ok(!value.includes('提示答案'));}
  assert.ok(exportBoard(board,{attempt:true}).html.includes('私密尝试'));
});
test('native session event source streams before any chat node and settles without replay',()=>{
  const track=createBoardEventTracker(),entries=[];let revision=0;
  const append=event=>{const entry={event};entries.push(entry);return track({revision:revision++,entries,change:{kind:'append',entries:[entry]}});};
  const chunk=argumentsDelta=>({type:'assistant/live-chunk',data:{attemptId:'test',chunk:{type:'tool-call-delta',index:0,id:'live',name:'write_lesson_board',argumentsDelta}}});
  assert.equal(append(chunk('{"title":"标题","body":"甲')).get('live').body,'甲');
  assert.equal(append(chunk('乙')).get('live').body,'甲乙');
  assert.equal(append({type:'turn/end',data:{}}).get('live').status,'error');
  const result={type:'tool/result',data:{message:{source:{callId:'live'},content:[{isError:false}]}}};
  const settled=track({revision:revision++,entries:[{event:{type:'tool/call',data:{callId:'live',name:'write_lesson_board',arguments:'{"title":"标题","body":"甲乙"}'}}},{event:result}],change:{kind:'settle-assistant'}});
  assert.equal(settled.get('live').status,'completed');assert.equal(settled.get('live').body,'甲乙');
});
test('real native IO: scope, CAS, persisted layout/highlights, restart and foreign note protection',async t=>{
  const root=await mkdtemp(join(tmpdir(),'notara-board-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const rows=['a','b'].map(id=>({id,path:join(root,id)}));for(const row of rows)await mkdir(join(row.path,'vault'),{recursive:true});
  const ctx=new Context();new LocalFileSystem(ctx,{cwd:root,diffBasisMaxBytes:10*1024*1024});ctx.reflect.provide('workspaceRegistry',{list:()=>rows});
  const agents=new Map(rows.map(row=>[row.id,{session:Session.create(row.id,[],{version:3,id:row.id,createdAt:Date.now(),isSeeded:false,cwd:row.path,agentPreset:'notara-teacher'})}]));
  ctx.reflect.provide('sessionController',{inspect:async id=>({meta:{cwd:agents.get(id)?.session.header.cwd}})});
  const service=new NotaraTeaching(ctx,{root:rows[1].path},{resolveAgent:async id=>agents.get(id),archive:async()=>{}});
  const exec={agent:agents.get('a'),signal:new AbortController().signal,callId:'one'};
  assert.deepEqual((await service.board({sessionId:'a'})).blocks,[]);
  await service.executeTool('write_lesson_board',{title:'核心',body:'观察与证据'},exec);
  const first=await service.board({sessionId:'a'});assert.equal(first.blocks.length,1);assert.equal((await service.board({sessionId:'b'})).blocks.length,0);
  const moved=await service.mutateBoard({sessionId:'a',expectedRevision:first.revision,blockId:first.blocks[0].id,patch:{x:591,body:'观察与<mark data-color="blue">证据</mark>'}});
  await assert.rejects(service.mutateBoard({sessionId:'a',expectedRevision:first.revision,blockId:first.blocks[0].id,patch:{x:0}}),/revision_conflict/);
  const restored=await service.board({sessionId:'a'});assert.deepEqual(restored,moved);assert.equal(restored.blocks[0].x,591);
  assert.match(await readFile(join(rows[0].path,'vault',boardPath('a')),'utf8'),/data-color="blue"/);
  service.prepared.set(exec.agent,{boardRevision:first.revision});await assert.rejects(service.executeTool('write_lesson_board',{title:'核心',body:'不能覆盖'},exec),/revision_conflict/);
  const io=createAgentVaultIO(ctx,exec,{writeApproved:true});await io.save(boardPath('a'),renderBoard(parseBoard(null,'someone-else')),restored.revision);await assert.rejects(service.board({sessionId:'a'}),/binding/);
});
