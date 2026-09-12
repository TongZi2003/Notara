import { test, expect, enterClassroom, sendInput, openRoot } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { CardContentSchema, type CardView } from '@studyforge/contracts/cards';
import type { SetView } from '@studyforge/contracts/sets';
import type { RouteView } from '@studyforge/contracts/routes';

function value<T>(reply: RemoteResult<T>): T { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; }

test('original notebook pages show real books, cards, calendar and learning records at desktop and phone widths', async ({ page, classroom }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterClassroom(page, classroom.authUrl);
  const client = await connectRuntime(classroom);
  await sendInput(page, '先写定义域，再讨论单调性。\n\n公式：$f(x)=x^2$\n\n| 步骤 | 动作 |\n| --- | --- |\n| 1 | 找定义域 |\n\n```js\nconst x = 2;\n```');
  await expect(page.locator('[data-chat-flow-kind="assistant-step"] .katex').first()).toBeVisible();
  await expect(page.locator('[data-chat-flow-kind="assistant-step"] table')).toBeVisible();
  await expect(page.locator('[data-chat-flow-kind="assistant-step"] pre code')).toHaveCSS('font-family', /monospace/);
  const sidebar = page.getByTestId('notebook-sidebar');
  await expect(sidebar).toBeVisible();
  // The notebook column is 196px wide when open; the native frame no longer
  // exposes the old [data-rightbar-collapsed] grid-template hook.
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(180);
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(230);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(180);
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(230);

  const books: MaterialView[] = [];
  for (const [index, title] of ['函数与导数', '三角函数笔记', '解析几何'].entries()) {
    books.push(value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'pages-book-' + index,
      material: { title, fileName: title + '.md', mediaType: 'text/markdown' }, base64: Buffer.from('# ' + title + '\n先理解条件，再写出推理。').toString('base64') } })));
  }
  const cards: CardView[] = [];
  for (const [index, title] of ['先看定义域', '等号成立的条件', '从图像看变化'].entries()) cards.push(value(await client.rpc<CardView>('studyforgeLearning/createCard', {
    input: { operationId: 'pages-card-' + index, content: CardContentSchema.parse({ title, front: '面对一道新的题目，先确定哪些条件？', sections: [{ heading: '思路', body: '整理题目给出的条件。' }], sources: [{ materialId: books[0]!.materialId, versionId: books[0]!.currentVersion.versionId,
      locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 6 } } }] }) },
  })));
  value(await client.rpc<SetView>('studyforgeOrganization/createSet', { input: { operationId: 'pages-set', set: { name: '高考数学', subjects: ['数学'], materials: books.map(book => book.materialId), members: cards.map(card => card.ref) } } }));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const [index, title] of ['函数的定义域', '导数与单调性', '导数的应用'].entries()) value(await client.rpc<RouteView>('studyforgeOrganization/addRouteNode', { input: { operationId: 'pages-route-' + index, node: { title, date } } }));

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const [label, route] of [['首页', 'home'], ['课程', 'courses'], ['资料', 'materials'], ['卡片与笔记', 'cards'], ['管理学习集', 'sets'], ['学情', 'memory'], ['日历', 'calendar']] as const) {
      if (route === 'cards') { await openRoot(page, '资料'); await page.getByTestId('materials-open-cards').click(); }
      else if (route === 'sets') {
        // The picker and management action live in the expanded sidebar body; a
        // narrow rightbar overlay can have collapsed it.
        const sidebar = page.getByTestId('notebook-sidebar');
        if (await sidebar.getAttribute('data-collapsed') === 'true') await sidebar.getByRole('button', { name: '展开侧栏', exact: true }).click();
        await sidebar.getByRole('button', { name: '管理学习集', exact: true }).click();
      }
      else await openRoot(page, label);
      const surface = page.getByTestId('studyforge-page-studyforge.' + route);
      await expect(surface).toBeVisible();
      // Below the native breakpoint the notebook rail collapses on its own; the
      // page keeps its own width only after that re-layout has actually landed.
      if (width === 390 && await sidebar.getAttribute('data-collapsed') !== 'true') {
        // A student who expanded the rail earlier keeps it; at the phone width
        // they fold it themselves so the page keeps a usable column.
        await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
        await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      }
      await expect.poll(async () => (await surface.boundingBox())?.width ?? 0).toBeGreaterThan(290);
      await page.evaluate(async () => { await document.fonts.ready; });
      if (route === 'home') await expect(surface.locator('.home-box')).toHaveCount(4);
      if (route === 'materials') {
        await expect(surface.getByTestId('material-row')).toHaveCount(3);
        await expect(surface.locator('.sf-shelf .cover').first()).toHaveCSS('width', '112px');
      }
      if (route === 'cards') await expect(surface.getByTestId('card-row')).toHaveCount(3);
      if (route === 'calendar') await expect(surface.getByTestId('calendar-course')).toHaveCount(3);
      expect(await surface.evaluate(element => element.scrollWidth <= element.clientWidth + 1), label + ' content width ' + width).toBe(true);
      await page.screenshot({ path: info.outputPath(`notebook-${route}-${width}.png`), fullPage: true });
      if (route === 'materials' && width === 1440) {
        await surface.getByTestId('material-row').first().getByRole('button').first().click();
        await expect(surface).toHaveAttribute('data-reading', 'true');
        await page.reload();
        await expect(surface).toHaveAttribute('data-reading', 'true');
        await surface.getByTestId('materials-back').click();
        await expect(surface).toHaveAttribute('data-reading', 'false');
        await surface.getByTestId('materials-card-row').first().getByRole('button').click();
        await expect(page.getByTestId('card-detail-title')).toHaveText(cards[0]!.content.title);
        await page.goBack();
        await expect(surface).toBeVisible();
      }
    }
  }
  for (const card of cards) expect(value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } })).history).toEqual([]);
  expect(errors).toEqual([]);
});
