import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, enterClassroom, sendInput, typeInput } from './fixtures/classroom.ts';
import { readerImage } from '../fixtures/materials/reader-image.ts';
import { scannedPdf } from '../fixtures/materials/synthetic-pdf.ts';
import { docxWithBody } from '../fixtures/materials/docx-fixtures.ts';
import type { CardView } from '../../packages/contracts/src/cards.ts';
import type { MaterialView } from '../../packages/contracts/src/material-records.ts';
import { decodeSourceFragments } from '../../packages/contracts/src/source-context.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';

test('selected text travels in the native message and returns to the same immutable source after refresh', async ({ page, classroom }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGEERROR', error.message); });
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '开始看原题');
  await expect(page.getByText('收到：开始看原题', { exact: false })).toBeVisible();
  const file = info.outputPath('原题.txt');
  await writeFile(file, '第一行\n递增区间\n第三行', 'utf8');
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(file);
  await page.getByTestId('material-row').first().getByRole('button').first().click();
  await expect(page.getByTestId('material-text')).toBeVisible();
  await page.getByTestId('material-open-classroom').click();
  const panel = page.locator('[data-sidebar-right-panel]');
  const text = panel.getByTestId('material-text');
  await expect(text).toBeVisible();
  await text.evaluate(element => {
    const node = element.firstChild!;
    const range = document.createRange(); range.setStart(node, 4); range.setEnd(node, 8);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(panel.getByRole('status').filter({ hasText: '已选好' })).toBeVisible();
  await page.locator('[data-composer-input]').click();
  await expect(page.getByTestId('composer-context')).toContainText('原题 · 选段');
  await typeInput(page, '我认为它递增。');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('message-sources').getByRole('button').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('studyforge-source');
  await expect(page.locator('body')).not.toContainText('versionId');
  await page.getByTestId('message-sources').getByRole('button').first().click();
  await expect(panel.getByTestId('source-text')).toContainText('递增区间');
  await expect(panel.getByTestId('source-highlight').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('source-roundtrip.png'), fullPage: true });
  const requests = await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8');
  expect(requests).toContain('studyforge-source');
  expect(requests).toContain('递增区间');
  await enterClassroom(page, classroom.authUrl);
  await expect(page.locator('body')).not.toContainText('studyforge-source');
  await page.getByTestId('message-sources').getByRole('button').first().click();
  await expect(page.getByTestId('source-highlight').first()).toBeVisible();
  await sendInput(page, '[slow] 先逐步分析这一段。'.repeat(20));
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toBeVisible();
  await typeInput(page, '接下来再问一遍。');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  const queue = page.locator('[data-queue-dock]');
  await expect(queue).toContainText('接下来再问一遍。');
  await expect(queue).not.toContainText('studyforge-source');
  await page.getByRole('button', { name: 'Edit queued message', exact: true }).click();
  const edit = page.getByRole('textbox', { name: 'Edit queued message', exact: true });
  await expect(edit).not.toHaveValue(/studyforge-source/);
  await edit.fill('改成新的问题。'); await edit.press('Enter');
  await expect(queue).toContainText('改成新的问题。');
  await page.getByRole('button', { name: 'Steer queued message', exact: true }).click();
  await expect(page.locator('[data-conversation-scroll]').getByText(/已收到：\s*改成新的问题。/)).toBeVisible({ timeout: 40_000 });
  expect(errors).toEqual([]);
});

