import {test, expect, type Page, type Locator} from '@playwright/test';
import {startVaultIsolated} from '../../scripts/dev-isolated.ts';
import {connectVault} from '../fixtures/vault-http.ts';

const camera = (world: Locator) => world.evaluate(element => {
  const matrix=new DOMMatrix(getComputedStyle(element).transform);
  return {x:matrix.e,y:matrix.f,z:matrix.a};
});
const views = (page: Page) => page.getByRole('tablist',{name:'课堂视图'});

test('board wheel anchors zoom, pan preserves inputs, and swapping preserves the mounted views', async ({page}) => {
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true}),client=await connectVault(runtime),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try{
    client.approvals.auto('allowed-once');
    await client.script({'__session-title':'白板手势与分屏','开始':{calls:[{name:'write_lesson_board',arguments:{title:'定位与缩放',section:'一节课',body:'鼠标缩放保留锚点。\n\n$$x^2+y^2=1$$'}}],text:'测试板书已完成。'}});
    await page.setViewportSize({width:2200,height:1080});
    await page.goto(runtime.authUrl);
    const later=page.getByRole('button',{name:/Configure later|稍后配置/});
    try{await later.waitFor({timeout:8000});await later.click();}catch{/* already acknowledged */}
    const input=page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('开始');await input.press('Enter');
    await expect(page.getByText('测试板书已完成。').first()).toBeVisible({timeout:60_000});
    await views(page).getByRole('tab',{name:'白板',exact:true}).click();
    const canvas=page.locator('.nb-viewport'),world=page.locator('.nb-world'),panes=page.locator('.nv-panes');
    await expect(canvas).toBeVisible();
    await expect(page.locator('.nb-block')).toHaveCount(1);
    const separator=page.getByRole('separator',{name:'调整资料面板宽度'}),swap=page.getByRole('button',{name:'调换窗格'});
    await expect(swap).toBeVisible();
    // Equal seats keep both board widths above its reading-mode threshold.
    const area=(await panes.boundingBox())!,divider=(await separator.boundingBox())!;
    await page.mouse.move(divider.x+divider.width/2,divider.y+100);await page.mouse.down();
    await page.mouse.move(area.x+area.width/2,divider.y+100);await page.mouse.up();
    await page.locator('.nb-toolbar').getByRole('button',{name:'全览',exact:true}).click();
    const box=(await canvas.boundingBox())!,anchor={x:box.x+box.width-30,y:box.y+box.height/2};
    await page.mouse.move(anchor.x,anchor.y);
    const before=await camera(world);
    await page.mouse.wheel(0,-120);
    await expect.poll(async()=> (await camera(world)).z).toBeGreaterThan(before.z);
    const zoomed=await camera(world),local={x:anchor.x-box.x,y:anchor.y-box.y};
    // Pointer coordinates are rounded to physical pixels by Chromium.
    expect(Math.abs((local.x-before.x)/before.z-(local.x-zoomed.x)/zoomed.z)).toBeLessThan(1/before.z);
    expect(Math.abs((local.y-before.y)/before.z-(local.y-zoomed.y)/zoomed.z)).toBeLessThan(1/before.z);
    expect(zoomed.z).toBeLessThanOrEqual(2);
    await page.mouse.wheel(0,10000);
    await expect.poll(async()=> (await camera(world)).z).toBeCloseTo(.3,4);
    await page.mouse.wheel(0,-10000);
    await expect.poll(async()=> (await camera(world)).z).toBeCloseTo(2,4);

    await canvas.focus();await page.keyboard.down('Space');
    const panBefore=await camera(world);
    await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();
    await page.mouse.move(anchor.x-80,anchor.y+35,{steps:4});await page.mouse.up();await page.keyboard.up('Space');
    await expect.poll(async()=> (await camera(world)).x).toBeCloseTo(panBefore.x-80,1);
    expect((await camera(world)).z).toBe(panBefore.z);
    const middleBefore=await camera(world);
    await page.mouse.move(anchor.x,anchor.y);await page.mouse.down({button:'middle'});
    await page.mouse.move(anchor.x-25,anchor.y-20,{steps:3});await page.mouse.up({button:'middle'});
    await expect.poll(async()=> (await camera(world)).y).toBeCloseTo(middleBefore.y-20,1);

    await input.fill('未发送的草稿');await input.press('End');await input.press('Space');await input.press('x');
    await expect(input).toHaveText('未发送的草稿 x');
    const inputNode=await input.elementHandle(),boardNode=await canvas.elementHandle(),heldCamera=await camera(world);
    const ratio=await separator.getAttribute('aria-valuenow');
    await swap.click();
    await expect(page.locator('section[aria-label="白板区域"]')).toHaveAttribute('data-nv-side','right');
    await expect(page.locator('section[aria-label="对话区域"]')).toHaveAttribute('data-nv-side','left');
    await expect(input).toHaveText('未发送的草稿 x');
    await expect(page.locator('[data-composer-input][contenteditable="true"]')).toHaveCount(1);
    expect(await input.evaluate((element,original)=>element===original,inputNode!)).toBe(true);
    expect(await canvas.evaluate((element,original)=>element===original,boardNode!)).toBe(true);
    expect(await camera(world)).toEqual(heldCamera);
    await expect(separator).toHaveAttribute('aria-valuenow',ratio!);
    const swapBox=(await swap.boundingBox())!,splitBox=(await separator.boundingBox())!;
    expect(Math.abs(swapBox.x+swapBox.width/2-(splitBox.x+splitBox.width/2))).toBeLessThan(2);
    await separator.focus();await separator.press('ArrowLeft');
    const movedSwap=(await swap.boundingBox())!;
    expect(movedSwap.x).toBeLessThan(swapBox.x);

    // Narrow board keeps its existing single-face navigation, then returns to
    // the same swapped seats; no extra conversation is constructed.
    await page.setViewportSize({width:730,height:1000});
    await expect(swap).toBeHidden();
    await views(page).getByRole('tab',{name:'对话',exact:true}).click();
    await expect(input).toBeVisible();await expect(input).toHaveText('未发送的草稿 x');
    await page.setViewportSize({width:2200,height:1080});
    await expect(swap).toBeVisible();
    await page.reload();
    await expect(page.locator('section[aria-label="白板区域"]')).toHaveAttribute('data-nv-side','right');
    await expect(swap).toHaveAttribute('aria-pressed','true');
    await expect(page.getByText('测试板书已完成。').first()).toBeVisible();
  }finally{await client.close();await runtime.stop();}
  expect(errors.filter(text=>!/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});

