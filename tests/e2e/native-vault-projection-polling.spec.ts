import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

type Snapshot = { kind: string; revision: string; unchanged?: boolean; value?: unknown };

test('unchanged projection polls stay small and real views observe external edits without stringifying full snapshots',async({page})=>{
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true});
  const client=await connectVault(runtime),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(()=>{
      const host=window as unknown as {projectionJsonCalls:number};host.projectionJsonCalls=0;
      const original=JSON.stringify;
      JSON.stringify=((...args:Parameters<typeof JSON.stringify>)=>{
        const value=args[0] as Record<string,unknown>|null;
        if(value&&typeof value==='object'&&(Array.isArray(value.blocks)||Array.isArray(value.routes)||Array.isArray(value.workers)||(Array.isArray(value.nodes)&&Array.isArray(value.edges))||Object.keys(value).some(key=>key.endsWith('.md'))))host.projectionJsonCalls++;
        return original.apply(JSON,args);
      }) as typeof JSON.stringify;
    });
    await client.script({'__session-title':'条件轮询','开始条件轮询':'条件轮询课堂已准备。'});
    await page.goto(runtime.authUrl);
    const later=page.getByRole('button',{name:/Configure later|稍后配置/});
    try{await later.waitFor({timeout:8000});await later.click();}catch{/* test route already acknowledged */}
    const composer=page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.fill('开始条件轮询');await composer.press('Enter');
    await expect(page.getByText('条件轮询课堂已准备。',{exact:true}).last()).toBeVisible({timeout:60_000});
    const sessionId=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('notara-vault-view')??'null')?.sessionId as string);
    expect(sessionId).toBeTruthy();
    for(const method of ['board','routes','classroom','graph','learningStars']){
      const first=client.value(await client.rpc<Snapshot>(`notaraVault/${method}`,{input:{sessionId,projectionRevision:null}}));
      expect(first.kind).toBe('notara-projection');expect(first).toHaveProperty('value');
      const next=client.value(await client.rpc<Snapshot>(`notaraVault/${method}`,{input:{sessionId,projectionRevision:first.revision}}));
      expect(next.unchanged,method).toBe(true);expect(next).not.toHaveProperty('value');
      expect(Buffer.byteLength(JSON.stringify(next)),method).toBeLessThan(150);
    }
    const tabs=page.getByRole('tablist',{name:'课堂视图'});
    for(const name of ['白板','教室']){
      await tabs.getByRole('tab',{name,exact:true}).click();
      await expect(name==='白板'?page.locator('.nb-board'):page.getByRole('region',{name:'教室区域',exact:true})).toBeVisible();
      await page.waitForTimeout(500);
      const before=await page.evaluate(()=>(window as unknown as {projectionJsonCalls:number}).projectionJsonCalls);
      for(let repeat=0;repeat<3;repeat++){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(400);}
      if(name==='白板')await page.waitForTimeout(5200); // two real 2.5 s timer ticks
      expect(await page.evaluate(()=>(window as unknown as {projectionJsonCalls:number}).projectionJsonCalls)).toBe(before);
    }
    await page.getByRole('navigation',{name:'学习导航'}).getByRole('button',{name:'Vault',exact:true}).click();
    const vaultTabs=page.getByRole('tablist',{name:'Vault 视图'});
    await vaultTabs.getByRole('tab',{name:'卡片',exact:true}).click();
    const cards=join(runtime.root,'workspace/vault/卡片');await mkdir(cards,{recursive:true});
    await writeFile(join(cards,'条件轮询卡.md'),'---\ntype: card\n---\n# 条件轮询卡\n');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button',{name:'打开卡片 条件轮询卡',exact:true})).toBeVisible();
    await vaultTabs.getByRole('tab',{name:'图谱',exact:true}).click();
    await expect(page.getByRole('button',{name:'图谱节点 条件轮询卡',exact:true})).toBeVisible();
    await writeFile(join(cards,'条件轮询卡.md'),'---\ntype: card\n---\n# 条件轮询新\n');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button',{name:'图谱节点 条件轮询新',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'图谱节点 条件轮询卡',exact:true})).toHaveCount(0);
    const before=await page.evaluate(()=>(window as unknown as {projectionJsonCalls:number}).projectionJsonCalls);
    for(let repeat=0;repeat<3;repeat++){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(400);}
    expect(await page.evaluate(()=>(window as unknown as {projectionJsonCalls:number}).projectionJsonCalls)).toBe(before);
    expect(errors).toEqual([]);
  }finally{await client.close();await runtime.stop();}
});