test('PDF pointer rectangles remain in original coordinates at four rotations and return to their page', async ({ page, classroom }, info) => {
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '检查旋转资料');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：检查旋转资料', { exact: true })).toBeVisible();
  const file = info.outputPath('旋转页.pdf');
  await writeFile(file, scannedPdf(readerImage('jpeg'), 900, 560, [0, 90, 180, 270]));
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(file);
  await page.getByTestId('material-row').first().getByRole('button').first().click();
  await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pdf-displayed-page', '1');
  await page.getByTestId('material-open-classroom').click();
  const panel = page.locator('[data-sidebar-right-panel]');
  const viewer = panel.getByTestId('pdf-viewer');
  const client = await connectRuntime(classroom);
  for (let p = 1; p <= 4; p++) {
    await expect(viewer).toHaveAttribute('data-pdf-displayed-page', String(p));
    await panel.getByTestId('pdf-zoom-in').click();
    const canvas = panel.getByTestId('pdf-canvas');
    await canvas.scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      const a = await canvas.boundingBox(); await page.waitForTimeout(100); const b = await canvas.boundingBox();
      return a?.x === b?.x && a?.width === b?.width;
    }).toBe(true);
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * .1, box.y + box.height * .1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4, { steps: 4 });
    await page.mouse.up();
    await page.locator('[data-composer-input]').click();
    await expect(page.getByTestId('composer-context')).toContainText('旋转页 · 选段');
    await typeInput(page, '看第' + p + '个选段。');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(async () => (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).includes('看第' + p + '个选段。')).toBe(true);
    await expect.poll(async () => {
      const value = await client.rpc<SessionListValue>('session/list', { _request: {} });
      return value.ok && value.value.items.every(item => !item.running);
    }).toBe(true);
    if (p < 4) await panel.getByTestId('pdf-next').click();
  }
  const rows = (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const locators = rows.filter(row => row.purpose !== 'session-title').flatMap(row => {
    const user = row.messages.findLast((m: { role: string; source: { kind: string } }) => m.role === 'user' && m.source.kind === 'user');
    const text = user.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n');
    return decodeSourceFragments(text).fragments.flatMap(f => f.context.selection?.sources.map(s => s.locator) ?? []);
  });
  expect(locators).toHaveLength(4);
  const expected = [[.1,.1,.4,.4], [.1,.6,.4,.9], [.6,.6,.9,.9], [.6,.1,.9,.4]];
  for (const [p, locator] of locators.entries()) {
    expect(locator.kind).toBe('pdf');
    if (locator.kind !== 'pdf') throw new Error('wrong source kind');
    expect(locator.page).toBe(p + 1);
    for (let n = 0; n < 4; n++) expect(locator.rect?.[n]).toBeCloseTo(expected[p]![n]!, 2);
  }
  await page.getByTestId('message-sources').getByRole('button').nth(1).click();
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '2');
  await expect(panel.getByTestId('source-highlight').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('source-pdf-rotations.png'), fullPage: true });
});

