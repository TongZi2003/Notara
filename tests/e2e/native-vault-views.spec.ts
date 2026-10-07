import { test, expect, type Page, type Request, type Response } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';

/**
 * Migrated to the minimal-split contract (docs/dev-log/2026-09-21-vault-minimal-split.md):
 * the standalone reader tab is deleted and PDF/Markdown both open inside the assets
 * view; the tabs are 对话/文件/图谱/卡片; the file rail starts collapsed behind
 * 展开文件栏; graph details list child cards instead of the full excerpt; card
 * creation lives inside 打开摘录工具; splitting is 带入对话拆分 and walks into the
 * native chat split pane instead of a dialog. Every behaviour assertion of the
 * pre-migration spec is kept — only the entry points moved.
 */
const railNav = (page: Page) => page.getByRole('navigation', { name: '学习导航' });
const tab = (page: Page, name: string) => {
  const vault = ['文件','图谱','卡片'].includes(name);
  const target = vault ? page.getByRole('tablist', { name: 'Vault 视图' }).getByRole('tab', { name, exact: true }) : page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name, exact: true });
  return { click: async () => { if (vault) { if (!(await target.isVisible())) await railNav(page).getByRole('button', { name: 'Vault', exact: true }).click(); await page.waitForTimeout(500); if (!(await target.isVisible()) && await railNav(page).getByRole('button', { name: '展开面板', exact: true }).isVisible()) await railNav(page).getByRole('button', { name: '展开面板', exact: true }).click(); } else if (!(await target.isVisible())) { await railNav(page).getByRole('button', { name: '首页', exact: true }).click(); await page.locator('.nv-panel .nv-session-row').first().click(); } await target.click(); }, target };
};
const detailsPane = (page: Page) => page.getByRole('complementary', { name: '节点详情' });
// The wording of the card-creation action inside 打开摘录工具 is still moving.
const createCard = (page: Page) => page.getByRole('button', { name: /创建摘录卡片|提取为 Markdown 卡片|提取段落为卡片/ });
const cardCreated = /已(?:提取|创建)/;

