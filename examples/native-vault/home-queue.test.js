import test from 'node:test';
import assert from 'node:assert/strict';
import { homeQueue } from './home-queue.js';

test('home combines actual due cards and unscheduled lessons without inventing completion',()=>{
  const queue={hits:[{path:'卡片/a.md',title:'基底',state:{next_review:'2026-09-24'}}]};
  const routes={routes:[{path:'路线/a.md',title:'向量'}],nodes:[{id:'l1',title:'坐标表示',routePath:'路线/a.md',routeRevision:'r1'}]};
  assert.deepEqual(homeQueue(queue,routes).map(item=>[item.kind,item.title,item.action]),[['review','基底','复习'],['schedule','坐标表示','安排']]);
  assert.equal(homeQueue(queue,routes)[1].revision,'r1');
  assert.equal(homeQueue(queue,routes)[1].subtitle,'待安排 · 向量');
  assert.ok(!('checked' in homeQueue(queue,routes)[0]));
});
test('already scheduled, opened, summarized and conditional lessons stay out of pending scheduling',()=>{
  const rows=[{}, {scheduledOn:'2026-09-25'}, {sessionId:'lesson'}, {summary:{path:'summary.md'}}, {pathway:'remedial'}, {pathway:'extension'}];
  const nodes=rows.map((extra,i)=>({id:String(i),title:'课程 '+i,routePath:'路线/a.md',...extra}));
  assert.deepEqual(homeQueue(null,{nodes}).map(item=>item.nodeId),['0']);
  assert.deepEqual(homeQueue(null,null),[]);
});
test('partial data and pagination duplicates do not fabricate rows or repeat identities',()=>{
  const card={path:'a.md',title:'甲'},node={routePath:'r.md',id:'1',title:'乙'};
  assert.equal(homeQueue({hits:[card,card]},null).length,1);
  assert.equal(homeQueue(null,{nodes:[node,node]}).length,1);
});
test('compact rotation surfaces both kinds while preserving their source order',()=>{
  const queue={hits:['a','b','c'].map(path=>({path,title:path}))};
  const routes={nodes:['1','2'].map(id=>({id,routePath:'r.md',title:id}))};
  assert.deepEqual(homeQueue(queue,routes).map(item=>item.title),['a','1','b','2','c']);
});
test('five due cards stay individual; six or more collapse into one reminder',()=>{
  const hits=Array.from({length:6},(_,i)=>({path:i+'.md',title:'题目'+i}));
  assert.equal(homeQueue({hits:hits.slice(0,5),total:5},null).length,5);
  const six=homeQueue({hits,total:6},null);
  assert.equal(six.length,1);assert.equal(six[0].kind,'review-group');assert.equal(six[0].title,'6 张卡片待复习');
  assert.equal(homeQueue({hits:[],total:0},null).length,0);
});
test('review summary uses full due total beyond the fetched page and keeps scheduling separate',()=>{
  const queue={hits:[{path:'a.md',title:'甲'}],total:27};
  const items=homeQueue(queue,{nodes:[{id:'1',title:'一节课',routePath:'r.md'}]});
  assert.equal(items[0].title,'27 张卡片待复习');assert.equal(items[0].path,undefined);
  assert.equal(items[1].kind,'schedule');
});
