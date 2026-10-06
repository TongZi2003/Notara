import { test, expect, type ConsoleMessage, type Locator, type Page, type Request, type Response } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, outcomeJson, type ScriptedReply, type ToolOutcome } from '../fixtures/vault-http.ts';

interface BoardBlock {
  id: string;
  title: string;
  body?: string;
  contentType?: string;
  sourceRef?: string;
}

interface Contribution {
  id: string;
  actor: string;
  undone?: boolean;
  undoOf?: string | null;
}

interface BoardSnapshot {
  revision: string | null;
  workspaceId: string;
  blocks: BoardBlock[];
  manualEdges?: Array<{ id: string; from: string; to: string; label: string }>;
  groups?: Array<{ id: string; title: string; members: string[] }>;
  contributions?: Contribution[];
}

interface BoardContent {
  revision: string;
  block: BoardBlock;
  content?: {
    elements?: Array<{ id: string; type: string; text?: string }>;
    mindmap?: { nodes: Array<{ elementId: string; parentId: string | null }>; links: unknown[]; notes: unknown[] };
  } | null;
  contributions?: Contribution[];
}

interface TeacherList extends BoardSnapshot { readTargetBeforePatch?: boolean }
interface TeacherRead { revision: string; block: BoardBlock; content?: unknown }
interface TeacherCommit { saved: boolean; revision: string; commitId: string; contributions?: Contribution[] }

const composer = (page: Page) => page.locator('[data-composer-input][contenteditable="true"]').last();
const lessonTabs = (page: Page) => page.getByRole('tablist', { name: '课堂视图', exact: true });
const boardPane = (page: Page) => page.locator('.nb-board');

async function enterLesson(page: Page, runtime: Awaited<ReturnType<typeof startVaultIsolated>>, client: Awaited<ReturnType<typeof connectVault>>, title: string, prompt: string, reply: ScriptedReply, responseText: string): Promise<string> {
  await client.script({ '__session-title': title });
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(runtime.authUrl);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* the synthetic route may already be acknowledged */ }
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
  await client.scriptOne(prompt, reply);
  await composer(page).fill(prompt);
  await composer(page).press('Enter');
  await expect(page.getByText(responseText, { exact: true }).last()).toBeVisible({ timeout: 60_000 });
  const sessionId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('notara-vault-view') ?? 'null')?.sessionId as string | undefined);
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

async function sendTurn(page: Page, client: Awaited<ReturnType<typeof connectVault>>, sessionId: string, prompt: string, reply: ScriptedReply, responseText: string): Promise<ToolOutcome[]> {
  const chatTab = lessonTabs(page).getByRole('tab', { name: '对话', exact: true });
  if (await chatTab.isVisible()) await chatTab.click();
  const beforeTurns = (await client.turns(sessionId)).length;
  const beforeOutcomes = (await client.outcomes(sessionId)).length;
  await client.scriptOne(prompt, reply);
  await composer(page).fill(prompt);
  await composer(page).press('Enter');
  await client.waitForTurn(sessionId, beforeTurns);
  await expect(page.getByText(responseText, { exact: true }).last()).toBeVisible({ timeout: 60_000 });
  return (await client.outcomes(sessionId)).slice(beforeOutcomes);
}

async function showBoard(page: Page): Promise<Locator> {
  await lessonTabs(page).getByRole('tab', { name: '白板', exact: true }).click();
  await expect(boardPane(page)).toBeVisible();
  return boardPane(page);
}

async function currentSession(page: Page): Promise<string> {
  const value = await page.evaluate(() => JSON.parse(sessionStorage.getItem('notara-vault-view') ?? 'null')?.sessionId as string | undefined);
  if (!value) throw new Error('当前测试课堂没有 sessionId');
  return value;
}

async function readBoard(client: Awaited<ReturnType<typeof connectVault>>, sessionId: string): Promise<BoardSnapshot> {
  let retries = 0;
  for (;;) {
    try { return client.value(await client.rpc<BoardSnapshot>('notaraVault/board', { input: { sessionId } })); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('资料已被修改，请刷新后再试') || retries >= 3) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, 25 * (2 ** retries++)));
    }
  }
}

async function readBlockContent(client: Awaited<ReturnType<typeof connectVault>>, sessionId: string, blockId: string): Promise<BoardContent> {
  return client.value(await client.rpc<BoardContent>('notaraVault/contentBoard', { input: { sessionId, blockId } }));
}

