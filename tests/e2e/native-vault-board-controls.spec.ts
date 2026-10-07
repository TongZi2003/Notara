import {test, expect, type Locator, type Page} from '@playwright/test';
import {startVaultIsolated} from '../../scripts/dev-isolated.ts';
import {connectVault} from '../fixtures/vault-http.ts';

const camera=(world:Locator)=>world.evaluate(element=>{const matrix=new DOMMatrix(getComputedStyle(element).transform);return {x:matrix.e,y:matrix.f,z:matrix.a};});
async function settings(page:Page) {
  await page.getByRole('button',{name:/^(Settings|设置)$/}).last().click();
  await page.getByText('学习界面',{exact:true}).first().click();
}

test('settings change the mounted board wheel mapping and compact zoom controls keep their anchors and bounds',async ({page},testInfo)=>{
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true}),client=await connectVault(runtime),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try {
    client.approvals.auto('allowed-once');
    await client.script({'__session-title':'白板操作设置','开始':{calls:[{name:'write_lesson_board',arguments:{title:'画布操作',section:'本节板书',body:'滚轮、滑条与百分比输入使用同一画布。'}}],text:'板书已准备。'}});
    await page.setViewportSize({width:2000,height:1000});await page.goto(runtime.authUrl);
    const later=page.getByRole('button',{name:/Configure later|稍后配置/});
    try {await later.waitFor({timeout:8000});await later.click();}catch {/* already acknowledged */}
    const composer=page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.fill('开始');await composer.press('Enter');await expect(page.getByText('板书已准备。').first()).toBeVisible({timeout:60_000});
    await page.getByRole('tablist',{name:'课堂视图'}).getByRole('tab',{name:'白板',exact:true}).click();
    const board=page.locator('.nb-board'),viewport=board.locator('.nb-viewport'),world=board.locator('.nb-world'),toolbar=board.getByRole('toolbar',{name:'画布控制'});
    await expect(viewport).toBeVisible();await toolbar.getByRole('button',{name:'全览',exact:true}).click();
    await expect(toolbar.locator('select')).toHaveCount(0);
    const original=await board.elementHandle();
    await settings(page);
    await expect(page.getByRole('group',{name:'鼠标滚轮映射'})).toBeVisible();
    await expect(page.getByRole('radio',{name:/^鼠标模式/})).toBeChecked();
    await page.getByRole('radio',{name:/^上下滚动/}).check();await page.keyboard.press('Escape');
    await expect(board).toHaveAttribute('data-navigation','mouse');await expect(board).toHaveAttribute('data-mouse-wheel','scroll');
    expect(await board.evaluate((element,node)=>element===node,original!)).toBe(true);
    let box=(await viewport.boundingBox())!;
    await page.mouse.move(box.x+box.width-30,box.y+box.height/2);
    const beforeScroll=await camera(world);await page.mouse.wheel(0,120);
    await expect.poll(async()=>(await camera(world)).y).toBeCloseTo(beforeScroll.y-120,1);
    expect((await camera(world)).z).toBe(beforeScroll.z);
    await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');
    await expect.poll(async()=>(await camera(world)).z).toBeGreaterThan(beforeScroll.z);
    await page.reload();await expect(board).toHaveAttribute('data-navigation','mouse');await expect(board).toHaveAttribute('data-mouse-wheel','scroll');
    await settings(page);await expect(page.getByRole('radio',{name:/^上下滚动/})).toBeChecked();
    await page.getByRole('radio',{name:/^触控板模式/}).check();await expect(page.getByRole('radio',{name:/^上下滚动/})).toBeDisabled();
    await expect(page.getByRole('radio',{name:/^上下滚动/})).toBeChecked();
    await page.keyboard.press('Escape');await expect(board).toHaveAttribute('data-navigation','trackpad');
    box=(await viewport.boundingBox())!;await page.mouse.move(box.x+box.width-30,box.y+box.height/2);
    const beforeTrackpad=await camera(world);await page.mouse.wheel(0,80);
    await expect.poll(async()=>(await camera(world)).y).toBeCloseTo(beforeTrackpad.y-80,1);expect((await camera(world)).z).toBe(beforeTrackpad.z);
    await settings(page);
    await page.getByRole('radio',{name:/^鼠标模式/}).check();await expect(page.getByRole('radio',{name:/^上下滚动/})).toBeChecked();
    await page.getByRole('radio',{name:/^放大缩小/}).check();await page.keyboard.press('Escape');
    await expect(board).toHaveAttribute('data-navigation','mouse');
    await expect(board).toHaveAttribute('data-mouse-wheel','zoom');
    const slider=toolbar.getByRole('slider',{name:'缩放滑条'}),number=toolbar.getByRole('spinbutton',{name:'缩放百分比'});
    await number.fill('100');await number.press('Enter');await expect.poll(async()=>(await camera(world)).z).toBe(1);
    box=(await viewport.boundingBox())!;const beforeSlider=await camera(world),center={x:box.width/2,y:box.height/2};
    const sliderBox=(await slider.boundingBox())!;
    await page.mouse.click(sliderBox.x+sliderBox.width*.65,sliderBox.y+sliderBox.height/2);
    const sliderPercent=Number(await slider.inputValue());expect(sliderPercent).toBeGreaterThan(100);expect(sliderPercent).toBeLessThan(190);
    await expect.poll(async()=>(await camera(world)).z).toBeCloseTo(sliderPercent/100,3);
    await expect(number).toHaveValue(String(sliderPercent));const afterSlider=await camera(world);
    expect(Math.abs((center.x-beforeSlider.x)/beforeSlider.z-(center.x-afterSlider.x)/afterSlider.z)).toBeLessThan(1);
    expect(Math.abs((center.y-beforeSlider.y)/beforeSlider.z-(center.y-afterSlider.y)/afterSlider.z)).toBeLessThan(1);
    await number.fill('175');expect((await camera(world)).z).toBe(afterSlider.z);
    await number.press('Enter');await expect.poll(async()=>(await camera(world)).z).toBe(1.75);await expect(slider).toHaveValue('175');
    await toolbar.getByRole('button',{name:'缩小',exact:true}).click();await expect(number).toHaveValue('165');
    await toolbar.getByRole('button',{name:'放大',exact:true}).click();await expect(number).toHaveValue('175');
    await number.fill('1000');await number.press('Enter');await expect(number).toHaveValue('200');await expect(toolbar.getByRole('button',{name:'放大',exact:true})).toBeDisabled();
    await number.fill('10');await number.press('Enter');await expect(number).toHaveValue('30');await expect(toolbar.getByRole('button',{name:'缩小',exact:true})).toBeDisabled();
    await number.fill('');await number.press('Enter');await expect(number).toHaveValue('30');
    await number.fill('100');await number.press('Enter');await expect.poll(async()=>(await camera(world)).z).toBe(1);
    await settings(page);await page.getByRole('radio',{name:/^手帐/}).check();
    await page.getByRole('group',{name:'白板操作',exact:true}).screenshot({path:testInfo.outputPath('board-settings-mouse-mapping.png')});
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-notara-style','notebook');
    await page.evaluate(()=>document.fonts.load('16px "Notara WenKai"'));
    const alignment=await board.locator('.nb-head').evaluate(header=>[...header.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);const text=range.getBoundingClientRect(),style=getComputedStyle(button);return {label:button.textContent,height:rect.height,center:rect.top+rect.height/2,textCenter:text.top+text.height/2,font:style.fontFamily,lineHeight:style.lineHeight};}));
    expect(new Set(alignment.map(value=>value.font)).size).toBe(1);expect(new Set(alignment.map(value=>value.lineHeight)).size).toBe(1);
    expect(alignment.every(value=>value.height===36)).toBe(true);
    expect(Math.max(...alignment.map(value=>value.center))-Math.min(...alignment.map(value=>value.center))).toBeLessThanOrEqual(1);
    expect(Math.max(...alignment.map(value=>value.textCenter))-Math.min(...alignment.map(value=>value.textCenter))).toBeLessThanOrEqual(1);
    await page.screenshot({path:testInfo.outputPath('board-controls-notebook-wide.png')});
    await toolbar.screenshot({path:testInfo.outputPath('board-zoom-toolbar.png')});
    await board.locator('.nb-head').screenshot({path:testInfo.outputPath('board-header-alignment.png')});
    await number.fill('127');
    await page.setViewportSize({width:600,height:950});await expect(toolbar).toBeHidden();
    await board.getByRole('tab',{name:'知识视图',exact:true}).click();await expect(toolbar).toBeVisible();
    await expect(slider).toHaveValue('100');await expect(number).toHaveValue('100');await number.fill('90');await number.press('Enter');await expect(slider).toHaveValue('90');
    await expect.poll(()=>board.evaluate(element=>({page:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-document.documentElement.clientWidth,board:element.scrollWidth-element.clientWidth}))).toEqual({page:0,board:0});
    for(const control of [slider,number]) {const rect=(await control.boundingBox())!,parent=(await toolbar.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(parent.x);expect(rect.x+rect.width).toBeLessThanOrEqual(parent.x+parent.width+1);}
    await page.screenshot({path:testInfo.outputPath('board-controls-notebook-narrow.png')});
    await testInfo.attach('header-alignment',{body:JSON.stringify(alignment),contentType:'application/json'});
    expect(errors).toEqual([]);
  } finally {await client.close();await runtime.stop();}
});