test('Word cross-paragraph selection preserves each real block including the middle repeated paragraph', async ({ page, classroom }, info) => {
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '一起读Word');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：一起读Word', { exact: true })).toBeVisible();
  const file = info.outputPath('重复段落.docx');
  await writeFile(file, docxWithBody('<w:p><w:r><w:t>第一段起步</w:t></w:r></w:p><w:p><w:r><w:t>同样的一句话</w:t></w:r></w:p><w:p><w:r><w:t>同样的一句话</w:t></w:r></w:p>'));
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(file);
  await page.getByTestId('material-row').first().getByRole('button').first().click();
  await expect(page.locator('[data-docx-positioned="true"]')).toBeVisible();
  await page.getByTestId('material-open-classroom').click();
  const panel = page.locator('[data-sidebar-right-panel]');
  await expect(panel.locator('[data-sf-block-id]')).toHaveCount(3);
  await panel.getByTestId('docx-body').evaluate(element => {
    const blocks = element.querySelectorAll('[data-sf-block-id]');
    const first = document.createTreeWalker(blocks[0]!, NodeFilter.SHOW_TEXT).nextNode()!;
    const last = document.createTreeWalker(blocks[2]!, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange(); range.setStart(first, 1); range.setEnd(last, 3);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.getByTestId('composer-context')).toContainText('重复段落 · 选段');
  await typeInput(page, '这三段有什么关系？');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('message-sources').getByRole('button')).toHaveCount(3);
  await page.getByTestId('message-sources').getByRole('button').nth(2).click();
  await expect(panel.getByTestId('source-highlight').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('source-docx-repeated.png'), fullPage: true });
  await expect.poll(async () => (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).includes('这三段有什么关系')).toBe(true);
  const rows = (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const messages = rows.filter(row => row.purpose !== 'session-title').at(-1).messages;
  const user = messages.findLast((m: { role: string; source: { kind: string } }) => m.role === 'user' && m.source.kind === 'user');
  const fragment = decodeSourceFragments(user.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')).fragments[0]!;
  const sources = fragment.context.selection!.sources;
  expect(sources).toHaveLength(3);
  expect(new Set(sources.map(source => source.locator.kind === 'docx' ? source.locator.blockId : '')).size).toBe(3);
  expect(fragment.context.selection!.text).toContain('同样的一句话');
});

test('native card reference returns the displayed fixed version without exposing the answer', async ({ page, classroom }, info) => {
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '查看普通卡');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：查看普通卡', { exact: true })).toBeVisible();
  const client = await connectRuntime(classroom);
  const list = await client.rpc<SessionListValue>('session/list', { _request: {} });
  if (!list.ok) throw new Error('native list unavailable');
  const sessionId = list.value.items.find(item => !item.origin)!.sessionId;
  const result = await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: crypto.randomUUID(), sessionId, content: { title: '原卡', presentation: 'problem', front: '第一版题面', sections: [{ heading: '解法', body: '暂时隐藏的解法' }], notes: '', tags: [], links: [], sources: [] },
  } });
  if (!result.ok) throw new Error('card create failed');
  await page.getByTestId('open-lesson').click();
  await page.getByTestId('lesson-materials-refresh').click();
  await page.getByTestId('lesson-resource-row').filter({ hasText: '原卡' }).getByTestId('lesson-resource-open').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('原卡');
  await expect(page.getByTestId('composer-context')).toContainText('原卡');
  await client.rpc('studyforgeLearning/editCard', { input: { operationId: crypto.randomUUID(), target: result.value.ref, expectedVersion: 1, patch: { front: '第二版题面' } } });
  await typeInput(page, '我正看这道题。');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('message-sources').getByRole('button', { name: '原卡' })).toBeVisible();
  await page.getByTestId('message-sources').getByRole('button', { name: '原卡' }).click();
  await expect(page.getByTestId('card-detail-fixed')).toBeVisible();
  await expect(page.getByTestId('card-detail-front')).toContainText('第一版题面');
  await expect(page.locator('body')).not.toContainText('暂时隐藏的解法');
  await expect(page.getByTestId('card-detail-edit')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('source-card-fixed.png'), fullPage: true });
});

test('native admission failure restores a frozen source reference and retry sends it once', async ({ page, classroom }, info) => {
  let rejectNext = false, rejected = false;
  await page.route('**/api/session/prompt', async route => {
    if (!rejectNext) { await route.continue(); return; }
    rejectNext = false; rejected = true;
    const request = route.request().postDataJSON() as { rpcId: string };
    await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { code: 'gateway/internal', message: 'Fixture admission rejected', details: {} } } } });
  });
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '先打开原文');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：先打开原文', { exact: true })).toBeVisible();
  const file = info.outputPath('失败重试.txt'); await writeFile(file, '原版本文字', 'utf8');
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(file);
  await page.getByTestId('material-row').first().getByRole('button').first().click();
  await expect(page.getByTestId('material-text')).toBeVisible();
  await page.getByTestId('material-open-classroom').click();
  await expect(page.getByTestId('composer-context')).toContainText('失败重试');
  await typeInput(page, '带着原文重试');
  rejectNext = true;
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => rejected).toBe(true);
  await expect(page.getByTestId('composer-context')).toContainText('失败重试');
  await expect(page.locator('[data-composer-input]')).toContainText('带着原文重试');
  await expect(page.locator('body')).not.toContainText('studyforge-source');
  const client = await connectRuntime(classroom);
  const materials = await client.rpc<MaterialView[]>('studyforgeMaterials/list', {});
  if (!materials.ok) throw new Error('materials unavailable');
  const original = materials.value[0]!;
  const changed = await client.rpc('studyforgeMaterials/createVersion', { input: {
    operationId: crypto.randomUUID(), expectedVersion: original.revision,
    material: { materialId: original.materialId, title: '失败重试', fileName: '失败重试.txt', mediaType: 'text/plain' },
    base64: Buffer.from('新版本文字').toString('base64'),
  } });
  expect(changed.ok).toBe(true);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('message-sources').getByRole('button', { name: '失败重试' })).toHaveCount(1);
  await expect.poll(async () => (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).includes('带着原文重试')).toBe(true);
  const rows = (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const request = rows.filter(row => row.purpose !== 'session-title').at(-1);
  const user = request.messages.findLast((m: { role: string; source: { kind: string } }) => m.role === 'user' && m.source.kind === 'user');
  const fragment = decodeSourceFragments(user.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')).fragments[0]!;
  expect(fragment.context.currentMaterial).toMatchObject({ kind: 'source', source: { versionId: original.currentVersion.versionId } });
  await page.screenshot({ path: info.outputPath('source-native-failure-retry.png'), fullPage: true });
});

