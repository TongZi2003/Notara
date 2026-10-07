import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {startVaultIsolated} from '../../scripts/dev-isolated.ts';

// Mount the actual client components in Chromium with a controllable pending
// delivery. The ordinary board e2e suite covers their Host integration.
test('frames keep navigation during a late receipt, reset on replacement, and reject old answer draft shapes',async({page})=>{
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true}),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try{
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const bundle=await build({absWorkingDir:root,bundle:true,write:false,format:'iife',stdin:{resolveDir:root,contents:`
      import React from 'react';import{createRoot}from'react-dom/client';
      import{createBoardFrames}from'./examples/native-vault/board-frames-client.js';
      import{createBoardAnswers}from'./examples/native-vault/board-answer-client.js';
      const h=React.createElement,root=createRoot(document.getElementById('root'));
      const Frames=createBoardFrames(React,{renderMarkdown:text=>text});
      const Answer=createBoardAnswers(React,{renderInline:text=>text});
      let finish,identity='initial',frames=[{body:'one'},{body:'two'},{body:'three',predict:true}];
      function showFrames(){root.render(h(Frames,{component:{type:'frames',fingerprint:identity,spec:{frames}},block:{answers:[]},live:true,onSubmit:()=>new Promise(resolve=>finish=resolve)}));}
      function damaged(type){const key='damaged-'+type,spec=type==='choice'?{stem:'Pick safely',options:['left','right'],multiple:true}:{items:['first','second']};localStorage.setItem(key,JSON.stringify(type==='choice'?{pick:[999],reason:'',exit:null,note:''}:{order:[999,1],exit:null,note:''}));root.render(h(Answer,{key,type,component:{type,index:0,fingerprint:type,spec},answers:[],live:true,draftKey:key,onSubmit:async value=>{window.lastAnswer=value;return{sent:true};}}));}
      window.harness={receipt:()=>finish({sent:true}),replace:()=>{identity='replacement';frames=[{body:'replacement'}];showFrames();},damaged,answer:()=>{localStorage.setItem('shape-regression',JSON.stringify({answer:'old version'}));root.render(h(Answer,{component:{type:'blank',index:0,fingerprint:'blank',spec:{blanks:['x'],lines:['Fill {{x}}']}},answers:[],live:true,draftKey:'shape-regression',onSubmit:async()=>({sent:true})}));}};
      showFrames();
    `}});
    await page.route('**/client-regression-harness',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto(new URL('/client-regression-harness',runtime.authUrl).href);
    await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    await page.getByRole('button',{name:'下一帧',exact:true}).click();
    await expect(page.locator('.nb-frames-caption')).toHaveText('第 2/3 帧');
    await page.getByRole('textbox').fill('pending prediction');
    await page.getByRole('button',{name:'交给老师',exact:true}).click();
    await page.getByRole('button',{name:'上一帧',exact:true}).click();
    await page.evaluate(()=>{(window as unknown as {harness:{receipt():void}}).harness.receipt();});
    await expect(page.locator('.nb-frames-caption')).toHaveText('第 1/3 帧');
    await page.getByRole('button',{name:'下一帧',exact:true}).click();
    await page.getByRole('button',{name:'直接看',exact:true}).click();
    await page.evaluate(()=>{(window as unknown as {harness:{receipt():void}}).harness.receipt();});
    await expect(page.locator('.nb-frames-caption')).toHaveText('第 3/3 帧');
    await page.evaluate(()=>{(window as unknown as {harness:{replace():void}}).harness.replace();});
    await expect(page.locator('.nb-frames-caption')).toHaveText('第 1/1 帧');
    await expect(page.locator('.nb-frames-stage')).toContainText('replacement');
    await page.evaluate(()=>{(window as unknown as {harness:{damaged(type:string):void}}).harness.damaged('choice');});
    await expect(page.getByRole('checkbox',{name:/left/})).toHaveAttribute('aria-checked','false');
    await page.getByRole('checkbox',{name:/right/}).click();
    await page.getByRole('button',{name:'交给老师',exact:true}).click();
    await expect(page.locator('[role=status]')).toContainText('已交给老师');
    expect(await page.evaluate(()=>(window as unknown as {lastAnswer:unknown}).lastAnswer)).toEqual({pick:[1]});
    await page.evaluate(()=>{(window as unknown as {harness:{damaged(type:string):void}}).harness.damaged('order');});
    await expect(page.locator('.nb-q-order > li').first()).toContainText('first');
    await page.getByRole('button',{name:'上移“second”',exact:true}).click();
    await page.getByRole('button',{name:'交给老师',exact:true}).click();
    await expect(page.locator('[role=status]')).toContainText('已交给老师');
    expect(await page.evaluate(()=>(window as unknown as {lastAnswer:unknown}).lastAnswer)).toEqual({order:[1,0]});
    await page.evaluate(()=>{(window as unknown as {harness:{answer():void}}).harness.answer();});
    await expect(page.getByRole('textbox',{name:'第1空：x'})).toHaveValue('');
    await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('quota','QuotaExceededError');};});
    await page.getByRole('textbox',{name:'第1空：x'}).fill('new answer');
    await expect(page.locator('[role=status]')).toContainText('浏览器未能保存草稿');
    await expect(page.getByRole('textbox',{name:'第1空：x'})).toHaveValue('new answer');
    await page.getByRole('button',{name:'交给老师',exact:true}).click();
    await expect(page.locator('[role=status]')).toContainText('已交给老师');
    expect(errors).toEqual([]);
  }finally{await runtime.stop();}
});