async function waitForBlockContent(client: Awaited<ReturnType<typeof connectVault>>, sessionId: string, blockId: string, predicate: (value: BoardContent) => boolean): Promise<BoardContent> {
  let latest: BoardContent | undefined;
  await expect.poll(async () => {
    try { latest = await readBlockContent(client, sessionId, blockId); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('资料已被修改，请刷新后再试')) throw error;
      latest = undefined;
    }
    return latest !== undefined && predicate(latest);
  }, { timeout: 30_000 }).toBe(true);
  return latest!;
}

async function addBlock(page: Page, type: 'text' | 'drawing' | 'mindmap' | 'figure' | 'source', title: string, body = '', sourcePath?: string): Promise<Locator> {
  const board = boardPane(page);
  await board.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增白板块' });
  await dialog.getByLabel('内容类型').selectOption(type);
  await dialog.getByLabel('新块标题').fill(title);
  if (type !== 'source') await dialog.getByLabel('新块正文').fill(body);
  else {
    if (!sourcePath) throw new Error('source block needs a Vault path');
    await dialog.getByLabel('本集资料').selectOption(sourcePath);
  }
  await dialog.getByRole('button', { name: '创建并编辑', exact: true }).click();
  const editor = page.getByRole('dialog', { name: `编辑 ${title}` });
  if (type === 'source') {
    const card = board.locator('.nb-block[data-content-type="source"]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(card).toBeVisible({ timeout: 30_000 });
    return card;
  }
  await expect(editor).toBeVisible({ timeout: 30_000 });
  // The dialog mounts before its asynchronous content read has initialized
  // the draft; the header Save button reflects actual editor readiness.
  await expect(editor.locator(':scope > header').getByRole('button', { name: '保存', exact: true })).toBeEnabled({ timeout: 30_000 });
  return editor;
}

async function findBlock(snapshot: BoardSnapshot, title: string): Promise<BoardBlock> {
  const block = snapshot.blocks.find(row => row.title === title);
  if (!block) throw new Error(`白板中没有块“${title}”`);
  return block;
}

function toolValue<T>(outcomes: ToolOutcome[], label: string): T {
  const outcome = outcomes.find(row => row.name === 'write_lesson_board');
  expect(outcome, `${label}: write_lesson_board result`).toBeDefined();
  expect(outcome!.failed, `${label}: tool call`).toBe(false);
  const value = outcomeJson<T>(outcome!);
  if (!value) throw new Error(`${label}: tool result was not JSON: ${outcome!.text}`);
  return value;
}

interface PageDiagnostics {
  errors: string[];
  externalAssets: string[];
  dispose(): void;
}

function collectErrors(page: Page, localUrl: string): PageDiagnostics {
  const diagnostics: PageDiagnostics = { errors: [], externalAssets: [], dispose() {} };
  const localHost = new URL(localUrl).hostname;
  const localHosts = new Set([localHost, 'localhost', '127.0.0.1', '::1']);
  const onPageError = (error: Error) => diagnostics.errors.push(`pageerror: ${error.message}`);
  const onConsole = (message: ConsoleMessage) => { if (message.type() === 'error') diagnostics.errors.push(`console: ${message.text()}`); };
  const onRequestFailed = (request: Request) => diagnostics.errors.push(`requestfailed ${request.failure()?.errorText ?? 'unknown'}: ${request.url()}`);
  const onResponse = (response: Response) => {
    if (response.status() >= 400) diagnostics.errors.push(`HTTP ${response.status()} ${response.request().resourceType()}: ${response.url()}`);
  };
  const onRequest = (request: Request) => {
    if (!['font', 'script'].includes(request.resourceType())) return;
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !localHosts.has(url.hostname)) diagnostics.externalAssets.push(`${request.resourceType()}: ${url.href}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  page.on('request', onRequest);
  diagnostics.dispose = () => {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    page.off('request', onRequest);
  };
  return diagnostics;
}

function expectNoUnexpectedErrors(diagnostics: PageDiagnostics): void {
  expect(diagnostics.errors).toEqual([]);
  expect(diagnostics.externalAssets).toEqual([]);
}

test('free text blocks create, autosave, reload, and retain a conflicting draft', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors = collectErrors(page, runtime.authUrl);
  client.approvals.auto('allowed-once');
  try {
    await enterLesson(page, runtime, client, '白板文字保存', '开始文字保存回归', '课堂已准备。', '课堂已准备。');
    const sessionId = await currentSession(page);
    const board = await showBoard(page);
    const editor = await addBlock(page, 'text', '保存竞争草稿', '初始正文。');
    const text = editor.getByLabel('块正文');
    await text.fill('第一版正文，等待自动保存。');
    await expect.poll(async () => (await readBoard(client, sessionId)).blocks.find(block => block.title === '保存竞争草稿')?.body).toBe('第一版正文，等待自动保存。');
    await editor.getByRole('button', { name: '返回白板', exact: true }).click();
    await page.reload();
    await expect(lessonTabs(page)).toBeVisible({ timeout: 30_000 });
    const reloadedBoard = await showBoard(page);
    await expect(reloadedBoard).toContainText('第一版正文，等待自动保存。');

    // A concurrent native commit advances the board revision after the local
    // buffer becomes dirty. The failed autosave and a reload must keep the draft.
    const card = reloadedBoard.locator('.nb-block').filter({ has: page.getByRole('heading', { name: '保存竞争草稿', exact: true }) });
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    const editing = page.getByRole('dialog', { name: '编辑 保存竞争草稿' });
    const localDraft = '本地输入必须在冲突后保留。';
    await editing.getByLabel('块正文').fill(localDraft);
    const current = await readBoard(client, sessionId);
    const block = await findBlock(current, '保存竞争草稿');
    client.value(await client.rpc('notaraVault/commitBoard', { input: {
      sessionId, expectedRevision: current.revision, requestId: randomUUID(),
      ops: [{ type: 'patch', blockId: block.id, patch: { body: '另一处已经保存的正文。' } }],
    } }));
    await expect(editing.getByRole('status')).toHaveText('保存失败，草稿已保留', { timeout: 20_000 });
    await expect(editing.getByLabel('块正文')).toHaveValue(localDraft);
    await page.reload();
    await expect(lessonTabs(page)).toBeVisible({ timeout: 30_000 });
    const afterReload = await showBoard(page);
    const latestCard = afterReload.locator('.nb-block').filter({ has: page.getByRole('heading', { name: '保存竞争草稿', exact: true }) });
    await latestCard.getByRole('button', { name: '编辑', exact: true }).click();
    const restored = page.getByRole('dialog', { name: '编辑 保存竞争草稿' });
    await expect(restored.getByRole('status')).toHaveText('已恢复未保存的草稿');
    await expect(restored.getByLabel('块正文')).toHaveValue(localDraft);
    expect((await readBoard(client, sessionId)).blocks.find(row => row.id === block.id)?.body).toBe('另一处已经保存的正文。');
    expectNoUnexpectedErrors(errors);
  } finally {
    errors.dispose();
    await testInfo.attach('page-diagnostics', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
});

test('drawing rectangles, mind-map nodes, and function sliders persist through autosave and reload', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors = collectErrors(page, runtime.authUrl);
  client.approvals.auto('allowed-once');
  try {
    await enterLesson(page, runtime, client, '白板绘图保存', '开始绘图保存回归', '课堂已准备。', '课堂已准备。');
    const sessionId = await currentSession(page);
    const board = await showBoard(page);

    const drawing = await addBlock(page, 'drawing', '保存的矩形', '');
    await drawing.getByRole('radio', { name: '矩形', exact: true }).check({ force: true });
    const canvas = drawing.locator('.nb-excalidraw-canvas canvas').first();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).toBeTruthy();
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.32, canvasBox!.y + canvasBox!.height * 0.32);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.68, canvasBox!.y + canvasBox!.height * 0.68, { steps: 5 });
    await page.mouse.up();
    const drawingBlock = await findBlock(await readBoard(client, sessionId), '保存的矩形');
    const drawingContent = await waitForBlockContent(client, sessionId, drawingBlock.id, value => value.content?.elements?.some(element => element.type === 'rectangle') === true);
    expect(drawingContent.content?.elements?.some(element => element.type === 'rectangle')).toBe(true);
    await drawing.getByRole('button', { name: '返回白板', exact: true }).click();

    const mindmap = await addBlock(page, 'mindmap', '保存的导图', '');
    const mapTools = mindmap.getByRole('toolbar', { name: '导图节点操作' });
    await mapTools.getByLabel('节点文字').fill('核心概念');
    await mapTools.getByRole('button', { name: '新增根节点', exact: true }).click();
    const mapBlock = await findBlock(await readBoard(client, sessionId), '保存的导图');
    const mapContent = await waitForBlockContent(client, sessionId, mapBlock.id, value => value.content?.mindmap?.nodes.length === 1 && value.content?.elements?.some(element => element.type === 'rectangle' || element.type === 'text') === true);
    expect(mapContent.content?.mindmap?.nodes).toHaveLength(1);
    expect(mapContent.content?.elements?.some(element => element.type === 'rectangle' || element.type === 'text')).toBe(true);
    await mindmap.getByRole('button', { name: '返回白板', exact: true }).click();

    const definition = '```figure\naxes x -4..4 y -3..3\nparam a = 1 in -3..3\nfunction f(x) = a*x^2\n```';
    const figure = await addBlock(page, 'figure', '可保存函数图', definition);
    await figure.getByLabel('函数表达式').fill('a*x^2 + 1');
    const slider = figure.getByLabel('参数 a');
    const sliderBefore = await slider.inputValue();
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => slider.inputValue()).not.toBe(sliderBefore);
    const figureBlock = await findBlock(await readBoard(client, sessionId), '可保存函数图');
    await expect.poll(async () => (await readBoard(client, sessionId)).blocks.find(block => block.id === figureBlock.id)?.body).toMatch(/function f\(x\) = a\*x\^2 \+ 1/);
    const savedFigure = (await readBoard(client, sessionId)).blocks.find(block => block.id === figureBlock.id)?.body ?? '';
    expect(savedFigure).toMatch(/param a = (?!1 in)-?\d/);
    await figure.getByRole('button', { name: '返回白板', exact: true }).click();

    await page.reload();
    await expect(lessonTabs(page)).toBeVisible({ timeout: 30_000 });
    const restoredBoard = await showBoard(page);
    await expect(restoredBoard.locator('.nb-block[data-content-type="drawing"] .nb-scene-preview rect')).toHaveCount(1);
    await expect(restoredBoard.locator('.nb-block[data-content-type="mindmap"] .nb-scene-preview')).toContainText('核心概念');
    await expect(restoredBoard).toContainText('可保存函数图');
    await page.screenshot({ path: testInfo.outputPath('free-board-scenes.png'), fullPage: false });
    expectNoUnexpectedErrors(errors);
  } finally {
    errors.dispose();
    await testInfo.attach('page-diagnostics', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
});

test('source cards save Markdown and code edits back to their original Vault files', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors = collectErrors(page, runtime.authUrl);
  client.approvals.auto('allowed-once');
  try {
    await mkdir(join(client.vault, '测试资料'), { recursive: true });
    const markdownPath = '测试资料/原始讲义.md', codePath = '测试资料/example.py';
    const markdownInitial = '---\ntype: card\ntitle: 原始讲义\n---\n\n来源中的原句。\n';
    const codeInitial = 'def double(value):\n    return value * 2\n';
    await client.writeVaultFile(markdownPath, markdownInitial);
    await client.writeVaultFile(codePath, codeInitial);
    await enterLesson(page, runtime, client, '原文件保存', '开始原文件保存回归', '课堂已准备。', '课堂已准备。');
    await showBoard(page);

    const markdownCard = await addBlock(page, 'source', '可编辑 Markdown 原文', '', markdownPath);
    await markdownCard.getByRole('button', { name: '原位编辑', exact: true }).click();
    const markdownEditor = markdownCard.locator('.nb-file-container');
    const markdownContent = markdownEditor.locator('.cm-content');
    await expect(markdownContent).toContainText('来源中的原句。');
    await markdownContent.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('课堂补充仍写回原讲义。');
    await markdownEditor.getByRole('button', { name: '保存原文件', exact: true }).click();
    await expect.poll(() => client.readVaultFile(markdownPath)).toContain('课堂补充仍写回原讲义。');

    const codeCard = await addBlock(page, 'source', '可编辑 Python 原文', '', codePath);
    await codeCard.getByRole('button', { name: '原位编辑', exact: true }).click();
    const codeEditor = page.getByRole('region', { name: `代码编辑：${codePath}` });
    const codeContent = codeEditor.locator('.cm-content');
    await expect(codeContent).toContainText('return value * 2');
    await codeContent.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('    return double(3)');
    await codeEditor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(codeEditor.getByRole('status')).toHaveText('已保存');
    await expect.poll(() => client.readVaultFile(codePath)).toContain('return double(3)');
    expect(await client.readVaultFile(markdownPath)).toContain('来源中的原句。');
    expectNoUnexpectedErrors(errors);
  } finally {
    errors.dispose();
    await testInfo.attach('page-diagnostics', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
});

test('teacher list/read/apply/undo preserves originals, manual links, groups, and both exports', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors = collectErrors(page, runtime.authUrl);
  client.approvals.auto('allowed-once');
  try {
    const initialReply: ScriptedReply = {
      calls: [
        { name: 'write_lesson_board', arguments: { title: '推导起点', section: '核心过程', body: '原始条件与第一步。' } },
        { name: 'write_lesson_board', arguments: { title: '推导结果', body: '由条件得到原始结论。' } },
      ],
      text: '两块板书已准备。',
    };
    await enterLesson(page, runtime, client, '教师白板协作', '准备两块推导', initialReply, '两块板书已准备。');
    const sessionId = await currentSession(page);
    await showBoard(page);
    const initial = await readBoard(client, sessionId);
    const first = await findBlock(initial, '推导起点'), second = await findBlock(initial, '推导结果');

    const pinnedEditor = await addBlock(page, 'text', '可引用原稿', '这块原稿用于验证白板引用入口。');
    await pinnedEditor.getByRole('button', { name: '返回白板', exact: true }).click();
    await expect(pinnedEditor).toBeHidden();
    const pinnedBlock = await findBlock(await readBoard(client, sessionId), '可引用原稿');
    const beforePinnedAsk = (await client.turns(sessionId)).length;
    const pinnedCard = boardPane(page).locator('.nb-block').filter({ has: page.getByRole('heading', { name: pinnedBlock.title, exact: true }) });
    await pinnedCard.getByRole('button', { name: '请老师完善', exact: true }).click();
    await expect(composer(page)).toContainText('请老师完善');
    const promptText = (await composer(page).innerText()).trim();
    expect(promptText).toContain('请老师完善');
    await client.scriptOne(promptText, { text: '已接收这块白板的原文引用。' });
    await composer(page).press('Enter');
    await client.waitForTurn(sessionId, beforePinnedAsk);
    const pinnedRequest = (await client.turns(sessionId)).slice(beforePinnedAsk).at(-1);
    expect(pinnedRequest).toBeDefined();
    const pinnedUserText = pinnedRequest!.messages.filter(message => message.role === 'user')
      .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text ?? ''))
      .join('\n');
    expect(pinnedUserText).toContain('〔白板选区:');
    expect(pinnedUserText).toContain('学生指定的白板目标');
    expect(pinnedUserText).toContain(`"blockId":"${pinnedBlock.id}"`);

    const listed = toolValue<TeacherList>(await sendTurn(page, client, sessionId, '先列出白板块', { calls: [{ name: 'write_lesson_board', arguments: { action: 'list' } }], text: '已列出当前白板。' }, '已列出当前白板。'), 'list');
    expect(listed.blocks.map(block => block.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    const read = toolValue<TeacherRead>(await sendTurn(page, client, sessionId, '读取推导起点', { calls: [{ name: 'write_lesson_board', arguments: { action: 'read', blockId: first.id } }], text: '已读取推导起点。' }, '已读取推导起点。'), 'read');
    expect(read.block.body).toBe('原始条件与第一步。');

    const afterText = '保留原条件，并补上核对过的第二步。';
    const applied = toolValue<TeacherCommit>(await sendTurn(page, client, sessionId, '在原块上补充并建立关系', { calls: [{ name: 'write_lesson_board', arguments: {
      action: 'apply', expectedRevision: read.revision, requestId: randomUUID(), ops: [
        { type: 'patch', blockId: first.id, patch: { body: afterText } },
        { type: 'connect', from: first.id, to: second.id, label: '推出', direction: 'forward' },
        // The runtime contract calls this collection `members`.
        { type: 'group', title: '同一推导', members: [first.id, second.id] },
      ],
    } }], text: '已在原稿上修订。' }, '已在原稿上修订。'), 'apply');
    expect(applied.saved).toBe(true);
    expect(applied.commitId).toBeTruthy();
    let current = await readBoard(client, sessionId);
    expect(current.blocks.find(block => block.id === first.id)?.body).toBe(afterText);
    expect(current.manualEdges).toHaveLength(1);
    expect(current.groups?.[0]?.members).toEqual([first.id, second.id]);

    await page.reload();
    await expect(lessonTabs(page)).toBeVisible({ timeout: 30_000 });
    const board = await showBoard(page);
    await expect(board.locator('.nb-canvas-group')).toContainText('同一推导');
    await board.getByRole('button', { name: '关系', exact: true }).click();
    const relations = board.getByRole('dialog', { name: '白板关系' });
    await expect(relations).toContainText('推导起点 → 推导结果 推出');
    await expect(relations).toContainText('同一推导');
    await board.getByRole('button', { name: '关系', exact: true }).click();

    await board.getByRole('button', { name: '修改记录', exact: true }).click();
    const history = board.getByRole('dialog', { name: '白板修改记录' });
    const contribution = history.locator(`.nb-record[data-contribution="${applied.commitId}"]`);
    await contribution.getByText('查看修改前后', { exact: true }).click();
    await expect(contribution.locator('.nb-original-pair')).toContainText('原始条件与第一步。');
    await expect(contribution.locator('.nb-original-pair')).toContainText(afterText);
    await page.screenshot({ path: testInfo.outputPath('free-board-contributions.png'), fullPage: false });

    const download = async (format: 'HTML' | 'Markdown', path: string) => {
      await board.getByRole('button', { name: '导出', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '导出课堂笔记' });
      const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: format, exact: true }).click()]);
      const output = testInfo.outputPath(path);
      await file.saveAs(output);
      return await (await import('node:fs/promises')).readFile(output, 'utf8');
    };
    const html = await download('HTML', 'free-board-export.html');
    expect(html).toContain(afterText);
    const markdown = await download('Markdown', 'free-board-export.md');
    expect(markdown).toContain(afterText);

    const undone = toolValue<TeacherCommit>(await sendTurn(page, client, sessionId, '撤回这次修订', { calls: [{ name: 'write_lesson_board', arguments: { action: 'undo', commitId: applied.commitId, expectedRevision: current.revision, requestId: randomUUID() } }], text: '已撤回这次修订。' }, '已撤回这次修订。'), 'undo');
    expect(undone.saved).toBe(true);
    current = await readBoard(client, sessionId);
    expect(current.blocks.find(block => block.id === first.id)?.body).toBe('原始条件与第一步。');
    expect(current.manualEdges).toEqual([]);
    expect(current.groups).toEqual([]);
    expect(current.contributions?.find(entry => entry.id === applied.commitId)?.undone).toBe(true);
    expect(current.contributions?.some(entry => entry.undoOf === applied.commitId)).toBe(true);
    expectNoUnexpectedErrors(errors);
  } finally {
    errors.dispose();
    await testInfo.attach('page-diagnostics', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
});

test('free drawing editor follows native dark and notebook themes at narrow width', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors = collectErrors(page, runtime.authUrl);
  client.approvals.auto('allowed-once');
  try {
    // Choose the appearance through the shipped Settings UI; the body flags
    // below are observations of the native shell, never test-written state.
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    await expect(page.locator('.nv-home')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).last().click();
    await page.getByText('学习界面', { exact: true }).first().click();
    await page.getByRole('radio', { name: /^手帐/ }).check();
    await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook');
    await expect(page.locator('style[data-notara-theme=notebook]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await enterLesson(page, runtime, client, '手帐暗色绘图', '开始手帐暗色绘图回归', '课堂已准备。', '课堂已准备。');
    const sessionId = await currentSession(page);
    const board = await showBoard(page);
    const creationEditor = await addBlock(page, 'drawing', '窄屏主题绘图', '');
    await creationEditor.getByRole('radio', { name: '矩形', exact: true }).check({ force: true });
    const canvas = creationEditor.locator('.nb-excalidraw-canvas canvas').first();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).toBeTruthy();
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.32, canvasBox!.y + canvasBox!.height * 0.32);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.68, canvasBox!.y + canvasBox!.height * 0.68, { steps: 5 });
    await page.mouse.up();
    const block = await findBlock(await readBoard(client, sessionId), '窄屏主题绘图');
    await waitForBlockContent(client, sessionId, block.id, value => value.content?.elements?.some(element => element.type === 'rectangle') === true);
    await creationEditor.getByRole('button', { name: '返回白板', exact: true }).click();

    const card = board.locator('.nb-block[data-content-type="drawing"]').filter({ has: page.getByRole('heading', { name: '窄屏主题绘图', exact: true }) });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑 窄屏主题绘图' });
    const excalidraw = editor.locator('.excalidraw');
    await expect(excalidraw).toBeVisible();

    await page.setViewportSize({ width: 600, height: 950 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook');
    await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', /.*/);
    await expect(excalidraw).toHaveClass(/theme--dark/);
    const notebookInput = editor.getByLabel('块标题');
    await expect.poll(() => notebookInput.evaluate(element => getComputedStyle(element).borderRadius)).toBe('6px 8px 5px 7px');
    const narrowGeometry = await page.evaluate(() => {
      const dialog = document.querySelector('.nb-free-editor')!;
      return {
        pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
        dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
        dialogRight: dialog.getBoundingClientRect().right,
      };
    });
    expect(narrowGeometry.pageOverflow).toBeLessThanOrEqual(1);
    expect(narrowGeometry.dialogOverflow).toBeLessThanOrEqual(1);
    expect(narrowGeometry.dialogRight).toBeLessThanOrEqual(601);
    const rectangleTool = editor.getByRole('radio', { name: '矩形', exact: true });
    await expect(rectangleTool).toBeVisible();
    await expect(rectangleTool).toBeEnabled();
    await rectangleTool.check({ force: true });
    await expect(rectangleTool).toBeChecked();
    const narrowCanvas = editor.locator('.nb-excalidraw-canvas canvas').first();
    const narrowCanvasBox = await narrowCanvas.boundingBox();
    expect(narrowCanvasBox).toBeTruthy();
    await page.mouse.move(narrowCanvasBox!.x + narrowCanvasBox!.width * 0.14, narrowCanvasBox!.y + narrowCanvasBox!.height * 0.16);
    await page.mouse.down();
    await page.mouse.move(narrowCanvasBox!.x + narrowCanvasBox!.width * 0.28, narrowCanvasBox!.y + narrowCanvasBox!.height * 0.3, { steps: 4 });
    await page.mouse.up();
    await waitForBlockContent(client, sessionId, block.id, value => value.content?.elements?.filter(element => element.type === 'rectangle').length === 2);
    const visibleMenu = excalidraw.locator('.main-menu-trigger');
    await expect(visibleMenu).toBeVisible();
    const menuContrast = await visibleMenu.evaluate(button => {
      const rgb = (value: string) => {
        const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        if (!channels || channels.length !== 3) throw new Error(`无法解析 Excalidraw 控件颜色：${value}`);
        return channels;
      };
      const luminance = (value: number[]) => value.map(channel => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
      const icon = button.querySelector('svg');
      if (!icon) throw new Error('窄屏 Excalidraw 主菜单按钮没有图标。');
      const foregroundStyle = getComputedStyle(icon), buttonStyle = getComputedStyle(button);
      const foreground = rgb(foregroundStyle.color), background = rgb(buttonStyle.backgroundColor);
      const foregroundLuminance = luminance(foreground), backgroundLuminance = luminance(background);
      const lighter = Math.max(foregroundLuminance, backgroundLuminance), darker = Math.min(foregroundLuminance, backgroundLuminance);
      return { foreground: foregroundStyle.color, background: buttonStyle.backgroundColor, ratio: (lighter + 0.05) / (darker + 0.05) };
    });
    expect(menuContrast.ratio, `Excalidraw menu icon contrast ${menuContrast.foreground} on ${menuContrast.background}`).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath('free-board-notebook-dark-narrow.png'), fullPage: false });

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('body')).not.toHaveAttribute('data-ds-dark-theme', /.*/);
    await expect(excalidraw).not.toHaveClass(/theme--dark/);
    await expect(page.locator('body')).toHaveAttribute('data-notara-style', 'notebook');
    await expect.poll(() => notebookInput.evaluate(element => getComputedStyle(element).borderRadius)).toBe('6px 8px 5px 7px');
    expectNoUnexpectedErrors(errors);
  } finally {
    errors.dispose();
    await testInfo.attach('page-diagnostics', { body: JSON.stringify(errors), contentType: 'application/json' });
    await client.close();
    await runtime.stop();
  }
});
