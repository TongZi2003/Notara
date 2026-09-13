# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook-pages.spec.ts >> original notebook pages show real books, cards, calendar and learning records at desktop and phone widths
- Location: tests/e2e/notebook-pages.spec.ts:11:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-slot="main.conversation"]>[data-phase]')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('[data-slot="main.conversation"]>[data-phase]') with timeout 15000ms
  - waiting for locator('[data-slot="main.conversation"]>[data-phase]')

```

```yaml
- complementary:
  - text: StudyForge
  - button "收起侧栏": ‹
  - combobox "打开学习集":
    - option "全部学习" [selected]
    - option "高考数学"
  - navigation "学习导航":
    - button "首页"
    - button "学习集"
    - button "课程"
    - button "New session": ＋
    - button "资料"
    - button "日历"
    - button "学情"
  - text: 最 近
  - button "一次函数学习 09/13":
    - text: 一次函数学习
    - time: 09/13
  - button "Settings":
    - img
    - text: Settings
  - text: 已连接
- main:
  - navigation "课堂视图":
    - button "对话" [pressed]
    - button "思维图"
    - button "资料工作台"
  - group: ▥
  - region "对话":
    - button "拖动对话": 对话
    - button "对话布局": ⋯
    - button "关闭对话": ×
    - text: 今天想学什么？
    - button "Choose workspace":
      - img
      - text: 学习空间
      - img
    - button "教学者":
      - img
      - text: 教学者
      - img
    - textbox "写下你想学习的内容…"
    - group: ＋
    - combobox "智能体身份":
      - option "教学者" [selected]
      - option "创作者"
    - group: 涉及科目
    - button "Select model, current study-model-a, reasoning effort 简短":
      - text: study-model-a 简短
      - img
    - button "Send message" [disabled]
