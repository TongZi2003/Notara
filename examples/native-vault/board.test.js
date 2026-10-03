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
import { parseBoard,renderBoard,upsertBoard,projectBoard,boardOverview } from './board-data.js';
import { boardComponents as boardComponentsOf } from './board-components.js';
import { partialBoardArgs,createBoardEventTracker } from './board-stream.js';
import { renderBoardMarkdown,exportBoard,highlightBoardText } from './board-render.js';

test('Markdown is the only body; revisions preserve stable identities and manual positions',()=>{
  const board=parseBoard(null,'lesson');upsertBoard(board,{title:'推导',body:'第一行'},'block-one');
  board.blocks[0].x=817;board.blocks[0].y=90;board.blocks[0].width=520;board.blocks[0].height=360;upsertBoard(board,{title:'推导',body:'修正后的解释'},'unused');
  const text=renderBoard(board),restored=parseBoard(text,'lesson');assert.deepEqual(restored,board);assert.equal(restored.blocks[0].id,'block-one');assert.equal(restored.blocks[0].x,817);assert.equal(restored.blocks[0].width,520);assert.equal(restored.blocks[0].height,360);assert.equal(text.match(/修正后的解释/g).length,1);
  assert.throws(()=>parseBoard(text.replace('"height":360','"height":99'),'lesson'),/board_layout_invalid/);
  assert.throws(()=>parseBoard(text.replace('"width":520','"width":1601'),'lesson'),/board_layout_invalid/);
  assert.throws(()=>parseBoard(text,'other'),/binding/);assert.throws(()=>parseBoard(text+'\n<!-- notara-board broken -->','lesson'),/content/);
  assert.throws(()=>upsertBoard(board,{title:'另一个区域',body:'x',placement:{relativeTo:'不存在',position:'below'}},'new'),/anchor/);
});
test('board markers of an older board keep their interactive reference; new writes cannot add one',()=>{
  const ref={provider:'math',interactionId:'123e4567-e89b-12d3-a456-426614174000',revision:'a'.repeat(24),preset:'parabola'};
  const legacy=`---\ntype: lesson-board\ntitle: 课堂板书\nsession: lesson\nsourceNotes: {}\n---\n<!-- notara-board ${JSON.stringify({id:'block-one',kind:'note',x:60,y:60,width:340,interactive:ref})} -->\n## 抛物线\n\n观察开口变化\n`;
  const board=parseBoard(legacy,'lesson');
  assert.deepEqual(board.blocks[0].interactive,ref);
  upsertBoard(board,{title:'抛物线',body:'改写后的观察'},'unused');
  assert.deepEqual(parseBoard(renderBoard(board),'lesson').blocks[0].interactive,ref,'a rewrite keeps the old figure');
  assert.throws(()=>upsertBoard(board,{title:'新图',body:'x',interactive:{provider:'math',preset:'parabola',scene:{preset:'parabola'}}},'new'),/board_content_invalid/);
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
test('interactive board export is a static snapshot and contains no executable HTML',()=>{
  const board={blocks:[{title:'抛物线',kind:'note',body:'观察开口变化',interactiveScene:{kind:'math',preset:'parabola',viewport:[-5,5,5,-5],parameters:{a:.8,h:0,k:0},observation:''}}]};
  const output=exportBoard(board).html;
  assert.match(output,/y = 0\.8\(x - 0\)² \+ 0/);
  assert.doesNotMatch(output,/<script|<iframe|javascript:/i);
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
  const agents=new Map(rows.map(row=>[row.id,{session:Session.create(row.id,[],{version: 4,id:row.id,createdAt:Date.now(),isSeeded:false,cwd:row.path,agentPreset:'notara-teacher'})}]));
  ctx.reflect.provide('sessionController',{inspect:async id=>({meta:{cwd:agents.get(id)?.session.header.cwd}})});
  const service=new NotaraTeaching(ctx,{root:rows[1].path},{resolveAgent:async id=>agents.get(id),archive:async()=>{}});
  const exec={agent:agents.get('a'),signal:new AbortController().signal,callId:'one'};
  assert.deepEqual((await service.board({sessionId:'a'})).blocks,[]);
  await service.executeTool('write_lesson_board',{title:'核心',body:'观察与证据'},exec);
  const first=await service.board({sessionId:'a'});assert.equal(first.blocks.length,1);assert.equal((await service.board({sessionId:'b'})).blocks.length,0);
  const moved=await service.mutateBoard({sessionId:'a',expectedRevision:first.revision,blockId:first.blocks[0].id,patch:{x:591,y:120,width:520,height:360,body:'观察与<mark data-color="blue">证据</mark>'}});
  assert.deepEqual({width:moved.blocks[0].width,height:moved.blocks[0].height},{width:520,height:360});
  await assert.rejects(service.mutateBoard({sessionId:'a',expectedRevision:moved.revision,blockId:first.blocks[0].id,patch:{width:220}}),/board_layout_invalid/);
  await assert.rejects(service.mutateBoard({sessionId:'a',expectedRevision:first.revision,blockId:first.blocks[0].id,patch:{x:0}}),/revision_conflict/);
  const restored=await service.mutateBoard({sessionId:'a',expectedRevision:moved.revision,blockId:first.blocks[0].id,patch:{pinned:false}});
  assert.equal(restored.blocks[0].x,undefined);assert.equal(restored.blocks[0].y,undefined);assert.equal(restored.blocks[0].width,undefined);assert.equal(restored.blocks[0].height,undefined);assert.match(restored.blocks[0].body,/证据/);
  assert.deepEqual(await service.board({sessionId:'a'}),restored);
  assert.match(await readFile(join(rows[0].path,'vault',boardPath('a')),'utf8'),/data-color="blue"/);
  service.prepared.set(exec.agent,{boardRevision:first.revision});await assert.rejects(service.executeTool('write_lesson_board',{title:'核心',body:'不能覆盖'},exec),/revision_conflict/);
  const io=createAgentVaultIO(ctx,exec,{writeApproved:true});await io.save(boardPath('a'),renderBoard(parseBoard(null,'someone-else')),restored.revision);await assert.rejects(service.board({sessionId:'a'}),/binding/);
});

test('sections, sizes and placements persist; a legacy board keeps its positions',()=>{
  const board=parseBoard(null,'lesson');let n=0;const ids=()=>'s-'+String(++n).padStart(8,'0');
  upsertBoard(board,{title:'题目',body:'椭圆的中点弦',kind:'question',section:'第1题 中点弦'},'q',ids);
  upsertBoard(board,{title:'我的尝试',body:'设直线',placement:{relativeTo:'题目',position:'beside'}},'a',ids);
  upsertBoard(board,{title:'椭圆图',body:'图',size:'wide'},'f',ids);
  upsertBoard(board,{title:'两种解法',body:'比较',section:'比较'},'c',ids);
  assert.deepEqual(board.sections,[{id:'s-00000001',title:'第1题 中点弦'},{id:'s-00000002',title:'比较'}]);
  assert.equal(board.blocks.find(b=>b.id==='a').section,'s-00000001','a new block joins the section written last');
  assert.deepEqual(board.blocks.find(b=>b.id==='a').place,{relativeTo:'q',position:'beside'});
  assert.throws(()=>upsertBoard(board,{title:'跨板块',body:'x',placement:{relativeTo:'题目',position:'below'}},'x',ids),/board_anchor_section/);
  const text=renderBoard(board);assert.doesNotMatch(text,/"x":/,'unpinned blocks store no coordinates');
  assert.deepEqual(parseBoard(text,'lesson'),board);
  upsertBoard(board,{title:'我的尝试',body:'改写'},'unused',ids);assert.equal(board.blocks.find(b=>b.id==='a').section,'s-00000001','a rewrite keeps the section');
  const legacy=`---\ntype: lesson-board\ntitle: 课堂板书\nsession: lesson\nsourceNotes: {}\n---\n<!-- notara-board {"id":"old","kind":"note","x":60,"y":60,"width":340} -->\n## 旧块\n\n旧内容\n`;
  const old=parseBoard(legacy,'lesson');assert.deepEqual(old.blocks[0],{id:'old',kind:'note',size:'narrow',x:60,y:60,width:340,title:'旧块',body:'旧内容'});
  upsertBoard(old,{title:'新块',body:'新内容'},'new',ids);assert.equal(old.blocks[1].section,old.sections[0].id);assert.equal(old.blocks[0].x,60);
  assert.throws(()=>upsertBoard(board,{title:'坏题',body:'```choice\n- 甲\n- 乙\n```'},'bad',ids),/board_component_invalid：第1个组件（choice）缺少题干/);
});
test('the per-turn overview lists sections, blocks and answer states',()=>{
  const board=parseBoard(null,'lesson');
  upsertBoard(board,{title:'先走哪步',body:'```choice\n你打算先走哪一步？\n- 联立\n- 点差\n```',section:'第1题'},'q',()=>'s-00000001');
  const [component]=boardComponentsOf(board.blocks[0].body);
  board.blocks[0].answers=[{id:'aaaaaaaa',c:0,fp:component.fingerprint,at:'2026-09-26T10:05:00.000Z',v:{pick:[1]}}];
  const text=boardOverview(board);
  assert.match(text,/- 板块「第1题」/);assert.match(text,/先走哪步（note）：choice#1（选择与判断）已作答 1 次，最近 \d\d:\d\d：我选：B 点差/);
  assert.equal(boardOverview(parseBoard(null,'lesson')),'当前白板还是空的。');
});
test('export follows sections and renders questions as text; answers only with 个人尝试',()=>{
  const board=parseBoard(null,'lesson');let n=0;const ids=()=>'s-'+String(++n).padStart(8,'0');
  upsertBoard(board,{title:'先判断',section:'第1题',body:'先判断方向。\n\n```choice\n斜率正还是负？\n- 正\n- 负\n```'},'q',ids);
  upsertBoard(board,{title:'补一步',body:'```blank\n相减得 {{ 和与差 }}\n```'},'b',ids);
  const [component]=boardComponentsOf(board.blocks[0].body);
  board.blocks[0].answers=[{id:'aaaaaaaa',c:0,fp:component.fingerprint,at:'2026-09-26T10:05:00.000Z',v:{pick:[1]}}];
  const plain=exportBoard(board);
  assert.match(plain.markdown,/## 第1题\n\n### 先判断\n\n先判断方向。\n\n斜率正还是负？\n\n- A\. 正\n- B\. 负/);
  assert.match(plain.markdown,/相减得 ____（和与差）/);
  assert.doesNotMatch(plain.markdown,/我的作答|```choice/);
  assert.match(plain.html,/<h2>第1题<\/h2><section><h3>先判断<\/h3>/);
  assert.match(exportBoard(board,{attempt:true}).markdown,/> 我的作答：我选：B 负/);
});
test('export draws flow diagrams as SVG and figures from their live snapshot or in words',()=>{
  const board=parseBoard(null,'lesson');let n=0;const ids=()=>'s-'+String(++n).padStart(8,'0');
  upsertBoard(board,{title:'因果',section:'交子',body:'```flow\nA[发行过量] --> B[币值下跌]\n```'},'flow-block',ids);
  upsertBoard(board,{title:'图',body:'```figure\naxes x -4..4 y -3..3\nfunction f(x) = x^2\n```'},'figure-block',ids);
  const words=exportBoard(board).html;
  assert.match(words,/<svg class="nb-flow"[^>]*>[\s\S]*发行过量/);
  assert.match(words,/<figcaption>图：函数 f\(x\) = x\^2<\/figcaption>/);
  assert.match(exportBoard(board).markdown,/```flow\nA\[发行过量\] --> B\[币值下跌\]\n```/,'Markdown keeps the readable source');
  const live=exportBoard(board,{figureSvgs:{'figure-block:0':'<svg class="jxg"><path d="M0 0"/></svg>'}}).html;
  assert.match(live,/<figure class="nb-export-figure"><svg class="jxg">/);
  assert.doesNotMatch(live,/图：函数/,'a snapshot needs no words');
  // A question figure without a snapshot keeps both the question and what the figure shows.
  upsertBoard(board,{title:'点一点',body:'```figure\naxes x 0..1 y 0..1\nfunction g(x) = x^2\nask point "点出 g 上 y=0.5 的点"\n```'},'ask-block',ids);
  assert.match(exportBoard(board).html,/<figcaption>点出 g 上 y=0.5 的点<br>图：函数 g\(x\) = x\^2<\/figcaption>/);
});
test('export spreads every frame out, with the predictions only under 个人尝试',()=>{
  const board=parseBoard(null,'lesson');
  upsertBoard(board,{title:'上抛',section:'第5题',body:'```frames\ntitle 竖直上抛\nframe 抛出瞬间\n速度向上\npredict\nframe 最高点\n速度为 0\n```'},'frames-block',()=>'s-00000001');
  const [component]=boardComponentsOf(board.blocks[0].body);
  board.blocks[0].answers=[{id:'aaaaaaaa',c:0,fp:component.fingerprint,at:'2026-09-27T08:00:00.000Z',v:{frame:1,text:'速度是 0'}}];
  const plain=exportBoard(board).markdown;
  assert.match(plain,/\*\*竖直上抛\*\*\n\n\*\*第1帧 · 抛出瞬间\*\*\n\n速度向上\n\n\*\*第2帧 · 最高点\*\*\n\n速度为 0/);
  assert.doesNotMatch(plain,/我预测/);
  assert.match(exportBoard(board,{attempt:true}).markdown,/> 我的作答：我预测第2帧（最高点）：速度是 0/);
});

test('punctuation right after an inline formula is kept on the formula\'s line; other text is untouched',()=>{
  const kept=renderBoardMarkdown('又 $a_1=1$，故 $a_n$ 成立');
  assert.match(kept,/<span class="nb-keep"><span class="katex">[^]*<\/span>，<\/span>故 /);
  // Only the formula's last piece is held to the comma, so a long formula still breaks between its terms.
  const long=renderBoardMarkdown('得 $a+b=c$，故');
  const held=long.slice(long.indexOf('<span class="nb-keep">'));
  assert.equal((long.match(/class="base"/g)??[]).length,3);
  assert.equal((held.match(/class="base"/g)??[]).length,1);
  assert.equal((long.match(/class="katex-mathml"/g)??[]).length,1,'the formula is read once');
  assert.equal((long.match(/<span/g)??[]).length,(long.match(/<\/span>/g)??[]).length);
  // A one-piece formula has nowhere to break: it stays one formula, held whole.
  const short=renderBoardMarkdown('又 $a_1$，故');
  assert.equal((short.match(/class="katex"/g)??[]).length,1);
  assert.match(short,/<span class="nb-keep"><span class="katex"><span class="katex-mathml">/);
  assert.equal((kept.match(/nb-keep/g)??[]).length,1);
  assert.doesNotMatch(renderBoardMarkdown('$$x=1$$，'),/nb-keep/);
  assert.doesNotMatch(renderBoardMarkdown('价格 $5$ 元'),/nb-keep/);
});
test('bold text on the board keeps its inline syntax: formulas, code and highlights render inside it',()=>{
  const html=renderBoardMarkdown('**结论：$k=-\\dfrac32$**（学生的推导）\n**用 `split` 与 <mark data-color="blue">关键</mark>**');
  assert.match(html,/<strong>结论：<span class="katex/);
  assert.doesNotMatch(html,/\$k=-\\dfrac32\$/,'the formula is not left as source');
  assert.match(html,/<strong>用 <code>split<\/code> 与 <mark data-color="blue">关键<\/mark><\/strong>/);
  // Bold content is still escaped: raw HTML inside it stays text.
  assert.match(renderBoardMarkdown('**<b>x</b>**'),/<strong>&lt;b&gt;x&lt;\/b&gt;<\/strong>/);
});


test('highlights protect formulas, code and links while a unique ordinary word beside them stays editable',()=>{
  for(const source of ['$x$','$$x$$','$$\nx\n$$','`x`','```js\nx\n```','~~~js\nx\n~~~','[[资料.md|x]]','[x](https://example.com)','[资料](x)','<mark data-color="green">xxx</mark>'])assert.throws(()=>highlightBoardText(source,'x','blue'));
  const source='普通 x，公式 $x$，代码 `x`，链接 [[资料.md|x]]。';
  const highlighted=highlightBoardText(source,'x','blue');
  assert.equal(highlighted,'普通 <mark data-color="blue">x</mark>，公式 $x$，代码 `x`，链接 [[资料.md|x]]。');
  assert.match(renderBoardMarkdown(highlighted),/class="katex"/);
  assert.doesNotMatch(renderBoardMarkdown(highlighted),/&lt;mark/);
  assert.throws(()=>highlightBoardText('普通 x 与另一个 x，公式 $x$','x','blue'));
  assert.throws(()=>highlightBoardText('普通 x 与 <mark data-color="green">x</mark>','x','blue'),'a source-only selection cannot choose between two visible copies');
  const marked='<mark data-color="green">重点</mark>';
  assert.equal(highlightBoardText(marked,'重点','blue'),'<mark data-color="blue">重点</mark>');
  assert.equal(highlightBoardText(marked,'重点',null),'重点');
});

test('board tables and HTML export preserve formulas, alias links, code and escaped pipes in their own cells',()=>{
  const source='| 项目 | 内容 |\n|---|---|\n| 绝对值 | $|x|$ |\n| 范数 | $\\|x\\|$ |\n| 资料 | [[资料.md|教材]] |\n| 代码 | `a|b` |\n| 转义 | a\\|b |\n| 高亮 | <mark data-color="blue">a|b</mark> |';
  const html=renderBoardMarkdown(source);
  assert.equal((html.match(/<td>/g)??[]).length,12);
  assert.equal((html.match(/class="katex"/g)??[]).length,2);
  assert.match(html,/<button class="nb-source-link" data-source="资料.md">教材<\/button>/);
  assert.match(html,/<td><code>a\|b<\/code><\/td>/);
  assert.match(html,/<td>a\|b<\/td>/);
  assert.match(html,/<td><mark data-color="blue">a\|b<\/mark><\/td>/);
  const exported=exportBoard({sections:[],blocks:[{id:'table',title:'表格',kind:'note',body:source}]}).html;
  assert.equal((exported.match(/<td>/g)??[]).length,12);
  assert.equal((exported.match(/class="katex"/g)??[]).length,2);
  assert.doesNotMatch(exported,/data-source=/,'export keeps the label as text without an application-only button');
});
