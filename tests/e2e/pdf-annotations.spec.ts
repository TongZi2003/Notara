/**
 * PDF 标注层在真实 Host 上：拖框圈选照旧成为会话引用，旁边出现「存为标注」；
 * 点击落成 source-only 卡（真实 pdf rect 锚点），选区高亮转为持久标注层；
 * 点标注进卡库；rpc 预置的标注卡打开页面直接显示为标注层。
 */
import { writeFile } from 'node:fs/promises';
import { test, expect, enterClassroom, openMaterial } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { readerImage } from '../fixtures/materials/reader-image.ts';
import { scannedPdf } from '../fixtures/materials/synthetic-pdf.ts';
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
  expect(errors).toEqual([]);
});
