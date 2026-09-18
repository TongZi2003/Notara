/**
 * 资料页全文检索：检索框 Enter/「搜全文」走 studyforgeMaterials.search，
 * 命中行显示标题、摘录高亮与位置标签；材料命中沿不可变版本+locator 跳到原文
 * （pdftext 命中翻到对应页），卡命中开内联详情；空结果与清除路径分别断言。
 */
import { writeFile } from 'node:fs/promises';
import { test, expect, enterClassroom, openMaterial } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { textPdf } from '../fixtures/materials/synthetic-pdf.ts';
import type { CardView } from '@studyforge/contracts/cards';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('materials search renders hits and navigates material hits to their locator', async ({ page, classroom }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const pdfFile = info.outputPath('检索书.pdf');
  await writeFile(pdfFile, textPdf([['cover page words'], ['quasar calibration lemma']] ));
  const noteFile = info.outputPath('检索笔记.md');
  await writeFile(noteFile, '# 笔记\n\nharbor lantern method line\n');
  const client = await connectRuntime(classroom);
  // 预置一张卡（在页面加载前），验证非材料语料的命中走向内联详情而不是原文导航。
  value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: 'search-card', content: { title: '检索卡', presentation: 'problem', front: 'zephyr mnemonic phrase 的问题', sections: [{ heading: '解答', body: '解' }], notes: '', sources: [], tags: [], links: [] },
  } }));

  await enterClassroom(page, classroom.authUrl);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(pdfFile);
  await expect(page.getByTestId('material-row').filter({ hasText: '检索书' })).toBeVisible();
  await page.getByTestId('material-file-input').setInputFiles(noteFile);
  await expect(page.getByTestId('material-row').filter({ hasText: '检索笔记' })).toBeVisible();

  const box = page.getByLabel('搜索资料');
  // PDF 文本层命中：命中行显示标题+页标签，点击翻到锚点所在页。
  await box.fill('quasar');
  await box.press('Enter');
  const hit = page.getByTestId('search-hit');
  await expect(hit).toHaveCount(1);
  await expect(hit.first()).toContainText('检索书');
  await expect(hit.first()).toContainText('第 2 页');
  await expect(hit.first().locator('mark')).toHaveText('quasar');
  await hit.first().click();
  const viewer = page.getByTestId('pdf-viewer');
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '2');

  // Markdown 命中：第 N 行标签，点击进原文。
  await page.getByTestId('materials-back').click();
  await box.fill('harbor');
  await page.getByTestId('materials-search-run').click();
  await expect(hit).toHaveCount(1);
  await expect(hit.first()).toContainText('检索笔记');
  await expect(hit.first()).toContainText('第 3 行');

  // 卡命中：点击开内联详情（CardDetail），不走材料导航。
  await box.fill('zephyr');
  await box.press('Enter');
  await expect(hit).toHaveCount(1);
  await expect(hit.first()).toContainText('检索卡');
  await expect(hit.first()).toContainText('题卡');
  await hit.first().click();
  await expect(page.getByTestId('library-detail')).toBeVisible();
  await expect(page.getByTestId('library-detail')).toContainText('zephyr mnemonic phrase');

  // 空结果态与返回目录。
  await page.getByTestId('library-detail').getByRole('button', { name: '关闭资料详情' }).click();
  await box.fill('nonexistent-term');
  await box.press('Enter');
  await expect(page.getByTestId('materials-search-results')).toContainText('没有命中');
  await page.getByTestId('materials-search-close').click();
  await expect(page.getByTestId('materials-search-results')).toHaveCount(0);
  // 返回目录保留标题过滤词——清除筛选后才见到完整目录。
  await expect(page.getByText('没有符合筛选条件的资料')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.getByTestId('library-source-group').first()).toBeVisible();

  expect(errors).toEqual([]);
});
