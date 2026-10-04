import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_OVERVIEW_LIMIT, boardOverview, parseBoard, renderBoard, upsertBoard } from './board-data.js';
import { boardAnswerSummary, boardComponents } from './board-components.js';

const question='```choice\n先判断什么？\n- 显性\n- 隐性\n```';
const length=text=>Array.from(text).length;
const add=(board,title,body='普通正文')=>upsertBoard(board,{title,body,section:'遗传'},`b-${board.blocks.length}`,()=>'s-00000001');

test('a small overview retains its original format and excludes prose and layout',()=>{
  const board=parseBoard(null,'synthetic');
  add(board,'基础判断',question);add(board,'讲解');
  const expected='- 板块「遗传」\n  - 基础判断（note）：choice#1（选择与判断）未作答\n  - 讲解（note）';
  assert.equal(boardOverview(board),expected);
  board.blocks[1].body='只修改正文';board.blocks[1].x=400;board.blocks[1].y=900;board.blocks[1].width=600;
  board.sourceNotes['资料.md']={body:'资料备注'};
  assert.equal(boardOverview(board),expected);
});

test('large Unicode boards have a deterministic overview budget without changing stored data',()=>{
  const board=parseBoard(null,'synthetic');
  for(let index=0;index<100;index++)add(board,`${index} ${'🧠遗传'.repeat(25)}`);
  const stored=renderBoard(board),text=boardOverview(board);
  assert.ok(length(text)<=BOARD_OVERVIEW_LIMIT);
  assert.ok(text.isWellFormed());
  assert.match(text,/白板概览已省略 \d+ 个块、0 个组件/);
  assert.match(text,/99 🧠遗传/,'later board blocks remain visible');
  assert.equal(boardOverview(board),text,'no clock or random value changes the snapshot');
  assert.equal(renderBoard(board),stored);
  assert.equal(parseBoard(stored,'synthetic').blocks.length,100);
});

test('overflow keeps the newest valid answer even inside an old block with many questions',()=>{
  const board=parseBoard(null,'synthetic');
  add(board,'旧块中的最新作答',Array.from({length:70},()=>question).join('\n\n'));
  const components=boardComponents(board.blocks[0].body);
  board.blocks[0].answers=[
    {id:'a0000000',c:0,fp:components[0].fingerprint,at:'2026-10-01T10:00:00.000Z',v:{pick:[0]}},
    {id:'b0000000',c:49,fp:components[49].fingerprint,at:'2026-10-02T10:00:00.000Z',v:{pick:[1],reason:'最近的有效判断'}},
    {id:'c0000000',c:1,fp:(components[1].fingerprint[0]==='a'?'b':'a')+components[1].fingerprint.slice(1),at:'2026-10-03T10:00:00.000Z',v:{pick:[0],reason:'已被改题的旧答案'}},
  ];
  for(let index=0;index<80;index++)add(board,`后续板书 ${index}`,question);
  const stored=renderBoard(board),text=boardOverview(parseBoard(stored,'synthetic'));
  assert.ok(length(text)<=BOARD_OVERVIEW_LIMIT);
  assert.match(text.split('\n')[0],/旧块中的最新作答.*choice#50.*最近的有效判断/);
  assert.doesNotMatch(text.split('\n')[0],/已被改题/);
  const visibleComponents=(text.match(/choice#\d+/g)??[]).length;
  assert.ok(visibleComponents<150);
  assert.match(text,new RegExp(`、${150-visibleComponents} 个组件`));
  assert.match(text,/完整内容仍在白板文件/);
  assert.equal(renderBoard(board),stored,'overview selection never removes answers or body');
});

test('new valid answers update the bounded tail while identical state remains stable',()=>{
  const board=parseBoard(null,'synthetic');
  for(let index=0;index<100;index++)add(board,`问题 ${index}`,question);
  const before=boardOverview(board),component=boardComponents(board.blocks[0].body)[0];
  board.blocks[0].answers=[{id:'a0000000',c:0,fp:component.fingerprint,at:'2026-10-04T10:00:00.000Z',v:{pick:[1]}}];
  const after=boardOverview(parseBoard(renderBoard(board),'synthetic'));
  assert.notEqual(after,before);
  assert.match(after.split('\n')[0],/问题 0.*choice#1.*已作答 1 次/);
  assert.ok(length(after)<=BOARD_OVERVIEW_LIMIT);
  assert.equal(boardOverview(structuredClone(board)),after);
});

test('a long legacy title cannot exclude the latest valid answer from overflow',()=>{
  const board=parseBoard(null,'synthetic');add(board,'合法新块',question);
  board.blocks[0].title='手工旧标题🧠'.repeat(500);
  const component=boardComponents(board.blocks[0].body)[0];
  board.blocks[0].answers=[{id:'a0000000',c:0,fp:component.fingerprint,at:'2026-10-04T10:00:00.000Z',v:{pick:[1],reason:'唯一的最新作答'}}];
  const stored=renderBoard(board),text=boardOverview(parseBoard(stored,'synthetic'));
  assert.ok(length(text)<=BOARD_OVERVIEW_LIMIT);
  assert.ok(text.isWellFormed());
  assert.match(text,/标题截短，需读取原文定位/);
  assert.match(text,/choice#1.*唯一的最新作答/);
  assert.match(text,/省略 0 个块、0 个组件/);
  assert.equal(renderBoard(board),stored);
});

test('answer summaries truncate Unicode by code point without breaking emoji',()=>{
  const board=parseBoard(null,'synthetic');add(board,'判断',question);
  const component=boardComponents(board.blocks[0].body)[0],answer={pick:[1],reason:'🧠'.repeat(50)};
  const summary=boardAnswerSummary(component,answer);
  assert.equal(length(summary),60);
  assert.ok(summary.isWellFormed());
  assert.ok(summary.endsWith('…'));
  board.blocks[0].answers=[{id:'a0000000',c:0,fp:component.fingerprint,at:'2026-10-04T10:00:00.000Z',v:answer}];
  const text=boardOverview(parseBoard(renderBoard(board),'synthetic'));
  assert.ok(text.isWellFormed());
  assert.ok(text.includes(summary));
});
