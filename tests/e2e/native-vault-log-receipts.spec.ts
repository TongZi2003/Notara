import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {startVaultIsolated} from '../../scripts/dev-isolated.ts';

test('late lesson logs cannot replace newer logs, and failed deletion recovery gives a visible restart instruction',async({page})=>{
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true}),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try{
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const bundle=await build({absWorkingDir:root,bundle:true,write:false,format:'iife',stdin:{resolveDir:root,contents:`
      import React from'react';import{createRoot}from'react-dom/client';
      import{createVaultRoutes}from'./examples/native-vault/routes-client.js';
      import{createSessionDeletionUI}from'./examples/native-vault/session-deletion-client.js';
      const h=React.createElement,root=createRoot(document.getElementById('root')),pending=[];
      const Dialog=({title,children})=>h('section',{role:'dialog','aria-label':title},children);
      const IconButton=({label,onClick})=>h('button',{onClick},label);
      const Routes=createVaultRoutes(React,{STYLE:{},IconButton,Dialog,EmptyState:()=>h('div',null,'empty')});
      const ctx={remote:{notaraVault:{routes:async()=>({ok:true,value:{routes:[],nodes:[],edges:[]}}),lessonLog:()=>new Promise(resolve=>pending.push(resolve)),learningStars:async()=>({ok:true,value:{stars:[],edges:[]}})}}};
      let rollback=false;
      const {DeleteSessionDialog}=createSessionDeletionUI(React,{Dialog,IconButton});
      const deletionCtx={remote:{notaraSession:{previewDeletion:async()=>rollback?{ok:false,error:{message:'session_delete_rollback_failed'}}:{ok:true,value:{title:'recovery lesson',linkedSessions:[],token:'test'}},deleteConversation:async()=>{rollback=true;return{ok:false,error:{message:'session_delete_rollback_failed'}};}}}};
      window.harness={count:()=>pending.length,resolve:(index,title)=>pending[index]({ok:true,value:{total:1,hits:[{title,path:'log.md',sessionId:'lesson',anchor:'summary',date:'2026-10-06'}]}}),deletion:()=>root.render(h(DeleteSessionDialog,{ctx:deletionCtx,session:{id:'lesson'},onClose:()=>{},onDeleted:()=>{throw Error('failed deletion cannot be reported successful');}}))};
      root.render(h(Routes,{ctx,sessionId:'lesson',visible:true,openView:()=>{}}));
    `}});
    await page.route('**/log-receipt-harness',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto(new URL('/log-receipt-harness',runtime.authUrl).href);
    await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {harness:{count():number}}).harness.count())).toBeGreaterThanOrEqual(1);
    await page.evaluate(()=>window.dispatchEvent(new Event('notara-vault-changed')));
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {harness:{count():number}}).harness.count())).toBeGreaterThanOrEqual(2);
    await page.evaluate(()=>(window as unknown as {harness:{resolve(index:number,title:string):void}}).harness.resolve(1,'newest lesson'));
    await page.getByText('课堂日志 · 1 次课堂',{exact:true}).click();
    await expect(page.getByRole('button',{name:'newest lesson',exact:true})).toBeVisible();
    await page.evaluate(()=>(window as unknown as {harness:{resolve(index:number,title:string):void}}).harness.resolve(0,'stale lesson'));
    await expect(page.getByRole('button',{name:'newest lesson',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'stale lesson',exact:true})).toHaveCount(0);
    await page.evaluate(()=>(window as unknown as {harness:{deletion():void}}).harness.deletion());
    await page.getByLabel('输入课堂名称以确认删除').fill('recovery lesson');
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'永久删除',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('请重启 Notara 尝试恢复');
    await expect(page.getByRole('button',{name:'永久删除',exact:true})).toBeDisabled();
    expect(errors).toEqual([]);
  }finally{await runtime.stop();}
});
