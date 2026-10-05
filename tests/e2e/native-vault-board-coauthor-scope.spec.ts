import {test, expect, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {startVaultIsolated} from '../../scripts/dev-isolated.ts';
import {connectVault, outcomeJson, type ScriptedReply} from '../fixtures/vault-http.ts';

interface BoardBlock { id: string; title: string; body: string; contentType?: string }
interface Contribution { id: string; actor: string; targetIds?: string[]; contentChanged?: boolean }
interface BoardSnapshot { revision: string; blocks: BoardBlock[]; contributions?: Contribution[] }
interface TeacherRead { revision: string; block: BoardBlock }
interface TeacherCommit { saved: boolean; revision: string; commitId: string; contributions?: Contribution[] }

const composer = (page: Page) => page.locator('[data-composer-input][contenteditable="true"]').last();
const boardPane = (page: Page) => page.locator('.nb-board');

async function enterLesson(page: Page, runtime: Awaited<ReturnType<typeof startVaultIsolated>>, client: Awaited<ReturnType<typeof connectVault>>): Promise<string> {
  await client.script({ '__session-title': '白板原生引用授权', '准备原生引用验收': '课堂已准备。' });
  await page.setViewportSize({width: 1500, height: 950});
  await page.goto(runtime.authUrl);
  const later = page.getByRole('button', {name: /Configure later|稍后配置/});
  try { await later.waitFor({timeout: 8000}); await later.click(); } catch { /* already acknowledged */ }
  await expect(composer(page)).toBeVisible({timeout: 30_000});
  await composer(page).fill('准备原生引用验收');
  await composer(page).press('Enter');
  await expect(page.getByText('课堂已准备。', {exact: true}).last()).toBeVisible({timeout: 60_000});
  const sessionId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('notara-vault-view') ?? 'null')?.sessionId as string | undefined);
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

async function readBoard(client: Awaited<ReturnType<typeof connectVault>>, sessionId: string): Promise<BoardSnapshot> {
  return client.value(await client.rpc<BoardSnapshot>('notaraVault/board', {input: {sessionId}}));
}