test('pixel iframe requests a fresh snapshot after losing its parent connection',async({page})=>{
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true}),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try{
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const bundle=await build({absWorkingDir:root,bundle:true,write:false,format:'iife',stdin:{resolveDir:root,contents:`
      import React from 'react';import{createRoot}from'react-dom/client';
      import{useLiveClassroom}from'./examples/pixel-classroom/src/live-classroom.tsx';
      function App(){const{connected}=useLiveClassroom();return React.createElement('output',null,connected?'connected':'disconnected');}
      createRoot(document.getElementById('root')).render(React.createElement(App));
    `}});
    await page.clock.install();
    await page.route('**/pixel-reconnect-harness',route=>route.fulfill({contentType:'text/html',body:`<script>window.readyCount=0;window.addEventListener('message',event=>{if(event.data?.type==='notara:classroom-ready'&&event.data.channel==='reconnect')window.readyCount++;});</script><iframe src="/pixel-harness?mode=live&channel=reconnect"></iframe>`}));
    await page.route('**/pixel-harness?*',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto(new URL('/pixel-reconnect-harness',runtime.authUrl).href);
    const iframe=page.frameLocator('iframe');
    await expect(iframe.locator('#root')).toBeAttached();
    const child=page.frames().find(frame=>frame.url().includes('/pixel-harness?'))!;
    await child.addScriptTag({content:bundle.outputFiles[0]!.text});
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {readyCount:number}).readyCount)).toBe(1);
    await page.clock.fastForward(10_000);
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {readyCount:number}).readyCount)).toBeGreaterThan(1);
    const snapshot=()=>page.evaluate(()=>{document.querySelector('iframe')!.contentWindow!.postMessage({type:'notara:classroom-state',channel:'reconnect',snapshot:{version:1,tasks:[],workers:[]}},location.origin);});
    await snapshot();await expect(iframe.locator('output')).toHaveText('connected');
    const before=await page.evaluate(()=>(window as unknown as {readyCount:number}).readyCount);
    await page.clock.fastForward(12_000);
    await expect(iframe.locator('output')).toHaveText('disconnected');
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {readyCount:number}).readyCount)).toBeGreaterThan(before);
    await snapshot();await expect(iframe.locator('output')).toHaveText('connected');
    expect(errors).toEqual([]);
  }finally{await runtime.stop();}
});
