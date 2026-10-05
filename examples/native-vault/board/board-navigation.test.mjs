import test from 'node:test';
import assert from 'node:assert/strict';
import {zoomAt,wheelCamera,panIntent,BOARD_NAVIGATION_KEY,readNavigationPreference,bindWheelBoundary} from './board-navigation.js';

test('zoom keeps the world point under the pointer, including limits',()=>{
 const before={x:-230,y:47,z:.8},point={x:110,y:280};
 for(const z of [1.2,20,.01]){
  const after=zoomAt(before,z,point);
  assert(Math.abs((point.x-after.x)/after.z-(point.x-before.x)/before.z)<1e-10);
  assert(Math.abs((point.y-after.y)/after.z-(point.y-before.y)/before.z)<1e-10);
  assert(after.z>=.3&&after.z<=2);
 }
});
test('explicit preference owns ordinary wheel; pinch always zooms; delta size never chooses a device',()=>{
 const before={x:10,y:20,z:1},point={x:150,y:250};
 for(const deltaY of [1,120])assert(wheelCamera(before,{deltaX:8,deltaY},'mouse',point).z<1);
 assert.deepEqual(wheelCamera(before,{deltaX:8,deltaY:120},'trackpad',point),{x:2,y:-100,z:1});
 assert(wheelCamera(before,{deltaY:-8,ctrlKey:true},'trackpad',point).z>1);
 assert.deepEqual(wheelCamera(before,{deltaX:0,deltaY:0},'mouse',point),before);
});
test('line/page wheel units and consecutive events preserve every increment',()=>{
 const point={x:50,y:80};let camera={x:0,y:0,z:1};
 for(let n=0;n<12;n++)camera=wheelCamera(camera,{deltaY:2},'trackpad',point);
 assert.equal(camera.y,-24);
 assert.equal(wheelCamera(camera,{deltaY:2,deltaMode:1},'trackpad',point).y,-56);
 assert.equal(wheelCamera(camera,{deltaY:1,deltaMode:2},'trackpad',point,600).y,-624);
});
test('pan starts only on allowed buttons and never takes Space from a text input or active editor',()=>{
 const target=selector=>({closest:query=>query.split(',').includes(selector)?{}:null});
 assert.equal(panIntent({button:2,target:target('')},true),false);
 assert.equal(panIntent({button:1,target:target('.nb-block')},false),true);
 assert.equal(panIntent({button:0,target:target('.nb-block')},false),false);
 assert.equal(panIntent({button:0,target:target('.nb-block')},true),true);
 assert.equal(panIntent({button:0,target:target('')},false),true);
 assert.equal(panIntent({button:0,target:target('textarea')},true),false);
 assert.equal(panIntent({button:1,target:target('[data-board-editing="true"]')},true),false);
 assert.equal(panIntent({button:0,target:target('[contenteditable="true"]')},true),false);
});
test('preference defaults to mouse, validates stored values and tolerates unavailable storage',()=>{
 assert.equal(BOARD_NAVIGATION_KEY,'notara-board-navigation');
 assert.equal(readNavigationPreference({getItem:()=>null}),'mouse');
 assert.equal(readNavigationPreference({getItem:()=> 'trackpad'}),'trackpad');
 assert.equal(readNavigationPreference({getItem:()=> 'invalid'}),'mouse');
 assert.equal(readNavigationPreference({getItem(){throw Error('blocked');}}),'mouse');
});
test('native inner boundary allows ordinary document scroll and prevents browser pinch zoom',()=>{
 const host=new EventTarget(),unbind=bindWheelBoundary(host);
 const scroll=new Event('wheel',{cancelable:true});host.dispatchEvent(scroll);assert.equal(scroll.defaultPrevented,false);
 const pinch=new Event('wheel',{cancelable:true});Object.defineProperty(pinch,'ctrlKey',{value:true});host.dispatchEvent(pinch);assert.equal(pinch.defaultPrevented,true);
 unbind();const released=new Event('wheel',{cancelable:true});Object.defineProperty(released,'ctrlKey',{value:true});host.dispatchEvent(released);assert.equal(released.defaultPrevented,false);
});
