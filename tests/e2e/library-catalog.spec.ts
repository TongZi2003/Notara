import { test, expect, enterClassroom, openRoot, openAppearance, closeAppearance } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('library hierarchy, direct tags, shared identity and mobile preview work in both themes', async ({ page, classroom }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const client = await connectRuntime(classroom), books: MaterialView[] = [];
  for (const title of ['三角恒等变换讲义', '数学公式手册']) books.push(value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: {
    operationId: title, material: { title, fileName: title + '.md', mediaType: 'text/markdown' }, base64: Buffer.from('# ' + title + '\n观察角之间的关系。').toString('base64'),
  } })));
  const anchor = (book: MaterialView) => ({ materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 9 } } });
  for (const [index, book] of books.entries()) value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: {
    operationId: 'outline-' + index, materialId: book.materialId, expectedVersion: 0,
    change: { nodes: ['三角函数', '三角函数/和差公式', '三角函数/和差公式/配角', index === 0 ? '三角函数/象限' : '三角函数/倍角'].map(path => ({ path, sources: [anchor(book)] })) },
  } }));
  const seeds = [
    { title: '和差公式的角度组合', tags: ['和差公式', '角度变换'], chapter: '三角函数/和差公式/配角', sources: [anchor(books[0]!), anchor(books[0]!), anchor(books[1]!)] },
    { title: '利用象限确定目标角的范围', tags: ['象限判断'], chapter: '三角函数/象限', sources: [anchor(books[0]!)] },
    { title: '倍角公式与平方关系', tags: ['倍角公式'], chapter: '三角函数/倍角', sources: [anchor(books[1]!)] },
    { title: '自己的解题提醒', tags: ['易错点'], sources: [] },
  ];
  const cards: CardView[] = [];
  for (const seed of seeds) cards.push(value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: seed.title, content: { ...seed, front: '先观察已知角与目标角，再选择公式。' },
  } })));
  await page.setViewportSize({ width: 1154, height: 747 }); await enterClassroom(page, classroom.authUrl);
  // 手帐主题入口已下线（本轮只发布极简主题）：这里仍按已发布主题逐个跑一遍，
  // 手帐主题重新开放后把 'notebook' 加回这个列表即可恢复双主题覆盖。
  for (const style of ['modern'] as const) {
    await openAppearance(page); await closeAppearance(page); await openRoot(page, '资料');
    const catalog = page.getByTestId('materials-list'), first = page.getByTestId('library-source-group').filter({ has: page.locator(`[data-material-title="${books[0]!.title}"]`) }), second = page.getByTestId('library-source-group').filter({ has: page.locator(`[data-material-title="${books[1]!.title}"]`) });
    await expect(page.getByRole('combobox', { name: '筛选标签' })).toBeVisible();
    await expect(page.getByTestId('library-source-group')).toHaveCount(2);
    await expect(catalog.locator('.sf-library-item')).toHaveCount(0);
    await first.locator('.sf-library-source-open').click();
    await first.getByRole('button', { name: '三角函数', exact: true }).click();
    await expect(first.locator('.sf-library-item')).toHaveCount(0);
    await first.getByRole('button', { name: '和差公式', exact: true }).click();
    await expect(first.locator('.sf-library-item')).toHaveCount(0);
    await first.getByRole('button', { name: '配角', exact: true }).click();
    await expect(first.locator('.sf-library-item')).toHaveCount(1);
    await first.getByRole('button', { name: '象限', exact: true }).click();
    await expect(first.locator('.sf-library-item')).toHaveCount(2);
    await expect(catalog.locator('.sf-linear-tree')).toHaveCount(0);
    await expect(first.locator('.sf-library-source-open strong')).toHaveCSS('font-size', '16px');
    await expect(first.locator('.sf-library-item-open').first()).toHaveCSS('font-size', '15px');
    await page.screenshot({ path: info.outputPath(`${style}-library.png`), fullPage: true });
    await first.locator('.sf-library-source-open').click();
    await expect(first.locator('.sf-library-item')).toHaveCount(0);
    await first.locator('.sf-library-source-open').click();
    await expect(first.getByRole('button', { name: '三角函数', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('combobox', { name: '筛选标签' }).selectOption('和差公式');
    await expect(first.locator('.sf-library-item')).toHaveCount(0); // filtering never opens every descendant
    for (const name of ['三角函数', '和差公式', '配角']) await first.getByRole('button', { name, exact: true }).click();
    await second.locator('.sf-library-source-open').click();
    for (const name of ['三角函数', '和差公式', '配角']) await second.getByRole('button', { name, exact: true }).click();
    await expect(catalog.locator('.sf-library-item')).toHaveCount(2); // one identity under two sources
    await expect(catalog.locator('.sf-library-item').first()).toHaveAttribute('data-ref', cards[0]!.ref);
    await expect(catalog.locator('.sf-library-item').last()).toHaveAttribute('data-ref', cards[0]!.ref);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索资料', exact: true }).fill('公式手册');
    await second.getByRole('button', { name: '倍角', exact: true }).click();
    await expect(catalog.locator('.sf-library-item')).toHaveCount(3); // source title finds its two cards, including the cross-book reference
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await first.getByRole('button', { name: '象限', exact: true }).click();
    await first.getByRole('button', { name: '筛选标签：象限判断', exact: true }).click();
    await expect(catalog.locator('.sf-library-item')).toHaveCount(1);
    await expect(page.getByRole('combobox', { name: '筛选标签' })).toHaveValue('象限判断');
    await catalog.locator('.sf-library-item-open').click();
    await page.getByTestId('card-detail-edit').click();
    await expect(page.getByTestId('card-editor')).toBeVisible();
    await expect.poll(() => page.getByTestId('library-detail').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`${style}-library-editor.png`), fullPage: true });
    await page.getByRole('button', { name: '关闭资料详情', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.getByTestId('library-browser').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('combobox', { name: '筛选标签' })).toHaveJSProperty('value', '象限判断');
    await page.screenshot({ path: info.outputPath(`${style}-library-tree-mobile.png`), fullPage: true });
    await catalog.locator('.sf-library-item-open').click();
    const detail = page.getByTestId('library-detail');
    await expect(detail).toBeVisible(); await expect(catalog).toBeHidden();
    await expect(detail.getByTestId('card-detail-front')).toContainText('先观察已知角');
    await expect.poll(() => page.getByTestId('library-browser').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`${style}-library-preview-mobile.png`), fullPage: true });
    await page.getByRole('button', { name: '关闭资料详情', exact: true }).click(); await expect(catalog).toBeVisible();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.setViewportSize({ width: 1154, height: 747 });
    await page.reload(); await openRoot(page, '资料');
    await expect(page.getByTestId('materials-list').locator('.sf-library-item')).toHaveCount(0);
  }
  expect(value(await client.rpc<CardView[]>('studyforgeLearning/cards', {})).map(card => card.ref).sort()).toEqual(cards.map(card => card.ref).sort());
  expect(errors).toEqual([]);
});
