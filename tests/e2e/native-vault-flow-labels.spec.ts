import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

const cases = [
  {title:'粗提取流程',source:'direction right\nA[取材与破碎细胞] -- 加入预冷缓冲液后充分研磨并过滤 --> B[溶解与去除杂质]\nB -- 去除蛋白质及残余杂质并离心取上清 --> C[析出粗提取物]\nC -- 加入预冷乙醇并静置后收集析出物 --> D[鉴定]\nD -- 与标准样品对照后确认鉴定结果 --> E[完成]'},
  {title:'竖向流程',source:'direction down\nA[甲] -- 使用预冷缓冲液研磨样本并离心过滤 --> B[乙]'},
  {title:'分支流程',source:'direction right\nA[起点] -- 使用预冷缓冲液研磨样本并离心过滤 --> B[中间一]\nA -- 经过第二次充分研磨过滤取上清液 --> C[中间二]\nB -- 左支路验证所得结果后再汇总 --> D[终点]\nC -- 右支路验证所得结果后再汇总 --> D'},
  {title:'回环与数学文本',source:'direction down\nA[溶液] -- 加入 $NaCl$ 与 $\\nu=1$ --> B[产物]\nB -. 验证不通过时回到起点重新取样 .-> A'},
];

async function textCollisions(page:Page) {
  return page.locator('svg.nb-flow').evaluateAll((diagrams:any[]) => {
    const failures:string[]=[];
    const intersects=(a:any,b:any)=>a.x < b.x+b.width-.2 && a.x+a.width > b.x+.2 && a.y < b.y+b.height-.2 && a.y+a.height > b.y+.2;
    const inside=(a:any,b:any)=>a.x >= b.x-.2 && a.y >= b.y-.2 && a.x+a.width <= b.x+b.width+.2 && a.y+a.height <= b.y+b.height+.2;
    for(const [i,svg] of diagrams.entries()) {
      const nodes=[...svg.querySelectorAll('.nb-flow-node')].map((node:any)=>node.getBBox());
      const labels=[...svg.querySelectorAll('.nb-flow-label')].map((node:any)=>({node,text:node.textContent,box:node.getBBox()}));
      for(const label of labels) {
        if(nodes.some(node=>intersects(label.box,node))) failures.push(`${i}: label overlaps node: ${label.text}`);
        if(!inside(label.box,svg.viewBox.baseVal)) failures.push(`${i}: label leaves viewBox: ${label.text}`);
        for(const other of labels) if(label!==other && intersects(label.box,other.box)) failures.push(`${i}: labels overlap: ${label.text}`);
      }
      for(const rect of svg.querySelectorAll('.nb-flow-label-bg')) {
        const label=rect.nextElementSibling;
        if(label?.classList.contains('nb-flow-label') && !inside(label.getBBox(),rect.getBBox())) failures.push(`${i}: text exceeds reserved label area: ${label.textContent}`);
      }
    }
    return failures;
  });
}

test('long flow labels remain complete, clear of nodes and inside the canvas in the board and HTML export',async({page},testInfo)=>{
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true});
  const client=await connectVault(runtime), errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  try {
    client.approvals.auto('allowed-once');
    await client.script({'画提取流程':{calls:cases.map(item=>({name:'write_lesson_board',arguments:{title:item.title,section:'流程标签',size:'wide',body:`\`\`\`flow\n${item.source}\n\`\`\``}})),text:'流程图已经放在白板。'}});
    await page.setViewportSize({width:1500,height:1000});
    await page.goto(runtime.authUrl);
    const later=page.getByRole('button',{name:/Configure later|稍后配置/});
    try {await later.waitFor({timeout:8000});await later.click();} catch {/* configured synthetic provider */}
    const input=page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('画提取流程');await input.press('Enter');
    await expect(page.getByText('流程图已经放在白板。').first()).toBeVisible({timeout:30_000});
    await page.getByRole('tablist',{name:'课堂视图'}).getByRole('tab',{name:'白板',exact:true}).click();
    await expect(page.locator('.nb-board svg.nb-flow')).toHaveCount(cases.length);
    expect(await textCollisions(page)).toEqual([]);
    for(const item of cases) {
      const block=page.locator('.nb-board .nb-block',{hasText:item.title});
      const labelTexts=await block.locator('.nb-flow-label').allTextContents();
      const expected=item.source.split('\n').flatMap(row=>[...row.matchAll(/(?:--\s+(.+?)\s+-->|-\.\s+(.+?)\s+\.->)/g)].map(match=>match[1]??match[2]));
      expect(labelTexts).toEqual(expected);
    }
    await page.screenshot({path:testInfo.outputPath('flow-labels-board.png')});

    await page.locator('.nb-board').getByRole('button',{name:'导出',exact:true}).click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('dialog').getByRole('button',{name:'HTML',exact:true}).click()]);
    const html=await readFile((await download.path())!,'utf8');
    const exported=await page.context().newPage();
    try {
      await exported.setContent(html);
      await expect(exported.locator('svg.nb-flow')).toHaveCount(cases.length);
      expect(await textCollisions(exported)).toEqual([]);
      const count=cases.reduce((sum,item)=>sum+(item.source.match(/(?:--\s+.+?\s+-->|-\.\s+.+?\s+\.->)/g)??[]).length,0);
      await expect(exported.locator('.nb-flow-label')).toHaveCount(count);
      await expect(exported.locator('.nb-flow-label').filter({hasText:'$\\nu=1$'})).toHaveCount(1);
    } finally {await exported.close();}
  } finally {
    await testInfo.attach('page-errors',{body:JSON.stringify(errors),contentType:'application/json'});
    await page.close();
    await client.close();await runtime.stop();
  }
  expect(errors).toEqual([]);
});