test('native whiteboard ask binds the teacher edit to the submitted board receipt', async ({page}) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated({testModel: true});
  const client = await connectVault(runtime), browserErrors: string[] = [];
  client.approvals.auto('allowed-once');
  const onPageError = (error: Error) => browserErrors.push(error.message);
  const onConsoleError = (message: import('@playwright/test').ConsoleMessage) => { if (message.type() === 'error') browserErrors.push(message.text()); };
  page.on('pageerror', onPageError);
  page.on('console', onConsoleError);
  try {
    const sessionId = await enterLesson(page, runtime, client);
    await page.getByRole('tablist', {name: '课堂视图', exact: true}).getByRole('tab', {name: '白板', exact: true}).click();
    const board = boardPane(page);
    await expect(board).toBeVisible();

    await board.getByRole('button', {name: '新增', exact: true}).click();
    const create = page.getByRole('dialog', {name: '新增白板块'});
    await create.getByLabel('内容类型').selectOption('text');
    await create.getByLabel('新块标题').fill('需老师完善的原稿');
    await create.getByLabel('新块正文').fill('学生已经写下的原始推导。');
    await create.getByRole('button', {name: '创建并编辑'}).click();
    const editor = page.getByRole('dialog', {name: '编辑 需老师完善的原稿'});
    await expect(editor).toBeVisible({timeout: 30_000});
    await editor.getByRole('button', {name: '返回白板', exact: true}).click();

    await board.getByRole('button', {name: '新增', exact: true}).click();
    const secondCreate = page.getByRole('dialog', {name: '新增白板块'});
    await secondCreate.getByLabel('内容类型').selectOption('text');
    await secondCreate.getByLabel('新块标题').fill('未被引用的另一块');
    await secondCreate.getByLabel('新块正文').fill('这块内容没有被上一条白板引用授权。');
    await secondCreate.getByRole('button', {name: '创建并编辑'}).click();
    const secondEditor = page.getByRole('dialog', {name: '编辑 未被引用的另一块'});
    await expect(secondEditor).toBeVisible({timeout: 30_000});
    await secondEditor.getByRole('button', {name: '返回白板', exact: true}).click();

    const before = await readBoard(client, sessionId);
    const target = before.blocks.find(block => block.title === '需老师完善的原稿');
    const other = before.blocks.find(block => block.title === '未被引用的另一块');
    expect(target).toBeDefined();
    expect(other).toBeDefined();
    expect(target!.contentType).toBe('text');
    expect(target!.body).toBe('学生已经写下的原始推导。');

    const afterText = '学生原稿保留，并补充了可核对的推理步骤。';
    const otherAfterText = '普通学生消息也可以继续补充另一块内容。';
    const reply: ScriptedReply = {
      calls: [
        {name: 'write_lesson_board', arguments: {action: 'read', blockId: target!.id}},
        {name: 'write_lesson_board', arguments: {action: 'apply', expectedRevision: before.revision, requestId: randomUUID(), ops: [
          {type: 'patch', blockId: target!.id, patch: {body: afterText}},
        ]}},
      ],
      text: '我已按原生白板引用完善这块内容。',
    };
    const targetCard = board.locator('.nb-block').filter({has: page.getByRole('heading', {name: target!.title, exact: true})});
    await board.getByRole('button', {name: '全览', exact: true}).click();
    await targetCard.getByRole('button', {name: '请老师完善', exact: true}).click();
    await expect(composer(page)).toBeVisible();
    await expect(composer(page)).toContainText('请老师完善');
    await expect(page.locator('[data-composer-input][contenteditable="true"]')).toHaveCount(1);
    const promptText = (await composer(page).innerText()).trim();
    expect(promptText).toContain('请老师完善');
    await client.scriptOne('__board-reference', reply);
    const submittedBefore = (await client.turns(sessionId)).length;
    await composer(page).press('Enter');

    await client.waitForTurn(sessionId, submittedBefore);
    await expect(page.getByText('我已按原生白板引用完善这块内容。', {exact: true}).last()).toBeVisible({timeout: 60_000});

    const assembled = await client.turns(sessionId);
    const submittedText = assembled.flatMap(request => request.messages)
      .filter(message => message.role === 'user')
      .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text ?? ''))
      .find(text => /〔白板选区:[a-f0-9-]{36}〕/.test(text));
    expect(submittedText).toBeTruthy();
    expect(submittedText).toContain(target!.id);

    const outcomes = (await client.outcomes(sessionId)).filter(outcome => outcome.name === 'write_lesson_board');
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every(outcome => !outcome.failed)).toBe(true);
    const read = outcomeJson<TeacherRead>(outcomes[0]!);
    const applied = outcomeJson<TeacherCommit>(outcomes[1]!);
    expect(read?.block).toMatchObject({id: target!.id, body: '学生已经写下的原始推导。'});
    expect(applied).toMatchObject({saved: true});
    expect(applied?.commitId).toBeTruthy();

    const after = await readBoard(client, sessionId);
    expect(after.blocks.find(block => block.id === target!.id)?.body).toBe(afterText);
    expect(after.contributions?.find(contribution => contribution.id === applied!.commitId)).toMatchObject({
      actor: 'teacher', targetIds: [target!.id], contentChanged: true,
    });
    const secondReply: ScriptedReply = {
      calls: [
        {name: 'write_lesson_board', arguments: {action: 'read', blockId: other!.id}},
        {name: 'write_lesson_board', arguments: {action: 'apply', expectedRevision: after.revision, requestId: randomUUID(), ops: [
          {type: 'patch', blockId: other!.id, patch: {body: otherAfterText}},
        ]}},
      ],
      text: '我会继续处理另一块板书。',
    };
    const ordinaryPrompt = '请继续完善另一块白板。';
    const beforeOrdinaryTurns = (await client.turns(sessionId)).length;
    const beforeOrdinaryOutcomes = (await client.outcomes(sessionId)).length;
    await client.scriptOne(ordinaryPrompt, secondReply);
    await composer(page).fill(ordinaryPrompt);
    await composer(page).press('Enter');
    await client.waitForTurn(sessionId, beforeOrdinaryTurns);
    await expect(page.getByText('我会继续处理另一块板书。', {exact: true}).last()).toBeVisible({timeout: 60_000});
    const ordinaryTurn = (await client.turns(sessionId)).at(-1);
    const ordinaryUser = ordinaryTurn?.messages.filter(message => message.role === 'user').at(-1);
    const ordinaryText = ordinaryUser?.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? '';
    expect(ordinaryText).toContain(ordinaryPrompt);
    expect(ordinaryText).not.toMatch(/〔白板选区:[a-f0-9-]{36}〕/);
    const ordinaryOutcomes = (await client.outcomes(sessionId)).slice(beforeOrdinaryOutcomes).filter(outcome => outcome.name === 'write_lesson_board');
    expect(ordinaryOutcomes).toHaveLength(2);
    expect(ordinaryOutcomes.every(outcome => !outcome.failed)).toBe(true);
    const ordinaryRead = outcomeJson<TeacherRead>(ordinaryOutcomes[0]!);
    const ordinaryApplied = outcomeJson<TeacherCommit>(ordinaryOutcomes[1]!);
    expect(ordinaryRead?.block).toMatchObject({id: other!.id, body: '这块内容没有被上一条白板引用授权。'});
    expect(ordinaryApplied).toMatchObject({saved: true});
    const ordinaryAfter = await readBoard(client, sessionId);
    expect(ordinaryAfter.blocks.find(block => block.id === other!.id)?.body).toBe(otherAfterText);
    expect(ordinaryAfter.contributions?.find(contribution => contribution.id === ordinaryApplied?.commitId)).toMatchObject({
      actor: 'teacher', targetIds: [other!.id], contentChanged: true,
    });
    expect(browserErrors).toEqual([]);
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsoleError);
    await client.close();
    await runtime.stop();
  }
});