test('vault views keep file facts, node-centred graph details and one chat mount', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime: VaultRuntime = await startVaultIsolated({ testModel: true });
  await testInfo.attach('isolated-runtime', { body: JSON.stringify({ root: runtime.root, workspace: join(runtime.root, 'workspace'), url: new URL(runtime.authUrl).origin, node: process.version }), contentType: 'application/json' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const responseByRequest = new Map<Request, Response>();
  page.on('response', response => responseByRequest.set(response.request(), response));
  const waitForRpcResponse = async (request: Request) => {
    const response = responseByRequest.get(request) ?? await page.waitForResponse(candidate => candidate.request() === request);
    expect(response.ok()).toBe(true);
    expect(await response.finished()).toBeNull();
  };
  let releaseFirstPdfRead!: () => void, releaseFocusedPdfRead!: () => void;
  let signalFirstPdfReadContinued!: () => void, signalFocusedPdfReadStarted!: () => void, signalFocusedPdfReadContinued!: () => void;
  const firstPdfReadGate = new Promise<void>(resolve => { releaseFirstPdfRead = resolve; });
  const focusedPdfReadGate = new Promise<void>(resolve => { releaseFocusedPdfRead = resolve; });
  const firstPdfReadContinued = new Promise<void>(resolve => { signalFirstPdfReadContinued = resolve; });
  const focusedPdfReadStarted = new Promise<void>(resolve => { signalFocusedPdfReadStarted = resolve; });
  const focusedPdfReadContinued = new Promise<void>(resolve => { signalFocusedPdfReadContinued = resolve; });
  const releasePendingReads: Array<() => void> = [releaseFirstPdfRead, releaseFocusedPdfRead];
  const pendingReadContinuations: Promise<void>[] = [firstPdfReadContinued, focusedPdfReadContinued];
  let pdfAssetReadCount = 0;
  let firstPdfReadRequest: Request | undefined, focusedPdfReadRequest: Request | undefined;
  await page.route('**/api/notaraVault/readAsset', async route => {
    const request = route.request().postDataJSON() as { payload?: { args?: { input?: { path?: string } } } };
    if (request.payload?.args?.input?.path === '媒体/向量讲义.pdf') {
      pdfAssetReadCount++;
      const ordinal = pdfAssetReadCount;
      const isFirstPdfRead = ordinal === 1, isFocusedPdfRead = ordinal === 2;
      if (isFirstPdfRead) firstPdfReadRequest = route.request();
      if (isFocusedPdfRead) focusedPdfReadRequest = route.request();
      if (isFirstPdfRead) await firstPdfReadGate;
      if (isFocusedPdfRead) { signalFocusedPdfReadStarted(); await focusedPdfReadGate; }
      try { await route.continue(); }
      finally {
        if (isFirstPdfRead) signalFirstPdfReadContinued();
        if (isFocusedPdfRead) signalFocusedPdfReadContinued();
      }
      return;
    }
    await route.continue();
  });
  const expandRail = async () => {
    const toggle = page.getByRole('button', { name: '展开文件栏', exact: true }).first();
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
  };
  try {
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: 'Configure later', exact: true });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already configured */ }
    const composer = page.locator('[data-composer-input][contenteditable="true"], textarea[placeholder]').last();
    await composer.fill('打开知识库'); await composer.press('Enter');

    // One unified tab strip; the reader tab is deleted and the composer is the
    // native chat's single instance, hidden outside the chat tab.
    await expect(tab(page, '对话').target).toBeVisible();
    await railNav(page).getByRole('button', { name: 'Vault', exact: true }).click();
    await expect(tab(page, '文件').target).toBeVisible();
    await tab(page, '文件').click();
    await page.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /向量讲义\.pdf/ }).first().click();
    await expect.poll(() => pdfAssetReadCount, { timeout: 10_000 }).toBe(1);
    await expect(tab(page, '图谱').target).toBeVisible();
    await expect(tab(page, '卡片').target).toBeVisible();
    await expect(page.getByRole('tab', { name: '阅读器', exact: true })).toHaveCount(0);

    await tab(page, '卡片').click();
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeHidden();
    await expect(page.getByText(/还没有卡片/)).toBeVisible();
    await tab(page, '对话').click();
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    // The native shell sidebar still folds and unfolds: the rail drives it.
    await railNav(page).getByRole('button', { name: '收起面板', exact: true }).click();
    await railNav(page).getByRole('button', { name: '展开面板', exact: true }).click();
    await expect(railNav(page).getByRole('button', { name: '收起面板', exact: true })).toBeVisible();
    await tab(page, '卡片').click();

    // External writes are file facts. Both views must refresh without a reload.
    const cards = join(runtime.root, 'workspace/vault/卡片');
    await mkdir(cards, { recursive: true });
    await writeFile(join(cards, '坐标卡.md'), '---\ntype: card\n---\n# 坐标卡\n\n![[媒体/向量讲义.pdf#page=2&rect=0.1,0.1,0.8,0.2]]\n\n> A point can be described by its coordinates.\n');
    await writeFile(join(cards, '导航焦点.md'), '---\ntype: card\n---\n# 导航焦点\n\n![[知识/向量.md]]\n');
    await expect(page.getByRole('button', { name: '打开卡片 坐标卡', exact: true })).toBeVisible();
    await page.getByPlaceholder('搜索卡片…').fill('不存在');
    await expect(page.getByText('没有符合条件的卡片。')).toBeVisible();
    await page.getByPlaceholder('搜索卡片…').fill('');

    // A card source now lands in the assets view, on the original page and region.
    await page.getByRole('button', { name: /媒体\/向量讲义\.pdf · 第 2 页/ }).click();
    await expect.poll(() => pdfAssetReadCount, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await focusedPdfReadStarted;
    // Keep the explicit page-2 focus open pending long enough to expose a
    // competing default-page open after the shell acknowledges navigation.
    await page.waitForTimeout(250);
    const readsWhileFocusedOpenWasPending = pdfAssetReadCount;
    releaseFocusedPdfRead();
    releaseFirstPdfRead();
    await Promise.all([firstPdfReadContinued, focusedPdfReadContinued]);
    await page.unroute('**/api/notaraVault/readAsset');
    if (!firstPdfReadRequest || !focusedPdfReadRequest) throw new Error('Expected both delayed PDF readAsset requests to be intercepted.');
    await Promise.all([waitForRpcResponse(firstPdfReadRequest), waitForRpcResponse(focusedPdfReadRequest)]);
    await page.waitForTimeout(250);
    const raceMetricsPath = testInfo.outputPath('pdf-focus-race-requests.json');
    await writeFile(raceMetricsPath, JSON.stringify({ initialAndFocusedReadsHeld: true, callsWhilePending: readsWhileFocusedOpenWasPending }, null, 2));
    await testInfo.attach('pdf-focus-race-requests', { path: raceMetricsPath, contentType: 'application/json' });
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2');
    // The card's region is the current selection: the excerpt tool opens on it.
    await expect(page.getByText(/第 2 页原始区域/)).toBeVisible();

    // Switching views keeps that locate target without a second reader tab.
    await tab(page, '图谱').click();
    await tab(page, '文件').click();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2');

    // The Vault section lists the files in the side panel.
    await expect(page.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /向量讲义\.pdf/ }).first()).toBeVisible();

    // Creating a preferred page while another focused Markdown read is pending
    // must keep the new page selected even if the post-create file-list refresh
    // fails. The old response is released only after the created page is shown.
    await tab(page, '图谱').click();
    const preferenceRaceNode = page.getByRole('button', { name: '图谱节点 导航焦点', exact: true });
    await expect(preferenceRaceNode).toBeVisible();
    await preferenceRaceNode.click();
    const preferenceRacePane = detailsPane(page);
    const preferenceRaceSource = preferenceRacePane.getByRole('button', { name: /知识\/向量\.md/ }).first();
    if (!(await preferenceRaceSource.isVisible())) await preferenceRacePane.getByText('来源', { exact: true }).click();
    await expect(preferenceRaceSource).toBeVisible();
    let releasePendingPreferredRead!: () => void, signalPreferredReadContinued!: () => void;
    const pendingPreferredReadGate = new Promise<void>(resolve => { releasePendingPreferredRead = resolve; });
    const preferredReadContinued = new Promise<void>(resolve => { signalPreferredReadContinued = resolve; });
    releasePendingReads.push(releasePendingPreferredRead);
    pendingReadContinuations.push(preferredReadContinued);
    const pendingPreferredReadRequests: Request[] = [];
    const createdPageReadRequests: Request[] = [];
    await page.route('**/api/notaraVault/read', async route => {
      const request = route.request().postDataJSON() as { payload?: { args?: { input?: { path?: string } } } };
      const path = request.payload?.args?.input?.path;
      if (path === '知识/向量.md') {
        const isPendingFocusRead = pendingPreferredReadRequests.length === 0;
        pendingPreferredReadRequests.push(route.request());
        if (isPendingFocusRead) await pendingPreferredReadGate;
        try { await route.continue(); }
        finally { if (isPendingFocusRead) signalPreferredReadContinued(); }
        return;
      }
      if (path === '卡片/我的摘录.md') createdPageReadRequests.push(route.request());
      await route.continue();
    });
    await preferenceRaceSource.click();
    await expect.poll(() => pendingPreferredReadRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);

    // 新建页面 opens a dialog; the Markdown page lands in the vault.
    await page.getByRole('button', { name: '新建页面', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('模板').first()).toBeVisible();
    await dialog.getByLabel('页面标题').fill('我的摘录');
    await dialog.getByLabel('目标路径').fill('卡片/我的摘录.md');
    await expect(dialog.getByRole('button', { name: '创建 Markdown 页面', exact: true })).toBeEnabled();

    let listFailureReplies = 0;
    let creationPersisted = false;
    let creationResponseCompleted = false;
    let listFailureRepliesBeforeCreateResponse = 0;
    let createFromTemplateRequest: Request | undefined;
    const listFailureRequests: Request[] = [];
    let signalCreateResponseFinished!: () => void;
    const createResponseFinished = new Promise<void>(resolve => { signalCreateResponseFinished = resolve; });
    page.on('response', response => {
      if (response.request() !== createFromTemplateRequest) return;
      void response.finished().then(error => {
        if (!error) creationResponseCompleted = true;
        listFailureRepliesBeforeCreateResponse = listFailureReplies;
        signalCreateResponseFinished();
      });
    });
    await page.route('**/api/notaraVault/createFromTemplate', async route => {
      createFromTemplateRequest = route.request();
      const upstream = await route.fetch();
      const body = await upstream.text();
      const envelope = JSON.parse(body) as { result?: { ok?: unknown } };
      if (envelope.result?.ok !== true) throw new Error('createFromTemplate did not persist the preferred page successfully');
      creationPersisted = true;
      await route.fulfill({ response: upstream, body });
    });
    await page.route('**/api/notaraVault/list', async route => {
      const upstream = await route.fetch();
      if (!creationPersisted) {
        await route.fulfill({ response: upstream });
        return;
      }
      await createResponseFinished;
      if (!creationResponseCompleted) {
        await route.fulfill({ response: upstream });
        return;
      }
      const envelope = JSON.parse(await upstream.text()) as { type?: unknown; rpcId?: unknown; result?: unknown };
      if (typeof envelope.type !== 'string' || typeof envelope.rpcId !== 'string') throw new Error('list RPC did not use the expected Typert response envelope');
      listFailureRequests.push(route.request());
      listFailureReplies++;
      await route.fulfill({ response: upstream, body: JSON.stringify({
        ...envelope,
        result: { ok: false, error: { code: 'gateway/internal', message: 'injected list failure', details: {} } },
      }) });
    });
    await dialog.getByRole('button', { name: '创建 Markdown 页面', exact: true }).click();
    await expect.poll(() => creationPersisted, { timeout: 10_000 }).toBe(true);
    if (!createFromTemplateRequest) throw new Error('Expected the page creation RPC to be intercepted.');
    await waitForRpcResponse(createFromTemplateRequest);
    await createResponseFinished;
    expect(creationResponseCompleted).toBe(true);
    expect(listFailureRepliesBeforeCreateResponse).toBe(0);
    await page.unroute('**/api/notaraVault/createFromTemplate');
    await expect.poll(() => listFailureReplies, { timeout: 10_000 }).toBeGreaterThan(0);
    await waitForRpcResponse(listFailureRequests[0]!);
    await expect.poll(() => createdPageReadRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await waitForRpcResponse(createdPageReadRequests[0]!);
    await expect(page.getByRole('heading', { name: '我的摘录', exact: true })).toBeVisible();
    await page.unroute('**/api/notaraVault/list');
    expect(await readFile(join(cards, '我的摘录.md'), 'utf8')).toContain('# 我的摘录');
    releasePendingPreferredRead();
    await preferredReadContinued;
    await waitForRpcResponse(pendingPreferredReadRequests[0]!);
    await page.waitForTimeout(250);
    await page.unroute('**/api/notaraVault/read');
    await expect(page.getByRole('heading', { name: '我的摘录', exact: true })).toBeVisible();
    const preferredCreateMetricsPath = testInfo.outputPath('pdf-pending-preferred-create.json');
    await writeFile(preferredCreateMetricsPath, JSON.stringify({
      pendingMarkdownReads: pendingPreferredReadRequests.length,
      successfulCreateRpcPersisted: creationPersisted,
      createResponseCompletedBeforeInjectedListFailure: creationResponseCompleted,
      listFailuresBeforeCreateResponse: listFailureRepliesBeforeCreateResponse,
      actualListRpcFailureReplies: listFailureReplies,
      createdPageReadRepliesCompleted: createdPageReadRequests.length,
      staleMarkdownResponseCompletedAfterCreatedPageShown: true,
      finalSelectedPath: '卡片/我的摘录.md',
    }, null, 2));
    await testInfo.attach('pdf-pending-preferred-create', { path: preferredCreateMetricsPath, contentType: 'application/json' });
    expect(await readFile(join(cards, '我的摘录.md'), 'utf8')).toContain('# 我的摘录');

    // Double-clicking a graph node opens the file in the assets view: one reader.
    await tab(page, '图谱').click();
    const pdfNode = page.getByRole('button', { name: '图谱节点 向量讲义.pdf', exact: true });
    await pdfNode.dblclick();
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toBeVisible();

    await tab(page, '图谱').click();
    const node = page.getByRole('button', { name: '图谱节点 坐标卡', exact: true });
    await expect(node).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath('graph-before.png') });
    await node.click();
    const pane = detailsPane(page);
    await expect(pane).toContainText('叶子卡片');
    await expect(pane).toContainText('第 2 页');
    // Details carry the child-card roll-up, never the document body.
    await expect(pane).toContainText(/子卡片\s*[:：]?\s*0/);
    await expect(pane).not.toContainText('A point can be described by its coordinates.');
    // A listed source navigates into the assets view at its own page.
    await pane.getByText('来源', { exact: true }).click();
    await pane.getByRole('button', { name: /媒体\/向量讲义\.pdf/ }).first().click();
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2');

    // A user can cancel a pending focus on another file by choosing the
    // already-open PDF from the rail; the late Markdown read must not take over.
    await tab(page, '图谱').click();
    const navigationNode = page.getByRole('button', { name: '图谱节点 导航焦点', exact: true });
    await expect(navigationNode).toBeVisible();
    await navigationNode.click();
    const navigationPane = detailsPane(page);
    const markdownSource = navigationPane.getByRole('button', { name: /知识\/向量\.md/ }).first();
    if (!(await markdownSource.isVisible())) await navigationPane.getByText('来源', { exact: true }).click();
    await expect(markdownSource).toBeVisible();
    let releaseMarkdownFocus!: () => void, signalMarkdownReadContinued!: () => void;
    const markdownFocusGate = new Promise<void>(resolve => { releaseMarkdownFocus = resolve; });
    const markdownReadContinued = new Promise<void>(resolve => { signalMarkdownReadContinued = resolve; });
    releasePendingReads.push(releaseMarkdownFocus);
    pendingReadContinuations.push(markdownReadContinued);
    let markdownFocusReads = 0;
    const markdownReadRequests: Request[] = [];
    const navigationReadPaths: string[] = [];
    const navigationAssetReadPaths: string[] = [];
    const navigationPdfReadRequests: Request[] = [];
    const navigationPdfAssetRequests: Request[] = [];
    await page.route('**/api/notaraVault/read', async route => {
      const request = route.request().postDataJSON() as { payload?: { args?: { input?: { path?: string } } } };
      const path = request.payload?.args?.input?.path;
      if (typeof path === 'string') navigationReadPaths.push(path);
      if (path === '媒体/向量讲义.pdf') navigationPdfReadRequests.push(route.request());
      if (path === '知识/向量.md') {
        markdownFocusReads++;
        markdownReadRequests.push(route.request());
        const isFirstMarkdownRead = markdownFocusReads === 1;
        if (isFirstMarkdownRead) await markdownFocusGate;
        try { await route.continue(); }
        finally { if (isFirstMarkdownRead) signalMarkdownReadContinued(); }
        return;
      }
      await route.continue();
    });
    await page.route('**/api/notaraVault/readAsset', async route => {
      const request = route.request().postDataJSON() as { payload?: { args?: { input?: { path?: string } } } };
      const path = request.payload?.args?.input?.path;
      if (typeof path === 'string') navigationAssetReadPaths.push(path);
      if (path === '媒体/向量讲义.pdf') navigationPdfAssetRequests.push(route.request());
      await route.continue();
    });
    await markdownSource.click();
    await expect.poll(() => markdownFocusReads, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2');
    await tab(page, '文件').click();
    await expandRail();
    await page.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /向量讲义\.pdf/ }).first().click();
    const markdownFocusReadsAtSelection = markdownFocusReads;
    // The second real navigation must issue a fresh PDF open while the prior
    // Markdown read is still held. Wait for that open's asset RPC to finish
    // before releasing the stale Markdown response below.
    await expect.poll(() => navigationPdfReadRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const selectedPdfReadRequest = navigationPdfReadRequests.at(-1)!;
    await waitForRpcResponse(selectedPdfReadRequest);
    if (navigationPdfAssetRequests.length === 0) {
      const diagnosticPath = testInfo.outputPath('pdf-navigation-rpc-paths.json');
      await writeFile(diagnosticPath, JSON.stringify({ navigationReadPaths, navigationAssetReadPaths, pdfReadResponseFinished: true }, null, 2));
      await testInfo.attach('pdf-navigation-rpc-paths', { path: diagnosticPath, contentType: 'application/json' });
    }
    await expect.poll(() => navigationPdfAssetRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const selectedPdfAssetRequest = navigationPdfAssetRequests.at(-1)!;
    await waitForRpcResponse(selectedPdfAssetRequest);
    const delayedMarkdownRequests = [...markdownReadRequests];
    releaseMarkdownFocus();
    await markdownReadContinued;
    await Promise.all(delayedMarkdownRequests.map(waitForRpcResponse));
    await page.waitForTimeout(250);
    await page.unroute('**/api/notaraVault/read');
    await page.unroute('**/api/notaraVault/readAsset');
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('1');
    await expect(page.getByLabel('Markdown Live Preview 编辑器')).toHaveCount(0);

    // Choosing the same PDF while a focused page request is pending is an
    // ordinary file open and must return to its default page.
    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '图谱节点 坐标卡', exact: true }).click();
    const coordinatePane = detailsPane(page);
    const pdfSource = coordinatePane.getByRole('button', { name: /媒体\/向量讲义\.pdf/ }).first();
    if (!(await pdfSource.isVisible())) await coordinatePane.getByText('来源', { exact: true }).click();
    await expect(pdfSource).toBeVisible();
    let releaseSamePdfFocus!: () => void, signalSamePdfReadContinued!: () => void;
    const samePdfFocusGate = new Promise<void>(resolve => { releaseSamePdfFocus = resolve; });
    const samePdfReadContinued = new Promise<void>(resolve => { signalSamePdfReadContinued = resolve; });
    releasePendingReads.push(releaseSamePdfFocus);
    pendingReadContinuations.push(samePdfReadContinued);
    let samePdfFocusReads = 0;
    const samePdfReadRequests: Request[] = [];
    await page.route('**/api/notaraVault/readAsset', async route => {
      const request = route.request().postDataJSON() as { payload?: { args?: { input?: { path?: string } } } };
      if (request.payload?.args?.input?.path === '媒体/向量讲义.pdf') {
        samePdfFocusReads++;
        samePdfReadRequests.push(route.request());
        const isFocusedRead = samePdfFocusReads === 1;
        if (isFocusedRead) await samePdfFocusGate;
        try { await route.continue(); }
        finally { if (isFocusedRead) signalSamePdfReadContinued(); }
        return;
      }
      await route.continue();
    });
    await pdfSource.click();
    await expect.poll(() => samePdfFocusReads, { timeout: 10_000 }).toBeGreaterThan(0);
    await tab(page, '文件').click();
    await expandRail();
    await page.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /向量讲义\.pdf/ }).first().click();
    await expect.poll(() => samePdfFocusReads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    const samePdfFocusReadsAtSelection = samePdfFocusReads;
    releaseSamePdfFocus();
    await samePdfReadContinued;
    await Promise.all(samePdfReadRequests.map(waitForRpcResponse));
    await page.waitForTimeout(250);
    await page.unroute('**/api/notaraVault/readAsset');
    await expect(page.locator('canvas[aria-label="向量讲义.pdf"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('1');
    const navigationMetricsPath = testInfo.outputPath('pdf-navigation-races.json');
    await writeFile(navigationMetricsPath, JSON.stringify({
      markdownFocusReadsAtSelection,
      pdfRailNavigationReadPaths: navigationReadPaths,
      pdfRailNavigationAssetReadPaths: navigationAssetReadPaths,
      pdfReadResponseCompletedBeforeStaleMarkdownRelease: true,
      pdfAssetResponseCompletedBeforeStaleMarkdownRelease: true,
      staleMarkdownResponsesCompletedBeforeFinalAssertion: markdownReadRequests.length,
      samePdfFocusReadsAtSelection,
      samePdfResponsesCompleted: samePdfReadRequests.length,
      selectedPageAfterSamePathOpen: 1,
    }, null, 2));
    await testInfo.attach('pdf-navigation-races', { path: navigationMetricsPath, contentType: 'application/json' });

    // 打开摘录工具 creates the child card with its parent and anchor.
    await tab(page, '卡片').click();
    await page.getByRole('button', { name: '打开卡片 坐标卡', exact: true }).click();
    await page.getByRole('button', { name: '打开摘录工具', exact: true }).click();
    await page.getByLabel('卡片标题', { exact: true }).fill('坐标子卡');
    await createCard(page).click();
    await expect(page.getByText(cardCreated).first()).toBeVisible();
    const child = await readFile(join(cards, '坐标子卡.md'), 'utf8');
    expect(child).toContain('parent: 卡片/坐标卡.md');
    expect(child).toContain('![[卡片/坐标卡.md#anchor=');

    // The same tool extracts a heading-anchored card from a Markdown page.
    await tab(page, '文件').click();
    await expandRail();
    await page.getByRole('button', { name: /向量\.md/ }).first().click();
    await expect(page.getByLabel('Markdown Live Preview 编辑器')).toBeVisible();
    await page.getByRole('button', { name: '打开摘录工具', exact: true }).click();
    await page.getByLabel('摘录段落').selectOption('关键联系');
    await page.getByLabel('卡片标题', { exact: true }).fill('基底摘录');
    await createCard(page).click();
    await expect(page.getByText(cardCreated).first()).toBeVisible();
    expect(await readFile(join(cards, '基底摘录.md'), 'utf8')).toContain('#anchor=%E5%85%B3%E9%94%AE%E8%81%94%E7%B3%BB');
    expect((await readdir(cards)).length).toBe(5);

    // The child card now shows up as a name in the graph details.
    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '图谱节点 坐标卡', exact: true }).click();
    await expect(detailsPane(page)).toContainText('中间卡片');
    await expect(detailsPane(page)).toContainText(/子卡片\s*[:：]?\s*1/);
    await expect(detailsPane(page).getByRole('button', { name: '坐标子卡', exact: true })).toBeVisible();
    expect((await page.locator('.nv-views:visible').boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('graph.png') });

    // Card library filters by source and keeps the parent out of the result.
    await tab(page, '卡片').click();
    await page.getByLabel('来源过滤').selectOption('卡片/坐标卡.md');
    await expect(page.getByRole('button', { name: '打开卡片 坐标子卡', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '打开卡片 坐标卡', exact: true })).toHaveCount(0);
    expect((await page.locator('.nv-views:visible').boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('cards.png') });

    // A heading locator survives content inserted before its source section.
    await writeFile(join(runtime.root, 'workspace/vault/知识/向量.md'), '# 向量\n\n新增前言。\n\n## 关键联系\n基底仍是坐标的语言。\n');
    await page.getByLabel('来源过滤').selectOption('知识/向量.md');
    await page.getByRole('button', { name: '打开卡片 基底摘录', exact: true }).click();
    await page.getByRole('button', { name: /知识\/向量\.md · 关键联系/ }).click();
    await page.getByRole('button', { name: '打开摘录工具', exact: true }).click();
    await expect(page.getByLabel('摘录段落')).toHaveValue('关键联系');
    await expect(page.getByLabel('摘录内容')).toHaveValue(/基底仍是坐标的语言/);
    await page.getByRole('button', { name: '打开摘录工具', exact: true }).click();
    const editor = page.getByLabel('Markdown Live Preview 编辑器').locator('.cm-content');
    await expect(editor).toBeVisible();
    await editor.press('ControlOrMeta+End');
    await editor.press('Enter'); await editor.pressSequentially('保留的草稿');
    await tab(page, '图谱').click();
    await tab(page, '文件').click();
    await expect(editor).toContainText('保留的草稿');
    await page.getByRole('button', { name: '文件操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '放弃修改', exact: true }).click();

    // Graph interactions: pin, zoom, pan, camera reset and detail width.
    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '图谱节点 向量讲义.pdf', exact: true }).click();
    const separator = page.getByRole('separator', { name: '调整详情宽度' });
    const before = Number(await separator.getAttribute('aria-valuenow'));
    const handle = (await separator.boundingBox())!;
    await page.mouse.move(handle.x + 3, handle.y + 70); await page.mouse.down();
    await page.mouse.move(handle.x - 50, handle.y + 70, { steps: 5 }); await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', String(before + 53));
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();

    const board = page.locator('.nv-graph-board');
    const boardBox = (await board.boundingBox())!;
    expect(boardBox.x).toBeGreaterThanOrEqual(0);
    await page.mouse.move(boardBox.x + 50, boardBox.y + 60); await page.mouse.wheel(0, -200);
    await expect(board.getByText('100%', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '居中', exact: true }).click();
    const camera = page.locator('.nv-graph-svg > g');
    const cameraBefore = await camera.getAttribute('transform');
    await page.mouse.move(boardBox.x + 30, boardBox.y + 30); await page.mouse.down();
    await page.mouse.move(boardBox.x + 60, boardBox.y + 50, { steps: 5 }); await page.mouse.up();
    await expect(camera).not.toHaveAttribute('transform', cameraBefore!);
    await page.getByRole('button', { name: '居中', exact: true }).click();
    await pdfNode.click();
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await pdfNode.hover();
    const point = (await pdfNode.boundingBox())!;
    await page.mouse.move(point.x + point.width / 2, point.y + 23); await page.mouse.down();
    await page.mouse.move(point.x + point.width / 2 + 40, point.y + 43, { steps: 6 }); await page.mouse.up();
    await expect(pdfNode).toHaveAttribute('data-fixed', 'true');
    await tab(page, '卡片').click();
    await tab(page, '图谱').click();
    await expect(pdfNode).toHaveAttribute('data-fixed', 'true');

    // 带入对话拆分 pre-fills the native split instead of opening a dialog, and
    // it never sends: the reference and the intent stay an editable draft.
    await page.getByRole('button', { name: '图谱节点 向量', exact: true }).click();
    await expect(page.getByRole('button', { name: '继续拆分', exact: true })).toHaveCount(0);
    await detailsPane(page).getByRole('button', { name: '带入对话拆分', exact: true }).click();
    await expect(page.locator('[data-nv-split]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toHaveCount(1);
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    const chatBox = (await page.getByRole('region', { name: '对话区域' }).boundingBox())!;
    const inputBox = (await page.locator('[data-composer-input]').boundingBox())!;
    expect(inputBox.x).toBeGreaterThanOrEqual(chatBox.x);
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(chatBox.x + chatBox.width + 1);
    await expect(page.locator('[data-composer-input]')).toContainText('拆分');
    await expect(page.locator('[data-composer-input]')).toContainText('基底摘录');
    await expect(page.locator('[data-nv-split]')).toContainText('向量');
    await page.getByRole('tablist', { name: '资料面板视图' }).getByRole('tab', { name: '卡片', exact: true }).click();
    await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '对话', exact: true }).click();
    await expect(page.locator('[data-composer-input]')).toContainText('拆分');
    await page.screenshot({ path: testInfo.outputPath('split.png') });

    // Browser reload reconstructs the projection solely from the saved files.
    await page.reload();
    await tab(page, '卡片').click();
    await expect(page.getByRole('button', { name: /^打开卡片 / })).toHaveCount(5);
    await page.setViewportSize({ width: 600, height: 900 });
    await tab(page, '图谱').click();
    await page.getByRole('button', { name: '图谱节点 坐标卡', exact: true }).click();
    await expect(detailsPane(page)).toBeVisible();
    // On a narrow pane the graph stacks above the details instead of beside them.
    const graphBox = (await page.locator('.nv-graph-board').boundingBox())!;
    expect(graphBox.y + graphBox.height).toBeLessThanOrEqual((await detailsPane(page).boundingBox())!.y + 1);
    expect((await detailsPane(page).boundingBox())!.x).toBeGreaterThanOrEqual(0);
    // 坐标卡 now has a child card, so it is brought to be split, not whole.
    await expect(detailsPane(page).getByRole('heading', { name: '子卡片 1', exact: true })).toBeVisible();
    await expect(detailsPane(page).getByRole('button', { name: '带入对话拆分', exact: true })).toBeVisible();
    await expect(detailsPane(page).getByRole('button', { name: '带入对话', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('narrow.png') });

    await writeFile(join(cards, '失效来源.md'), '---\ntype: card\n---\n# 失效来源\n\n![[媒体/不存在.pdf#page=3]]\n');
    await tab(page, '卡片').click();
    await page.getByRole('button', { name: /媒体\/不存在\.pdf/ }).click();
    await expect(page.getByRole('alert')).toContainText('无法打开这个文件');

    // An empty vault still renders explicit empty states in every view.
    await rm(join(runtime.root, 'workspace/vault'), { recursive: true });
    await tab(page, '图谱').click();
    await expect(page.getByText('还没有文件。在 Vault 的「文件」里导入资料或新建页面。')).toBeVisible();
    await expect(page.locator('[data-node]')).toHaveCount(0);
    await tab(page, '卡片').click();
    await expect(page.getByText(/还没有卡片/)).toBeVisible();
    await tab(page, '文件').click();
    await expect(page.getByText('资料库还是空的')).toBeVisible();
    // With nothing open, the bar names the view by its current name.
    await expect(page.locator('.nv-assets .nv-breadcrumb')).toHaveText('文件');
    await expect(page.locator('canvas[aria-label]')).toHaveCount(0);
    expect(errors.filter(text => !/favicon|net::|downloadable font/i.test(text))).toEqual([]);
  } finally {
    for (const release of releasePendingReads) release();
    await Promise.race([Promise.all(pendingReadContinuations), page.waitForTimeout(1000)]).catch(() => {});
    await page.unroute('**/api/notaraVault/read').catch(() => {});
    await page.unroute('**/api/notaraVault/readAsset').catch(() => {});
    await page.unroute('**/api/notaraVault/list').catch(() => {});
    await page.unroute('**/api/notaraVault/createFromTemplate').catch(() => {});
    await testInfo.attach('console-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('final-state.png') });
    await testInfo.attach('graph-geometry', { body: JSON.stringify(await page.locator('.nv-graph-board, .nv-graph-layout, .nv-views').evaluateAll(nodes => nodes.map(node => ({ className: node.className, box: node.getBoundingClientRect().toJSON() })))), contentType: 'application/json' });
    await runtime.stop();
  }
});