test('pointer-selected image is attached before native sending and native queued steering preserves its frozen reference', async ({ page, classroom }, info) => {
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '先读图');
  await expect(page.locator('[data-conversation-scroll]').getByText('已收到：先读图', { exact: true })).toBeVisible();
  const file = info.outputPath('函数图.png');
  await writeFile(file, readerImage());
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(file);
  await page.getByTestId('material-row').first().getByRole('button').first().click();
  await expect(page.getByTestId('material-image')).toBeVisible();
  await page.getByTestId('material-open-classroom').click();
  const image = page.locator('[data-sidebar-right-panel]').getByTestId('material-image');
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const a = await image.boundingBox();
    await page.waitForTimeout(100);
    const b = await image.boundingBox();
    return a?.x === b?.x && a?.width === b?.width;
  }).toBe(true);
  const box = (await image.boundingBox())!;
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('source-highlight').first()).toBeVisible();
  await page.locator('[data-composer-input]').click();
  await expect(page.getByTestId('composer-context')).toContainText('函数图 · 选段');
  await typeInput(page, '解释我框出的图。');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('message-sources').getByRole('button').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('studyforge-source');
  const client = await connectRuntime(classroom);
  const settled = async () => {
    const reply = await client.rpc<SessionListValue>('session/list', { _request: {} });
    return reply.ok && reply.value.items.every(item => !item.running);
  };
  await expect.poll(settled).toBe(true);
  const requests = (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const latest = requests.filter(row => row.purpose !== 'session-title').at(-1);
  const user = latest.messages.findLast((message: { role: string; source: { kind: string } }) => message.role === 'user' && message.source.kind === 'user');
  expect(user.content.some((block: { type: string }) => block.type === 'image')).toBe(true);
  const frozen = decodeSourceFragments(user.content.filter((block: { type: string }) => block.type === 'text').map((block: { text: string }) => block.text).join('\n')).fragments[0];
  const locator = frozen?.context.selection?.sources[0]?.locator;
  expect(locator?.kind).toBe('image');
  if (locator?.kind !== 'image') throw new Error('wrong source kind');
  if (!locator.rect) throw new Error('missing image crop');
  for (const [i, value] of [.1, .1, .4, .4].entries()) expect(locator.rect[i]).toBeCloseTo(value, 3);
  await sendInput(page, '[slow] 继续逐步分析。'.repeat(20));
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toBeVisible();
  await page.locator('[data-composer-input]').click();
  await expect(page.getByTestId('composer-context')).toBeVisible();
  await typeInput(page, '稍后再看。');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit queued message', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit queued message', exact: true })).toBeDisabled();
  await expect(page.locator('[data-queue-dock]')).not.toContainText('studyforge-source');
  await page.getByRole('button', { name: 'Steer queued message', exact: true }).click();
  await expect.poll(settled, { timeout: 40_000 }).toBe(true);
  await page.screenshot({ path: info.outputPath('source-image-queue.png'), fullPage: true });
});
