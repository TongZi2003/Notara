import { test, expect, type Page, type Locator } from '@playwright/test';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../fixtures/vault-http.ts';

const board = (page: Page) => page.locator('.nb-board');
const tabs = (page: Page, name: string) => page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name, exact: true });
const choiceText = '```choice\nDNA主要分布在哪里？\n- 底部的沉淀里\n- 上清液里\n- 两层的交界处\nreason required\n```';
const alternateText = '```choice\n为什么会这样？\n- 密度\n- 溶解状态\n```';
const framesText = '```frames\ntitle 离心以后\nframe 离心之前\nDNA还在溶液中。\npredict\nframe 离心以后\nDNA在上清液中。\n```';

async function styleOf(input: Locator) {
  return input.evaluate(element => {
    const style = getComputedStyle(element);
    return { value: (element as HTMLTextAreaElement).value, color: style.color, background: style.backgroundColor, caret: style.caretColor, scheme: style.colorScheme };
  });
}
function contrast(one: string, two: string) {
  const luminance = (text: string) => (text.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  const first = luminance(one), second = luminance(two);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
async function readable(input: Locator, text: string) {
  await expect(input).toHaveValue(text);
  const style = await styleOf(input);
  expect(contrast(style.color, style.background), JSON.stringify(style)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(style.caret, style.background), JSON.stringify(style)).toBeGreaterThanOrEqual(3);
}
async function imeText(page: Page, input: Locator, text: string) {
  await input.focus();
  const cdp = await page.context().newCDPSession(page);
  try {
    for (let index = 1; index <= text.length; index++) {
      await cdp.send('Input.imeSetComposition', { text: text.slice(0, index), selectionStart: 0, selectionEnd: index });
    }
    await cdp.send('Input.insertText', { text });
  } finally { await cdp.detach(); }
}

test('typed board reasons remain readable and preserved in native dark mode across IME, polling, resize and reload', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime);
  const errors: string[] = [];
  const diagnostics: Record<string, unknown> = {};
  let boardReads = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/notaraVault/board')) boardReads++; });
  try {
    await page.setViewportSize({ width: 600, height: 1000 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      (window as any).__boardInputEvents = [];
      document.addEventListener('input', event => {
        const target = event.target as HTMLTextAreaElement;
        if (target?.matches?.('.nb-q-note')) (window as any).__boardInputEvents.push({ value: target.value, data: (event as InputEvent).data, composing: (event as InputEvent).isComposing });
      }, true);
    });
    client.approvals.auto('rejected');
    await client.script({
      '__session-title': '理由输入回归',
      '理由输入回归': { calls: [
        { name: 'write_lesson_board', arguments: { title: '小检测：离心后DNA在哪一层', section: '理由与预测', kind: 'question', body: choiceText } },
        { name: 'write_lesson_board', arguments: { title: '另一种想法', kind: 'question', body: alternateText } },
        { name: 'write_lesson_board', arguments: { title: '预测离心结果', kind: 'question', body: framesText } },
      ], text: '现在可以在白板上写理由和预测。' },
    });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 5000 }); await later.click(); } catch { /* synthetic provider already configured */ }
    await page.locator('[data-composer-input][contenteditable="true"]').last().fill('理由输入回归');
    await page.locator('[data-composer-input][contenteditable="true"]').last().press('Enter');
    await expect(page.getByText('现在可以在白板上写理由和预测。', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const lesson = (await client.sessions()).find(row => (row as any).blank === false && (row as any).origin !== 'subagent')!.sessionId;
    await tabs(page, '白板').click();
    await expect(board(page).locator('.nb-reading')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', /.*/);
    const choice = board(page).locator('.nb-block').filter({ has: page.getByRole('heading', { name: '小检测：离心后DNA在哪一层' }) });
    const reason = choice.getByLabel('理由');
    await choice.getByRole('radio', { name: /上清液/ }).click();
    await choice.getByRole('button', { name: '交给老师' }).click();
    await expect(choice.getByRole('status')).toHaveText('这道题要写一句理由。');
    await reason.pressSequentially('DNA remains dissolved', { delay: 20 });
    await expect(reason).toHaveValue('DNA remains dissolved');
    await expect(choice.getByRole('status')).toHaveCount(0);
    await reason.fill('');
    await choice.getByRole('button', { name: '交给老师' }).click();
    await expect(choice.getByRole('status')).toHaveText('这道题要写一句理由。');
    await imeText(page, reason, '因为离心');
    await expect(reason).toHaveValue('因为离心');
    await expect(choice.getByRole('status')).toHaveCount(0);
    await choice.getByRole('heading', { name: '小检测：离心后DNA在哪一层' }).click();
    diagnostics.reasonAfterIME = await styleOf(reason);
    diagnostics.darkBody = await page.locator('body').evaluate(element => ({ dark: element.hasAttribute('data-ds-dark-theme'), scheme: getComputedStyle(element).colorScheme }));
    await page.screenshot({ path: testInfo.outputPath('dark-reason-native.png') });
    await readable(reason, '因为离心');

    const beforeReads = boardReads;
    await expect.poll(() => boardReads, { timeout: 10_000 }).toBeGreaterThan(beforeReads);
    await readable(reason, '因为离心');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(board(page).locator('.nb-reading')).toHaveCount(0);
    await expect(reason).toHaveValue('因为离心');
    await page.setViewportSize({ width: 600, height: 1000 });
    await expect(board(page).locator('.nb-reading')).toBeVisible();
    await readable(reason, '因为离心');
    const savedDraft = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('notara-board-draft:')).map(key => ({ key, value: JSON.parse(localStorage.getItem(key)!) }))).then(values => values.find(row => row.value.reason === '因为离心'));
    expect(savedDraft?.value.pick).toEqual([1]);
    diagnostics.reasonEvents = await page.evaluate(() => (window as any).__boardInputEvents);
    await page.reload();
    await expect(tabs(page, '白板')).toBeVisible({ timeout: 30_000 });
    await tabs(page, '白板').click();
    await readable(reason, '因为离心');
    await choice.getByRole('button', { name: '交给老师' }).click();
    await expect(choice.locator('.nb-q-badge')).toHaveText('已交给老师');

    const other = board(page).locator('.nb-block').filter({ has: page.getByRole('heading', { name: '另一种想法' }) });
    await other.getByRole('button', { name: '都不对，我觉得……' }).click();
    const note = other.getByLabel('我的想法');
    await note.pressSequentially('DNA ', { delay: 20 });
    await imeText(page, note, '仍然溶解');
    await other.getByRole('heading', { name: '另一种想法' }).click();
    await readable(note, 'DNA 仍然溶解');
    await other.getByRole('button', { name: '交给老师' }).click();
    await expect(other.locator('.nb-q-badge')).toHaveText('已交给老师');

    const predictionBlock = board(page).locator('.nb-block').filter({ has: page.getByRole('heading', { name: '预测离心结果' }) });
    const prediction = predictionBlock.getByPlaceholder('写下你的预测，交给老师后揭开这一帧');
    await prediction.pressSequentially('DNA ', { delay: 20 });
    await imeText(page, prediction, '留在上清液');
    await predictionBlock.getByRole('heading', { name: '预测离心结果' }).click();
    await readable(prediction, 'DNA 留在上清液');
    await predictionBlock.getByRole('button', { name: '交给老师' }).click();
    await expect(predictionBlock.locator('.nb-frames-mine')).toHaveText('你的预测：DNA 留在上清液');
    const value = client.value(await client.rpc<{ blocks: { answers?: { v: unknown }[] }[] }>('notaraVault/board', { input: { sessionId: lesson } }));
    const answers = value.blocks.flatMap(block => block.answers ?? []).map(answer => answer.v);
    expect(answers).toEqual(expect.arrayContaining([{ pick: [1], reason: '因为离心' }, { other: 'DNA 仍然溶解' }, { frame: 1, text: 'DNA 留在上清液' }]));
    await tabs(page, '对话').click();
    await expect(page.getByText(/理由：因为离心/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/DNA 仍然溶解/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/DNA 留在上清液/).first()).toBeVisible({ timeout: 30_000 });
    // The notebook look shares the paper's input; changing either native color
    // scheme must leave the typed text and its contrast intact.
    await page.evaluate(() => localStorage.setItem('notara.vault.appearance', 'notebook'));
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook');
    await tabs(page, '白板').click();
    await choice.getByRole('button', { name: '改答案' }).click();
    await reason.pressSequentially('DNA', { delay: 20 });
    await readable(reason, 'DNA');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('body')).not.toHaveAttribute('data-ds-dark-theme', /.*/);
    await readable(reason, 'DNA');
    await page.screenshot({ path: testInfo.outputPath('notebook-reason.png') });
    expect(errors).toEqual([]);
    diagnostics.answers = answers;
    diagnostics.events = await page.evaluate(() => (window as any).__boardInputEvents);
    diagnostics.boardReads = boardReads;
  } finally {
    diagnostics.errors = errors;
    await testInfo.attach('input-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
    await page.close();
    await client.close();
    await runtime.stop();
  }
});
