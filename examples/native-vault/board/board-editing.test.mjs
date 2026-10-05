import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScene,persistentEditorScene,teacherRequest,createBoardDraft,sourceTarget,sourceRefForRead} from './board-editing.js';
import {validateBoardScene} from '../board-scene.js';
import {changeParent,branchIds,layoutBranch,reconcileMindmap} from './mindmap-operations.js';

test('actual Electron structured clone of an editor scene omits transient undefined customData before strict Host validation',()=>{
 const element={id:'electron-box',type:'rectangle',x:100,y:120,width:160,height:100,roundness:{type:3,value:undefined},customData:undefined};
 const raw={version:1,elements:[element],appState:{viewBackgroundColor:'#ffffff'},files:{}};
 assert.throws(()=>validateBoardScene(structuredClone(raw)),/board_scene_invalid/);
 const stored=persistentEditorScene(raw);assert.equal(Object.hasOwn(stored.elements[0],'customData'),false);assert.equal(Object.hasOwn(stored.elements[0].roundness,'value'),false);
 assert.equal(validateBoardScene(structuredClone(stored)).elements[0].width,160);assert.equal(Object.hasOwn(raw.elements[0],'customData'),true);
 const tagged={...raw,elements:[{...element,customData:{notaraMindmapNode:{parentId:null},arbitrary:()=>{}}}]};
 assert.equal(validateBoardScene(structuredClone(persistentEditorScene(tagged))).elements[0].id,'electron-box');
});

test('scene limits count UTF-8 bytes, accept raster files and bound total transfer',()=>{
 assert.equal(validateScene({version:1,elements:[],appState:{},files:{}}).version,1);
 assert.throws(()=>validateScene({version:1,elements:Array.from({length:501},()=>({type:'rectangle'})),files:{}}),/500/);
 assert.throws(()=>validateScene({version:1,elements:[{type:'text',text:'字'.repeat(400000)}],files:{}}),/1 MiB/);
 const file={id:'png',mimeType:'image/png',dataURL:'data:image/png;base64,iVBORw0KGgo=',created:1};
 assert.equal(validateScene({version:1,elements:[{id:'image',type:'image',fileId:'png'}],files:{png:file}}).files.png.mimeType,'image/png');
 assert.throws(()=>validateScene({version:1,elements:[],files:{png:{...file,dataURL:'data:image/svg+xml;base64,AA=='}}}),/图片/);
 assert.throws(()=>validateScene({version:1,elements:[],files:{png:{...file,dataURL:'data:image/png;base64,'+'A'.repeat(1_800_000)}}}),/图片资料卡/);
 assert.throws(()=>validateScene({version:2,elements:[],files:{}}),/版本/);
});
test('teacher request references stable selected objects, never embeds scene or sends a turn',()=>{
 const request=teacherRequest({id:'internal-block-1',title:'我的尝试'},['internal-element-1','internal-element-2'],'补两个反例');
 assert.equal(request.reference.blockId,'internal-block-1');assert.deepEqual(request.reference.elementIds,['internal-element-1','internal-element-2']);assert.match(request.text,/补两个反例/);assert.doesNotMatch(request.text,/internal-|data:|elements|files|blockId/);
});
test('draft preserves edits arriving during save and uses original revision until acknowledged',()=>{
 const draft=createBoardDraft({blockId:'b',revision:'r1',title:'原文',body:''});draft.edit({body:'第一版'});
 const flight=draft.capture();draft.edit({body:'第二版'});draft.acknowledge(flight,'r2');
 assert.equal(draft.value.body,'第二版');assert.equal(draft.dirty,true);assert.equal(draft.capture().revision,'r2');
 draft.acknowledge(draft.capture(),'r3');assert.equal(draft.dirty,false);
});
test('source reference targets use existing same-collection reader and PDF locator',()=>{
 const ref='vault:'+Buffer.from(JSON.stringify({workspaceId:'w',path:'资料/书.pdf',revision:'a'.repeat(24),locator:{kind:'pdf-page',page:3}})).toString('base64url');
 assert.deepEqual(sourceTarget(ref),{workspaceId:'w',path:'资料/书.pdf',revision:'a'.repeat(24),locator:{kind:'pdf-page',page:3}});
 assert.throws(()=>sourceTarget('https://example.org'),/资料引用/);
 const receipt={path:'资料/书.pdf',revision:'a'.repeat(24)};
 assert.equal(sourceTarget(sourceRefForRead(receipt,'w')).workspaceId,'w');
 assert.throws(()=>sourceRefForRead({...receipt,ref},'other'),/可用引用/);
});
const tree={nodes:[{elementId:'a',parentId:null},{elementId:'b',parentId:'a'},{elementId:'c',parentId:'b'},{elementId:'d',parentId:null}],links:[],notes:[]};
test('mindmap rejects cycles, moves only selected branch and filters dangling relations',()=>{
 assert.throws(()=>changeParent(tree,'a','c'),/成环/);
 assert.deepEqual(branchIds(tree,'b'),['b','c']);
 assert.equal(changeParent(tree,'b','d').nodes.find(n=>n.elementId==='b').parentId,'d');
 const elements=tree.nodes.map((n,i)=>({id:n.elementId,x:i*90,y:i*30,width:80,height:40}));
 const changed=layoutBranch(elements,tree,'b');assert.deepEqual(changed.find(e=>e.id==='a'),elements[0]);assert.deepEqual(changed.find(e=>e.id==='d'),elements[3]);
 const repaired=reconcileMindmap({...tree,links:[{from:'a',to:'c',label:''}],notes:[{elementId:'c',text:'注'}]},elements.filter(e=>e.id!=='c'));
 assert.equal(repaired.nodes.length,3);assert.equal(repaired.links.length,0);assert.equal(repaired.notes.length,0);
});
