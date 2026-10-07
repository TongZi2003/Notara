import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conditionalProjection, markProjection, createProjectionMemo } from './projection-runtime.js';
import { createProjectionReader } from './projection-client.js';
import { createVaultStore } from './vault.js';
import { NotaraVaultRemote } from './index.js';

test('unchanged snapshots omit the body, keep legacy shape, and separate scopes',()=>{
  const value=markProjection({body:'x'.repeat(1_000_000)},['source','r1']);
  assert.equal(conditionalProjection({},value,'one'),value);
  const first=conditionalProjection({projectionRevision:null},value,'one');
  assert.equal(first.value,value);
  value.toJSON=()=>{throw Error('large projection was serialized');};
  const same=conditionalProjection({projectionRevision:first.revision},value,'one');
  assert.equal(same.unchanged,true);
  assert.ok(JSON.stringify(same).length<150);
  assert.equal(conditionalProjection({projectionRevision:first.revision},value,'two').value,value);
  assert.throws(()=>conditionalProjection({projectionRevision:'bad'},value,'one'),/projection_invalid/);
});

test('poll reader reuses object identity, invalidates after writes, and rejects missing snapshots',async()=>{
  let value={body:'old'}, calls=[];
  const reader=createProjectionReader(async input=>{calls.push(input);return{ok:true,value:conditionalProjection(input,value,'scope')};});
  const first=await reader.read(),second=await reader.read();
  assert.equal(first.value,second.value);
  value={body:'new'};
  assert.equal((await reader.read()).value.body,'new');
  reader.invalidate();await reader.read();
  assert.equal(calls.at(-1).projectionRevision,null);
  const missing=createProjectionReader(async()=>({ok:true,value:{kind:'notara-projection',revision:'a'.repeat(64),unchanged:true}}));
  await assert.rejects(missing.read(),/projection_missing/);
});

test('late reads cannot replace a newer receipt or repopulate an invalidated reader',async()=>{
  const pending=[],reader=createProjectionReader(input=>new Promise(resolve=>pending.push({input,resolve})));
  const old=reader.read(),newer=reader.read();
  pending[1].resolve({ok:true,value:conditionalProjection(pending[1].input,{body:'new'},'scope')});await newer;
  pending[0].resolve({ok:true,value:conditionalProjection(pending[0].input,{body:'old'},'scope')});await old;
  const follow=reader.read();
  assert.equal(pending[2].input.projectionRevision,conditionalProjection({projectionRevision:null},{body:'new'},'scope').revision);
  reader.invalidate();pending[2].resolve({ok:true,value:conditionalProjection(pending[2].input,{body:'stale'},'scope')});await follow;
  const after=reader.read();assert.equal(pending[3].input.projectionRevision,null);
  pending[3].resolve({ok:false});await after;
});

test('pure projection memo has bounded scope retention and rebuilds on errors/deletion',()=>{
  const memo=createProjectionMemo(2);let builds=0;
  const build=()=>({nested:{build:++builds}});
  const first=memo('one',['r1',[]],build);
  assert.equal(memo('one',['r1',[]],build),first);
  assert.ok(Object.isFrozen(first.nested));
  assert.notEqual(memo('one',['r1',['unreadable']],build),first);
  memo('two',[],build);memo('three',[],build);memo('one',[],build);
  assert.equal(builds,5);
});

test('projection memo bounds retained bytes and does not retain an oversized body',()=>{
  const memo=createProjectionMemo(32,150);let builds=0;
  const small=()=>({body:'x'.repeat(20),build:++builds});
  const first=memo('one',['r1'],small);memo('two',['r1'],small);memo('three',['r1'],small);
  assert.notEqual(memo('one',['r1'],small),first);
  const large=()=>({body:'x'.repeat(1000),build:++builds});
  const over=memo('large',['r1'],large);
  assert.notEqual(memo('large',['r1'],large),over);
});

test('graph/star polls observe same-size external edits and file removal without a full unchanged body',async()=>{
  const root=await mkdtemp(join(tmpdir(),'notara-projection-'));
  try{
    const file=join(root,'card.md');
    await writeFile(file,'---\ntype: card\n---\n# Alpha\n');
    const store=createVaultStore(root,root);
    for(const method of ['graph','learningStars']){
      const first=conditionalProjection({projectionRevision:null},await store[method](),method);
      assert.equal(conditionalProjection({projectionRevision:first.revision},await store[method](),method).unchanged,true);
      await writeFile(file,'---\ntype: card\n---\n# Bravo\n');
      assert.ok(Object.hasOwn(conditionalProjection({projectionRevision:first.revision},await store[method](),method),'value'));
      await writeFile(file,'---\ntype: card\n---\n# Alpha\n');
    }
    const before=conditionalProjection({projectionRevision:null},await store.graph(),'graph');
    await rm(file);
    const after=conditionalProjection({projectionRevision:before.revision},await store.graph(),'graph');
    assert.equal(after.value.nodes.length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a matching poll token still runs session authorization and propagates denial',async()=>{
  let authorized=true,calls=0;
  const remote=Object.create(NotaraVaultRemote.prototype,{ctx:{value:{get:name=>name==='notaraTeaching'?{board:async()=>{calls++;if(!authorized)throw Error('denied');return{blocks:[],revision:'r1'};}}:undefined}}});
  const first=await remote.board({sessionId:'real',projectionRevision:null});
  assert.equal((await remote.board({sessionId:'real',projectionRevision:first.revision})).unchanged,true);
  authorized=false;
  await assert.rejects(remote.board({sessionId:'real',projectionRevision:first.revision}),error=>error.cause?.message==='denied');
  assert.equal(calls,3);
});