test('narrow conversation and file split swaps vertically and resizes on its visible axis', async ({page}) => {
  test.setTimeout(120_000);
  const runtime=await startVaultIsolated({testModel:true}),client=await connectVault(runtime);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try{
    await page.setViewportSize({width:650,height:1000});await page.goto(runtime.authUrl);
    const later=page.getByRole('button',{name:/Configure later|稍后配置/});
    try{await later.waitFor({timeout:8000});await later.click();}catch{/* already acknowledged */}
    const input=page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('打开一个课堂');await input.press('Enter');
    await expect(views(page)).toBeVisible({timeout:30_000});
    await page.getByRole('button',{name:'打开资料面板',exact:true}).click();
    const separator=page.getByRole('separator',{name:'调整窗格高度'}),swap=page.getByRole('button',{name:'调换窗格'});
    await expect(separator).toHaveAttribute('aria-orientation','horizontal');
    await expect(page.locator('.nv-panes')).toHaveAttribute('data-nv-axis','stacked');
    const chat=page.locator('section[aria-label="对话区域"]'),files=page.locator('section[aria-label="文件区域"]');
    const before=(await chat.boundingBox())!,fileBefore=(await files.boundingBox())!;
    expect(before.y).toBeLessThan(fileBefore.y);
    await input.fill('保持这份草稿');await swap.click();
    const after=(await chat.boundingBox())!,fileAfter=(await files.boundingBox())!;
    expect(after.y).toBeGreaterThan(fileAfter.y);
    await expect(input).toHaveText('保持这份草稿');
    const value=Number(await separator.getAttribute('aria-valuenow'));
    await separator.focus();await separator.press('ArrowUp');
    await expect(separator).toHaveAttribute('aria-valuenow',String(value-5));
    const current=(await separator.boundingBox())!,swapBox=(await swap.boundingBox())!;
    expect(Math.abs(swapBox.y+swapBox.height/2-(current.y+current.height/2))).toBeLessThan(2);
  }finally{await client.close();await runtime.stop();}
  expect(errors.filter(text=>!/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
