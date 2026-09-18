/**
 * PDF 标注层在真实 Host 上：拖框圈选照旧成为会话引用，旁边出现「存为标注」；
 * 点击落成 source-only 卡（真实 pdf rect 锚点），选区高亮转为持久标注层；
 * 点标注进卡库；rpc 预置的标注卡打开页面直接显示为标注层。
 */
import { writeFile } from 'node:fs/promises';
import { test, expect, enterClassroom, openMaterial } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { readerImage } from '../fixtures/materials/reader-image.ts';
import { scannedPdf, textPdf } from '../fixtures/materials/synthetic-pdf.ts';
import type { CardView } from '@studyforge/contracts/cards';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('pdf drag saves a persistent annotation card, the layer reopens it, pre-seeded marks show', async ({ page, classroom }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const file = info.outputPath('标注页.pdf');
  await writeFile(file, scannedPdf(readerImage('jpeg'), 900, 560, [0, 90]));
  const client = await connectRuntime(classroom);

  await enterClassroom(page, classroom.authUrl);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(file);
  await openMaterial(page, '标注页');
  const viewer = page.getByTestId('pdf-viewer');
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '1');
  const canvas = page.getByTestId('pdf-canvas');
  await canvas.scrollIntoViewIfNeeded();

  // 拖框：照旧成为选区，出现「存为标注」。
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4, { steps: 4 });
  await page.mouse.up();
  const save = page.getByTestId('annotation-save');
  await expect(save).toBeVisible();
  await expect(page.getByTestId('source-highlight').first()).toBeVisible();

  // 存为标注：source-only 卡落成，持久标注层出现。
  await save.click();
  await expect(page.getByTestId('annotation-mark').first()).toBeVisible();
  const cards = value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}));
  const mark = cards.find(card => card.content.title.includes('标注页'));
  expect(mark).toBeDefined();
  const locator = mark!.content.sources[0]?.locator;
  expect(locator?.kind).toBe('pdf');
  if (locator?.kind !== 'pdf') throw new Error('annotation must anchor a pdf rect');
  expect(locator.page).toBe(1);
  expect(locator.rect?.[0]).toBeCloseTo(.1, 1);
  expect(locator.rect?.[2]).toBeCloseTo(.4, 1);

  // 点标注层进卡库看这张卡。
  await page.getByTestId('annotation-mark').first().click();
  await expect(page.getByTestId('card-detail-title')).toHaveText(mark!.content.title);

  // rpc 预置另一页的标注卡：回到资料页直接显示为标注层（翻页才可见）。
  const material = mark!.content.sources[0]!;
  value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: 'seeded-mark', content: { title: '预置的第二页标注', presentation: 'note', front: '', sections: [], notes: '',
      sources: [{ materialId: material.materialId, versionId: material.versionId, locator: { kind: 'pdf', page: 2, rect: [.2, .2, .5, .5] } }], tags: [], links: [] },
  } }));
  // AI 指路卡：页级锚点没有几何，显示为「指路」角标而不是高亮框。
  value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: 'guide-mark', content: { title: '这一页值得先看', presentation: 'note', front: '定义域决定后面所有讨论。', sections: [], notes: '',
      sources: [{ materialId: material.materialId, versionId: material.versionId, locator: { kind: 'pdf', page: 1 } }], tags: [], links: [] },
  } }));
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await openMaterial(page, '标注页');
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '1');
  await expect(page.getByTestId('annotation-mark')).toHaveCount(1);
  const guide = page.getByTestId('annotation-guide').first();
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('这一页值得先看');
  await viewer.getByTestId('pdf-next').click();
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '2');
  await expect(page.getByTestId('annotation-mark')).toHaveCount(1);
  await expect(page.getByTestId('annotation-mark').first()).toHaveAttribute('title', '预置的第二页标注');
  await expect(page.getByTestId('annotation-guide')).toHaveCount(0);

  // pdftext 摘录卡：有文字层的 PDF 上字节级锚点——createCard 经 resolveAnchor
  // 校验真实页文本后落成，阅读面同样显示为「指路」角标（没有矩形可画）。
  const textFile = info.outputPath('文字层.pdf');
  await writeFile(textFile, textPdf([['alpha first page'], ['bravo second page']]));
  await page.getByTestId('materials-back').click();
  await page.getByTestId('material-file-input').setInputFiles(textFile);
  await expect(page.getByTestId('material-row').filter({ hasText: '文字层' })).toBeVisible();
  const library = value(await client.rpc<{ materialId: string; currentVersion: { versionId: string }; title: string }[]>('studyforgeMaterials/list', {}));
  const textMaterial = library.find(item => item.title === '文字层');
  expect(textMaterial).toBeDefined();
  const excerpt = value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: 'pdftext-mark', content: { title: '第一页的一句话', presentation: 'note', front: '', sections: [], notes: '',
      sources: [{ materialId: textMaterial!.materialId, versionId: textMaterial!.currentVersion.versionId, locator: { kind: 'pdftext', page: 1, start: 0, end: 5 }, quote: 'alpha' }], tags: [], links: [] },
  } }));
  expect(excerpt.content.sources[0]?.locator).toMatchObject({ kind: 'pdftext', page: 1 });
  const { quote: _quote, ...readSource } = excerpt.content.sources[0]!;
  const reading = value(await client.rpc<{ text?: string }>('studyforgeMaterials/read', { input: { source: readSource } }));
  expect(reading.text).toBe('alpha');
  // 只给 quote 的锚点在确认时解析成具体偏移落库：读面不再需要 quote。
  const quoted = value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: 'pdftext-quote', content: { title: '第二页整行', presentation: 'note', front: '', sections: [], notes: '',
      sources: [{ materialId: textMaterial!.materialId, versionId: textMaterial!.currentVersion.versionId, locator: { kind: 'pdftext', page: 2 }, quote: 'bravo second page' }], tags: [], links: [] },
  } }));
  expect(quoted.content.sources[0]?.locator).toEqual({ kind: 'pdftext', page: 2, start: 0, end: 17 });
  await openMaterial(page, '文字层');
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '1');
  // 文字层已渲染：pdftext 卡的字节级锚点画成字形高亮，不是指路角标。
  const layer = page.getByTestId('pdf-text');
  await expect(layer).toHaveAttribute('data-sf-pdf-text', 'ready');
  const pageOneMarks = page.getByTestId('annotation-mark');
  await expect(pageOneMarks).toHaveCount(1);
  await expect(pageOneMarks.first()).toHaveAttribute('title', '第一页的一句话');
  await expect(page.getByTestId('annotation-guide')).toHaveCount(0);

  // 学生拖选文字：选区暂存出现高亮与「存为标注」，落卡拿到字节级 pdftext 锚点。
  const span = layer.locator('[data-sf-base]').first();
  const spanBox = (await span.boundingBox())!;
  await page.mouse.move(spanBox.x + 2, spanBox.y + spanBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(spanBox.x + spanBox.width - 2, spanBox.y + spanBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('source-highlight').first()).toBeVisible();
  await page.getByTestId('annotation-save').click();
  await expect(page.getByText('已存为标注卡')).toBeVisible();
  const selected = value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))
    .find(card => card.content.title === '文字层 · 第1页');
  const selectedLocator = selected?.content.sources[0]?.locator;
  expect(selectedLocator?.kind).toBe('pdftext');
  if (selectedLocator?.kind !== 'pdftext') throw new Error('selection must anchor pdf text');
  expect(selectedLocator.page).toBe(1);
  const { start, end } = selectedLocator;
  if (start === undefined || end === undefined) throw new Error('pdftext anchor must carry byte offsets');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeLessThanOrEqual('alpha first page'.length);
  expect(end).toBeGreaterThan(start);
  // 字节级自洽：锚点切出的文本必须是页文本同一区间——像素不撒谎。
  const { quote: _q, ...selSource } = selected!.content.sources[0]!;
  const selReading = value(await client.rpc<{ text?: string }>('studyforgeMaterials/read', { input: { source: selSource } }));
  expect(selReading.text).toBe('alpha first page'.slice(start, end));

  // 第二页的整行卡同样落成字形高亮；指路角标在这里没有位置。
  await viewer.getByTestId('pdf-next').click();
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '2');
  const pageTwoMarks = page.getByTestId('annotation-mark');
  await expect(pageTwoMarks).toHaveCount(1);
  await expect(pageTwoMarks.first()).toHaveAttribute('title', '第二页整行');
  await expect(page.getByTestId('annotation-guide')).toHaveCount(0);
  expect(errors).toEqual([]);
});