```

# Test source

```ts
  1   | import { test, expect, enterClassroom, sendInput, openRoot } from './fixtures/classroom.ts';
  2   | import { connectRuntime } from '../fixtures/http-runtime.ts';
  3   | import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
  4   | import type { MaterialView } from '@studyforge/contracts/material-records';
  5   | import { CardContentSchema, type CardView } from '@studyforge/contracts/cards';
  6   | import type { SetView } from '@studyforge/contracts/sets';
  7   | import type { RouteView } from '@studyforge/contracts/routes';
  8   |
  9   | function value<T>(reply: RemoteResult<T>): T { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; }
  10  |
  11  | test('original notebook pages show real books, cards, calendar and learning records at desktop and phone widths', async ({ page, classroom }, info) => {
  12  |   const errors: string[] = [];
  13  |   page.on('pageerror', error => errors.push(error.message));
  14  |   await page.setViewportSize({ width: 1440, height: 1000 });
  15  |   await enterClassroom(page, classroom.authUrl);
  16  |   const client = await connectRuntime(classroom);
  17  |   await sendInput(page, '先写定义域，再讨论单调性。\n\n公式：$f(x)=x^2$\n\n| 步骤 | 动作 |\n| --- | --- |\n| 1 | 找定义域 |\n\n```js\nconst x = 2;\n```');
  18  |   await expect(page.locator('[data-chat-flow-kind="assistant-step"] .katex').first()).toBeVisible();
  19  |   await expect(page.locator('[data-chat-flow-kind="assistant-step"] table')).toBeVisible();
  20  |   await expect(page.locator('[data-chat-flow-kind="assistant-step"] pre code')).toHaveCSS('font-family', /monospace/);
  21  |   const sidebar = page.getByTestId('notebook-sidebar');
  22  |   await expect(sidebar).toBeVisible();
  23  |   // The notebook column is 196px wide when open; the native frame no longer
  24  |   // exposes the old [data-rightbar-collapsed] grid-template hook.
  25  |   await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(180);
  26  |   await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(230);
  27  |   await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  28  |   await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  29  |   await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  30  |   await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(180);
  31  |   await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(230);
  32  |
  33  |   const books: MaterialView[] = [];
  34  |   for (const [index, title] of ['函数与导数', '三角函数笔记', '解析几何'].entries()) {
  35  |     books.push(value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'pages-book-' + index,
  36  |       material: { title, fileName: title + '.md', mediaType: 'text/markdown' }, base64: Buffer.from('# ' + title + '\n先理解条件，再写出推理。').toString('base64') } })));
  37  |   }
  38  |   const cards: CardView[] = [];
  39  |   for (const [index, title] of ['先看定义域', '等号成立的条件', '从图像看变化'].entries()) cards.push(value(await client.rpc<CardView>('studyforgeLearning/createCard', {
  40  |     input: { operationId: 'pages-card-' + index, content: CardContentSchema.parse({ title, front: '面对一道新的题目，先确定哪些条件？', sections: [{ heading: '思路', body: '整理题目给出的条件。' }], sources: [{ materialId: books[0]!.materialId, versionId: books[0]!.currentVersion.versionId,
  41  |       locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 6 } } }] }) },
  42  |   })));
  43  |   value(await client.rpc<SetView>('studyforgeOrganization/createSet', { input: { operationId: 'pages-set', set: { name: '高考数学', subjects: ['数学'], materials: books.map(book => book.materialId), members: cards.map(card => card.ref) } } }));
  44  |   const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  45  |   for (const [index, title] of ['函数的定义域', '导数与单调性', '导数的应用'].entries()) value(await client.rpc<RouteView>('studyforgeOrganization/addRouteNode', { input: { operationId: 'pages-route-' + index, node: { title, date } } }));
  46  |
  47  |   for (const width of [1440, 390]) {
  48  |     await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  49  |     for (const [label, route] of [['首页', 'home'], ['课程', 'courses'], ['资料', 'materials'], ['卡片与笔记', 'cards'], ['管理学习集', 'sets'], ['学情', 'memory'], ['日历', 'calendar']] as const) {
  50  |       if (route === 'cards') { await openRoot(page, '资料'); await page.getByTestId('materials-open-cards').click(); }
  51  |       else if (route === 'sets') {
  52  |         // The picker and management action live in the expanded sidebar body; a
  53  |         // narrow rightbar overlay can have collapsed it.
  54  |         const sidebar = page.getByTestId('notebook-sidebar');
  55  |         if (await sidebar.getAttribute('data-collapsed') === 'true') await sidebar.getByRole('button', { name: '展开侧栏', exact: true }).click();
  56  |         await sidebar.getByRole('button', { name: '学习集', exact: true }).click();
  57  |       }
  58  |       else await openRoot(page, label);
  59  |       const surface = route === 'home' ? page.locator('[data-slot="main.conversation"]>[data-phase]') : page.getByTestId('studyforge-page-studyforge.' + route);
> 60  |       await expect(surface).toBeVisible();
      |                             ^ Error: expect(locator).toBeVisible() failed
  61  |       // Below the native breakpoint the notebook rail collapses on its own; the
  62  |       // page keeps its own width only after that re-layout has actually landed.
  63  |       if (width === 390 && await sidebar.getAttribute('data-collapsed') !== 'true') {
  64  |         // A student who expanded the rail earlier keeps it; at the phone width
  65  |         // they fold it themselves so the page keeps a usable column.
  66  |         await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  67  |         await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  68  |       }
  69  |       await expect.poll(async () => (await surface.boundingBox())?.width ?? 0).toBeGreaterThan(290);
  70  |       await page.evaluate(async () => { await document.fonts.ready; });
  71  |       if (route === 'home') await expect(surface.getByTestId('agent-role')).toBeVisible();
  72  |       if (route === 'materials') {
  73  |         await expect(surface.getByTestId('material-row')).toHaveCount(6);
  74  |         await expect(surface.locator('.sf-library-row')).toHaveCount(6);
  75  |       }
  76  |       if (route === 'cards') {
  77  |         await expect(surface.getByTestId('card-row')).toHaveCount(3);
  78  |         await expect(surface.getByTestId('card-list')).toHaveCSS('display', 'block');
  79  |         const rows = await surface.getByTestId('card-row').all();
  80  |         const boxes = await Promise.all(rows.map(row => row.boundingBox()));
  81  |         for (let i = 1; i < boxes.length; i++) {
  82  |           expect(boxes[i]!.x).toBeCloseTo(boxes[0]!.x, 0);
  83  |           expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height);
  84  |         }
  85  |       }
  86  |       if (route === 'courses') {
  87  |         await surface.getByTestId('courses-view').selectOption('list');
  88  |         await expect(surface.getByTestId('roadmap-nodes')).toHaveCSS('display', 'block');
  89  |         await expect(surface.getByTestId('roadmap-node')).toHaveCount(3);
  90  |       }
  91  |       if (route === 'calendar') {
  92  |         await page.getByRole('button', { name: '今天', exact: true }).click();
  93  |         await expect(surface.getByTestId('calendar-course')).toHaveCount(3);
  94  |         await surface.getByTestId('calendar-view-list').click();
  95  |         await expect(surface.getByTestId('calendar-list')).toHaveCSS('display', 'block');
  96  |       }
  97  |       expect(await surface.evaluate(element => element.scrollWidth <= element.clientWidth + 1), label + ' content width ' + width).toBe(true);
  98  |       await page.screenshot({ path: info.outputPath(`notebook-${route}-${width}.png`), fullPage: true });
  99  |       if (route === 'materials' && width === 1440) {
  100 |         await surface.getByTestId('material-row').first().getByRole('button').first().click();
  101 |         await surface.getByRole('button', { name: '阅读原文', exact: true }).click();
  102 |         await expect(surface).toHaveAttribute('data-reading', 'true');
  103 |         await page.reload();
  104 |         await expect(surface).toHaveAttribute('data-reading', 'true');
  105 |         await surface.getByTestId('materials-back').click();
  106 |         await expect(surface).toHaveAttribute('data-reading', 'false');
  107 |         await surface.getByRole('button', { name: new RegExp(cards[0]!.content.title) }).click();
  108 |         await expect(page.getByTestId('card-detail-title')).toHaveText(cards[0]!.content.title);
  109 |         await surface.getByRole('button', { name: '关闭资料详情', exact: true }).click();
  110 |         await expect(surface).toBeVisible();
  111 |       }
  112 |     }
  113 |   }
  114 |   for (const card of cards) expect(value(await client.rpc<CardView>('studyforgeLearning/card', { input: { target: card.ref } })).history).toEqual([]);
  115 |   expect(errors).toEqual([]);
  116 | });
  117 |
```
