import {test, expect} from '@playwright/test';
import {startVaultIsolated} from '../../scripts/dev-isolated.ts';
import {connectVault} from '../fixtures/vault-http.ts';

test('a whiteboard source opens in the companion pane after swapping and survives a reload', async ({page}) => {
  test.setTimeout(180_000);
  const runtime=await startVaultIsolated({testModel:true}),client=await connectVault(runtime),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try {
    client.approvals.auto('allowed-once');
    await client.writeVaultFile('引用资料.md','# 分屏引用资料\n\n资料原文仍保持不变。\n');
    await client.script({'__session-title':'白板资料分屏','开始':{calls:[{name:'write_lesson_board',arguments:{title:'资料引用',section:'一节课',body:'先读资料，再回到板书。'}}],text:'资料板书已经准备好。'}});
    await page.setViewportSize({width:1800,height:1000});
    await page.goto(runtime.authUrl);
    const later=page.getByRole('button',{name:/Configure later|稍后配置/});
    try{await later.waitFor({timeout:8000});await later.click();}catch{/* already acknowledged */}
    const composer=page.locator('[data-composer-input][contenteditable="true"]').last();
    await expect(composer).toBeVisible({timeout:30_000});
    await composer.fill('开始');await composer.press('Enter');
    await expect(page.getByText('资料板书已经准备好。').first()).toBeVisible({timeout:60_000});
    await page.getByRole('tablist',{name:'课堂视图'}).getByRole('tab',{name:'白板',exact:true}).click();
    const board=page.locator('.nb-board');
    await expect(board.locator('.nb-block')).toHaveCount(1);

    await board.getByRole('button',{name:'新增',exact:true}).click();
    const create=page.getByRole('dialog',{name:'新增白板块'});
    await create.getByLabel('内容类型').selectOption('source');
    await create.getByLabel('新块标题').fill('引用资料');
    await expect(create.getByLabel('本集资料').locator('option[value="引用资料.md"]')).toHaveCount(1);
    await create.getByLabel('本集资料').selectOption('引用资料.md');
    await create.getByRole('button',{name:'创建并编辑'}).click();
    const source=board.locator('.nb-block[data-content-type="source"]');
    await expect(source).toBeVisible({timeout:30_000});
    await expect(page.getByRole('button',{name:'调换窗格'})).toBeVisible();

    await composer.fill('保留这份未发送的草稿');
    const composerNode=await composer.elementHandle(),boardNode=await board.elementHandle();
    const swap=page.getByRole('button',{name:'调换窗格'});
    await swap.click();
    const boardPane=page.locator('section[aria-label="白板区域"]');
    await expect(boardPane).toHaveAttribute('data-nv-side','right');
    await expect(page.locator('[data-composer-input][contenteditable="true"]')).toHaveCount(1);
    expect(await board.evaluate((element,original)=>element===original,boardNode!)).toBe(true);
    expect(await composer.evaluate((element,original)=>element===original,composerNode!)).toBe(true);
    await expect(composer).toHaveText('保留这份未发送的草稿');

    await source.getByRole('button',{name:'打开资料',exact:true}).click();
    const files=page.locator('section[aria-label="文件区域"]');
    await expect(files).toHaveAttribute('data-nv-side','left');
    await expect(files.locator('.nv-document article')).toContainText('资料原文仍保持不变。',{timeout:30_000});
    await expect(board).toBeVisible();
    await expect(boardPane).toHaveAttribute('data-nv-side','right');

    // Closing and reopening the companion seat restores the swapped board and file.
    await page.getByRole('button',{name:'收起资料面板',exact:true}).click();
    await expect(boardPane).toBeVisible();
    await page.getByRole('button',{name:'打开资料面板',exact:true}).click();
    await expect(files).toHaveAttribute('data-nv-side','left');
    await expect(files.locator('.nv-document article')).toContainText('资料原文仍保持不变。');
    await page.reload();
    await expect(page.locator('section[aria-label="白板区域"]')).toHaveAttribute('data-nv-side','right');
    await expect(page.getByRole('button',{name:'调换窗格'})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('section[aria-label="文件区域"] .nv-document article')).toContainText('资料原文仍保持不变。',{timeout:30_000});
    await expect(page.locator('[data-composer-input][contenteditable="true"]')).toHaveCount(1);
  } finally {
    await client.close();
    await runtime.stop();
  }
  expect(errors.filter(text=>!/favicon|net::|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
