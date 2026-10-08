import { test, expect } from '@playwright/test';
import type { SessionPage } from '@deepseek-ai/dsh-api-session-controller';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, outcomeJson } from '../fixtures/vault-http.ts';

test('teacher history tools show Chinese status while query, cursors, raw results and errors stay hidden', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const client = await connectVault(runtime), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const seed = '先保留这条课堂记录，稍后请老师核对。';
  const prompt = '请核对课堂记录，再检查一条找不到的记录。';
  const query = 'HIDDEN_HISTORY_QUERY_319748';
  const missingSeq = 987654321;
  try {
    await client.script({ '__session-title': '课堂记录显示检查', [seed]: '课堂记录已准备。' });
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 6000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill(seed); await input.press('Enter');
    await expect(page.getByText('课堂记录已准备。', { exact: true })).toBeVisible({ timeout: 30_000 });
    const request = (await client.requests()).find(row => row.purpose === null && row.messages.some(message =>
      message.role === 'user' && message.source?.kind === 'user' && message.content.some(block => block.text === seed)));
    expect(request?.sessionId).toBeTruthy();
    const sessionId = request!.sessionId!;
    const cut = client.value(await client.rpc<{ asOfSeq: number }>('session/projections', { request: { sessionId } }));
    const log = client.value(await client.rpc<SessionPage>('session/page', {
      request: { address: { kind: 'session', sessionId }, throughSeq: cut.asOfSeq, maxMessages: 1000 },
    }));
    const original = log.records.find(row => row.type === 'event' && row.event.type === 'user/message' && JSON.stringify(row.event.data).includes(seed));
    expect(original?.type).toBe('event');
    const seq = original!.type === 'event' ? original!.event.seq : -1;
    const before = (await client.turns(sessionId)).length;
    await client.scriptOne(prompt, { calls: [
      { name: 'history_search', arguments: { query } },
      { name: 'history_read', arguments: { seq } },
      { name: 'history_read', arguments: { seq: missingSeq } },
    ], text: '已经核对原始记录，另有一条记录没有找到。' });
    await input.fill(prompt); await input.press('Enter');
    await expect(page.getByText('已经核对原始记录，另有一条记录没有找到。', { exact: true })).toBeVisible({ timeout: 45_000 });
    await client.waitForTurn(sessionId, before);
    // Real native tool success/failure drives these registered frontend rows.
    const outcomes = await client.outcomes(sessionId);
    const search = outcomes.find(row => row.name === 'history_search');
    const reads = outcomes.filter(row => row.name === 'history_read');
    expect(search?.failed).toBe(false);
    expect(outcomeJson<{ query: string }>(search!)?.query).toBe(query);
    expect(reads).toHaveLength(2);
    expect(reads[0]?.failed).toBe(false);
    expect(outcomeJson<{ seq: number; record: { blocks: { text?: string }[] } }>(reads[0]!)?.record.blocks[0]?.text).toBe(seed);
    expect(reads[1]?.failed).toBe(true);
    expect(reads[1]?.text).toContain('MISSING_EVENT_REFERENCE');
    const rows = page.locator('.nv-board-tool-row');
    await expect(rows).toHaveCount(3);
    await expect(rows).toHaveText(['已查找课堂记录', '已回看课堂记录', '课堂记录读取失败']);
    for (const text of ['已查找课堂记录', '已回看课堂记录', '课堂记录读取失败']) {
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText(/history_search|history_read|HIDDEN_HISTORY_QUERY_319748|987654321|native-event-v1|MISSING_EVENT_REFERENCE|previewEncoding|canonical-record|"query"|"seq"|"hits"/);
    await expect(page.locator('[data-composer-input][contenteditable="true"]')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('history-tool-status.png') });
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('console-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await testInfo.attach('isolated-host-log', { body: runtime.log(), contentType: 'text/plain' });
    await client.close(); await runtime.stop();
  }
});
